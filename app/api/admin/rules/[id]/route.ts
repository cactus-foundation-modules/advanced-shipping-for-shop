// PATCH/DELETE /api/m/advanced-shipping-for-shop/admin/rules/[id]
import { NextResponse } from 'next/server'
import { requireShopUser } from '@/modules/shop/lib/access'
import { getRule, updateRule, deleteRule } from '@/modules/advanced-shipping-for-shop/lib/db/rules'
import { RuleBody } from '@/modules/advanced-shipping-for-shop/app/api/admin/rules/route'

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireShopUser('shop.manage')
  if (gate.error) return gate.error
  const { id } = await params
  if (!(await getRule(id))) return NextResponse.json({ error: 'Rule not found' }, { status: 404 })
  const parsed = RuleBody.partial().safeParse(await request.json())
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid rule' }, { status: 400 })
  await updateRule(id, parsed.data)
  return NextResponse.json({ rule: await getRule(id) })
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireShopUser('shop.manage')
  if (gate.error) return gate.error
  const { id } = await params
  await deleteRule(id)
  return NextResponse.json({ ok: true })
}
