// GET/POST /api/m/advanced-shipping-for-shop/cron/refresh-holidays
// Weekly Vercel cron: re-fetches the configured region's calendar so a newly
// published bank holiday lands without the admin re-importing. Same CRON_SECRET
// bearer as shop's crons.
import { NextRequest, NextResponse } from 'next/server'
import { errorResponse } from '@/lib/utils'
import { getSettings } from '@/modules/advanced-shipping-for-shop/lib/db/settings'
import { syncHolidays } from '@/modules/advanced-shipping-for-shop/lib/holidays'

async function handle(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) return errorResponse('CRON_SECRET is not configured', 503)
  if (request.headers.get('authorization') !== `Bearer ${secret}`) return errorResponse('Unauthorized', 401)

  const settings = await getSettings()
  try {
    const count = await syncHolidays(settings.holidayRegion)
    return NextResponse.json({ ok: true, region: settings.holidayRegion, count })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'refresh failed'
    return NextResponse.json({ ok: false, error: message }, { status: 502 })
  }
}

export async function GET(request: NextRequest) {
  return handle(request)
}

export async function POST(request: NextRequest) {
  return handle(request)
}
