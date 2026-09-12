// What a listing can promise before the shopper has settled on a variation.
//
// In a file of its own because two quite different callers need the one answer:
// the storefront's delivery estimate and service picker (lib/estimate-service.ts),
// and the `shop.product-delivery-timing` seam other modules read
// (lib/delivery-timing-provider.ts). A listing whose delivery scope lives on its
// variations - which is most of a catalogue filed that way - resolves to no
// services at all on its own, so anything asking about the PARENT gets nothing
// unless it comes through here.
//
// Kept out of estimate-service.ts rather than exported from it: that file
// reaches into shop for tax display, and the delivery-timing provider is
// registered in core's generated extension-point registry, so an edge from the
// provider into it is the shape of import cycle scripts/check-import-cycles.mjs
// exists to catch.
//
// Nothing here is a second opinion about anything. It is the same function the
// picker has always used, moved.

import { computeEstimate } from '@/modules/advanced-shipping-for-shop/lib/estimate'
import type { ProductDelivery, ResolveContext, ResolvedTierOption } from '@/modules/advanced-shipping-for-shop/lib/resolve'
import type { AshSettings, StockState } from '@/modules/advanced-shipping-for-shop/lib/types'

// Sorts after every real ISO date, so "no date at all" wins a worst-case pick.
const LATEST_DATE = '9999-12-31'

// What a listing page can promise before the shopper has settled on a variation:
// every service ANY of the variations still in play offers, each one costed and
// dated at its worst across the ones that carry it.
//
// Every service they offer between them, deliberately - not only the ones they
// all agree on. A shopper who has picked nothing has ruled nothing out, and a
// service crossed out on a page they have not touched reads as a refusal: the
// shop plainly does sell two-person delivery on this chair, and being told
// which colours carry it before being asked which colour they want is an answer
// to a question nobody put. The narrowing is the variations' job. As picks come
// in the caller passes only the children still matching them, and a service that
// falls out of that set is one their own choice has just cost them - which is
// the moment it earns the unavailable chip (see otherTiersFor).
//
// Never in the best light, though: each service takes the dearest price and the
// latest date among the variations offering it, so nothing shown here gets
// dearer or later once a combination is settled and the picker asks again for
// that exact variation.
//
// Null when none of them offers anything (or there are none), which leaves the
// listing with whatever it resolved to on its own.
export function mergeVariantDeliveries(parentProductId: string, children: ProductDelivery[], ctx: ResolveContext, timing: AshSettings): ProductDelivery | null {
  if (children.length === 0) return null

  const dateFor = (delivery: ProductDelivery, key: string): string => {
    const tier = delivery.tiers.find((t) => t.key === key)
    if (!tier) return LATEST_DATE
    const est = computeEstimate({
      now: ctx.now, timezone: ctx.timezone, holidays: ctx.holidays, timing, tier: tier.modifiers, stock: delivery.stock,
    })
    // A variation that cannot promise a date at all is the worst case there is.
    return est.available && est.targetDate ? est.targetDate : LATEST_DATE
  }

  // Every service on offer between them, in the order the variations list them,
  // so the preview reads down the page in the shop's own service order.
  const keys = [...new Set(children.flatMap((c) => c.tiers.map((t) => t.key)))]
  if (keys.length === 0) return null

  // One variation stands in for the lot PER SERVICE: the slowest of the ones
  // carrying it, whose timing and stock decide that service's date. Per service
  // rather than one stand-in for the whole listing, because the slowest
  // variation overall need not offer the service at all, and where it does not
  // its stock has nothing to say about when that service would land.
  const stockByTier = new Map<string, StockState>()
  const tiers: ResolvedTierOption[] = []
  let slowest = children[0]!
  let slowestDate = ''
  for (const key of keys) {
    const offering = children.filter((c) => c.tiers.some((t) => t.key === key))
    let representative = offering[0]!
    let worst = ''
    for (const child of offering) {
      const date = dateFor(child, key)
      if (date > worst) { worst = date; representative = child }
    }
    if (worst > slowestDate) { slowestDate = worst; slowest = representative }
    stockByTier.set(key, representative.stock)
    const base = representative.tiers.find((t) => t.key === key)!
    // Dearest across the variations offering it, so a preview never undercuts
    // the price the chosen variation will actually charge.
    const price = offering
      .map((c) => Number(c.tiers.find((t) => t.key === key)?.price ?? 0) || 0)
      .reduce((a, b) => Math.max(a, b), 0)
    tiers.push({ ...base, price: price.toFixed(2) })
  }

  // The listing-level stock, for anything asking the delivery as a whole rather
  // than a service at a time: the slowest variation's, on the same footing.
  return { productId: parentProductId, stock: slowest.stock, stockByTier, tiers }
}
