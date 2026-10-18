// What a listing can deliver, variation by variation, in words a person can say.
//
// A listing whose delivery rules live on its variations has no delivery of its
// own: the blue, black and red may land on Tuesday for £10 while every other
// colour is Wednesday week. `shop.product-delivery-timing` cannot say that - it
// answers with counts of working days for the listing as a whole, and for a
// listing it resolves to nothing at all. A shopper looking at the page is told
// the date for the combination they have picked; something that has to answer
// "when can I have it?" without a page to click on (the phone assistant) needs
// the whole picture at once.
//
// So this is that picture: per delivery service, the distinct (date, price)
// outcomes across every enabled variation, each with the variations it applies
// to. Pure - resolved deliveries, option values and a clock in, groups out - so
// the grouping is unit-tested and the provider in delivery-forecast-provider.ts
// is only the reading.
//
// Dates are real dates, worked out against `now`, so a caller must not cache
// the answer past the day it was asked for. Prices are NET and in major units,
// exactly as the delivery-timing seam carries them.

import { computeEstimate } from '@/modules/advanced-shipping-for-shop/lib/estimate'
import type { ProductDelivery, ResolveContext } from '@/modules/advanced-shipping-for-shop/lib/resolve'
import { effectiveTierPrice } from '@/modules/advanced-shipping-for-shop/lib/tier-labels'
import { formatDeliveryDate, todayInZone } from '@/modules/advanced-shipping-for-shop/lib/working-days'
import type { VariantOptionValue } from '@/modules/advanced-shipping-for-shop/lib/variations-bridge'
import type { AshSettings } from '@/modules/advanced-shipping-for-shop/lib/types'

/** Which variations a group covers, said option by option. */
export type ForecastScope = {
  /** Every variation of the listing. Nothing else to say. */
  all: boolean
  /** Options this group narrows, with the values it covers - set when the group
   *  is exactly the combinations those values make up. */
  appliesTo: Array<{ option: string; values: string[] }> | null
  /** Otherwise (the group is not a clean grid of values) the variations one by
   *  one, capped. Null when `all` or `appliesTo` says it. */
  combinations: string[] | null
  count: number
}

export type ForecastGroup = ForecastScope & {
  /** "YYYY-MM-DD", or null when these variations cannot promise a date. */
  date: string | null
  /** "Tuesday 20th of October". */
  dateLabel: string | null
  /** NET, major units. */
  price: number
}

export type ForecastService = {
  key: string
  label: string
  description: string | null
  /** Soonest first; undated last. */
  groups: ForecastGroup[]
  /** Variations that do not offer this service at all, when some do not. */
  notOfferedOn: ForecastScope | null
}

export type ProductDeliveryForecast = {
  productId: string
  /** "YYYY-MM-DD" in the shop's timezone: the day every date here is measured from. */
  today: string
  hasVariations: boolean
  services: ForecastService[]
}

/** A variation, or the product itself when it has none. */
export type ForecastMember = { id: string; delivery: ProductDelivery; values: VariantOptionValue[] }

const MAX_GROUPS = 8
const MAX_COMBINATIONS = 12

function labelsInOrder(values: VariantOptionValue[]): string[] {
  const seen = new Map<string, number>()
  for (const v of values) {
    const at = seen.get(v.valueLabel)
    if (at == null || v.valuePosition < at) seen.set(v.valueLabel, v.valuePosition)
  }
  return [...seen.entries()].sort((a, b) => a[1] - b[1]).map(([label]) => label)
}

/** Says which of `everyone` the `subset` is, in the options' own terms. */
export function describeScope(subset: ForecastMember[], everyone: ForecastMember[]): ForecastScope {
  const count = subset.length
  if (count >= everyone.length) return { all: true, appliesTo: null, combinations: null, count }

  const valuesOf = (members: ForecastMember[]) => members.flatMap((m) => m.values)
  const everything = valuesOf(everyone)
  const here = valuesOf(subset)
  const optionIds = [...new Map(everything.map((v) => [v.optionId, v])).values()]
    .sort((a, b) => a.optionPosition - b.optionPosition)

  // The options this group actually narrows: one that takes every value is not
  // what separates it from the rest, and naming it would only mislead.
  const appliesTo: Array<{ option: string; values: string[] }> = []
  let cells = 1
  for (const option of optionIds) {
    const all = labelsInOrder(everything.filter((v) => v.optionId === option.optionId))
    const mine = labelsInOrder(here.filter((v) => v.optionId === option.optionId))
    cells *= Math.max(1, mine.length)
    if (mine.length > 0 && mine.length < all.length) appliesTo.push({ option: option.optionName, values: mine })
  }

  // A clean grid: the group is every combination of the values named, nothing
  // more. Otherwise "Blue and 160cm" would claim a pairing the group lacks.
  if (appliesTo.length > 0 && cells === count) return { all: false, appliesTo, combinations: null, count }

  const combinations = subset
    .map((m) => [...m.values].sort((a, b) => a.optionPosition - b.optionPosition).map((v) => v.valueLabel).join(' / '))
    .filter(Boolean)
    .slice(0, MAX_COMBINATIONS)
  return { all: false, appliesTo: null, combinations: combinations.length > 0 ? combinations : null, count }
}

export function buildDeliveryForecast(
  productId: string,
  members: ForecastMember[],
  hasVariations: boolean,
  ctx: ResolveContext,
  timing: AshSettings,
): ProductDeliveryForecast {
  const keys = [...new Set(members.flatMap((m) => m.delivery.tiers.map((t) => t.key)))]
  const services: ForecastService[] = []

  for (const key of keys) {
    const offering = members.filter((m) => m.delivery.tiers.some((t) => t.key === key))
    const first = offering[0]!.delivery.tiers.find((t) => t.key === key)!

    const buckets = new Map<string, { date: string | null; price: number; members: ForecastMember[] }>()
    for (const member of offering) {
      const tier = member.delivery.tiers.find((t) => t.key === key)!
      const stock = member.delivery.stockByTier?.get(key) ?? member.delivery.stock
      const est = computeEstimate({
        now: ctx.now, timezone: ctx.timezone, holidays: ctx.holidays, timing, tier: tier.modifiers, stock,
      })
      const date = est.available && est.targetDate ? est.targetDate : null
      const price = effectiveTierPrice(tier)
      const bucketKey = `${date ?? 'none'}|${price.toFixed(2)}`
      const bucket = buckets.get(bucketKey) ?? { date, price, members: [] }
      bucket.members.push(member)
      buckets.set(bucketKey, bucket)
    }

    const sorted = [...buckets.values()].sort((a, b) => {
      if (a.date !== b.date) return a.date === null ? 1 : b.date === null ? -1 : a.date < b.date ? -1 : 1
      return a.price - b.price
    })
    // Soonest few and the latest, so a long tail never drowns the answer and the
    // worst case is never left out.
    const kept = sorted.length > MAX_GROUPS ? [...sorted.slice(0, MAX_GROUPS - 1), sorted[sorted.length - 1]!] : sorted

    services.push({
      key,
      label: first.label,
      description: first.description,
      groups: kept.map((b) => ({
        date: b.date,
        dateLabel: b.date ? formatDeliveryDate(b.date) : null,
        price: b.price,
        ...describeScope(b.members, members),
      })),
      notOfferedOn: offering.length < members.length
        ? describeScope(members.filter((m) => !offering.includes(m)), members)
        : null,
    })
  }

  return { productId, today: todayInZone(ctx.now, ctx.timezone), hasVariations, services }
}
