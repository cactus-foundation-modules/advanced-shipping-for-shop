// The shop's dispatch calendar, published at `shop.delivery-calendar` so a
// module that only holds working-day COUNTS (from `shop.product-delivery-timing`)
// can turn one into a real date without becoming a dependent of this module.
// The storefront filter panel is the first caller: "within 6 working days"
// becomes "By Tuesday the 1st of December".
//
// Handed over as a list of upcoming working days rather than a function, because
// the caller does its arithmetic in the shopper's BROWSER: a category page can
// sit in a cache for hours, across a cut-off or a midnight, and a date worked out
// on the server at render time would go stale with it. The list starts on the
// day it was built and runs well past any lead time the shop offers, so a page
// served from a cache days later still has every day it needs.
//
// Working days here are exactly the ones the date engine counts: the shop's ship
// days, minus the bank holidays for its region and its own closures. Same set,
// same cut-off, so a date counted off this list agrees with lib/estimate.ts.
import { getResolveContext } from '@/modules/advanced-shipping-for-shop/lib/context'
import { getSettingsCached } from '@/modules/advanced-shipping-for-shop/lib/db/settings'
import { effectiveShipDays } from '@/modules/advanced-shipping-for-shop/lib/estimate'
import { addCalendarDays, isWorkingDay, todayInZone } from '@/modules/advanced-shipping-for-shop/lib/working-days'

export type DeliveryCalendar = {
  /** IANA zone the dates and the cut-off are in. */
  timezone: string
  /** "HH:MM" wall-clock in `timezone`: an order before it on a working day
   *  clears that day. */
  cutoffTime: string
  /** The day the list was built ("YYYY-MM-DD" in `timezone`). */
  builtOn: string
  /** Every working day from `builtOn` (included when it is one) onward, in
   *  order, "YYYY-MM-DD". */
  workingDays: string[]
}

// About seven months of working days: comfortably past the longest made-to-order
// lead any shop sensibly offers, plus the days a cached page may sit unrefreshed.
const WORKING_DAYS = 150
// Calendar days to walk before giving up - a shop that ships on no day at all
// would otherwise never fill the list.
const MAX_WALK = 400

export async function advancedShippingDeliveryCalendar(now: Date = new Date()): Promise<DeliveryCalendar> {
  const [ctx, settings] = await Promise.all([getResolveContext(now), getSettingsCached()])
  const shipDays = effectiveShipDays(settings)
  const builtOn = todayInZone(now, ctx.timezone)
  const workingDays: string[] = []
  let cursor = builtOn
  for (let i = 0; i < MAX_WALK && workingDays.length < WORKING_DAYS; i++) {
    if (isWorkingDay(cursor, ctx.holidays, shipDays)) workingDays.push(cursor)
    cursor = addCalendarDays(cursor, 1)
  }
  return { timezone: ctx.timezone, cutoffTime: settings.cutoffTime, builtOn, workingDays }
}
