// GET /api/m/advanced-shipping-for-shop/admin/holidays
import { NextResponse } from 'next/server'
import { requireShopUser } from '@/modules/shop/lib/access'
import { getSettings } from '@/modules/advanced-shipping-for-shop/lib/db/settings'
import { listClosedDays, listCustomClosures } from '@/modules/advanced-shipping-for-shop/lib/db/holidays'
import { HOLIDAY_REGIONS } from '@/modules/advanced-shipping-for-shop/lib/types'
import { getShopTimezone } from '@/modules/advanced-shipping-for-shop/lib/context'
import { todayInZone } from '@/modules/advanced-shipping-for-shop/lib/working-days'

export async function GET() {
  const gate = await requireShopUser('shop.manage')
  if (gate.error) return gate.error
  const settings = await getSettings()
  const [holidays, custom, timezone] = await Promise.all([
    listClosedDays(settings.holidayRegion),
    listCustomClosures(),
    getShopTimezone(),
  ])
  return NextResponse.json({
    region: settings.holidayRegion,
    regions: HOLIDAY_REGIONS,
    syncedAt: settings.holidaysSyncedAt,
    // Every closed day, imported and hand-added, one row per date.
    holidays,
    // The hand-added closures as entered, so a run of days lists once.
    custom,
    // The screen decides which dates are still to come, and the browser's own
    // clock is the wrong one to ask: a holiday is over when it is over in the
    // shop's timezone, not in whichever one the admin happens to be sitting in.
    timezone,
    today: todayInZone(new Date(), timezone),
  })
}
