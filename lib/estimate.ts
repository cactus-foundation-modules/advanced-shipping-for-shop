// The delivery-date engine. Pure: given the current instant, the shop timezone,
// the holiday set, the shop-wide dispatch timing, the resolved delivery service
// and the product's stock state, it returns a delivered-by date and the cut-off
// the estimate hangs on. No database, no network - every input is resolved
// before it gets here, so this is the one file the unit tests pin the maths
// against.
import type { DeliveryEstimate, DispatchTiming, ResolvedTier, StockState } from './types'
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
  timing: DispatchTiming
  tier: ResolvedTier
  stock: StockState
}

// The days the shop actually ships on, defaulting to Mon-Fri when a shop has
// nominated none. Exported because callers doing their own date maths off an
// estimate (turning its date into a working-day count, say) have to use the very
// same set or their answer disagrees with the estimate it came from.
export function effectiveShipDays(timing: DispatchTiming): number[] {
  return timing.shipDays.length > 0 ? timing.shipDays : [1, 2, 3, 4, 5]
}

export function computeEstimate(input: ComputeEstimateInput): DeliveryEstimate {
  const { now, timezone, holidays, timing, tier, stock } = input
  const today = todayInZone(now, timezone)
  const shipDays = effectiveShipDays(timing)

  const outOfStock = stock.trackInventory && (stock.stockCount ?? 0) <= 0
  // Out of stock and set to block: nothing to promise. A backorderable line
  // still gets a date (the shop lets it be bought), promised at normal timing.
  if (outOfStock && stock.outOfStockBehaviour === 'BLOCK') {
    return {
      available: false,
      reason: 'Out of stock',
      targetDate: null,
      cutoffInstantISO: null,
      dispatchDate: null,
      isBackorder: false,
      isPreOrder: false,
    }
  }
  const isBackorder = outOfStock && stock.outOfStockBehaviour === 'BACKORDER'

  let dispatchDate: string
  let cutoffInstantISO: string | null = null
  let isPreOrder = false

  if (stock.isPreOrder && stock.preOrderDispatchDate) {
    // Pre-order: dispatch is the promised date (or today if that has passed),
    // rolled to a working day. No cut-off, no lead.
    isPreOrder = true
    dispatchDate = nextWorkingDay(laterOf(stock.preOrderDispatchDate, today), holidays, shipDays)
  } else {
    // The cut-off decides the baseline dispatch day. Order before the cut-off on
    // a ship/working day and it clears today; otherwise it clears the next
    // working day. The cut-off the estimate hangs on is the one on that clearing
    // day - the storefront countdown ticks to it.
    const canDispatchToday =
      isWorkingDay(today, holidays, shipDays) && now < cutoffInstant(today, timing.cutoffTime, timezone)
    // addWorkingDays(_, 1) lands on the first working day strictly after today,
    // which is exactly where a missed cut-off (or a non-working today) clears.
    const base = canDispatchToday ? today : addWorkingDays(today, 1, holidays, shipDays)
    cutoffInstantISO = cutoffInstant(base, timing.cutoffTime, timezone).toISOString()
    dispatchDate = addWorkingDays(base, Math.max(0, timing.dispatchLeadDays), holidays, shipDays)
  }

  let targetDate = addWorkingDays(dispatchDate, Math.max(0, tier.transitDays), holidays, shipDays)

  // A service can floor the whole estimate at a working-day minimum (e.g. full
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
    isBackorder,
    isPreOrder,
  }
}
