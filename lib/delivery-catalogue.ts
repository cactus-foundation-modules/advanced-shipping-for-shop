// What this shop's delivery services cost, where each one is offered, and the
// working-day rules behind every date it quotes - published whole, at the
// `shop.delivery-services-catalogue` extension point, for any module that needs
// to describe the shop's delivery to somewhere else.
//
// A companion to delivery-timing-provider.ts, not a replacement for it. That
// one answers "how long does THIS product take", product by product, which is
// what a feed attaching times to items wants. This one answers "what are the
// shop's delivery rules", once, with no products in the question at all - which
// is what anything reproducing those rules in another system wants, because
// such a system is configured once and then applied to everything.
//
// Deliberately free of any notion of who is asking. There is nothing in these
// types about Google, Merchant Center, rate groups or shipping labels; a
// courier tender document or a printed price list would read exactly the same
// shape. The awkward parts of somebody else's model - a scope set that does not
// fit, a holiday calendar the other end cannot express - are theirs to notice
// and say out loud, and this module's job is only to be honest about what it
// holds.
//
// READ ONLY. Nothing here writes, and nothing here is a decision.
//
// RELEASE ORDER. `scopesForProducts` answers with an object per product; it
// once answered with a bare group id, and google-shopping's reader still
// understands both. A consumer that does NOT - an older google-shopping -
// silently drops every label and sends its whole feed to the catch-all rate.
// Nothing in a manifest can express that, because it is the shape of an answer
// rather than an import, so: release google-shopping no later than this module,
// and widen a consumer's reader before ever changing what is answered here.
import { listCategories } from '@/modules/shop/lib/db/catalogue'
import { listAttributes } from '@/modules/product-attributes-for-shop/lib/db/attributes'
import { ttlCached } from '@/modules/advanced-shipping-for-shop/lib/ttl-cache'
import { getShopTimezone } from '@/modules/advanced-shipping-for-shop/lib/context'
import { getSettingsCached } from '@/modules/advanced-shipping-for-shop/lib/db/settings'
import { listHolidays } from '@/modules/advanced-shipping-for-shop/lib/db/holidays'
import { listTiersCached, listTierConfigCached } from '@/modules/advanced-shipping-for-shop/lib/db/tiers'
import {
  SCOPE_SPECIFICITY,
  pickMostSpecific,
  resolveProductScopeFacts,
} from '@/modules/advanced-shipping-for-shop/lib/resolve'
import { effectiveTierPrice } from '@/modules/advanced-shipping-for-shop/lib/tier-labels'
import type { ScopeType, TierScopeConfig } from '@/modules/advanced-shipping-for-shop/lib/types'

/** The kinds of thing a delivery rule can be written against, most specific
 *  first in SCOPE_ORDER below. */
export type DeliveryScopeKind = ScopeType

/** One group of products the shop prices delivery for: a product range, a
 *  category, a supplier, or everything. */
export type DeliveryScope = {
  /** Stable within a catalogue, and stable between runs: "range:<id>",
   *  "category:<id>", "supplier:<name>", "default". */
  id: string
  kind: DeliveryScopeKind
  /** What the rule is written against - a value id, a category id, a supplier
   *  name. Null on the catch-all. */
  ref: string | null
  /** What the shop calls it, for a human: "Orion", "Office chairs", "Furdeco". */
  label: string
}

/** What one service costs, and how long it takes, for one scope. */
export type DeliveryScopeRate = {
  scopeId: string
  /** False where the shop has a rule saying this service is NOT offered here.
   *  A scope with no rule at all simply has no entry. */
  available: boolean
  /** NET price in major units, on the same side of tax as a product's stored
   *  price - the charge is folded into the line and taxed at the product's own
   *  rate, so a caller printing it to a shopper must convert it exactly as it
   *  converts that product's price.
   *
   *  Charged PER UNIT. Two of the same thing is twice this. */
  price: number
  /** Working days on the road, after this scope's own override. */
  transitDays: number
  /** The floor under the whole estimate for this scope, where one is set.
   *  Never brings a date in, only pushes it out. */
  minLeadDays: number | null
}

export type DeliveryServiceEntry = {
  key: string
  label: string
  description: string | null
  /** The order the shop lists its services in. */
  position: number
  /** The service's own courier time, before any scope override. */
  transitDays: number
  minLeadDays: number | null
  /** One entry per scope with a rule for this service. */
  rates: DeliveryScopeRate[]
  /** The shop's designated default service is offered everywhere, free, on its
   *  own timing, whether or not a scope has a rule for it. */
  isDefault: boolean
}

/** The shop-wide rules every date is worked out against. */
export type DeliveryDispatchRules = {
  /** "HH:MM", wall-clock in `timezone`. An order after it starts tomorrow. */
  cutoffTime: string
  /** IANA zone the cut-off is read in. */
  timezone: string
  /** Weekday numbers parcels leave on, 0 = Sunday. */
  shipDays: number[]
  /** Working days from a cleared order to the parcel leaving. */
  dispatchLeadDays: number
}

export type DeliveryHoliday = { date: string; name: string }

export type DeliveryCatalogue = {
  /** How a product picks its scope: the first of these with a matching rule
   *  wins, and for CATEGORY the nearest ancestor beats a distant one. */
  scopeOrder: readonly DeliveryScopeKind[]
  /** Whether a service's price is charged once per order or on every unit.
   *  Always 'per-unit' today; named rather than assumed because a consumer
   *  reproducing these prices somewhere that only understands per-order has to
   *  know it is making an approximation. */
  pricing: 'per-unit' | 'per-order'
  scopes: DeliveryScope[]
  services: DeliveryServiceEntry[]
  dispatch: DeliveryDispatchRules
  /** Non-working days on top of the weekly pattern, soonest first. Dates the
   *  shop does not dispatch or deliver on. */
  holidays: DeliveryHoliday[]
}

/** The catch-all scope's id, so a caller need not build the string itself. */
export const DEFAULT_SCOPE_ID = 'default'

/** A scope's stable id. Pure, and the only place the shape is decided. */
export function deliveryScopeId(kind: DeliveryScopeKind, ref: string | null): string {
  if (kind === 'DEFAULT' || ref === null) return DEFAULT_SCOPE_ID
  return `${kind.toLowerCase()}:${ref}`
}

// A rule row reduced to the pair that identifies its scope, deduplicated.
function scopeKeysOf(config: TierScopeConfig[]): Array<{ kind: DeliveryScopeKind; ref: string | null }> {
  const seen = new Map<string, { kind: DeliveryScopeKind; ref: string | null }>()
  for (const row of config) {
    const kind = row.scopeType
    const ref = kind === 'DEFAULT' ? null : row.scopeRef
    // A scoped rule whose reference has gone (a deleted category, say) is not a
    // scope any product can fall in, so it is not one worth publishing.
    if (kind !== 'DEFAULT' && !ref) continue
    seen.set(deliveryScopeId(kind, ref), { kind, ref })
  }
  // Sorted, and not as a nicety. Where a product matches two scopes of the same
  // kind - a listing carrying two range values, say - the first candidate wins,
  // and the rule rows come back from Postgres in no particular order. An
  // unsorted list would hand the same product a different scope between two
  // runs, which for a consumer grouping products is a group that moves on its
  // own.
  return [...seen.values()].sort((a, b) => (a.ref ?? '').localeCompare(b.ref ?? ''))
}

// The two reads that are NOT already memoised on the resolve path, given TTL
// memos of their own here.
//
// listAttributes in particular is not a small read: it pulls every attribute in
// the shop with every one of its values, and a shop with a range attribute has
// a value per range. The catalogue needs it only to put a name to a scope, and
// the names change about as often as the ranges do, so a minute's memo costs
// nothing and spares an admin page load the lot. Both are named lookups behind
// the scenes, so a stale name for up to a minute is a non-event.
const categoriesCache = ttlCached(listCategories, 60_000)
const attributesCache = ttlCached(listAttributes, 60_000)

/**
 * Every scope the shop has written a delivery rule against, named.
 *
 * A reference whose thing has been deleted still gets a scope - the rule is
 * still there and still costs money - but it is named so that it reads as the
 * loose end it is rather than as a group somebody meant to create.
 */
async function nameScopes(
  keys: Array<{ kind: DeliveryScopeKind; ref: string | null }>,
  rangeAttributeId: string | null,
): Promise<DeliveryScope[]> {
  const needsCategories = keys.some((k) => k.kind === 'CATEGORY')
  const needsRanges = keys.some((k) => k.kind === 'RANGE') && rangeAttributeId !== null
  const [categories, attributes] = await Promise.all([
    needsCategories ? categoriesCache.get() : Promise.resolve([]),
    needsRanges ? attributesCache.get() : Promise.resolve([]),
  ])
  const categoryNames = new Map(categories.map((c) => [c.id, c.name]))
  const rangeNames = new Map<string, string>()
  const rangeAttribute = rangeAttributeId ? attributes.find((a) => a.id === rangeAttributeId) : undefined
  for (const value of rangeAttribute?.values ?? []) rangeNames.set(value.id, value.label)

  return keys.map(({ kind, ref }) => ({
    id: deliveryScopeId(kind, ref),
    kind,
    ref,
    label: scopeLabel(kind, ref, categoryNames, rangeNames),
  }))
}

function scopeLabel(
  kind: DeliveryScopeKind,
  ref: string | null,
  categoryNames: Map<string, string>,
  rangeNames: Map<string, string>,
): string {
  switch (kind) {
    case 'DEFAULT':
      return 'Everything'
    case 'SUPPLIER':
      // The supplier IS the reference - a name, typed on the product.
      return ref ?? 'Everything'
    case 'CATEGORY':
      return (ref && categoryNames.get(ref)) || 'Deleted category'
    case 'RANGE':
      return (ref && rangeNames.get(ref)) || 'Deleted range'
  }
}

/**
 * The whole delivery catalogue: services, scopes, prices, timing and holidays.
 *
 * One read of each table. The settings, services and rules are the same
 * TTL-memoised reads the resolve path uses; the category and attribute names
 * are memoised here (see above). The holiday list is NOT - it is read straight
 * every time, because it is one small indexed query and nothing else in this
 * module caches it by region for this shape.
 */
export async function buildDeliveryCatalogue(): Promise<DeliveryCatalogue> {
  const [settings, tiers, config, timezone] = await Promise.all([
    getSettingsCached(),
    listTiersCached(),
    listTierConfigCached(),
    getShopTimezone(),
  ])
  const holidays = await listHolidays(settings.holidayRegion)

  const scopes = await nameScopes(scopeKeysOf(config), settings.rangeAttributeId)
  // Stable ordering, so a consumer diffing two catalogues sees a change only
  // where something actually changed: specificity first, then the label as a
  // person would sort it, then the reference to break a tie between two
  // scopes named the same.
  const rank = new Map(SCOPE_SPECIFICITY.map((kind, index) => [kind, index]))
  scopes.sort((a, b) => (rank.get(a.kind) ?? 0) - (rank.get(b.kind) ?? 0)
    || a.label.localeCompare(b.label, 'en-GB')
    || (a.ref ?? '').localeCompare(b.ref ?? ''))

  const services: DeliveryServiceEntry[] = tiers.map((tier) => {
    const rates: DeliveryScopeRate[] = []
    for (const row of config) {
      if (row.tierId !== tier.id) continue
      if (row.scopeType !== 'DEFAULT' && !row.scopeRef) continue
      rates.push({
        scopeId: deliveryScopeId(row.scopeType, row.scopeType === 'DEFAULT' ? null : row.scopeRef),
        available: row.available,
        price: effectiveTierPrice(row),
        // The service's own figure where the scope does not override it, which
        // is what the basket charges - not a null for the caller to interpret.
        transitDays: row.transitDays ?? tier.transitDays,
        minLeadDays: row.minLeadDays ?? tier.minLeadDays,
      })
    }
    return {
      key: tier.key,
      label: tier.label,
      description: tier.description,
      position: tier.position,
      transitDays: tier.transitDays,
      minLeadDays: tier.minLeadDays,
      rates,
      isDefault: settings.defaultTierKey != null && tier.key === settings.defaultTierKey,
    }
  })

  return {
    scopeOrder: SCOPE_SPECIFICITY,
    pricing: 'per-unit',
    scopes,
    services,
    dispatch: {
      cutoffTime: settings.cutoffTime,
      timezone,
      shipDays: settings.shipDays,
      dispatchLeadDays: settings.dispatchLeadDays,
    },
    holidays,
  }
}

// Ids per round trip, for the same reasons delivery-timing-provider chunks:
// the resolver binds a parameter per id against Postgres's 65,535 ceiling, and
// a variant child drags its parent in beside it.
const CHUNK = 10_000

/** Which group a product falls in, and what else it equally matched. */
export type ProductDeliveryScope = {
  /** The group the product is labelled with. */
  scopeId: string
  /** Other groups of the SAME specificity the product ALSO matched, where
   *  there were any. Empty on nearly every product.
   *
   *  Published because the tie is real and a consumer cannot see it otherwise.
   *  A listing tagged with two product ranges matches both range rules; this
   *  answer settles the tie one way, while a per-service resolution (the basket)
   *  settles it on whichever promises the later delivery, and the two can land
   *  on different groups. A consumer that has to pick ONE group per product -
   *  a feed labelling items, say - needs to know which products it is guessing
   *  about, and it costs nothing to say: pickMostSpecific already works the
   *  whole set out, and this used to throw all but the winner away. */
  tiedWith: string[]
}

/**
 * Which scope each product falls in, keyed by product id.
 *
 * The SAME resolution the basket uses, because it is literally the basket's
 * own code: resolveProductScopeFacts works out the range, category chain and
 * supplier (with the variant-child fallbacks), and pickMostSpecific applies the
 * house order - range, else nearest-ancestor category, else supplier, else
 * everything.
 *
 * One difference worth naming: the basket resolves a scope PER SERVICE, since
 * each service has its own set of rules and may fall through to a different
 * one. This answers a single scope per product, taken across every rule the
 * shop has written, because a consumer grouping products can only put each one
 * in one group. Where the two disagree, this is the more specific of the two -
 * it is the most specific scope the product matches anywhere - and `tiedWith`
 * above names the cases where the choice was not forced.
 *
 * A product matching no scope at all is absent from the map. There is nothing
 * honest to say about it, and a caller must not invent a group for it.
 */
export async function resolveProductDeliveryScopes(productIds: string[]): Promise<Map<string, ProductDeliveryScope>> {
  const result = new Map<string, ProductDeliveryScope>()
  const ids = [...new Set(productIds)].filter(Boolean)
  if (ids.length === 0) return result

  const [settings, config] = await Promise.all([getSettingsCached(), listTierConfigCached()])
  const keys = scopeKeysOf(config)
  if (keys.length === 0) return result

  for (let start = 0; start < ids.length; start += CHUNK) {
    const facts = await resolveProductScopeFacts(ids.slice(start, start + CHUNK), settings)
    for (const [productId, { scope }] of facts) {
      // Every equally-specific match, not just the first. For CATEGORY this is
      // the rows on the nearest category in the chain, which deduplicate to
      // one; for SUPPLIER and DEFAULT there can only be one. In practice a tie
      // means a listing carrying two product ranges.
      const candidates = pickMostSpecific(
        keys.map((key) => ({ scopeType: key.kind, scopeRef: key.ref, key })),
        scope,
      )
      const [winner, ...rest] = candidates
      if (!winner) continue
      result.set(productId, {
        scopeId: deliveryScopeId(winner.key.kind, winner.key.ref),
        tiedWith: rest.map((other) => deliveryScopeId(other.key.kind, other.key.ref)),
      })
    }
  }
  return result
}
