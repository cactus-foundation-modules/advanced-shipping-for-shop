// Public-holiday source for the shop-wide delivery calendar. Mirrors
// modules/twilio/lib/holidays.ts (the gov.uk bank-holidays feed) rather than
// depending on it: twilio is an unrelated SMS module, and a shipping module
// importing it would couple two features that have nothing to do with each
// other. The one difference from twilio's version: these dates are PERSISTED
// into ash_holidays, so the date maths never makes a live network call while
// rendering a product page or cart.
import type { HolidayRegion } from '@/modules/advanced-shipping-for-shop/lib/types'
import { HOLIDAY_REGIONS } from '@/modules/advanced-shipping-for-shop/lib/types'
import { markHolidaysSynced } from '@/modules/advanced-shipping-for-shop/lib/db/settings'
import { replaceHolidays, type HolidayRow } from '@/modules/advanced-shipping-for-shop/lib/db/holidays'

const GOV_UK_URL = 'https://www.gov.uk/bank-holidays.json'
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export function holidayRegionLabel(region: HolidayRegion): string {
  return HOLIDAY_REGIONS.find((r) => r.id === region)?.label ?? region
}

// Every bank holiday the gov.uk feed lists for a division (roughly 2019-2028 in
// one document). We keep them all: a wide persisted window means the engine can
// price a made-to-order product months out without a re-fetch.
export async function fetchHolidaysFromGovUk(region: HolidayRegion): Promise<HolidayRow[]> {
  const res = await fetch(GOV_UK_URL, {
    signal: AbortSignal.timeout(15_000),
    // A day-old copy of a list that changes once a year is fine.
    next: { revalidate: 86_400 },
  })
  if (!res.ok) {
    throw new Error(`The holiday list could not be fetched (HTTP ${res.status}). Try again shortly.`)
  }
  const data = (await res.json()) as Record<string, { events?: Array<{ title?: string; date?: string }> }> | null
  const events = data?.[region]?.events
  if (!Array.isArray(events)) {
    throw new Error('The gov.uk holiday list came back in an unexpected shape.')
  }
  const byDate = new Map<string, HolidayRow>()
  for (const e of events) {
    if (typeof e.date !== 'string' || !DATE_RE.test(e.date)) continue
    if (!byDate.has(e.date)) byDate.set(e.date, { date: e.date, name: e.title?.trim() || 'Bank holiday' })
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date))
}

// Fetch and persist one region's calendar, then stamp the sync time. Returns how
// many dates were stored so the admin import can report it.
export async function syncHolidays(region: HolidayRegion): Promise<number> {
  const holidays = await fetchHolidaysFromGovUk(region)
  await replaceHolidays(region, holidays)
  await markHolidaysSynced()
  return holidays.length
}
