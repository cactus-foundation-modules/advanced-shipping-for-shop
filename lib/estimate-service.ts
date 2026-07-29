// Turns a set of (productId, chosen service, quantity) into per-item delivery
// estimates plus a grouped "arrives in N deliveries" summary. This is the one
// place the resolver, the date engine and the shopper's service choice meet, so
// the product page, the cart and the estimate API all speak through it and stay
// consistent.
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db/prisma'
import { formatDeliveryDate } from '@/modules/advanced-shipping-for-shop/lib/working-days'
import { effectiveTierPrice } from '@/modules/advanced-shipping-for-shop/lib/line-resolver'
import { computeEstimate } from '@/modules/advanced-shipping-for-shop/lib/estimate'
import { resolveProductDeliveries, findTierOption, type ProductDelivery } from '@/modules/advanced-shipping-for-shop/lib/resolve'
import { getResolveContext } from '@/modules/advanced-shipping-for-shop/lib/context'
import { getSettingsCached } from '@/modules/advanced-shipping-for-shop/lib/db/settings'
import { makeDisplayAdjuster, resolveTaxDisplay } from '@/modules/shop/lib/tax-display'

// `ref` is the caller's own handle on the item, echoed back untouched. The
// basket needs it: two lines of the same product on different services are one
// productId but two rows, and an answer keyed only by product could not tell
// them apart to write a choice back to the right one.
export type EstimateItemInput = { productId: string; tierKey?: string; quantity?: number; ref?: string }

export type TierOption = {
  key: string
  label: string
  description: string | null
  price: string
  // What this service would actually cost on THIS line - the base price, or
  // base x people where it is priced per person. Null when it is per-person and
  // no count could be read, which is the one case that cannot be priced.
  priceEffective: number | null
  // When this service would land, worked out per service rather than only for
  // the chosen one, so a basket can offer "everything sooner" without a second
  // round-trip. Null when this service cannot promise a date on this line.
  targetDate: string | null
  targetLabel: string | null
}

export type ItemEstimate = {
  productId: string
  ref: string | null
  // The product's own name, for a basket that groups lines by arrival date and
  // has to say which items are in each group.
  name: string | null
  // A product offered no delivery service has no estimate to show; the
  // storefront simply renders nothing for it.
  hasEstimate: boolean
  available: boolean
  reason?: string
  targetDate: string | null
  targetLabel: string | null
  cutoffInstantISO: string | null
  isBackorder: boolean
  isPreOrder: boolean
  tierKey: string | null
  tiers: TierOption[]
}

// One arrival date the basket is waiting on, with the services and the items
// landing on it. `names` lets a summary say WHAT arrives then, not just how many.
export type GroupedDelivery = {
  date: string
  label: string
  count: number
  names: string[]
  tierLabels: string[]
}

export type EstimateResult = { items: ItemEstimate[]; deliveries: GroupedDelivery[] }

const EMPTY_ITEM = (productId: string, ref: string | null, name: string | null): ItemEstimate => ({
  productId,
  ref,
  name,
  hasEstimate: false,
  available: false,
  targetDate: null,
  targetLabel: null,
  cutoffInstantISO: null,
  isBackorder: false,
  isPreOrder: false,
  tierKey: null,
  tiers: [],
})

// Product names for the whole set in one query. The delivery resolver reads the
// scope columns it needs and no more, so the name is fetched here rather than
// widening that hot path for the one caller that wants it.
// The tax class rides along on the same read: every price this service quotes
// has to be printed on the same side of tax as the product it is added to, and
// that is decided by the product's own class (see shop's lib/tax-display.ts).
async function getProductNames(productIds: string[]): Promise<Map<string, { name: string; taxClassId: string | null }>> {
  const unique = [...new Set(productIds)]
  if (unique.length === 0) return new Map()
  const rows = await prisma.$queryRaw<{ id: string; name: string; tax_class_id: string | null }[]>`
    SELECT "id", "name", "tax_class_id" FROM "shp_products" WHERE "id" IN (${Prisma.join(unique)})
  `
  return new Map(rows.map((r) => [r.id, { name: r.name, taxClassId: r.tax_class_id }]))
}

// Which service to price for an item: the shopper's choice if it is still
// offered, else the shop's default service, else the first service offered.
function chooseTier(delivery: ProductDelivery, requestedKey: string | undefined, defaultTierKey: string | null): string | null {
  if (requestedKey && findTierOption(delivery, requestedKey)) return requestedKey
  if (defaultTierKey && findTierOption(delivery, defaultTierKey)) return defaultTierKey
  return delivery.tiers[0]?.key ?? null
}

export async function estimateItems(inputs: EstimateItemInput[], now: Date = new Date()): Promise<EstimateResult> {
  const productIds = inputs.map((i) => i.productId)
  const ctx = await getResolveContext(now)
  const [settings, deliveries, productById, taxDisplay] = await Promise.all([
    getSettingsCached(),
    resolveProductDeliveries(productIds, ctx),
    getProductNames(productIds),
    resolveTaxDisplay(),
  ])

  const items: ItemEstimate[] = []
  // Per arrival date: how many units land then, which products they are, and on
  // which services. Sets, so three of the same chair reads as one product name.
  const grouped = new Map<string, { count: number; names: Set<string>; tierLabels: Set<string> }>()

  for (const input of inputs) {
    const ref = input.ref ?? null
    const product = productById.get(input.productId)
    const name = product?.name ?? null
    // Every figure this estimate reports is display-only - the cart re-prices
    // the chosen service server-side - so it is converted to whichever side of
    // tax the shop prints on, at this product's own rate.
    const adjustPrice = makeDisplayAdjuster(taxDisplay, product?.taxClassId)
    const shown = (price: number | null) => (price != null && adjustPrice ? adjustPrice(price) : price)
    const delivery = deliveries.get(input.productId)
    const tierKey = delivery ? chooseTier(delivery, input.tierKey, settings.defaultTierKey) : null
    const tierOption = delivery && tierKey ? findTierOption(delivery, tierKey) : null
    if (!delivery || !tierOption) {
      items.push(EMPTY_ITEM(input.productId, ref, name))
      continue
    }

    const est = computeEstimate({
      now: ctx.now,
      timezone: ctx.timezone,
      holidays: ctx.holidays,
      timing: settings,
      tier: tierOption.modifiers,
      stock: delivery.stock,
    })

    items.push({
      productId: input.productId,
      ref,
      name,
      hasEstimate: true,
      available: est.available,
      reason: est.reason,
      targetDate: est.targetDate,
      targetLabel: est.targetDate ? formatDeliveryDate(est.targetDate) : null,
      cutoffInstantISO: est.cutoffInstantISO,
      isBackorder: est.isBackorder,
      isPreOrder: est.isPreOrder,
      tierKey,
      // Every service costed and dated for this line, not just the chosen one -
      // the estimates are IO-free arithmetic over data already resolved, and a
      // basket offering "everything sooner" needs all of them to compare.
      tiers: delivery.tiers.map((t) => {
        const tEst = computeEstimate({
          now: ctx.now,
          timezone: ctx.timezone,
          holidays: ctx.holidays,
          timing: settings,
          tier: t.modifiers,
          stock: delivery.stock,
        })
        const dated = tEst.available && tEst.targetDate ? tEst.targetDate : null
        return {
          key: t.key,
          label: t.label,
          description: t.description,
          // The service's configured base price, left exactly as recorded - it
          // is the raw setting, not a figure any storefront prints. What IS
          // printed is `priceEffective` below, and that is converted.
          price: t.price,
          priceEffective: shown(effectiveTierPrice(t, delivery.perPersonCount)),
          targetDate: dated,
          targetLabel: dated ? formatDeliveryDate(dated) : null,
        }
      }),
    })

    if (est.available && est.targetDate) {
      const bucket = grouped.get(est.targetDate) ?? { count: 0, names: new Set<string>(), tierLabels: new Set<string>() }
      bucket.count += Math.max(1, input.quantity ?? 1)
      if (name) bucket.names.add(name)
      bucket.tierLabels.add(tierOption.label)
      grouped.set(est.targetDate, bucket)
    }
  }

  const deliveriesSummary: GroupedDelivery[] = [...grouped.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, bucket]) => ({
      date,
      label: formatDeliveryDate(date),
      count: bucket.count,
      names: [...bucket.names],
      tierLabels: [...bucket.tierLabels],
    }))

  return { items, deliveries: deliveriesSummary }
}
