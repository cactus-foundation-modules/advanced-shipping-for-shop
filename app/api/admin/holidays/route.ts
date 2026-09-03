// GET /api/m/advanced-shipping-for-shop/admin/holidays
import { NextResponse } from 'next/server'
import { requireShopUser } from '@/modules/shop/lib/access'
import { getSettings } from '@/modules/advanced-shipping-for-shop/lib/db/settings'
import { listHolidays } from '@/modules/advanced-shipping-for-shop/lib/db/holidays'
import { HOLIDAY_REGIONS } from '@/modules/advanced-shipping-for-shop/lib/types'
import { getShopTimezone } from '@/modules/advanced-shipping-for-shop/lib/context'
import { todayInZone } from '@/modules/advanced-shipping-for-shop/lib/working-days'

export async function GET() {
  const gate = await requireShopUser('shop.manage')
  if (gate.error) return gate.error
  const settings = await getSettings()
  const [holidays, timezone] = await Promise.all([listHolidays(settings.holidayRegion), getShopTimezone()])
  return NextResponse.json({
    region: settings.holidayRegion,
    regions: HOLIDAY_REGIONS,
    syncedAt: settings.holidaysSyncedAt,
    holidays,
    // The screen decides which dates are still to come, and the browser's own
    // clock is the wrong one to ask: a holiday is over when it is over in the
    // shop's timezone, not in whichever one the admin happens to be sitting in.
    timezone,
    today: todayInZone(new Date(), timezone),
  })
}
