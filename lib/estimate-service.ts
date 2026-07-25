// Turns a set of (productId, chosen tier, quantity) into per-item delivery
// estimates plus a grouped "arrives in N deliveries" summary. This is the one
// place the resolver, the date engine and the shopper's tier choice meet, so the
// product page, the cart and the estimate API all speak through it and stay
// consistent.
import { formatDeliveryDate } from '@/modules/advanced-shipping-for-shop/lib/working-days'
import { computeEstimate } from '@/modules/advanced-shipping-for-shop/lib/estimate'
import { resolveProductDeliveries, findTierOption, type ProductDelivery } from '@/modules/advanced-shipping-for-shop/lib/resolve'
import { getResolveContext } from '@/modules/advanced-shipping-for-shop/lib/context'
import { getSettings } from '@/modules/advanced-shipping-for-shop/lib/db/settings'

export type EstimateItemInput = { productId: string; tierKey?: string; quantity?: number }

export type TierOption = { key: string; label: string; price: string }

export type ItemEstimate = {
  productId: string
  // A product with no matching rule, or one an override has disabled, has no
  // estimate to show; the storefront simply renders nothing for it.
  hasEstimate: boolean
  available: boolean
  reason?: string
  targetDate: string | null
  targetLabel: string | null
  cutoffInstantISO: string | null
  isMadeToOrder: boolean
  isBackorder: boolean
  isPreOrder: boolean
  tierKey: string | null
  tiers: TierOption[]
}

export type GroupedDelivery = { date: string; label: string; count: number }

export type EstimateResult = { items: ItemEstimate[]; deliveries: GroupedDelivery[] }

const EMPTY_ITEM = (productId: string): ItemEstimate => ({
  productId,
  hasEstimate: false,
  available: false,
  targetDate: null,
  targetLabel: null,
  cutoffInstantISO: null,
  isMadeToOrder: false,
  isBackorder: false,
  isPreOrder: false,
  tierKey: null,
  tiers: [],
})

// Which tier to price for an item: the shopper's choice if it is still offered,
// else the shop's default tier, else the first tier offered, else none (the
// bare rule).
function chooseTier(delivery: ProductDelivery, requestedKey: string | undefined, defaultTierKey: string | null): string | null {
  if (requestedKey && findTierOption(delivery, requestedKey)) return requestedKey
  if (defaultTierKey && findTierOption(delivery, defaultTierKey)) return defaultTierKey
  return delivery.tiers[0]?.key ?? null
}

export async function estimateItems(inputs: EstimateItemInput[], now: Date = new Date()): Promise<EstimateResult> {
  const productIds = inputs.map((i) => i.productId)
  const ctx = await getResolveContext(now)
  const [settings, deliveries] = await Promise.all([
    getSettings(),
    resolveProductDeliveries(productIds, ctx),
  ])

  const items: ItemEstimate[] = []
  const grouped = new Map<string, number>()

  for (const input of inputs) {
    const delivery = deliveries.get(input.productId)
    if (!delivery || delivery.disabled) {
      items.push(EMPTY_ITEM(input.productId))
      continue
    }

    const tierKey = chooseTier(delivery, input.tierKey, settings.defaultTierKey)
    const tierOption = tierKey ? findTierOption(delivery, tierKey) : null
    const est = computeEstimate({
      now: ctx.now,
      timezone: ctx.timezone,
      holidays: ctx.holidays,
      rule: delivery.rule,
      tier: tierOption?.modifiers ?? null,
      stock: delivery.stock,
    })

    items.push({
      productId: input.productId,
      hasEstimate: true,
      available: est.available,
      reason: est.reason,
      targetDate: est.targetDate,
      targetLabel: est.targetDate ? formatDeliveryDate(est.targetDate) : null,
      cutoffInstantISO: est.cutoffInstantISO,
      isMadeToOrder: est.isMadeToOrder,
      isBackorder: est.isBackorder,
      isPreOrder: est.isPreOrder,
      tierKey,
      tiers: delivery.tiers.map((t) => ({ key: t.key, label: t.label, price: t.price })),
    })

    if (est.available && est.targetDate) {
      grouped.set(est.targetDate, (grouped.get(est.targetDate) ?? 0) + Math.max(1, input.quantity ?? 1))
    }
  }

  const deliveriesSummary: GroupedDelivery[] = [...grouped.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, count]) => ({ date, label: formatDeliveryDate(date), count }))

  return { items, deliveries: deliveriesSummary }
}
