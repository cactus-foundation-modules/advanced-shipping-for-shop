// The wording and date maths for an order whose payment has not been taken yet.
// Pure: no database, no request context, no shop imports - so the unit tests pin
// it directly and the seam provider next door is left as plumbing.
//
// The problem it solves: a delivery date is counted from the day the order is
// DISPATCHED, and nothing is dispatched before it is paid for. On a method that
// takes the money at the checkout those are the same afternoon, so the date the
// basket promised stands. On bank transfer they are not: the shopper can sit on
// it for a fortnight, and a line still reading "Delivery by Tuesday the 5th" is
// then simply a false promise, made by us, in writing, on their receipt.
//
// So an unpaid line states the promise the only way it can honestly be stated -
// as a lead time, counted from whenever the money lands - and becomes a date
// again the moment it does.
import { formatDeliveryDate } from '@/modules/advanced-shipping-for-shop/lib/working-days'

// What the cart-line resolver snapshots onto the order line so the promise can be
// restated later without re-reading it out of its own sentence. Namespaced,
// because every resolver's data shares one bag on the line (shop's LineMeta.data).
export const DELIVERY_META_KEY = 'ashDelivery'

export type DeliveryLineState = {
  // The service the shopper bought, so a restatement re-dates that one and not
  // the shop's default.
  tierKey: string
  // The service as it is named on the line - the wording is settled at order
  // time and never re-derived, so it cannot drift under a shopper who has
  // already paid.
  tierText: string
  // Working days from the order to the date it was quoted: the promise itself,
  // independent of when the clock starts. What an unpaid line states, and the
  // fallback for re-dating a paid one whose service has since been reconfigured.
  leadDays: number
  // The date quoted when the order was placed, kept for the audit trail.
  targetDate: string
  // A pre-order's date comes from the stock's own arrival, not from dispatch
  // timing, so payment does not move it and it is never restated as a lead time.
  isPreOrder: boolean
}

export function isDeliveryLineState(value: unknown): value is DeliveryLineState {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return typeof v.tierKey === 'string'
    && typeof v.tierText === 'string'
    && typeof v.leadDays === 'number'
    && typeof v.targetDate === 'string'
    && typeof v.isPreOrder === 'boolean'
}

// Reads this module's state back off a stored line snapshot, or null when the
// line was never ours (a plain product, or one ordered before this existed).
export function readDeliveryLineState(data: Record<string, unknown> | undefined): DeliveryLineState | null {
  const raw = data?.[DELIVERY_META_KEY]
  return isDeliveryLineState(raw) ? raw : null
}

// The label the order line's delivery field is filed under. Fixed, because it is
// the identity shop merges a restatement on.
export const DELIVERY_FIELD_LABEL = 'Delivery'

// "5 working days" / "1 working day" - a count nobody has to decode.
export function formatWorkingDays(days: number): string {
  return `${days} working day${days === 1 ? '' : 's'}`
}

// What an unpaid line says. Deliberately not a date: it states the promise and
// what starts it, in that order, so a shopper who has not sent the money yet can
// see exactly what they are holding up.
export function unpaidDeliveryValue(state: DeliveryLineState): string {
  if (state.leadDays <= 0) return `${state.tierText} - dispatched once your payment reaches us`
  return `${state.tierText} - ${formatWorkingDays(state.leadDays)} from when your payment reaches us`
}

// What a paid line says: the ordinary promise again, on a date counted from the
// day the money actually arrived.
export function paidDeliveryValue(tierText: string, targetDate: string): string {
  return `${tierText} - by ${formatDeliveryDate(targetDate)}`
}

// The checkout's one sentence about a method that does not take the money now.
// `leadDays` is the longest lead in the basket - the day everything has arrived
// by, which is the figure the shopper is actually waiting on. Omitted when no
// line has a lead worth quoting, so the sentence never trails off into nothing.
export function deferredPaymentNote(leadDays: number | null): string {
  const lead = leadDays != null && leadDays > 0
    ? ` For this order that is ${formatWorkingDays(leadDays)} from the day it clears.`
    : ''
  return `Nothing is dispatched until your payment reaches us, so your delivery dates start from the day it clears rather than today.${lead} Until then your order shows the delivery time in working days instead of a date.`
}
