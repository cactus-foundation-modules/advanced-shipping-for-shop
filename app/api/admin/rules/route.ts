// GET/POST /api/m/advanced-shipping-for-shop/admin/rules
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireShopUser } from '@/modules/shop/lib/access'
import { listRules, createRule } from '@/modules/advanced-shipping-for-shop/lib/db/rules'

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/

export const RuleBody = z.object({
  scopeType: z.enum(['DEFAULT', 'SUPPLIER', 'CATEGORY', 'RANGE']),
  scopeRef: z.string().min(1).nullable(),
  fulfilmentMode: z.enum(['STOCKED', 'MADE_TO_ORDER']),
  cutoffTime: z.string().regex(TIME_RE, 'Cut-off must be a 24-hour HH:MM time'),
  dispatchLeadDays: z.number().int().min(0).max(365),
  mtoLeadDays: z.number().int().min(0).max(365),
  transitDays: z.number().int().min(0).max(365),
  shipDays: z.array(z.number().int().min(0).max(6)).min(1, 'Pick at least one ship day'),
  backorderLeadDays: z.number().int().min(0).max(365).nullable(),
  position: z.number().int().optional(),
})

export async function GET() {
  const gate = await requireShopUser('shop.manage')
  if (gate.error) return gate.error
  return NextResponse.json({ rules: await listRules() })
}

export async function POST(request: NextRequest) {
  const gate = await requireShopUser('shop.manage')
  if (gate.error) return gate.error
  const parsed = RuleBody.safeParse(await request.json())
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid rule' }, { status: 400 })
  if (parsed.data.scopeType !== 'DEFAULT' && !parsed.data.scopeRef) {
    return NextResponse.json({ error: 'Choose what this rule applies to' }, { status: 400 })
  }
  const rule = await createRule(parsed.data)
  return NextResponse.json({ rule })
}
