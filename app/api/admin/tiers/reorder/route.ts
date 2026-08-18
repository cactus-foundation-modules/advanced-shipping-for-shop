// POST /api/m/advanced-shipping-for-shop/admin/tiers/reorder
// The running order of the delivery services, sent whole: ids in the order the
// shop owner wants them, positions assigned from the list.
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireShopUser } from '@/modules/shop/lib/access'
import { listTiers, reorderTiers } from '@/modules/advanced-shipping-for-shop/lib/db/tiers'

const ReorderBody = z.object({
  ids: z.array(z.string().min(1)).min(1).max(200),
})

export async function POST(request: Request) {
  const gate = await requireShopUser('shop.manage')
  if (gate.error) return gate.error
  const parsed = ReorderBody.safeParse(await request.json())
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid order' }, { status: 400 })
  if (new Set(parsed.data.ids).size !== parsed.data.ids.length) {
    return NextResponse.json({ error: 'The same service was listed twice' }, { status: 400 })
  }
  await reorderTiers(parsed.data.ids)
  return NextResponse.json({ tiers: await listTiers() })
}
