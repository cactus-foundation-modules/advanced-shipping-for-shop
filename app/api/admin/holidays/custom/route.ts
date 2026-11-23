// POST /api/m/advanced-shipping-for-shop/admin/holidays/custom
// Adds a closed day, or an inclusive run of them, on top of the imported calendar.
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireShopUser } from '@/modules/shop/lib/access'
import { createCustomClosure } from '@/modules/advanced-shipping-for-shop/lib/db/holidays'

// A real calendar date, not merely the right shape: "2026-02-30" passes a regex
// and Postgres would reject it with an error the screen cannot explain.
const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a date').refine((value) => {
  const [y, m, d] = value.split('-').map(Number)
  const date = new Date(Date.UTC(y!, m! - 1, d!))
  return date.getUTCFullYear() === y && date.getUTCMonth() === m! - 1 && date.getUTCDate() === d
}, 'That date does not exist')

// A year is far longer than any shutdown; the cap stops a typo in the year
// (2026 -> 2062) quietly closing the shop for decades.
const MAX_RUN_DAYS = 366

const CustomClosureBody = z.object({
  startDate: IsoDate,
  endDate: IsoDate.optional(),
  name: z.string().trim().min(1, 'Give the closure a name').max(120, 'Keep the name under 120 characters'),
}).transform((body) => ({ ...body, endDate: body.endDate ?? body.startDate }))
  .refine((body) => body.endDate >= body.startDate, { message: 'The last day cannot be before the first', path: ['endDate'] })
  .refine((body) => (Date.parse(body.endDate) - Date.parse(body.startDate)) / 86_400_000 < MAX_RUN_DAYS, { message: `A closure can run for at most ${MAX_RUN_DAYS} days`, path: ['endDate'] })

export async function POST(request: Request) {
  const gate = await requireShopUser('shop.manage')
  if (gate.error) return gate.error
  let raw: unknown
  try { raw = await request.json() } catch { return NextResponse.json({ error: 'Invalid request' }, { status: 400 }) }
  const parsed = CustomClosureBody.safeParse(raw)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid closure' }, { status: 400 })
  const closure = await createCustomClosure(parsed.data)
  return NextResponse.json({ closure })
}
