// POST /api/m/advanced-shipping-for-shop/admin/preview
// Runs the date engine against an unsaved rule (+ optional tier modifiers) so the
// admin sees "an order placed now would dispatch X, deliver by Y" while editing,
// catching a mis-set cut-off before it reaches a shopper. Uses the live holiday
// calendar and timezone, and an in-stock product.
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireShopUser } from '@/modules/shop/lib/access'
import { computeEstimate } from '@/modules/advanced-shipping-for-shop/lib/estimate'
import { formatDeliveryDate } from '@/modules/advanced-shipping-for-shop/lib/working-days'
import { getResolveContext } from '@/modules/advanced-shipping-for-shop/lib/context'

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/

const Body = z.object({
  fulfilmentMode: z.enum(['STOCKED', 'MADE_TO_ORDER']),
  cutoffTime: z.string().regex(TIME_RE),
  dispatchLeadDays: z.number().int().min(0).max(365),
  mtoLeadDays: z.number().int().min(0).max(365),
  transitDays: z.number().int().min(0).max(365),
  shipDays: z.array(z.number().int().min(0).max(6)).min(1),
  backorderLeadDays: z.number().int().min(0).max(365).nullable(),
  tier: z
    .object({
      dispatchLeadDelta: z.number().int().min(-365).max(365),
      transitDelta: z.number().int().min(-365).max(365),
      minLeadDays: z.number().int().min(0).max(365).nullable(),
    })
    .nullable()
    .optional(),
})

export async function POST(request: NextRequest) {
  const gate = await requireShopUser('shop.manage')
  if (gate.error) return gate.error
  const parsed = Body.safeParse(await request.json())
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid rule' }, { status: 400 })

  const { tier, ...rule } = parsed.data
  const ctx = await getResolveContext()
  const est = computeEstimate({
    now: ctx.now,
    timezone: ctx.timezone,
    holidays: ctx.holidays,
    rule,
    tier: tier ?? null,
    stock: { trackInventory: false, stockCount: null, outOfStockBehaviour: 'BLOCK', isPreOrder: false, preOrderDispatchDate: null },
  })

  return NextResponse.json({
    available: est.available,
    dispatchDate: est.dispatchDate,
    dispatchLabel: est.dispatchDate ? formatDeliveryDate(est.dispatchDate) : null,
    targetDate: est.targetDate,
    targetLabel: est.targetDate ? formatDeliveryDate(est.targetDate) : null,
    isMadeToOrder: est.isMadeToOrder,
  })
}
