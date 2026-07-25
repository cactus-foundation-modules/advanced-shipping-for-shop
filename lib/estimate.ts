// The delivery-date engine. Pure: given the current instant, the shop timezone,
// the holiday set, a resolved rule, an optional tier and the product's stock
// state, it returns a delivered-by date and the cut-off the estimate hangs on.
// No database, no network - every input is resolved before it gets here, so this
// is the one file the unit tests pin the maths against.
import type { DeliveryEstimate, ResolvedRule, ResolvedTier, StockState } from './types'
import {
  addWorkingDays,
  cutoffInstant,
  isWorkingDay,
  laterOf,
  nextWorkingDay,
  todayInZone,
} from './working-days'

export type ComputeEstimateInput = {
  now: Date
  timezone: string
  holidays: Set<string>
  rule: ResolvedRule
  tier?: ResolvedTier | null
  stock: StockState
}

const NO_TIER: ResolvedTier = { isNextDay: false, dispatchLeadDelta: 0, transitDelta: 0, minLeadDays: null }

export function computeEstimate(input: ComputeEstimateInput): DeliveryEstimate {
  const { now, timezone, holidays, rule, stock } = input
  const tier = input.tier ?? NO_TIER
  const today = todayInZone(now, timezone)
  const shipDays = rule.shipDays.length > 0 ? rule.shipDays : [1, 2, 3, 4, 5]

  const outOfStock = stock.trackInventory && (stock.stockCount ?? 0) <= 0
  const isBackorder = outOfStock && stock.outOfStockBehaviour === 'BACKORDER'

  // Out of stock and set to block: nothing to promise. Everything else is a
  // date, however far out.
  if (outOfStock && stock.outOfStockBehaviour === 'BLOCK') {
    return {
      available: false,
      reason: 'Out of stock',
      targetDate: null,
      cutoffInstantISO: null,
      dispatchDate: null,
      isMadeToOrder: rule.fulfilmentMode === 'MADE_TO_ORDER',
      isBackorder: false,
      isPreOrder: false,
    }
  }

  const transit = Math.max(0, rule.transitDays + tier.transitDelta)
  const backorderExtra = isBackorder ? Math.max(0, rule.backorderLeadDays ?? 0) : 0

  let dispatchDate: string
  let cutoffInstantISO: string | null = null
  let isPreOrder = false

  if (stock.isPreOrder && stock.preOrderDispatchDate) {
    // Pre-order: dispatch is the promised date (or today if that has passed),
    // rolled to a working day. No cut-off, no lead.
    isPreOrder = true
    dispatchDate = nextWorkingDay(laterOf(stock.preOrderDispatchDate, today), holidays, shipDays)
  } else if (rule.fulfilmentMode === 'MADE_TO_ORDER') {
    // Made to order: no cut-off. Lead time in working days from today, then
    // transit. Tier next-day is meaningless here (nothing is in stock to rush),
    // so only the dispatch delta and backorder lead move the dispatch day.
    const lead = Math.max(0, rule.mtoLeadDays + tier.dispatchLeadDelta) + backorderExtra
    dispatchDate = addWorkingDays(nextWorkingDay(today, holidays, shipDays), lead, holidays, shipDays)
  } else {
    // Stocked: cut-off decides the baseline dispatch day. Order before the
    // cut-off on a ship/working day and it clears today; otherwise it clears the
    // next working day. The cut-off the estimate hangs on is the one on that
    // clearing day - the storefront countdown ticks to it.
    const canDispatchToday =
      isWorkingDay(today, holidays, shipDays) && now < cutoffInstant(today, rule.cutoffTime, timezone)
    // addWorkingDays(_, 1) lands on the first working day strictly after today,
    // which is exactly where a missed cut-off (or a non-working today) clears.
    const base = canDispatchToday ? today : addWorkingDays(today, 1, holidays, shipDays)
    cutoffInstantISO = cutoffInstant(base, rule.cutoffTime, timezone).toISOString()

    const dispatchLead = Math.max(0, rule.dispatchLeadDays + tier.dispatchLeadDelta) + backorderExtra
    // Next-day tier ships on the clearing day itself, ignoring the standing
    // dispatch lead (but still honouring backorder restock, which is a real
    // wait, not a courier speed).
    dispatchDate = tier.isNextDay
      ? addWorkingDays(base, backorderExtra, holidays, shipDays)
      : addWorkingDays(base, dispatchLead, holidays, shipDays)
  }

  let targetDate = addWorkingDays(dispatchDate, transit, holidays, shipDays)

  // A tier can floor the whole estimate at a working-day minimum (e.g. full
  // installation is never sooner than ~10 working days out), never bring it in.
  if (tier.minLeadDays != null && tier.minLeadDays > 0) {
    const floor = addWorkingDays(nextWorkingDay(today, holidays, shipDays), tier.minLeadDays, holidays, shipDays)
    if (targetDate < floor) targetDate = floor
  }

  return {
    available: true,
    targetDate,
    cutoffInstantISO,
    dispatchDate,
    isMadeToOrder: rule.fulfilmentMode === 'MADE_TO_ORDER',
    isBackorder,
    isPreOrder,
  }
}
