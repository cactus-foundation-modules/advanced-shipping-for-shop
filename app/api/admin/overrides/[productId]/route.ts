// GET/PUT/DELETE /api/m/advanced-shipping-for-shop/admin/overrides/[productId]
// The per-product exception layer, edited from the product editor's Delivery tab.
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireShopUser } from '@/modules/shop/lib/access'
import { getOverride, upsertOverride, deleteOverride } from '@/modules/advanced-shipping-for-shop/lib/db/overrides'

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/

const OverrideBody = z.object({
  fulfilmentMode: z.enum(['STOCKED', 'MADE_TO_ORDER']).nullable(),
  mtoLeadDays: z.number().int().min(0).max(365).nullable(),
  cutoffTime: z.string().regex(TIME_RE).nullable(),
  dispatchLeadDays: z.number().int().min(0).max(365).nullable(),
  transitDays: z.number().int().min(0).max(365).nullable(),
  backorderLeadDays: z.number().int().min(0).max(365).nullable(),
  disabled: z.boolean(),
})

export async function GET(_request: Request, { params }: { params: Promise<{ productId: string }> }) {
  const gate = await requireShopUser('shop.products')
  if (gate.error) return gate.error
  const { productId } = await params
  return NextResponse.json({ override: await getOverride(productId) })
}

export async function PUT(request: Request, { params }: { params: Promise<{ productId: string }> }) {
  const gate = await requireShopUser('shop.products')
  if (gate.error) return gate.error
  const { productId } = await params
  const parsed = OverrideBody.safeParse(await request.json())
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid override' }, { status: 400 })
  await upsertOverride(productId, { ...parsed.data })
  return NextResponse.json({ override: await getOverride(productId) })
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ productId: string }> }) {
  const gate = await requireShopUser('shop.products')
  if (gate.error) return gate.error
  const { productId } = await params
  await deleteOverride(productId)
  return NextResponse.json({ ok: true })
}
