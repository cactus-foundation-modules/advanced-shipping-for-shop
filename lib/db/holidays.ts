import { prisma } from '@/lib/db/prisma'
import { Prisma } from '@prisma/client'
import type { HolidayRegion } from '@/modules/advanced-shipping-for-shop/lib/types'
import { ttlCachedByKey } from '@/modules/advanced-shipping-for-shop/lib/ttl-cache'

export type HolidayRow = { date: string; name: string }

// Every persisted holiday for one region as a Set of "YYYY-MM-DD", which is what
// the working-day engine consumes. to_char keeps it a plain calendar string, so
// no timezone can shift a DATE across midnight on the way out.
export async function getHolidaySet(region: HolidayRegion): Promise<Set<string>> {
  const rows = await prisma.$queryRaw<{ d: string }[]>`
    SELECT to_char("date", 'YYYY-MM-DD') AS d FROM "ash_holidays" WHERE "region" = ${region}
  `
  return new Set(rows.map((r) => r.d))
}

// Cross-request TTL memo keyed on region. The calendar changes roughly once a
// year (a cron re-imports it nightly), so a ten-second window costs nothing and
// spares every cart/estimate request a read. The import invalidates below.
const holidayCache = ttlCachedByKey(getHolidaySet, 10_000)
export const getHolidaySetCached = (region: HolidayRegion): Promise<Set<string>> => holidayCache.get(region)

// The same rows with names, for the admin Holidays screen, soonest first.
export async function listHolidays(region: HolidayRegion): Promise<HolidayRow[]> {
  const rows = await prisma.$queryRaw<{ d: string; name: string }[]>`
    SELECT to_char("date", 'YYYY-MM-DD') AS d, "name" FROM "ash_holidays"
    WHERE "region" = ${region} ORDER BY "date" ASC
  `
  return rows.map((r) => ({ date: r.d, name: r.name }))
}

// Replaces the whole persisted calendar for one region in one transaction: the
// import is authoritative, so stale dates are cleared rather than merged.
export async function replaceHolidays(region: HolidayRegion, holidays: HolidayRow[]): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`DELETE FROM "ash_holidays" WHERE "region" = ${region}`
    if (holidays.length === 0) return
    const values = holidays.map((h) => Prisma.sql`(${region}, ${h.date}::date, ${h.name})`)
    await tx.$executeRaw`
      INSERT INTO "ash_holidays" ("region", "date", "name")
      VALUES ${Prisma.join(values)}
      ON CONFLICT ("region", "date") DO UPDATE SET "name" = EXCLUDED."name"
    `
  })
  holidayCache.invalidate()
}

export async function countHolidays(region: HolidayRegion): Promise<number> {
  const rows = await prisma.$queryRaw<{ n: bigint }[]>`
    SELECT COUNT(*) AS n FROM "ash_holidays" WHERE "region" = ${region}
  `
  return Number(rows[0]?.n ?? 0)
}
