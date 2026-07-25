// shop.cart-line-resolver provider: prices the shopper's chosen delivery tier
// into the cart + order (server-authoritative), snapshots the tier and promised
// date onto the order line, and offers the tier picker the cart renders. Returns
// NOOP for any line that has no tiers offered, so it never disturbs a plain line
// or another module's personalisation (shop folds every resolver additively).
import type { CartLineResolution } from '@/modules/shop/lib/line-meta'
import type { ShpProduct } from '@/modules/shop/lib/types'
import { getShopConfigCached } from '@/modules/shop/lib/config'
import { formatDeliveryDate } from '@/modules/advanced-shipping-for-shop/lib/working-days'
import { computeEstimate } from '@/modules/advanced-shipping-for-shop/lib/estimate'
import { resolveProductDeliveries, findTierOption } from '@/modules/advanced-shipping-for-shop/lib/resolve'
import { getResolveContext } from '@/modules/advanced-shipping-for-shop/lib/context'
import { getSettings } from '@/modules/advanced-shipping-for-shop/lib/db/settings'

const NOOP: CartLineResolution = { valid: true, priceAdjust: 0, persistMeta: null, control: null }

function tierOptionLabel(label: string, price: number, symbol: string): string {
  if (price <= 0) return `${label} (included)`
  return `${label} (+${symbol}${price.toFixed(2)})`
}

export async function resolveShippingTierLineMeta(
  product: ShpProduct,
  meta: Record<string, unknown> | undefined,
): Promise<CartLineResolution> {
  const ctx = await getResolveContext()
  const deliveries = await resolveProductDeliveries([product.id], ctx)
  const delivery = deliveries.get(product.id)
  // No rule, disabled, or no tiers configured -> this module has nothing to add
  // to the line. Stay out of the fold entirely.
  if (!delivery || delivery.disabled || delivery.tiers.length === 0) return NOOP

  const settings = await getSettings()
  const requested = meta && typeof meta.shippingTier === 'string' ? meta.shippingTier : undefined
  const chosenKey =
    (requested && findTierOption(delivery, requested) && requested) ||
    (settings.defaultTierKey && findTierOption(delivery, settings.defaultTierKey) && settings.defaultTierKey) ||
    delivery.tiers[0]!.key
  const tierOption = findTierOption(delivery, chosenKey)
  if (!tierOption) return NOOP

  const est = computeEstimate({
    now: ctx.now,
    timezone: ctx.timezone,
    holidays: ctx.holidays,
    rule: delivery.rule,
    tier: tierOption.modifiers,
    stock: delivery.stock,
  })

  const { currencySymbol } = await getShopConfigCached()
  const control = {
    key: 'shippingTier',
    label: 'Delivery',
    value: chosenKey,
    options: delivery.tiers.map((t) => ({ value: t.key, label: tierOptionLabel(t.label, Number(t.price), currencySymbol) })),
  }

  const priceAdjust = Number(tierOption.price) || 0

  // An unavailable estimate (out of stock and set to block) fails the line, like
  // any other unbuyable line, carrying the reason.
  if (!est.available) {
    return { valid: false, priceAdjust, persistMeta: null, reason: est.reason ?? 'Unavailable', control }
  }

  const dateLabel = est.targetDate ? formatDeliveryDate(est.targetDate) : null
  const fields = [{ label: 'Delivery', value: dateLabel ? `${tierOption.label} - by ${dateLabel}` : tierOption.label }]

  return { valid: true, priceAdjust, persistMeta: { fields }, control }
}
