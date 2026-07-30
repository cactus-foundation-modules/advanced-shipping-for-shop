// POST /api/m/advanced-shipping-for-shop/estimate  (public)
// Body: { items: [{ productId? , slug?, tierKey?, quantity? }] }
// Returns a per-item delivery estimate plus a grouped "arrives in N deliveries"
// summary. The storefront delivery line and the cart both call this for a live
// refresh (the countdown re-fetches when a cut-off passes and rolls the date).
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db/prisma'
import { shopClosedResponse } from '@/modules/shop/lib/access'
import { estimateItems, type EstimateItemInput } from '@/modules/advanced-shipping-for-shop/lib/estimate-service'

const Body = z.object({
  items: z
    .array(
      z.object({
        productId: z.string().min(1).optional(),
        slug: z.string().min(1).optional(),
        tierKey: z.string().min(1).optional(),
        quantity: z.number().int().min(1).max(1000).optional(),
        // The caller's own handle on the row, echoed back untouched - a basket
        // sends its cart-line key so it can match the answer to the right line.
        ref: z.string().min(1).max(200).optional(),
        // Answer from the product's variations when it offers nothing itself -
        // what a listing page needs before a combination has been chosen.
        variantFallback: z.boolean().optional(),
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
  // the slug from the URL) in ONE query for the lot - this was a lookup per
  // item, which billed a full round-trip per cart line on a remote database.
  // Unknown slugs are dropped rather than erroring.
  const slugsToResolve = [...new Set(parsed.data.items.filter((i) => !i.productId && i.slug).map((i) => i.slug!))]
  const idBySlug = new Map<string, string>()
  if (slugsToResolve.length > 0) {
    const rows = await prisma.$queryRaw<{ id: string; slug: string }[]>`
      SELECT "id", "slug" FROM "shp_products" WHERE "slug" IN (${Prisma.join(slugsToResolve)})
    `
    for (const row of rows) idBySlug.set(row.slug, row.id)
  }
  const inputs: EstimateItemInput[] = []
  for (const item of parsed.data.items) {
    const productId = item.productId ?? (item.slug ? idBySlug.get(item.slug) : undefined)
    if (!productId) continue
    inputs.push({ productId, tierKey: item.tierKey, quantity: item.quantity, ref: item.ref, variantFallback: item.variantFallback })
  }

  if (inputs.length === 0) return NextResponse.json({ items: [], deliveries: [] })

  const result = await estimateItems(inputs)
  return NextResponse.json(result)
}
