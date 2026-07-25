// PATCH/DELETE /api/m/advanced-shipping-for-shop/admin/tiers/[id]
import { NextResponse } from 'next/server'
import { requireShopUser } from '@/modules/shop/lib/access'
import { getTier, updateTier, deleteTier } from '@/modules/advanced-shipping-for-shop/lib/db/tiers'
import { TierBody } from '@/modules/advanced-shipping-for-shop/app/api/admin/tiers/route'

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireShopUser('shop.manage')
  if (gate.error) return gate.error
  const { id } = await params
  if (!(await getTier(id))) return NextResponse.json({ error: 'Tier not found' }, { status: 404 })
  const parsed = TierBody.partial().safeParse(await request.json())
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid tier' }, { status: 400 })
  await updateTier(id, parsed.data)
  return NextResponse.json({ tier: await getTier(id) })
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireShopUser('shop.manage')
  if (gate.error) return gate.error
  const { id } = await params
  await deleteTier(id)
  return NextResponse.json({ ok: true })
}
