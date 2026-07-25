// GET /api/m/advanced-shipping-for-shop/admin/holidays
import { NextResponse } from 'next/server'
import { requireShopUser } from '@/modules/shop/lib/access'
import { getSettings } from '@/modules/advanced-shipping-for-shop/lib/db/settings'
import { listHolidays } from '@/modules/advanced-shipping-for-shop/lib/db/holidays'
import { HOLIDAY_REGIONS } from '@/modules/advanced-shipping-for-shop/lib/types'

export async function GET() {
  const gate = await requireShopUser('shop.manage')
  if (gate.error) return gate.error
  const settings = await getSettings()
  const holidays = await listHolidays(settings.holidayRegion)
  return NextResponse.json({
    region: settings.holidayRegion,
    regions: HOLIDAY_REGIONS,
    syncedAt: settings.holidaysSyncedAt,
    holidays,
  })
}
