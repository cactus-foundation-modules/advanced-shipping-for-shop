// Turns a set of (productId, chosen service, quantity) into per-item delivery
// estimates plus a grouped "arrives in N deliveries" summary. This is the one
// place the resolver, the date engine and the shopper's service choice meet, so
// the product page, the cart and the estimate API all speak through it and stay
// consistent.
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db/prisma'
import { formatDeliveryDate, formatDeliveryByLabel, todayInZone } from '@/modules/advanced-shipping-for-shop/lib/working-days'
import { effectiveTierPrice } from '@/modules/advanced-shipping-for-shop/lib/tier-labels'
import { computeEstimate } from '@/modules/advanced-shipping-for-shop/lib/estimate'
import { resolveProductDeliveries, findTierOption, type ProductDelivery, type ResolveContext, type ResolvedTierOption } from '@/modules/advanced-shipping-for-shop/lib/resolve'
import { getResolveContext } from '@/modules/advanced-shipping-for-shop/lib/context'
import { getSettingsCached } from '@/modules/advanced-shipping-for-shop/lib/db/settings'
import { getVariantChildIds, getVariantParents, getVariantOptionValues, type VariantOptionValue } from '@/modules/advanced-shipping-for-shop/lib/variations-bridge'
import { availableWithGroups, availableWithPhrase, childIdsInPlay } from '@/modules/advanced-shipping-for-shop/lib/tier-availability'
import type { AshSettings, CartControlStyle, StockState } from '@/modules/advanced-shipping-for-shop/lib/types'
import { makeDisplayAdjuster, resolveTaxDisplay } from '@/modules/shop/lib/tax-display'

// `ref` is the caller's own handle on the item, echoed back untouched. The
// basket needs it: two lines of the same product on different services are one
// productId but two rows, and an answer keyed only by product could not tell
// them apart to write a choice back to the right one.
// `variantFallback` asks: answer this listing from its variations rather than
// from its own product row (see mergeVariantDeliveries below). The product
// page's picker sets it, because the listing is not the thing bought - the
// basket takes the chosen variation's own product - so the variations are what
// decides which services are really on offer, and on a catalogue that keys
// delivery off them the listing row resolves to nothing at all. The cart never
// sets it - its lines are already the variations themselves.
// `variantAlternatives` asks for the other half of the story: the services the
// variations RULED OUT by what the shopper has settled on offer but this answer
// does not, so a product page can cross those out and say which choice carries
// them instead of silently hiding them. Set by the product page's picker, never
// by the cart - a basket line is a thing the shopper has already chosen, not a
// choice still being made.
// `chosenValueIds` are the variation options the shopper has picked so far
// (shop-variations' own option-value ids, straight off its page-wide selection
// broadcast). They decide two things, and only ever narrow:
//  - WHICH services the listing still offers, since only the variations still
//    matching the picks are in play. Nothing picked means nothing ruled out, so
//    every service any variation carries is offered as normal, and a service is
//    crossed out only once a pick has actually cost it;
//  - the WORDING of the ones that have been: where a service is to be had is
//    answered against the combination being built rather than against the
//    listing as a whole, which on a chair offering express on fourteen of its
//    colours range-wide but only three on the arms already chosen is the
//    difference between a useful line and a misleading one.
export type EstimateItemInput = { productId: string; tierKey?: string; quantity?: number; ref?: string; variantFallback?: boolean; variantAlternatives?: boolean; chosenValueIds?: string[] }

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
  // The same date said the way a picker says it ("Friday", "Thu 13th") rather
  // than as a plain date. The basket's own picker is worded from this by the
  // cart-line resolver; the product page's picker has only this API to read, so
  // it rides along here and the two cannot end up saying different things.
  targetByLabel: string | null
}

// A service this product cannot have, but another variation of the same listing
// can. Deliberately NOT in `tiers`: everything that reads `tiers` treats it as
// "what this line may be switched to", and a basket offering "everything sooner"
// must never offer one of these. It carries no date for the same reason - there
// is no honest date for a service that would need a different product.
export type UnavailableTierOption = {
  key: string
  label: string
  description: string | null
  // Dearest across the variations that DO offer it, on the same "never in the
  // best light" footing as the listing preview: a figure the shopper is shown
  // before they can have the thing must not undercut what it will actually cost.
  priceEffective: number | null
  // "Available in 160 to 180cm" - which choice carries it, worded here so the
  // product page and any other surface say it the same way.
  note: string
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
  // Only ever populated for a caller that asked (`variantAlternatives`), and only
  // on a listing that has variations. Absent everywhere else, so no existing
  // reader has to learn about it.
  otherTiers?: UnavailableTierOption[]
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

export type EstimateResult = {
  items: ItemEstimate[]
  deliveries: GroupedDelivery[]
  // Which picker the shop owner chose in Delivery settings, so a storefront
  // island can render the services the way the basket does without a settings
  // read of its own. Presentation only - nothing is priced from it.
  controlStyle: CartControlStyle
}

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
function mergeVariantDeliveries(parentProductId: string, children: ProductDelivery[], ctx: ResolveContext, timing: AshSettings): ProductDelivery | null {
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
    tiers.push({
      ...base,
      price: price.toFixed(2),
      // Priced per person if ANY of them prices it that way - the shopper is
      // told so rather than shown a flat figure that may not apply.
      perPerson: offering.some((c) => c.tiers.find((t) => t.key === key)?.perPerson ?? false),
    })
  }

  // The listing-level stock, for anything asking the delivery as a whole rather
  // than a service at a time: the slowest variation's, on the same footing.
  return { productId: parentProductId, stock: slowest.stock, stockByTier, tiers, perPersonCount: slowest.perPersonCount }
}

// Which stock decides a given service's date. On a real product there is one
// answer; on a listing-wide preview the service and the stock come from
// whichever variation is slowest at THAT service, which is not always the same
// one (see mergeVariantDeliveries).
function stockFor(delivery: ProductDelivery, tierKey: string | null): StockState {
  return (tierKey ? delivery.stockByTier?.get(tierKey) : null) ?? delivery.stock
}

// Sorts after every real ISO date, so "no date at all" wins a worst-case pick.
const LATEST_DATE = '9999-12-31'

export async function estimateItems(inputs: EstimateItemInput[], now: Date = new Date()): Promise<EstimateResult> {
  const productIds = inputs.map((i) => i.productId)
  const ctx = await getResolveContext(now)
  const [settings, deliveries, productById, taxDisplay] = await Promise.all([
    getSettingsCached(),
    resolveProductDeliveries(productIds, ctx),
    getProductNames(productIds),
    resolveTaxDisplay(),
  ])

  // Listing pages that resolved to nothing, where the caller asked us to look at
  // the variations instead (the product page's own picker does; the cart never
  // does - it holds real variation lines already). One extra pair of queries,
  // and only when a page would otherwise have shown nothing at all.
  // Which listings this batch needs the variations of, and why:
  //  - `variantFallback`: a listing page that resolved to nothing itself, whose
  //    variations are the only things carrying delivery facts (merged below);
  //  - `variantAlternatives`: a product page that wants the services the rest of
  //    the listing offers, whether or not this product resolved to anything. Here
  //    the item may BE a variation, so the listing is found by going up first.
  // Both are answered from one set of queries: the same children, resolved once.
  // The shop can turn the whole idea off (Delivery settings): a catalogue where
  // naming what this variation cannot have is noise rather than an upsell. Off,
  // no caller gets alternatives, and the queries they cost are never run.
  const alternativesOffered = settings.showUnavailableServices
  const wantsAlternatives = (i: EstimateItemInput) => Boolean(i.variantAlternatives) && alternativesOffered
  const wantAlternatives = [...new Set(inputs.filter(wantsAlternatives).map((i) => i.productId))]
  const parentOf = wantAlternatives.length > 0 ? await getVariantParents(wantAlternatives) : new Map<string, string>()
  const listingOf = (productId: string) => parentOf.get(productId) ?? productId
  const needChildren = new Set<string>([
    ...inputs.filter((i) => i.variantFallback).map((i) => i.productId),
    ...wantAlternatives.map(listingOf),
  ])
  const childIdsByListing = needChildren.size > 0 ? await getVariantChildIds([...needChildren]) : new Map<string, string[]>()
  const allChildren = [...new Set([...childIdsByListing.values()].flat())]
  const childDeliveries = allChildren.length > 0 ? await resolveProductDeliveries(allChildren, ctx) : new Map<string, ProductDelivery>()
  // What each variation is made of, for the "available in 160 to 180cm" line.
  // Only fetched for a caller that asked for the alternatives at all.
  const childOptionValues = wantAlternatives.length > 0 && allChildren.length > 0
    ? await getVariantOptionValues(allChildren)
    : new Map<string, VariantOptionValue[]>()

  // The listing-wide preview, built out of the variations still in play rather
  // than out of whatever the listing's own product id happens to resolve to. A
  // listing with variations is never the thing bought - the basket takes the
  // variation's own product - so its own row's services are a fiction, and where
  // the two disagree the variations are the ones telling the truth. With nothing
  // picked yet, all of them are in play (see childIdsInPlay).
  for (const input of inputs) {
    if (!input.variantFallback) continue
    const ids = childIdsInPlay(childOptionValues, childIdsByListing.get(input.productId) ?? [], input.chosenValueIds)
    const resolved = ids.map((id) => childDeliveries.get(id)).filter((d): d is ProductDelivery => !!d)
    const merged = mergeVariantDeliveries(input.productId, resolved, ctx, settings)
    if (merged) deliveries.set(input.productId, merged)
  }

  // The services somewhere in this listing that the answer above does not carry,
  // each with the choice that carries it. On a settled variation that is what
  // the other variations offer and this one does not; on a listing still being
  // narrowed it is what the shopper's own picks have just put out of reach,
  // since everything still in play is already in `own` (see
  // mergeVariantDeliveries) - which is why an untouched page crosses nothing
  // out. Everything it needs is already in hand, so it costs no further queries.
  function otherTiersFor(
    productId: string,
    own: ProductDelivery | undefined,
    shown: (p: number | null) => number | null,
    chosenValueIds: string[] | undefined,
  ): UnavailableTierOption[] {
    const childIds = childIdsByListing.get(listingOf(productId)) ?? []
    if (childIds.length === 0) return []
    const ownKeys = new Set((own?.tiers ?? []).map((t) => t.key))
    // Keys in the order the variations themselves list them, so the unavailable
    // services read down the page in the shop's own service order.
    const seen = new Set<string>()
    const extras: UnavailableTierOption[] = []
    for (const childId of childIds) {
      for (const tier of childDeliveries.get(childId)?.tiers ?? []) {
        if (ownKeys.has(tier.key) || seen.has(tier.key)) continue
        seen.add(tier.key)
        const offering = childIds.filter((id) => childDeliveries.get(id)?.tiers.some((t) => t.key === tier.key))
        // Dearest across the variations that carry it; a per-person service on a
        // variation with no readable count prices to null and is left unpriced
        // rather than guessed, exactly as it is in the picker itself.
        let price: number | null = 0
        for (const id of offering) {
          const child = childDeliveries.get(id)
          const match = child?.tiers.find((t) => t.key === tier.key)
          if (!child || !match) continue
          const effective = effectiveTierPrice(match, child.perPersonCount)
          if (effective == null) { price = null; break }
          price = Math.max(price ?? 0, effective)
        }
        const groups = availableWithGroups(
          childOptionValues,
          childIds,
          offering,
          // What the shopper has picked so far. A product that IS a variation is
          // a settled combination in its own right, so its own values stand in
          // where the caller sent none (an older storefront, or a page with no
          // variation controls on it).
          chosenValueIds?.length
            ? chosenValueIds
            : (childOptionValues.get(productId) ?? []).map((v) => v.valueId),
        )
        extras.push({
          key: tier.key,
          label: tier.label,
          description: tier.description,
          priceEffective: shown(price),
          note: availableWithPhrase(groups),
        })
      }
    }
    return extras
  }

  // "Today" in the shop's own timezone, for the relative wording on each
  // service's date ("Friday" rather than "Fri 8 Aug"). One value for the whole
  // batch - every date in it is worked out against the same day.
  const todayStr = todayInZone(ctx.now, ctx.timezone)
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
    // Worked out even for a product with no services of its own: a listing whose
    // variations agree on nothing still has services to tell the shopper about,
    // and "nothing at all" would be the one answer that is plainly wrong.
    const otherTiers = wantsAlternatives(input) ? otherTiersFor(input.productId, delivery, shown, input.chosenValueIds) : undefined
    if (!delivery || !tierOption) {
      const empty = EMPTY_ITEM(input.productId, ref, name)
      items.push(otherTiers?.length ? { ...empty, otherTiers } : empty)
      continue
    }

    const est = computeEstimate({
      now: ctx.now,
      timezone: ctx.timezone,
      holidays: ctx.holidays,
      timing: settings,
      tier: tierOption.modifiers,
      stock: stockFor(delivery, tierKey),
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
          stock: stockFor(delivery, t.key),
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
          targetByLabel: dated ? formatDeliveryByLabel(dated, todayStr) : null,
        }
      }),
      ...(otherTiers?.length ? { otherTiers } : null),
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

  return { items, deliveries: deliveriesSummary, controlStyle: settings.cartControlStyle }
}
