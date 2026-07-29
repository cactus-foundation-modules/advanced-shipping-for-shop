// POST /api/m/advanced-shipping-for-shop/admin/preview
// Runs the date engine against unsaved dispatch timing (+ optional service
// timing) so the admin sees "an order placed now would dispatch X, deliver by Y"
// while editing, catching a mis-set cut-off before it reaches a shopper. Uses
// the live holiday calendar and timezone, and an in-stock product.
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireShopUser } from '@/modules/shop/lib/access'
import { computeEstimate } from '@/modules/advanced-shipping-for-shop/lib/estimate'
import { formatDeliveryDate } from '@/modules/advanced-shipping-for-shop/lib/working-days'
import { getResolveContext } from '@/modules/advanced-shipping-for-shop/lib/context'

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/

const Body = z.object({
  cutoffTime: z.string().regex(TIME_RE),
  dispatchLeadDays: z.number().int().min(0).max(365),
  shipDays: z.array(z.number().int().min(0).max(6)).min(1),
  tier: z
    .object({
      transitDays: z.number().int().min(0).max(365),
      minLeadDays: z.number().int().min(0).max(365).nullable(),
    })
    .nullable()
    .optional(),
})

export async function POST(request: NextRequest) {
  const gate = await requireShopUser('shop.manage')
  if (gate.error) return gate.error
  const parsed = Body.safeParse(await request.json())
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid timing' }, { status: 400 })

  const { tier, ...timing } = parsed.data
  const ctx = await getResolveContext()
  const est = computeEstimate({
    now: ctx.now,
    timezone: ctx.timezone,
    holidays: ctx.holidays,
    timing,
    tier: tier ?? { transitDays: 0, minLeadDays: null },
    stock: { trackInventory: false, stockCount: null, outOfStockBehaviour: 'BLOCK', isPreOrder: false, preOrderDispatchDate: null },
  })

  return NextResponse.json({
    available: est.available,
    dispatchDate: est.dispatchDate,
    dispatchLabel: est.dispatchDate ? formatDeliveryDate(est.dispatchDate) : null,
    targetDate: est.targetDate,
    targetLabel: est.targetDate ? formatDeliveryDate(est.targetDate) : null,
  })
}
