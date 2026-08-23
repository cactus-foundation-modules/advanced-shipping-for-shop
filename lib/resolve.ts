// Delivery-service resolution: given a set of product ids, work out which
// services each is offered and at what price and timing, batched so a whole
// cart is a handful of queries rather than one per line.
//
// One most-specific-wins stack: each service resolves to the first scope its
// config rows match - range, else category (nearest ancestor), else supplier,
// else default - and that row decides price and any timing override. A service with no matching row is simply not offered. Where several
// rows match at equal specificity (a product carrying two range values, say)
// the tiebreak picks the one giving the LATEST delivery, so the shop never
// over-promises.
import { prisma } from '@/lib/db/prisma'
import { Prisma } from '@prisma/client'
import type { ShpOutOfStockBehaviour } from '@/modules/shop/lib/types'
import type {
  ResolvedTier,
  ScopeType,
  ServiceTier,
  StockState,
  TierScopeConfig,
} from '@/modules/advanced-shipping-for-shop/lib/types'
import { getSettingsCached } from '@/modules/advanced-shipping-for-shop/lib/db/settings'
import { listTiersCached, listTierConfigCached } from '@/modules/advanced-shipping-for-shop/lib/db/tiers'
import { getVariantParents, getVariantRangeValues } from '@/modules/advanced-shipping-for-shop/lib/variations-bridge'

// The per-product scope facts the resolver keys on.
export type ScopeCtx = {
  rangeValueIds: string[]
  categoryChain: string[] // nearest (self) -> root
  supplier: string | null
}

export type ResolvedTierOption = {
  key: string
  label: string
  description: string | null
  price: string // decimal string, "10.00"
  available: boolean
  modifiers: ResolvedTier
}

export type ProductDelivery = {
  productId: string
  stock: StockState
  tiers: ResolvedTierOption[]
  // Stock per service, set only on the listing-wide preview a product page
  // builds out of a set of variations (see mergeVariantDeliveries). There the
  // service and the stock come from different variations - the slowest one
  // carrying express need not be the slowest one overall - so a single stock for
  // the whole listing would date some services off a variation that does not
  // even offer them. Absent on a real product, whose stock is simply its own.
  stockByTier?: Map<string, StockState>
}

export type ResolveContext = {
  now: Date
  timezone: string
  holidays: Set<string>
}

type ProductRow = {
  id: string
  supplier: string | null
  master_category_id: string | null
  track_inventory: boolean
  stock_count: number | null
  out_of_stock_behaviour: string
  is_pre_order: boolean
  pre_order_dispatch_date: Date | null
}

const SPECIFICITY: ScopeType[] = ['RANGE', 'CATEGORY', 'SUPPLIER', 'DEFAULT']

// True when a scoped row applies to this product at the given tier.
function matchesScope(scopeType: ScopeType, scopeRef: string | null, ctx: ScopeCtx): boolean {
  switch (scopeType) {
    case 'DEFAULT':
      return true
    case 'SUPPLIER':
      return scopeRef != null && scopeRef === ctx.supplier
    case 'CATEGORY':
      return scopeRef != null && ctx.categoryChain.includes(scopeRef)
    case 'RANGE':
      return scopeRef != null && ctx.rangeValueIds.includes(scopeRef)
  }
}

// Rows of the most specific scope tier that matches, ready for a tiebreak. For
// CATEGORY the "nearest ancestor" is honoured by returning only the rows on the
// closest category in the chain, so a row on the product's own category beats
// one on its grandparent.
export function pickMostSpecific<T extends { scopeType: ScopeType; scopeRef: string | null }>(
  rows: T[],
  ctx: ScopeCtx,
): T[] {
  for (const tier of SPECIFICITY) {
    const atTier = rows.filter((r) => r.scopeType === tier)
    if (atTier.length === 0) continue
    if (tier === 'CATEGORY') {
      for (const catId of ctx.categoryChain) {
        const here = atTier.filter((r) => r.scopeRef === catId)
        if (here.length > 0) return here
      }
      continue
    }
    const matches = atTier.filter((r) => matchesScope(r.scopeType, r.scopeRef, ctx))
    if (matches.length > 0) return matches
  }
  return []
}

// The service's own timing patched by any non-null override on the winning
// scope row. A scope wanting NO minimum where the service has one sets 0.
export function tierModifiers(tier: ServiceTier, config?: TierScopeConfig): ResolvedTier {
  return {
    transitDays: config?.transitDays ?? tier.transitDays,
    minLeadDays: config?.minLeadDays ?? tier.minLeadDays,
  }
}

// Among equal-specificity config candidates, the one promising the LATEST
// delivery (never over-promise): the largest effective transit, then the larger
// minimum floor as the tiebreak.
export function latestConfig(tier: ServiceTier, candidates: TierScopeConfig[]): TierScopeConfig {
  const [first, ...rest] = candidates
  if (!first) throw new Error('latestConfig requires at least one candidate')
  if (rest.length === 0) return first
  let best = first
  for (const c of candidates) {
    const cm = tierModifiers(tier, c)
    const bm = tierModifiers(tier, best)
    if (
      cm.transitDays > bm.transitDays ||
      (cm.transitDays === bm.transitDays && (cm.minLeadDays ?? 0) > (bm.minLeadDays ?? 0))
    ) {
      best = c
    }
  }
  return best
}

function stockOf(row: ProductRow): StockState {
  return {
    trackInventory: row.track_inventory,
    stockCount: row.stock_count,
    outOfStockBehaviour: (row.out_of_stock_behaviour as ShpOutOfStockBehaviour) === 'BACKORDER' ? 'BACKORDER' : 'BLOCK',
    isPreOrder: row.is_pre_order,
    preOrderDispatchDate: row.pre_order_dispatch_date ? row.pre_order_dispatch_date.toISOString().slice(0, 10) : null,
  }
}

// Resolves each product id to its stock state and the delivery services offered
// to it. Products offered no service at all are simply absent from the map, so
// the storefront shows no estimate for them.
export async function resolveProductDeliveries(
  productIds: string[],
  _ctx: ResolveContext,
): Promise<Map<string, ProductDelivery>> {
  const result = new Map<string, ProductDelivery>()
  const ids = [...new Set(productIds)].filter(Boolean)
  if (ids.length === 0) return result

  // A cart line for a product with options holds the hidden variant CHILD
  // product, and the child carries none of the scope facts services key on - the
  // range attribute, category and supplier all sit on the parent. Map children
  // to parents up front and fetch the parents' facts alongside, so a variant
  // line resolves exactly as its parent would.
  const parentByChild = await getVariantParents(ids)
  const allIds = [...new Set([...ids, ...parentByChild.values()])]

  const [settings, tiers, tierConfig, productRows] = await Promise.all([
    getSettingsCached(),
    listTiersCached(),
    listTierConfigCached(),
    prisma.$queryRaw<ProductRow[]>`
      SELECT "id", "supplier", "master_category_id", "track_inventory", "stock_count",
             "out_of_stock_behaviour", "is_pre_order", "pre_order_dispatch_date"
      FROM "shp_products" WHERE "id" IN (${Prisma.join(allIds)})
    `,
  ])

  if (tiers.length === 0) return result

  // Range value ids per product (only when the admin has designated a range
  // attribute), joined through to the chosen attribute's values.
  const rangeByProduct = new Map<string, string[]>()
  if (settings.rangeAttributeId) {
    const rangeRows = await prisma.$queryRaw<{ product_id: string; value_id: string }[]>`
      SELECT pv."product_id", pv."value_id"
      FROM "pat_product_values" pv
      JOIN "pat_attribute_values" av ON av."id" = pv."value_id"
      WHERE pv."product_id" IN (${Prisma.join(allIds)}) AND av."attribute_id" = ${settings.rangeAttributeId}
    `
    for (const r of rangeRows) {
      const list = rangeByProduct.get(r.product_id) ?? []
      list.push(r.value_id)
      rangeByProduct.set(r.product_id, list)
    }
  }

  // Per-variation range: when the range attribute has been set up as a variation
  // option rather than a product-level attribute, each variant child carries its
  // own range value in the shop-variations tables, not pat_product_values. Read
  // it keyed by child id so a variant line can prefer its own range over the
  // parent's (see the fallback below). Only the requested ids can be children.
  const variantRangeByChild = settings.rangeAttributeId
    ? await getVariantRangeValues(ids, settings.rangeAttributeId)
    : new Map<string, string[]>()

  // Category ancestry for every distinct master category in ONE recursive CTE
  // (this used to be one query per distinct category - a mixed cart paid a
  // round-trip per department). depth 0 is the category itself, rising towards
  // the root, so ordering by depth yields the self -> root chain directly. The
  // depth cap guards against a cyclic parent link ever looping the recursion.
  const chainByCategory = new Map<string, string[]>()
  const distinctCategoryIds = [...new Set(productRows.map((r) => r.master_category_id).filter((c): c is string => !!c))]
  if (distinctCategoryIds.length > 0) {
    const trailRows = await prisma.$queryRaw<{ start_id: string; id: string }[]>`
      WITH RECURSIVE trail AS (
        SELECT "id", "parent_id", "id" AS start_id, 0 AS depth
        FROM "shp_categories" WHERE "id" IN (${Prisma.join(distinctCategoryIds)})
        UNION ALL
        SELECT c."id", c."parent_id", t.start_id, t.depth + 1
        FROM "shp_categories" c JOIN trail t ON c."id" = t."parent_id"
        WHERE t.depth < 50
      )
      SELECT start_id, "id" FROM trail ORDER BY start_id, depth ASC
    `
    for (const row of trailRows) {
      const chain = chainByCategory.get(row.start_id) ?? []
      chain.push(row.id)
      chainByCategory.set(row.start_id, chain)
    }
  }

  const rowById = new Map(productRows.map((r) => [r.id, r]))
  const requested = new Set(ids)

  for (const row of productRows) {
    if (!requested.has(row.id)) continue // a parent fetched only for its scope facts
    // A variant child falls back to its parent for every scope fact it lacks:
    // category/supplier fill in only when the child's own field is empty, and
    // range likewise. A child's OWN range is either a product-level value on the
    // child (rare) or, when the range attribute is a per-variation option, the
    // value carried by its variation selection. When the child has a range of its
    // own the parent's product-level range is NOT mixed in - the variation's
    // range is the more specific truth and should win outright.
    const parentId = parentByChild.get(row.id)
    const parentRow = parentId ? rowById.get(parentId) : undefined
    const ownRange = [...new Set([...(rangeByProduct.get(row.id) ?? []), ...(variantRangeByChild.get(row.id) ?? [])])]
    const parentRange = parentRow ? rangeByProduct.get(parentRow.id) ?? [] : []
    const ownChain = row.master_category_id ? chainByCategory.get(row.master_category_id) ?? [] : []
    const parentChain = parentRow?.master_category_id ? chainByCategory.get(parentRow.master_category_id) ?? [] : []
    const ctxScope: ScopeCtx = {
      rangeValueIds: ownRange.length > 0 ? ownRange : parentRange,
      categoryChain: ownChain.length > 0 ? ownChain : parentChain,
      supplier: row.supplier ?? parentRow?.supplier ?? null,
    }
    const stock = stockOf(row)

    // Each service's most-specific scope row for this product. A service with no
    // matching row is not offered - unless it is the shop's designated default
    // service, which is offered everywhere at price 0 on its own timing.
    const tierOptions: ResolvedTierOption[] = []
    for (const tier of tiers) {
      const configForTier = tierConfig.filter((c: TierScopeConfig) => c.tierId === tier.id)
      const candidates = pickMostSpecific(configForTier, ctxScope)
      const winningConfig = candidates.length > 0 ? latestConfig(tier, candidates) : undefined
      const isDefaultTier = settings.defaultTierKey != null && tier.key === settings.defaultTierKey
      if (!winningConfig && !isDefaultTier) continue
      if (winningConfig && !winningConfig.available) continue
      tierOptions.push({
        key: tier.key,
        label: tier.label,
        description: tier.description,
        price: winningConfig ? winningConfig.price : '0.00',
        available: true,
        modifiers: tierModifiers(tier, winningConfig),
      })
    }
    if (tierOptions.length === 0) continue // no service -> no estimate for this product

    result.set(row.id, {
      productId: row.id,
      stock,
      tiers: tierOptions,
    })
  }

  return result
}

// The service option for one product + service key, for the cart-line resolver
// to re-price a chosen service server-side. Returns null when the service is
// not offered for that product (an invalid or stale selection).
export function findTierOption(delivery: ProductDelivery, tierKey: string): ResolvedTierOption | null {
  return delivery.tiers.find((t) => t.key === tierKey) ?? null
}
