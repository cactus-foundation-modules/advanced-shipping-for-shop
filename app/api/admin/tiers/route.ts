// GET/POST /api/m/advanced-shipping-for-shop/admin/tiers
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireShopUser } from '@/modules/shop/lib/access'
import { slugify } from '@/modules/shop/lib/slug'
import { listTiers, createTier } from '@/modules/advanced-shipping-for-shop/lib/db/tiers'

export const TierBody = z.object({
  key: z.string().min(1).max(60).optional(),
  label: z.string().min(1).max(80),
  supplier: z.string().max(200).nullable().optional(),
  position: z.number().int().optional(),
  dispatchLeadDelta: z.number().int().min(-365).max(365),
  transitDelta: z.number().int().min(-365).max(365),
  minLeadDays: z.number().int().min(0).max(365).nullable(),
})

export async function GET() {
  const gate = await requireShopUser('shop.manage')
  if (gate.error) return gate.error
  return NextResponse.json({ tiers: await listTiers() })
}

export async function POST(request: NextRequest) {
  const gate = await requireShopUser('shop.manage')
  if (gate.error) return gate.error
  const parsed = TierBody.safeParse(await request.json())
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid tier' }, { status: 400 })
  const supplier = parsed.data.supplier ?? null
  // Base the key on label + supplier so two same-named tiers for different
  // suppliers start from distinct keys; createTier guarantees final uniqueness.
  const key = parsed.data.key?.trim() || slugify(supplier ? `${parsed.data.label}-${supplier}` : parsed.data.label)
  const tier = await createTier({ ...parsed.data, supplier, key })
  return NextResponse.json({ tier })
}
