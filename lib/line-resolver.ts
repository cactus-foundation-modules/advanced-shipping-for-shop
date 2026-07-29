// shop.cart-line-resolver provider: prices the shopper's chosen delivery
// service into the cart + order (server-authoritative), snapshots the service
// and promised date onto the order line, and offers the service picker the cart
// renders. Returns NOOP for any line that has no services offered, so it never
// disturbs a plain line or another module's personalisation (shop folds every
// resolver additively).
import type { CartLineResolution } from '@/modules/shop/lib/line-meta'
import type { ShpProduct } from '@/modules/shop/lib/types'
import { getShopConfigCached } from '@/modules/shop/lib/config'
import { formatDeliveryDate, formatDeliveryByLabel, todayInZone } from '@/modules/advanced-shipping-for-shop/lib/working-days'
import { computeEstimate } from '@/modules/advanced-shipping-for-shop/lib/estimate'
import { findTierOption, type ProductDelivery, type ResolvedTierOption } from '@/modules/advanced-shipping-for-shop/lib/resolve'
import { getProductDelivery, prefetchProductDeliveries } from '@/modules/advanced-shipping-for-shop/lib/delivery-cache'
import { getResolveContext } from '@/modules/advanced-shipping-for-shop/lib/context'
import { getSettingsCached } from '@/modules/advanced-shipping-for-shop/lib/db/settings'

const NOOP: CartLineResolution = { valid: true, priceAdjust: 0, persistMeta: null, control: null }

// The amount a service adds to a line: its base price, or base × person count
// when it is priced per person. Returns null for a per-person service on a line
// with no readable count - it cannot be priced, so the line is blocked rather
// than guessed. Rounded to the penny so the optimistic client figure matches.
export function effectiveTierPrice(t: ResolvedTierOption, count: number | null): number | null {
  const base = Number(t.price) || 0
  if (!t.perPerson) return base
  if (count == null) return null
  return Math.round(base * count * 100) / 100
}

function tierOptionLabel(label: string, price: number | null, symbol: string, byLabel: string | null): string {
  const base = byLabel ? `${label} by ${byLabel}` : label
  // A per-person service on a line whose count could not be read has no price to
  // show; the shopper is told it is priced per person and the line blocks on
  // selection until a person count is set.
  if (price == null) return `${base} (price per person)`
  if (price <= 0) return `${base} (included)`
  return `${base} (+${symbol}${price.toFixed(2)})`
}

// The same option, broken into the parts the basket's summary presentation lays
// out - so the basket never has to pick a label apart to find the date, the
// service or the price. `headline` is what the line reads once this service is
// the chosen one, `switchLabel` is the compact wording on the chip that swaps to
// it, and `priceLabel` is the price on its own.
export function tierOptionSummary(
  label: string, price: number | null, symbol: string, byLabel: string | null, dateLabel: string | null,
) {
  return {
    headline: dateLabel ? `Arrives by ${dateLabel}` : label,
    secondary: dateLabel ? label : undefined,
    switchLabel: byLabel ? `${label} by ${byLabel}` : label,
    priceLabel: price == null ? 'Per person' : price <= 0 ? 'Free' : `+${symbol}${price.toFixed(2)}`,
  }
}

// Which service a line is on: the shopper's own choice when they have made one
// and it is still offered, else the shop's default service, else the first one
// on the product. Shared by the line resolver and the basket-wide summary below
// so the two can never promise different dates for the same line.
export function chosenTierKey(
  delivery: ProductDelivery,
  meta: Record<string, unknown> | undefined,
  defaultTierKey: string | null,
): string {
  const requested = meta && typeof meta.shippingTier === 'string' ? meta.shippingTier : undefined
  return (
    (requested && findTierOption(delivery, requested) && requested) ||
    (defaultTierKey && findTierOption(delivery, defaultTierKey) && defaultTierKey) ||
    delivery.tiers[0]!.key
  )
}

export async function resolveShippingTierLineMeta(
  product: ShpProduct,
  meta: Record<string, unknown> | undefined,
): Promise<CartLineResolution> {
  const ctx = await getResolveContext()
  // Served from the request batch cache when shop prefetched the whole cart (the
  // fast path); falls back to a single resolve otherwise.
  const delivery = await getProductDelivery(product.id, ctx)
  // No services configured for this product -> this module has nothing to add
  // to the line. Stay out of the fold entirely.
  if (!delivery || delivery.tiers.length === 0) return NOOP

  const settings = await getSettingsCached()
  const chosenKey = chosenTierKey(delivery, meta, settings.defaultTierKey)
  const tierOption = findTierOption(delivery, chosenKey)
  if (!tierOption) return NOOP

  const est = computeEstimate({
    now: ctx.now,
    timezone: ctx.timezone,
    holidays: ctx.holidays,
    timing: settings,
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
    // price optimistically the instant the shopper picks a service, before the
    // server re-validate confirms it. Older shops simply ignore the field.
    // Each option's own promised date is baked into its label ("Express
    // Delivery by Monday (+£4.95)") so the shopper sees when every service lands
    // without picking it - one estimate per service, all cheap and IO-free. The
    // service's own description rides along for a new-enough shop to show under
    // the option; an older shop ignores it.
    options: delivery.tiers.map((t) => {
      const tEst = computeEstimate({
        now: ctx.now,
        timezone: ctx.timezone,
        holidays: ctx.holidays,
        timing: settings,
        tier: t.modifiers,
        stock: delivery.stock,
      })
      const byLabel = tEst.available && tEst.targetDate ? formatDeliveryByLabel(tEst.targetDate, todayStr) : null
      const dateLabel = tEst.available && tEst.targetDate ? formatDeliveryDate(tEst.targetDate) : null
      const eff = effectiveTierPrice(t, delivery.perPersonCount)
      return {
        value: t.key,
        label: tierOptionLabel(t.label, eff, currencySymbol, byLabel),
        priceAdjust: eff ?? 0,
        description: t.description ?? undefined,
        // The same wording pre-split for the summary presentation. A shop too
        // old to read it ignores the field and renders from `label` as before.
        summary: tierOptionSummary(t.label, eff, currencySymbol, byLabel, dateLabel),
      }
    }),
    // The shop owner picks the basket's picker in Delivery settings: the chosen
    // service confirmed in place with the rest as chips (the default), a plain
    // dropdown, or a radio list. Each is only honoured by a shop new enough to
    // read it - an older shop falls back to the dropdown either way.
    renderAs: settings.cartControlStyle === 'radios'
      ? ('radios' as const)
      : settings.cartControlStyle === 'dropdown' ? ('select' as const) : ('summary' as const),
  }

  // A per-person service on a line whose count could not be read cannot be
  // priced, so the line is blocked (never silently mispriced) with a
  // plain-English reason, exactly as the shop owner chose over falling back to
  // a flat price.
  const chosenPrice = effectiveTierPrice(tierOption, delivery.perPersonCount)
  if (chosenPrice == null) {
    return { valid: false, priceAdjust: 0, persistMeta: null, reason: 'Set the number of people for this item to price its delivery', control }
  }
  const priceAdjust = chosenPrice

  // An unavailable estimate (out of stock and set to block) fails the line, like
  // any other unbuyable line, carrying the reason.
  if (!est.available) {
    return { valid: false, priceAdjust, persistMeta: null, reason: est.reason ?? 'Unavailable', control }
  }

  const dateLabel = est.targetDate ? formatDeliveryDate(est.targetDate) : null
  // On a per-person price, record the count the price was worked out from, so
  // the order line shows why the delivery cost what it did.
  const perPersonNote = tierOption.perPerson && delivery.perPersonCount ? ` (${delivery.perPersonCount} people)` : ''
  const tierText = `${tierOption.label}${perPersonNote}`
  const fields = [{ label: 'Delivery', value: dateLabel ? `${tierText} - by ${dateLabel}` : tierText }]

  // Tell the basket how much of this line's price is the delivery service, so it
  // can show it on a line of its own under the goods rather than burying a £66
  // installation fee inside a chair's price. It is an attribution, not an extra
  // charge - the money is already in priceAdjust above.
  const charges = priceAdjust > 0 ? [{ label: 'Delivery', amount: priceAdjust }] : null

  return { valid: true, priceAdjust, persistMeta: { fields }, control, charges }
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
