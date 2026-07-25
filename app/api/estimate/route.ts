// POST /api/m/advanced-shipping-for-shop/estimate  (public)
// Body: { items: [{ productId? , slug?, tierKey?, quantity? }] }
// Returns a per-item delivery estimate plus a grouped "arrives in N deliveries"
// summary. The storefront delivery line and the cart both call this for a live
// refresh (the countdown re-fetches when a cut-off passes and rolls the date).
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { shopClosedResponse } from '@/modules/shop/lib/access'
import { getProductBySlug } from '@/modules/shop/lib/db/products'
import { estimateItems, type EstimateItemInput } from '@/modules/advanced-shipping-for-shop/lib/estimate-service'

const Body = z.object({
  items: z
    .array(
      z.object({
        productId: z.string().min(1).optional(),
        slug: z.string().min(1).optional(),
        tierKey: z.string().min(1).optional(),
        quantity: z.number().int().min(1).max(1000).optional(),
      }),
    )
    .min(1)
    .max(200),
})

export async function POST(request: NextRequest) {
  const closed = await shopClosedResponse()
  if (closed) return closed

  const parsed = Body.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })

  // Resolve any slug-only items to product ids (the storefront block knows only
  // the slug from the URL). Unknown slugs are dropped rather than erroring.
  const inputs: EstimateItemInput[] = []
  for (const item of parsed.data.items) {
    let productId = item.productId
    if (!productId && item.slug) {
      const product = await getProductBySlug(item.slug)
      productId = product?.id
    }
    if (!productId) continue
    inputs.push({ productId, tierKey: item.tierKey, quantity: item.quantity })
  }

  if (inputs.length === 0) return NextResponse.json({ items: [], deliveries: [] })

  const result = await estimateItems(inputs)
  return NextResponse.json(result)
}
