// Rule + tier resolution: given a set of product ids, work out which delivery
// rule and which service tiers apply to each, batched so a whole cart is a
// handful of queries rather than one per line.
//
// Stacking is flat, most-specific-wins whole (no field-level inheritance): a
// product resolves to the first scope tier it matches - range, else category
// (nearest ancestor), else supplier, else default - and the entire winning rule
// is used. A per-product override is the one place a winning rule is patched
// field by field. Where several rules match at equal specificity (a product
// carrying two range values, say) the tiebreak picks the one giving the LATEST
// delivery date, so the shop never over-promises.
import { prisma } from '@/lib/db/prisma'
import { Prisma } from '@prisma/client'
import type { ShpOutOfStockBehaviour } from '@/modules/shop/lib/types'
import type {
  DeliveryRule,
  ProductOverride,
  ResolvedRule,
  ResolvedTier,
  ScopeType,
  ServiceTier,
  StockState,
  TierScopeConfig,
} from '@/modules/advanced-shipping-for-shop/lib/types'
import { getSettingsCached } from '@/modules/advanced-shipping-for-shop/lib/db/settings'
import { listRulesCached } from '@/modules/advanced-shipping-for-shop/lib/db/rules'
import { listTiersCached, listTierConfigCached } from '@/modules/advanced-shipping-for-shop/lib/db/tiers'
import { getOverridesByProduct } from '@/modules/advanced-shipping-for-shop/lib/db/overrides'
import { getVariantParents } from '@/modules/advanced-shipping-for-shop/lib/variations-bridge'
import { computeEstimate } from '@/modules/advanced-shipping-for-shop/lib/estimate'

// The per-product scope facts the resolver keys on.
export type ScopeCtx = {
  rangeValueIds: string[]
  categoryChain: string[] // nearest (self) -> root
  supplier: string | null
}

export type ResolvedTierOption = {
  key: string
  label: string
  price: string // decimal string - the BASE price; per-person multiplication is
  // applied by the line resolver using the delivery's perPersonCount.
  available: boolean
  perPerson: boolean
  modifiers: ResolvedTier
}

export type ProductDelivery = {
  productId: string
  disabled: boolean
  rule: ResolvedRule
  stock: StockState
  tiers: ResolvedTierOption[]
  // Person count read off the nominated count attribute for this line, or null
  // when no attribute is nominated or its value carries no readable number. A
  // per-person tier on a line whose count is null is blocked, never mispriced.
  perPersonCount: number | null
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

// Rows of the most specific tier that matches, ready for a tiebreak. For
// CATEGORY the "nearest ancestor" is honoured by returning only the rows on the
// closest category in the chain, so a rule on the product's own category beats
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

export function ruleToResolved(rule: DeliveryRule): ResolvedRule {
  return {
    fulfilmentMode: rule.fulfilmentMode,
    cutoffTime: rule.cutoffTime,
    dispatchLeadDays: rule.dispatchLeadDays,
    mtoLeadDays: rule.mtoLeadDays,
    transitDays: rule.transitDays,
    shipDays: rule.shipDays,
    backorderLeadDays: rule.backorderLeadDays,
  }
}

// Patches the winning rule with any non-null override field - the single place
// field-level patching is allowed.
export function applyOverride(rule: ResolvedRule, override: ProductOverride | undefined): ResolvedRule {
  if (!override) return rule
  return {
    fulfilmentMode: override.fulfilmentMode ?? rule.fulfilmentMode,
    cutoffTime: override.cutoffTime ?? rule.cutoffTime,
    dispatchLeadDays: override.dispatchLeadDays ?? rule.dispatchLeadDays,
    mtoLeadDays: override.mtoLeadDays ?? rule.mtoLeadDays,
    transitDays: override.transitDays ?? rule.transitDays,
    shipDays: rule.shipDays,
    backorderLeadDays: override.backorderLeadDays ?? rule.backorderLeadDays,
  }
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

// Among equal-specificity rule candidates, the one whose estimate lands latest
// (never over-promise). Availability is ignored for the sort - an unavailable
// candidate has no date to compare - so an available rule is preferred, and the
// latest date wins among those.
export function latestRule(candidates: DeliveryRule[], stock: StockState, ctx: ResolveContext): DeliveryRule {
  const [first, ...rest] = candidates
  if (!first) throw new Error('latestRule requires at least one candidate')
  if (rest.length === 0) return first
  let best = first
  let bestDate = ''
  for (const rule of candidates) {
    const est = computeEstimate({ now: ctx.now, timezone: ctx.timezone, holidays: ctx.holidays, rule: ruleToResolved(rule), stock })
    const date = est.targetDate ?? ''
    if (date > bestDate) {
      bestDate = date
      best = rule
    }
  }
  return best
}

// The person count carried by a nominated count-attribute value's label. The
// label is free text the shop types ("6 People", "6", "6-seat bench"), so the
// first whole number in it is taken as the count. Returns null when there is no
// positive number to read, which blocks a per-person line rather than guessing.
export function parsePersonCount(label: string | null | undefined): number | null {
  if (!label) return null
  const match = label.match(/\d+/)
  if (!match) return null
  const n = Number.parseInt(match[0], 10)
  return Number.isFinite(n) && n > 0 ? n : null
}

// A tier bound to a supplier is offered only for that supplier's products; a
// tier with no supplier is offered to every product. This is the tier-level
// supplier gate (distinct from a scope-config's SUPPLIER scope).
export function tierAppliesToSupplier(tier: Pick<ServiceTier, 'supplier'>, supplier: string | null): boolean {
  return tier.supplier == null || tier.supplier === supplier
}

function tierModifiers(tier: ServiceTier): ResolvedTier {
  return {
    isNextDay: tier.isNextDay,
    dispatchLeadDelta: tier.dispatchLeadDelta,
    transitDelta: tier.transitDelta,
    minLeadDays: tier.minLeadDays,
  }
}

// Resolves each product id to its delivery rule (override-patched), stock state
// and the service tiers offered to it. Products with no matching rule are simply
// absent from the map, so the storefront shows no estimate for them.
export async function resolveProductDeliveries(
  productIds: string[],
  ctx: ResolveContext,
): Promise<Map<string, ProductDelivery>> {
  const result = new Map<string, ProductDelivery>()
  const ids = [...new Set(productIds)].filter(Boolean)
  if (ids.length === 0) return result

  // A cart line for a product with options holds the hidden variant CHILD
  // product, and the child carries none of the scope facts rules key on - the
  // range attribute, category and supplier all sit on the parent. Map children
  // to parents up front and fetch the parents' facts alongside, so a variant
  // line resolves exactly as its parent would.
  const parentByChild = await getVariantParents(ids)
  const allIds = [...new Set([...ids, ...parentByChild.values()])]

  const [settings, rules, tiers, tierConfig, overrides, productRows] = await Promise.all([
    getSettingsCached(),
    listRulesCached(),
    listTiersCached(),
    listTierConfigCached(),
    getOverridesByProduct(allIds),
    prisma.$queryRaw<ProductRow[]>`
      SELECT "id", "supplier", "master_category_id", "track_inventory", "stock_count",
             "out_of_stock_behaviour", "is_pre_order", "pre_order_dispatch_date"
      FROM "shp_products" WHERE "id" IN (${Prisma.join(allIds)})
    `,
  ])

  if (rules.length === 0) return result

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

  // Person count per product for per-person tier pricing, read the same way as
  // the range attribute (variant children carry their own value in
  // pat_product_values keyed by the child id). Only read when a count attribute
  // is nominated. First readable number in the value label wins.
  const countByProduct = new Map<string, number>()
  if (settings.perPersonAttributeId) {
    const countRows = await prisma.$queryRaw<{ product_id: string; label: string }[]>`
      SELECT pv."product_id", av."label"
      FROM "pat_product_values" pv
      JOIN "pat_attribute_values" av ON av."id" = pv."value_id"
      WHERE pv."product_id" IN (${Prisma.join(allIds)}) AND av."attribute_id" = ${settings.perPersonAttributeId}
    `
    for (const r of countRows) {
      const n = parsePersonCount(r.label)
      // A product may hold several values (one per variation helping); the
      // largest readable count wins, so a line never under-charges.
      if (n != null && n > (countByProduct.get(r.product_id) ?? 0)) countByProduct.set(r.product_id, n)
    }
  }

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

  const tierByKey = new Map(tiers.map((t) => [t.id, t]))
  const rowById = new Map(productRows.map((r) => [r.id, r]))
  const requested = new Set(ids)

  for (const row of productRows) {
    if (!requested.has(row.id)) continue // a parent fetched only for its scope facts
    // A variant child falls back to its parent for every scope fact it lacks:
    // range values union in (children carry none of their own today), and
    // category/supplier fill in only when the child's own field is empty.
    const parentId = parentByChild.get(row.id)
    const parentRow = parentId ? rowById.get(parentId) : undefined
    const ownRange = rangeByProduct.get(row.id) ?? []
    const parentRange = parentRow ? rangeByProduct.get(parentRow.id) ?? [] : []
    const ownChain = row.master_category_id ? chainByCategory.get(row.master_category_id) ?? [] : []
    const parentChain = parentRow?.master_category_id ? chainByCategory.get(parentRow.master_category_id) ?? [] : []
    const ctxScope: ScopeCtx = {
      rangeValueIds: [...new Set([...ownRange, ...parentRange])],
      categoryChain: ownChain.length > 0 ? ownChain : parentChain,
      supplier: row.supplier ?? parentRow?.supplier ?? null,
    }
    const stock = stockOf(row)
    // Count on the line's own product, else the parent's (a variation child
    // carries its own count; a plain product carries it on itself).
    const perPersonCount = countByProduct.get(row.id) ?? (parentRow ? countByProduct.get(parentRow.id) : undefined) ?? null

    const candidateRules = pickMostSpecific(rules, ctxScope)
    if (candidateRules.length === 0) continue // no rule -> no estimate for this product

    const winning = latestRule(candidateRules, stock, ctx)
    // Per-product overrides are set on the parent in the admin (variant children
    // never appear there), so a child without its own row inherits the parent's.
    const override = overrides.get(row.id) ?? (parentRow ? overrides.get(parentRow.id) : undefined)
    const resolvedRule = applyOverride(ruleToResolved(winning), override)

    // Tier options: each tier's most-specific scope config for this product. A
    // tier with no matching config is not offered.
    const tierOptions: ResolvedTierOption[] = []
    for (const tier of tiers) {
      // A supplier-bound tier is skipped for products from any other supplier.
      if (!tierAppliesToSupplier(tier, ctxScope.supplier)) continue
      const configForTier = tierConfig.filter((c: TierScopeConfig) => c.tierId === tier.id)
      // pickMostSpecific may return several rows only for a multi-value range;
      // any of them is a valid price for that tier, so the first will do.
      const winningConfig = pickMostSpecific(configForTier, ctxScope)[0]
      const isDefaultTier = settings.defaultTierKey != null && tier.key === settings.defaultTierKey
      if (!winningConfig && !isDefaultTier) continue
      const available = winningConfig ? winningConfig.available : true
      if (!available) continue
      tierOptions.push({
        key: tier.key,
        label: tier.label,
        price: winningConfig ? winningConfig.price : '0.00',
        available: true,
        perPerson: winningConfig ? winningConfig.perPerson : false,
        modifiers: tierModifiers(tierByKey.get(tier.id) ?? tier),
      })
    }

    result.set(row.id, {
      productId: row.id,
      disabled: override?.disabled ?? false,
      rule: resolvedRule,
      stock,
      tiers: tierOptions,
      perPersonCount,
    })
  }

  return result
}

// The tier modifiers for one product + tier key, for the cart-line resolver to
// re-price a chosen tier server-side. Returns null when the tier is not offered
// for that product (an invalid or stale selection).
export function findTierOption(delivery: ProductDelivery, tierKey: string): ResolvedTierOption | null {
  return delivery.tiers.find((t) => t.key === tierKey) ?? null
}
