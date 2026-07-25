// DELETE /api/m/advanced-shipping-for-shop/admin/tier-config/[id]
import { NextResponse } from 'next/server'
import { requireShopUser } from '@/modules/shop/lib/access'
import { deleteTierConfig } from '@/modules/advanced-shipping-for-shop/lib/db/tiers'

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireShopUser('shop.manage')
  if (gate.error) return gate.error
  const { id } = await params
  await deleteTierConfig(id)
  return NextResponse.json({ ok: true })
}
