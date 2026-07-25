// GET/PATCH /api/m/advanced-shipping-for-shop/admin/settings
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireShopUser } from '@/modules/shop/lib/access'
import { getSettings, updateSettings } from '@/modules/advanced-shipping-for-shop/lib/db/settings'
import { HOLIDAY_REGIONS } from '@/modules/advanced-shipping-for-shop/lib/types'

export async function GET() {
  const gate = await requireShopUser('shop.manage')
  if (gate.error) return gate.error
  return NextResponse.json({ settings: await getSettings() })
}

const PatchBody = z.object({
  rangeAttributeId: z.string().nullable().optional(),
  holidayRegion: z.enum(HOLIDAY_REGIONS.map((r) => r.id) as [string, ...string[]]).optional(),
  defaultTierKey: z.string().nullable().optional(),
})

export async function PATCH(request: NextRequest) {
  const gate = await requireShopUser('shop.manage')
  if (gate.error) return gate.error
  const parsed = PatchBody.safeParse(await request.json())
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid settings' }, { status: 400 })
  const settings = await updateSettings(parsed.data)
  return NextResponse.json({ settings })
}
