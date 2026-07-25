// POST /api/m/advanced-shipping-for-shop/admin/holidays/import
// Fetches the gov.uk calendar for the configured region and persists it.
import { NextResponse } from 'next/server'
import { requireShopUser } from '@/modules/shop/lib/access'
import { getSettings } from '@/modules/advanced-shipping-for-shop/lib/db/settings'
import { syncHolidays } from '@/modules/advanced-shipping-for-shop/lib/holidays'

export async function POST() {
  const gate = await requireShopUser('shop.manage')
  if (gate.error) return gate.error
  const settings = await getSettings()
  try {
    const count = await syncHolidays(settings.holidayRegion)
    return NextResponse.json({ ok: true, count })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'The holiday list could not be imported.'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
