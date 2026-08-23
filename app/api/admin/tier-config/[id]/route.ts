// PATCH/DELETE /api/m/advanced-shipping-for-shop/admin/tier-config/[id]
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireShopUser } from '@/modules/shop/lib/access'
import { deleteTierConfig, getTierConfig, updateTierConfig } from '@/modules/advanced-shipping-for-shop/lib/db/tiers'

// Everything on a price row except where it applies - scope moves go through
// the POST upsert, which owns the (tier, scope) uniqueness.
const ConfigPatch = z.object({
  available: z.boolean(),
  price: z.number().min(0).max(1_000_000),
  transitDays: z.number().int().min(0).max(365).nullable(),
  minLeadDays: z.number().int().min(0).max(365).nullable(),
}).partial()

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireShopUser('shop.manage')
  if (gate.error) return gate.error
  const { id } = await params
  if (!(await getTierConfig(id))) return NextResponse.json({ error: 'Price not found' }, { status: 404 })
  const parsed = ConfigPatch.safeParse(await request.json())
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid pricing' }, { status: 400 })
  await updateTierConfig(id, parsed.data)
  return NextResponse.json({ config: await getTierConfig(id) })
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireShopUser('shop.manage')
  if (gate.error) return gate.error
  const { id } = await params
  await deleteTierConfig(id)
  return NextResponse.json({ ok: true })
}
