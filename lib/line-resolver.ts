// shop.cart-line-resolver provider: prices the shopper's chosen delivery
// service into the cart + order (server-authoritative), snapshots the service
// and promised date onto the order line, and offers the service picker the cart
// renders. Returns NOOP for any line that has no services offered, so it never
// disturbs a plain line or another module's personalisation (shop folds every
// resolver additively).
import type { CartLineResolution } from '@/modules/shop/lib/line-meta'
import type { ShpProduct } from '@/modules/shop/lib/types'
import { getShopConfigCached } from '@/modules/shop/lib/config'
import { makeDisplayAdjuster, resolveTaxDisplay } from '@/modules/shop/lib/tax-display'
import { formatDeliveryDate, formatDeliveryByLabel, todayInZone, workingDaysBetween } from '@/modules/advanced-shipping-for-shop/lib/working-days'
import { computeEstimate, effectiveShipDays } from '@/modules/advanced-shipping-for-shop/lib/estimate'
import { DELIVERY_FIELD_LABEL, DELIVERY_META_KEY, paidDeliveryValue, type DeliveryLineState } from '@/modules/advanced-shipping-for-shop/lib/deferred-delivery'
import { findTierOption, type ProductDelivery } from '@/modules/advanced-shipping-for-shop/lib/resolve'
import { effectiveTierPrice, tierOptionLabel, tierOptionSummary } from '@/modules/advanced-shipping-for-shop/lib/tier-labels'
import { getProductDelivery, prefetchProductDeliveries } from '@/modules/advanced-shipping-for-shop/lib/delivery-cache'
import { getResolveContext } from '@/modules/advanced-shipping-for-shop/lib/context'
import { getSettingsCached } from '@/modules/advanced-shipping-for-shop/lib/db/settings'

const NOOP: CartLineResolution = { valid: true, priceAdjust: 0, persistMeta: null, control: null }

// The wording and the pricing arithmetic live in lib/tier-labels.ts, which is
// pure and so can be read by the storefront's client islands too (the product
// page's own service picker shows the same options this resolver offers the
// basket). Re-exported here because this file was their first home and the rest
// of the module still asks for them by this path.
export { effectiveTierPrice, tierOptionSummary } from '@/modules/advanced-shipping-for-shop/lib/tier-labels'

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
  // A service's charge is folded into the line price, so it is taxed at the
  // product's own rate - which means it has to be printed on the same side of
  // tax as that price. Shop converts the numeric `priceAdjust` below itself (it
  // owns that arithmetic for every resolver); the option WORDING is ours, and
  // shop never re-words it, so the labels are converted here. Hence `shown` for
  // the labels and the raw figure for `priceAdjust`.
  const taxDisplay = await resolveTaxDisplay()
  const adjustPrice = makeDisplayAdjuster(taxDisplay, product.taxClassId)
  const shown = (price: number) => (adjustPrice ? adjustPrice(price) : price)
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
      const eff = effectiveTierPrice(t)
      return {
        value: t.key,
        label: tierOptionLabel(t.label, shown(eff), currencySymbol, byLabel),
        priceAdjust: eff,
        description: t.description ?? undefined,
        // The same wording pre-split for the summary presentation. A shop too
        // old to read it ignores the field and renders from `label` as before.
        summary: tierOptionSummary(t.label, shown(eff), currencySymbol, byLabel, dateLabel),
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

  const priceAdjust = effectiveTierPrice(tierOption)

  // An unavailable estimate (out of stock and set to block) fails the line, like
  // any other unbuyable line, carrying the reason.
  if (!est.available) {
    return { valid: false, priceAdjust, persistMeta: null, reason: est.reason ?? 'Unavailable', control }
  }

  const tierText = tierOption.label
  const deliveryValue = est.targetDate ? paidDeliveryValue(tierText, est.targetDate) : tierText
  const fields = [{ label: DELIVERY_FIELD_LABEL, value: deliveryValue }]

  // The same promise as a bucket shop can list the order by: everything landing
  // on one day shown together, buckets running soonest first (the ISO date is
  // both the identity and the sort). What a shopper is planning around is the
  // day the van turns up, so the DATE alone makes the bucket - a flat-packed
  // desk and a built chair landing on the same Tuesday are one delivery to them,
  // whatever the warehouse calls them.
  // Which leaves the service to be said in one of two places, and shop picks by
  // comparing rather than composing: where every line in the bucket is on the
  // same service the fuller sentence becomes the heading, and where they are not
  // the heading states the date and each line names its own service underneath.
  // `fieldLabel` then tells shop to stop printing the whole sentence under every
  // product, which is what saying it once over the group is for.
  // A shop too old to read a batch ignores it and shows the field per line as
  // before.
  const batch = est.targetDate
    ? {
        id: est.targetDate,
        sort: est.targetDate,
        heading: `Arrives by ${formatDeliveryDate(est.targetDate)}`,
        uniformHeading: deliveryValue,
        detail: tierText,
        fieldLabel: DELIVERY_FIELD_LABEL,
      }
    : null

  // The same promise in machine-readable form, carried onto the order line so it
  // can be restated later without anyone parsing the sentence above back apart.
  // It earns its keep on a shop taking payment by bank transfer, where the date
  // cannot be counted from today because nothing is dispatched until the money
  // arrives - see lib/order-payment-state.ts. Harmless everywhere else: nothing
  // reads it unless the order turns out to be on a pay-later method.
  const state: DeliveryLineState | null = est.targetDate
    ? {
        tierKey: chosenKey,
        tierText,
        leadDays: workingDaysBetween(todayStr, est.targetDate, ctx.holidays, effectiveShipDays(settings)),
        targetDate: est.targetDate,
        isPreOrder: est.isPreOrder,
      }
    : null

  // Tell the basket how much of this line's price is the delivery service, so it
  // can show it on a line of its own under the goods rather than burying a £66
  // installation fee inside a chair's price. It is an attribution, not an extra
  // charge - the money is already in priceAdjust above.
  const charges = priceAdjust > 0 ? [{ label: 'Delivery', amount: priceAdjust }] : null

  return {
    valid: true,
    priceAdjust,
    persistMeta: { fields, ...(batch ? { batch } : {}), ...(state ? { data: { [DELIVERY_META_KEY]: state } } : {}) },
    control,
    charges,
  }
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
