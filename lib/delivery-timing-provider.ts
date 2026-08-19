// A plain answer to "how long does this product take to arrive?", published at
// the `shop.product-delivery-timing` extension point so any module needing
// delivery timing can read it without becoming a dependent of this one - and,
// just as importantly, without this module knowing who is asking. The Google
// Shopping feed is the first caller; a printed quote or a courier export would
// read exactly the same shape.
//
// Two working-day counts rather than a date, deliberately. A date is only ever
// true for the instant it was worked out, so a caller that caches its output
// (a product feed refreshed hourly, say) would publish yesterday's promise.
// The counts move only when the shop's own settings do, which makes them safe
// to hold on to. Callers wanting a real date have estimateItems for that.
import { computeEstimate } from '@/modules/advanced-shipping-for-shop/lib/estimate'
import { getResolveContext } from '@/modules/advanced-shipping-for-shop/lib/context'
import { getSettingsCached } from '@/modules/advanced-shipping-for-shop/lib/db/settings'
import { resolveProductDeliveries, findTierOption, type ProductDelivery, type ResolveContext, type ResolvedTierOption } from '@/modules/advanced-shipping-for-shop/lib/resolve'
import { cutoffInstant } from '@/modules/advanced-shipping-for-shop/lib/working-days'
import type { AshSettings } from '@/modules/advanced-shipping-for-shop/lib/types'

export type ProductDeliveryTiming = {
  productId: string
  /** The service these counts describe - the shop's default where the product
   *  is offered it, else the first service it is offered. */
  serviceKey: string
  serviceLabel: string
  /** Working days from the order clearing the cut-off to the parcel leaving. */
  handlingDays: number
  /** Working days on the road after that. */
  transitDays: number
  /** ISO instant the product can first be dispatched, set ONLY on a pre-order
   *  or backordered product - the two cases where a shopper is buying something
   *  the shop has not got yet and the date is the whole point. Null otherwise,
   *  where the counts above already say everything there is to say. */
  availabilityDate: string | null
}

// Ids per round trip. A whole catalogue can be asked for at once - a feed asks
// for every variant it publishes, which on a real shop is tens of thousands -
// and the resolver binds a query parameter per id, against Postgres's ceiling of
// 65535 per statement. A variant child drags its parent in alongside it, so the
// worst case is twice this figure, which leaves the ceiling a wide berth.
//
// Deliberately large. Nearly all of a batch's cost is the round trips, not the
// rows: on a live catalogue 500 ids and 8000 ids cost within a second of each
// other, so a small chunk size buys nothing and pays the fixed cost again for
// every chunk it adds.
const CHUNK = 10_000

// Which service speaks for the product: the shop's designated default where it
// reaches this product, else the first service the product is offered. Same
// order of preference the cart uses, so the feed and the basket agree.
function chooseTier(delivery: ProductDelivery, defaultTierKey: string | null): ResolvedTierOption | null {
  if (defaultTierKey) {
    const preferred = findTierOption(delivery, defaultTierKey)
    if (preferred) return preferred
  }
  return delivery.tiers[0] ?? null
}

// The service's timing as two counts. A service floored at a minimum lead
// (installation never sooner than ten working days, say) has the floor folded
// into HANDLING, not transit: the parcel really is on the road for its usual
// time, it simply is not picked up for a while, and folding it the other way
// would tell a courier-time reader something plainly untrue. Never optimistic -
// the two counts always add up to at least the floor.
function counts(settings: AshSettings, tier: ResolvedTierOption): { handlingDays: number; transitDays: number } {
  const transitDays = Math.max(0, tier.modifiers.transitDays)
  let handlingDays = Math.max(0, settings.dispatchLeadDays)
  const floor = tier.modifiers.minLeadDays ?? 0
  if (floor > handlingDays + transitDays) handlingDays = floor - transitDays
  return { handlingDays, transitDays }
}

// Local midnight on the promised dispatch day, as an instant. A bare date would
// be read in whatever zone the consumer happens to run in, which on a shop a
// few hours either side of UTC is a day out.
function availabilityInstant(dateStr: string, timezone: string): string {
  return cutoffInstant(dateStr, '00:00', timezone).toISOString()
}

async function timingForChunk(
  productIds: string[],
  ctx: ResolveContext,
  settings: AshSettings,
  out: Map<string, ProductDeliveryTiming>,
): Promise<void> {
  const deliveries = await resolveProductDeliveries(productIds, ctx)
  for (const [productId, delivery] of deliveries) {
    const tier = chooseTier(delivery, settings.defaultTierKey)
    if (!tier) continue
    const { handlingDays, transitDays } = counts(settings, tier)

    // Only a pre-ordered or backordered product needs a date, and only then is
    // the estimate worth running: everything else is answered by the counts.
    let availabilityDate: string | null = null
    if (delivery.stock.isPreOrder || (delivery.stock.trackInventory && (delivery.stock.stockCount ?? 0) <= 0 && delivery.stock.outOfStockBehaviour === 'BACKORDER')) {
      const est = computeEstimate({
        now: ctx.now,
        timezone: ctx.timezone,
        holidays: ctx.holidays,
        timing: settings,
        tier: tier.modifiers,
        stock: delivery.stock,
      })
      if (est.available && est.dispatchDate) availabilityDate = availabilityInstant(est.dispatchDate, ctx.timezone)
    }

    out.set(productId, {
      productId,
      serviceKey: tier.key,
      serviceLabel: tier.label,
      handlingDays,
      transitDays,
      availabilityDate,
    })
  }
}

/** Delivery timing for the given products. Products the shop offers no delivery
 *  service at all are simply absent from the map - there is nothing honest to
 *  say about them, and a caller must not print a zero in their place. */
export async function advancedShippingDeliveryTiming(
  productIds: string[],
  now: Date = new Date(),
): Promise<Map<string, ProductDeliveryTiming>> {
  const result = new Map<string, ProductDeliveryTiming>()
  const ids = [...new Set(productIds)].filter(Boolean)
  if (ids.length === 0) return result

  const [ctx, settings] = await Promise.all([getResolveContext(now), getSettingsCached()])
  for (let i = 0; i < ids.length; i += CHUNK) {
    await timingForChunk(ids.slice(i, i + CHUNK), ctx, settings, result)
  }
  return result
}
