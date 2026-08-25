// Works out how soon each product in a grid could arrive, for the "Delivery in
// as little as X days" line on its card.
//
// Registered at shop's `shop.card-media` point, which despite the name is the
// single seam for everything a companion module pins to a product card: extra
// images, an overlay control, and an opaque `facts` payload a module's own card
// block renders itself (see modules/shop/lib/card-media.ts). Going through the
// existing point means every card surface that already shows contributed photos
// shows this too, with no extra wiring per grid - the shop's own category and
// collection pages, the tag pages, related and featured strips, search results,
// and the filter-collection grids in filters-for-shop, which all resolve card
// extras through the one helper.
//
// Batched, like its siblings: the delivery resolver takes the whole page of
// products in one pass, so forty cards cost the same handful of queries as one.
// The date sums themselves are pure (lib/estimate.ts) and cost nothing.
//
// "Soonest" is the earliest date across every service the product is actually
// offered - usually an express one - with the shop's cut-off, dispatch lead,
// ship days and bank holidays all already folded in by computeEstimate. A
// product no service reaches, and one whose stock rules say it cannot be
// promised at all, is simply absent from the map: the card then prints nothing,
// which is the only honest thing to print.
//
// A listing with variations answers out of its variations rather than out of its
// own row, exactly as the product page does - see the merge below.
import { prisma } from '@/lib/db/prisma'
import type { ShopCardMediaPayload, ShopCardMediaProvider } from '@/modules/shop/lib/card-media'
import { CARD_DELIVERY_BLOCK_TYPE, type CardDeliveryFacts } from '@/modules/advanced-shipping-for-shop/lib/card-delivery'
import { getResolveContext } from '@/modules/advanced-shipping-for-shop/lib/context'
import { getSettingsCached } from '@/modules/advanced-shipping-for-shop/lib/db/settings'
import { computeEstimate, effectiveShipDays } from '@/modules/advanced-shipping-for-shop/lib/estimate'
import { stockFor } from '@/modules/advanced-shipping-for-shop/lib/estimate-service'
import { resolveProductDeliveries, type ProductDelivery } from '@/modules/advanced-shipping-for-shop/lib/resolve'
import { ttlCached } from '@/modules/advanced-shipping-for-shop/lib/ttl-cache'
import { getRepresentativeVariants } from '@/modules/advanced-shipping-for-shop/lib/variations-bridge'
import { calendarDaysBetween, todayInZone, workingDaysBetween } from '@/modules/advanced-shipping-for-shop/lib/working-days'

// Is the delivery line actually on anybody's card?
//
// Shop asks every card-media provider for every grid it draws, whether or not
// the answer will be rendered - it cannot know which blocks a card layout uses
// until it stamps the template, which happens after. Left ungated, a shop that
// has this module but has never placed the block would pay five extra queries on
// every category page for nothing. One cheap, memoised look at the saved card
// layouts settles it instead.
//
// Deliberately not filtered by `status`: a card layout can be pointed at by a
// grid block directly (the "Card layout" field), draft or not, so a published-
// only check could switch the sums off under a layout that really does use them.
// Matching the quoted block type is enough - Puck writes `"type":"ShopCardDelivery"`
// - and a false positive costs a few queries, never a wrong card.
const blockInUse = ttlCached(async (): Promise<boolean> => {
  const rows = await prisma.$queryRaw<{ one: number }[]>`
    SELECT 1 AS one FROM "Layout"
    WHERE "type" = 'shopProductCard'
      AND "builderData"::text LIKE ${`%"${CARD_DELIVERY_BLOCK_TYPE}"%`}
    LIMIT 1
  `
  return rows.length > 0
}, 30_000)

export const advancedShippingCardDelivery: ShopCardMediaProvider = {
  async load(productIds) {
    if (productIds.length === 0) return new Map()
    if (!(await blockInUse.get())) return new Map()
    return cardDeliveryFacts(productIds)
  },
}

/** The sums themselves, without the "is anybody asking?" gate in front of them.
 *  Separated so the gate can be reasoned about (and exercised) on its own. */
export async function cardDeliveryFacts(productIds: string[]): Promise<Map<string, ShopCardMediaPayload>> {
  const out = new Map<string, ShopCardMediaPayload>()
  const [ctx, settings] = await Promise.all([getResolveContext(), getSettingsCached()])

  // A listing with variations is never the thing bought - the basket takes the
  // variation's own product - so on a catalogue where the range attribute sits
  // on the variations, the listing's own row resolves to no service at all while
  // every variation of it resolves to three. The product page settles that the
  // same way (estimateItems, `variantFallback`), and a card that settled it
  // differently would say nothing in the grid about a product whose own page
  // promises a date.
  //
  // A grid cannot resolve every variation of every listing, though - see
  // getRepresentativeVariants for why it does not have to.
  const repsByListing = await getRepresentativeVariants(productIds, settings.rangeAttributeId)
  const repIds = [...new Set([...repsByListing.values()].flat())]
  const [ownDeliveries, repDeliveries] = await Promise.all([
    resolveProductDeliveries(productIds, ctx),
    repIds.length > 0 ? resolveProductDeliveries(repIds, ctx) : Promise.resolve(new Map<string, ProductDelivery>()),
  ])

  const today = todayInZone(ctx.now, ctx.timezone)
  const shipDays = effectiveShipDays(settings)

  for (const productId of new Set(productIds)) {
    // The variations where they carry the answer, the listing's own row where
    // they carry none - a listing whose variations resolve to nothing has not
    // been contradicted by them, so whatever it resolves to itself still stands.
    const fromVariations = (repsByListing.get(productId) ?? [])
      .map((id) => repDeliveries.get(id))
      .filter((d): d is ProductDelivery => !!d)
    const own = ownDeliveries.get(productId)
    const candidates = fromVariations.length > 0 ? fromVariations : own ? [own] : []
    if (candidates.length === 0) continue

    // The soonest any of them can be here, and every service any of them is
    // offered. "As little as" is a floor, so this is the best case across the
    // choices - the shopper reads the exact date for the one they settle on
    // when they open the product.
    let soonest: string | null = null
    const services: string[] = []
    for (const delivery of candidates) {
      for (const tier of delivery.tiers) {
        if (!services.includes(tier.label)) services.push(tier.label)
        const estimate = computeEstimate({
          now: ctx.now,
          timezone: ctx.timezone,
          holidays: ctx.holidays,
          timing: settings,
          tier: tier.modifiers,
          stock: stockFor(delivery, tier.key),
        })
        // Unavailable means the stock rules refuse to promise this one at all
        // (out of stock, blocked). It simply offers no date; where none of them
        // does, the product drops out below and its card says nothing.
        if (!estimate.available || !estimate.targetDate) continue
        if (soonest == null || estimate.targetDate < soonest) soonest = estimate.targetDate
      }
    }
    if (!soonest) continue

    // Floored at one. A same-day date would otherwise read "in as little as 0
    // days", and rounding the other way is the direction that cannot
    // over-promise.
    const facts: CardDeliveryFacts = {
      days: Math.max(1, calendarDaysBetween(today, soonest)),
      workingDays: Math.max(1, workingDaysBetween(today, soonest, ctx.holidays, shipDays)),
      services,
    }
    out.set(productId, { facts })
  }
  return out
}
