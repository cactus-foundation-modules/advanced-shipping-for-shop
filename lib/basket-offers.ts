// Whole-order upgrades: the offers a basket can make once it can see every
// line's services at once, which no single line can work out for itself.
//
// Two kinds come out of the same data:
//   - "Get everything sooner" - put every line on its earliest-arriving service.
//   - one per named service offered across several lines (an assembly service,
//     say) - put every line that offers it onto it.
//
// Pure arithmetic over an estimate result: no IO, no React, no dates of its own
// beyond the "today" it is handed. That keeps it unit-testable, which matters -
// an offer that promises a date it cannot keep, or quotes a price that isn't
// what the basket then charges, is worse than no offer at all.
import { formatDeliveryDate, formatDeliveryByLabel } from '@/modules/advanced-shipping-for-shop/lib/working-days'
import type { ItemEstimate } from '@/modules/advanced-shipping-for-shop/lib/estimate-service'

// One line's move under an offer: which basket row, and onto which service.
export type OfferChange = { ref: string; tierKey: string }

export type BasketOffer = {
  id: string
  title: string
  // Total extra across every line the offer moves, already summed. Negative is
  // possible (a cheaper service that also arrives sooner) and reads as a saving.
  extraCost: number
  itemCount: number
  // Finished copy about what changes and when, e.g.
  // "first arrives Friday (was 6 Aug)". Empty when nothing about the dates moves.
  detail: string
  changes: OfferChange[]
}

// A line the offer machinery can reason about: it has an estimate, a known
// current service, and a basket row to write a choice back to.
type Candidate = {
  ref: string
  current: ItemEstimate['tiers'][number]
  tiers: ItemEstimate['tiers']
}

function candidates(items: ItemEstimate[]): Candidate[] {
  const out: Candidate[] = []
  for (const item of items) {
    if (!item.hasEstimate || !item.ref || !item.tierKey) continue
    const current = item.tiers.find((t) => t.key === item.tierKey)
    if (!current) continue
    out.push({ ref: item.ref, current, tiers: item.tiers })
  }
  return out
}

// The basket's first and last arrival under a given choice per line. Lines with
// no promised date are simply not waited on.
function span(dates: (string | null)[]): { first: string | null; last: string | null } {
  const known = dates.filter((d): d is string => !!d).sort()
  return { first: known[0] ?? null, last: known[known.length - 1] ?? null }
}

// How the offer changes what the shopper is waiting for. The last date is the
// one that decides when the order is actually complete, so it leads; where only
// the first arrival moves, that is said instead - and where neither moves, the
// offer says nothing about dates rather than implying it sped something up.
function describeDates(
  before: { first: string | null; last: string | null },
  after: { first: string | null; last: string | null },
  todayStr: string,
): string {
  const by = (d: string) => formatDeliveryByLabel(d, todayStr)
  const on = (d: string) => formatDeliveryDate(d)
  if (before.last && after.last && after.last < before.last) {
    return `everything by ${by(after.last)} (was ${on(before.last)})`
  }
  if (before.first && after.first && after.first < before.first) {
    return `first arrives ${by(after.first)} (was ${on(before.first)})`
  }
  // A service that lands LATER is still worth offering (an assembly service
  // usually does), but the basket must say so plainly rather than bury it.
  if (before.last && after.last && after.last > before.last) {
    return `everything by ${by(after.last)} (was ${on(before.last)})`
  }
  return ''
}

// Builds one offer from a per-line choice function, or null when it moves
// nothing, prices nothing it can stand behind, or is not offered widely enough.
function buildOffer(
  id: string,
  title: string,
  rows: Candidate[],
  pick: (row: Candidate) => Candidate['current'] | null,
  todayStr: string,
  minLines: number,
): BasketOffer | null {
  const changes: OfferChange[] = []
  const before: (string | null)[] = []
  const after: (string | null)[] = []
  let extraCost = 0

  for (const row of rows) {
    const chosen = pick(row)
    before.push(row.current.targetDate)
    // Not offered here, or the same service the line is already on: the line is
    // untouched and keeps its current date on both sides of the comparison.
    if (!chosen || chosen.key === row.current.key) { after.push(row.current.targetDate); continue }
    changes.push({ ref: row.ref, tierKey: chosen.key })
    extraCost += chosen.priceEffective - row.current.priceEffective
    after.push(chosen.targetDate)
  }

  if (changes.length < minLines) return null
  return {
    id,
    title,
    extraCost: Math.round(extraCost * 100) / 100,
    itemCount: changes.length,
    detail: describeDates(span(before), span(after), todayStr),
    changes,
  }
}

// Earliest-arriving service on a line; ties broken by price, so "sooner" never
// costs more than it has to. A service with no promised date is not a candidate.
function earliest(row: Candidate): Candidate['current'] | null {
  let best: Candidate['current'] | null = null
  for (const t of row.tiers) {
    if (!t.targetDate) continue
    if (!best) { best = t; continue }
    if (t.targetDate < best.targetDate! || (t.targetDate === best.targetDate && t.priceEffective < best.priceEffective)) best = t
  }
  return best
}

export function buildBasketOffers(items: ItemEstimate[], todayStr: string): BasketOffer[] {
  const rows = candidates(items)
  // A single line has nothing to say about the WHOLE order - its own picker
  // already offers everything this row could.
  if (rows.length < 2) return []

  const offers: BasketOffer[] = []

  // "Sooner" only earns its place when it moves at least two lines; one line is
  // the shopper's own picker's job, sitting right there beside the item.
  const sooner = buildOffer('sooner', 'Get everything sooner', rows, earliest, todayStr, 2)
  // A "sooner" offer that costs nothing and changes nothing about the dates is
  // noise - it means every line was already on its earliest service.
  if (sooner && sooner.detail) offers.push(sooner)

  // One offer per named service that more than one line is offered, in the order
  // the services appear across the basket so the row is stable between renders.
  const sharedKeys: string[] = []
  const offeredCount = new Map<string, number>()
  for (const row of rows) {
    for (const t of row.tiers) {
      const seen = (offeredCount.get(t.key) ?? 0) + 1
      offeredCount.set(t.key, seen)
      if (seen === 1 && !sharedKeys.includes(t.key)) sharedKeys.push(t.key)
    }
  }
  for (const key of sharedKeys) {
    if ((offeredCount.get(key) ?? 0) < 2) continue
    const label = rows.flatMap((r) => r.tiers).find((t) => t.key === key)?.label
    if (!label) continue
    const offer = buildOffer(
      `tier:${key}`,
      label,
      rows,
      (row) => row.tiers.find((t) => t.key === key) ?? null,
      todayStr,
      2,
    )
    // Already the whole basket's service, or it only reaches one line: nothing
    // to offer. The "sooner" row above may also have covered this exact move.
    if (!offer) continue
    if (offers.some((o) => sameChanges(o.changes, offer.changes))) continue
    offers.push(offer)
  }

  return offers
}

// Two offers that move the same lines onto the same services are the same offer
// wearing different names - the basket shows it once, under the first name.
function sameChanges(a: OfferChange[], b: OfferChange[]): boolean {
  if (a.length !== b.length) return false
  const key = (c: OfferChange[]) => c.map((x) => `${x.ref}=${x.tierKey}`).sort().join('|')
  return key(a) === key(b)
}

// "+£13.90", "£13.90 off", or "Included" - the price change an offer carries,
// worded for a shopper rather than a spreadsheet.
export function formatOfferPrice(extraCost: number, currencySymbol: string): string {
  if (Math.abs(extraCost) < 0.005) return 'Included'
  if (extraCost < 0) return `${currencySymbol}${Math.abs(extraCost).toFixed(2)} off`
  return `+${currencySymbol}${extraCost.toFixed(2)}`
}
