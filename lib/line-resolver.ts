// shop.cart-line-resolver provider: prices the shopper's chosen delivery tier
// into the cart + order (server-authoritative), snapshots the tier and promised
// date onto the order line, and offers the tier picker the cart renders. Returns
// NOOP for any line that has no tiers offered, so it never disturbs a plain line
// or another module's personalisation (shop folds every resolver additively).
import type { CartLineResolution } from '@/modules/shop/lib/line-meta'
import type { ShpProduct } from '@/modules/shop/lib/types'
import { getShopConfigCached } from '@/modules/shop/lib/config'
import { formatDeliveryDate, formatDeliveryByLabel, todayInZone } from '@/modules/advanced-shipping-for-shop/lib/working-days'
import { computeEstimate } from '@/modules/advanced-shipping-for-shop/lib/estimate'
import { findTierOption } from '@/modules/advanced-shipping-for-shop/lib/resolve'
import { getProductDelivery, prefetchProductDeliveries } from '@/modules/advanced-shipping-for-shop/lib/delivery-cache'
import { getResolveContext } from '@/modules/advanced-shipping-for-shop/lib/context'
import { getSettingsCached } from '@/modules/advanced-shipping-for-shop/lib/db/settings'

const NOOP: CartLineResolution = { valid: true, priceAdjust: 0, persistMeta: null, control: null }

function tierOptionLabel(label: string, price: number, symbol: string, byLabel: string | null): string {
  const base = byLabel ? `${label} by ${byLabel}` : label
  if (price <= 0) return `${base} (included)`
  return `${base} (+${symbol}${price.toFixed(2)})`
}

export async function resolveShippingTierLineMeta(
  product: ShpProduct,
  meta: Record<string, unknown> | undefined,
): Promise<CartLineResolution> {
  const ctx = await getResolveContext()
  // Served from the request batch cache when shop prefetched the whole cart (the
  // fast path); falls back to a single resolve otherwise.
  const delivery = await getProductDelivery(product.id, ctx)
  // No rule, disabled, or no tiers configured -> this module has nothing to add
  // to the line. Stay out of the fold entirely.
  if (!delivery || delivery.disabled || delivery.tiers.length === 0) return NOOP

  const settings = await getSettingsCached()
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
  const todayStr = todayInZone(ctx.now, ctx.timezone)
  const control = {
    key: 'shippingTier',
    label: 'Delivery',
    value: chosenKey,
    // Each option's label already carries its own promised date, so a new-enough
    // shop drops the "Delivery:" heading and the restated confirmation line and
    // renders the picker bare. An older shop ignores the flag and shows both.
    optionsSelfLabelled: true,
    // priceAdjust rides along per option so a new-enough shop can move the line
    // price optimistically the instant the shopper picks a tier, before the
    // server re-validate confirms it. Older shops simply ignore the field.
    // Each option's own promised date is baked into its label ("Express
    // Delivery by Monday (+£4.95)") so the shopper sees when every tier lands
    // without picking it - one estimate per tier, all cheap and IO-free.
    options: delivery.tiers.map((t) => {
      const tEst = computeEstimate({
        now: ctx.now,
        timezone: ctx.timezone,
        holidays: ctx.holidays,
        rule: delivery.rule,
        tier: t.modifiers,
        stock: delivery.stock,
      })
      const byLabel = tEst.available && tEst.targetDate ? formatDeliveryByLabel(tEst.targetDate, todayStr) : null
      return {
        value: t.key,
        label: tierOptionLabel(t.label, Number(t.price), currencySymbol, byLabel),
        priceAdjust: Number(t.price) || 0,
      }
    }),
    // Shop renders a dropdown by default; the shop owner can switch the cart to a
    // radio group in Delivery settings. 'radios' is only honoured by a shop new
    // enough to read it - an older shop just shows the dropdown either way.
    renderAs: settings.cartControlStyle === 'radios' ? ('radios' as const) : ('select' as const),
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

// shop.cart-line-resolver-prefetch: resolve every cart product's delivery in one
// batched pass before shop folds the lines, so resolveShippingTierLineMeta above
// is a cache read per line instead of its own handful of queries. Called once
// per cart validate / checkout resolve with the whole product set.
export async function prefetchShippingTierDeliveries(products: ShpProduct[]): Promise<void> {
  if (products.length === 0) return
  const ctx = await getResolveContext()
  await prefetchProductDeliveries(products.map((p) => p.id), ctx)
}
