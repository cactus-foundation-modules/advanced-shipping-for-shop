// GET/PATCH /api/m/advanced-shipping-for-shop/admin/settings
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireShopUser } from '@/modules/shop/lib/access'
import { getSettings, updateSettings } from '@/modules/advanced-shipping-for-shop/lib/db/settings'
import { HOLIDAY_REGIONS } from '@/modules/advanced-shipping-for-shop/lib/types'

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/

export async function GET() {
  const gate = await requireShopUser('shop.manage')
  if (gate.error) return gate.error
  return NextResponse.json({ settings: await getSettings() })
}

const PatchBody = z.object({
  rangeAttributeId: z.string().nullable().optional(),
  holidayRegion: z.enum(HOLIDAY_REGIONS.map((r) => r.id) as [string, ...string[]]).optional(),
  defaultTierKey: z.string().nullable().optional(),
  cartControlStyle: z.enum(['summary', 'dropdown', 'radios']).optional(),
  showUnavailableServices: z.boolean().optional(),
  cutoffTime: z.string().regex(TIME_RE, 'Cut-off must be a 24-hour HH:MM time').optional(),
  dispatchLeadDays: z.number().int().min(0).max(365).optional(),
  shipDays: z.array(z.number().int().min(0).max(6)).min(1, 'Pick at least one ship day').optional(),
})

export async function PATCH(request: NextRequest) {
  const gate = await requireShopUser('shop.manage')
  if (gate.error) return gate.error
  const parsed = PatchBody.safeParse(await request.json())
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid settings' }, { status: 400 })
  const settings = await updateSettings(parsed.data)
  return NextResponse.json({ settings })
}
