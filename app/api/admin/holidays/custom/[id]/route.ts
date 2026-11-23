// DELETE /api/m/advanced-shipping-for-shop/admin/holidays/custom/[id]
import { NextResponse } from 'next/server'
import { requireShopUser } from '@/modules/shop/lib/access'
import { deleteCustomClosure } from '@/modules/advanced-shipping-for-shop/lib/db/holidays'

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireShopUser('shop.manage')
  if (gate.error) return gate.error
  const { id } = await params
  if (!(await deleteCustomClosure(id))) return NextResponse.json({ error: 'That closure has already gone' }, { status: 404 })
  return NextResponse.json({ ok: true })
}
