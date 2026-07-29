// Turns a set of (productId, chosen service, quantity) into per-item delivery
// estimates plus a grouped "arrives in N deliveries" summary. This is the one
// place the resolver, the date engine and the shopper's service choice meet, so
// the product page, the cart and the estimate API all speak through it and stay
// consistent.
import { formatDeliveryDate } from '@/modules/advanced-shipping-for-shop/lib/working-days'
import { computeEstimate } from '@/modules/advanced-shipping-for-shop/lib/estimate'
import { resolveProductDeliveries, findTierOption, type ProductDelivery } from '@/modules/advanced-shipping-for-shop/lib/resolve'
import { getResolveContext } from '@/modules/advanced-shipping-for-shop/lib/context'
import { getSettingsCached } from '@/modules/advanced-shipping-for-shop/lib/db/settings'

export type EstimateItemInput = { productId: string; tierKey?: string; quantity?: number }

export type TierOption = { key: string; label: string; description: string | null; price: string }

export type ItemEstimate = {
  productId: string
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

export type GroupedDelivery = { date: string; label: string; count: number }

export type EstimateResult = { items: ItemEstimate[]; deliveries: GroupedDelivery[] }

const EMPTY_ITEM = (productId: string): ItemEstimate => ({
  productId,
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
  const [settings, deliveries] = await Promise.all([
    getSettingsCached(),
    resolveProductDeliveries(productIds, ctx),
  ])

  const items: ItemEstimate[] = []
  const grouped = new Map<string, number>()

  for (const input of inputs) {
    const delivery = deliveries.get(input.productId)
    const tierKey = delivery ? chooseTier(delivery, input.tierKey, settings.defaultTierKey) : null
    const tierOption = delivery && tierKey ? findTierOption(delivery, tierKey) : null
    if (!delivery || !tierOption) {
      items.push(EMPTY_ITEM(input.productId))
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
      hasEstimate: true,
      available: est.available,
      reason: est.reason,
      targetDate: est.targetDate,
      targetLabel: est.targetDate ? formatDeliveryDate(est.targetDate) : null,
      cutoffInstantISO: est.cutoffInstantISO,
      isBackorder: est.isBackorder,
      isPreOrder: est.isPreOrder,
      tierKey,
      tiers: delivery.tiers.map((t) => ({ key: t.key, label: t.label, description: t.description, price: t.price })),
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
