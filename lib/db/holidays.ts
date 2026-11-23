import { randomUUID } from 'crypto'
import { prisma } from '@/lib/db/prisma'
import { Prisma } from '@prisma/client'
import type { HolidayRegion } from '@/modules/advanced-shipping-for-shop/lib/types'
import { ttlCachedByKey } from '@/modules/advanced-shipping-for-shop/lib/ttl-cache'

export type HolidayRow = { date: string; name: string }

// Every closed day for one region as a Set of "YYYY-MM-DD", which is what the
// working-day engine consumes: the imported calendar for that region plus every
// day the shop has closed by hand (those apply whichever region it follows).
// to_char keeps it a plain calendar string, so no timezone can shift a DATE
// across midnight on the way out.
export async function getHolidaySet(region: HolidayRegion): Promise<Set<string>> {
  const rows = await prisma.$queryRaw<{ d: string }[]>`
    SELECT to_char("date", 'YYYY-MM-DD') AS d FROM "ash_holidays" WHERE "region" = ${region}
    UNION
    SELECT to_char(g.day::date, 'YYYY-MM-DD') AS d
    FROM "ash_custom_closures" c
    CROSS JOIN LATERAL generate_series(c."start_date", c."end_date", interval '1 day') AS g(day)
  `
  return new Set(rows.map((r) => r.d))
}

// Cross-request TTL memo keyed on region. The calendar changes roughly once a
// year (a cron re-imports it nightly), so a ten-second window costs nothing and
// spares every cart/estimate request a read. The import and the custom-closure
// writes below invalidate it.
const holidayCache = ttlCachedByKey(getHolidaySet, 10_000)
export const getHolidaySetCached = (region: HolidayRegion): Promise<Set<string>> => holidayCache.get(region)

export type ClosedDay = HolidayRow & { source: 'calendar' | 'custom' }

// The same days with names, soonest first, one row per date. Where a hand-added
// closure lands on a bank holiday the calendar's name wins, as the more
// recognisable of the two.
export async function listClosedDays(region: HolidayRegion): Promise<ClosedDay[]> {
  const rows = await prisma.$queryRaw<{ d: string; name: string; src: number }[]>`
    SELECT DISTINCT ON (u.d) u.d, u."name", u.src FROM (
      SELECT to_char("date", 'YYYY-MM-DD') AS d, "name", 0 AS src
      FROM "ash_holidays" WHERE "region" = ${region}
      UNION ALL
      SELECT to_char(g.day::date, 'YYYY-MM-DD') AS d, c."name", 1 AS src
      FROM "ash_custom_closures" c
      CROSS JOIN LATERAL generate_series(c."start_date", c."end_date", interval '1 day') AS g(day)
    ) u
    ORDER BY u.d ASC, u.src ASC
  `
  return rows.map((r) => ({ date: r.d, name: r.name, source: r.src === 0 ? 'calendar' : 'custom' }))
}

// Name and date only, for consumers that do not care where a closed day came
// from (the delivery catalogue).
export async function listHolidays(region: HolidayRegion): Promise<HolidayRow[]> {
  return (await listClosedDays(region)).map(({ date, name }) => ({ date, name }))
}

export type CustomClosure = { id: string; startDate: string; endDate: string; name: string }

// The hand-added closures as the shop entered them (a run of days stays one
// row), for the admin list to show and remove. Soonest first.
export async function listCustomClosures(): Promise<CustomClosure[]> {
  const rows = await prisma.$queryRaw<{ id: string; s: string; e: string; name: string }[]>`
    SELECT "id", to_char("start_date", 'YYYY-MM-DD') AS s, to_char("end_date", 'YYYY-MM-DD') AS e, "name"
    FROM "ash_custom_closures" ORDER BY "start_date" ASC, "end_date" ASC
  `
  return rows.map((r) => ({ id: r.id, startDate: r.s, endDate: r.e, name: r.name }))
}

export async function createCustomClosure(input: { startDate: string; endDate: string; name: string }): Promise<CustomClosure> {
  const id = randomUUID()
  await prisma.$executeRaw`
    INSERT INTO "ash_custom_closures" ("id", "start_date", "end_date", "name")
    VALUES (${id}, ${input.startDate}::date, ${input.endDate}::date, ${input.name})
  `
  holidayCache.invalidate()
  return { id, ...input }
}

// True when a row was removed, so the route can answer 404 for a stale id.
export async function deleteCustomClosure(id: string): Promise<boolean> {
  const removed = await prisma.$executeRaw`DELETE FROM "ash_custom_closures" WHERE "id" = ${id}`
  holidayCache.invalidate()
  return removed > 0
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
