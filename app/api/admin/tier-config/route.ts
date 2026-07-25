// GET/POST /api/m/advanced-shipping-for-shop/admin/tier-config
// Per-scope price + availability for a service tier.
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireShopUser } from '@/modules/shop/lib/access'
import { getTier, listTierConfig, upsertTierConfig } from '@/modules/advanced-shipping-for-shop/lib/db/tiers'

const ConfigBody = z.object({
  tierId: z.string().min(1),
  scopeType: z.enum(['DEFAULT', 'SUPPLIER', 'CATEGORY', 'RANGE']),
  scopeRef: z.string().min(1).nullable(),
  available: z.boolean(),
  price: z.number().min(0).max(1_000_000),
})

export async function GET() {
  const gate = await requireShopUser('shop.manage')
  if (gate.error) return gate.error
  return NextResponse.json({ config: await listTierConfig() })
}

export async function POST(request: NextRequest) {
  const gate = await requireShopUser('shop.manage')
  if (gate.error) return gate.error
  const parsed = ConfigBody.safeParse(await request.json())
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid pricing' }, { status: 400 })
  if (parsed.data.scopeType !== 'DEFAULT' && !parsed.data.scopeRef) {
    return NextResponse.json({ error: 'Choose what this price applies to' }, { status: 400 })
  }
  if (!(await getTier(parsed.data.tierId))) return NextResponse.json({ error: 'Tier not found' }, { status: 404 })
  await upsertTierConfig(parsed.data)
  return NextResponse.json({ ok: true })
}
