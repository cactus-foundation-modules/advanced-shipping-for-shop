import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db/prisma'

// shop-variations is an OPTIONAL companion, not a dependency: delivery rules
// work on a plain shop catalogue without it. But when it IS present, the cart
// holds hidden variant child products (ordinary shp_products rows), and those
// children carry none of the scope facts rules key on - the range attribute,
// category and supplier all live on the parent. So the resolver maps children
// back to their parents through raw SQL against svr_variants, never importing
// from '@/modules/shop-variations/...' - that path does not exist on an install
// without the module and a static import would break the build there.
//
// Presence is probed with to_regclass rather than the Module table (same
// pattern as product-attributes-for-shop's variations bridge): the table is
// what the query actually needs, and a module row can exist while its
// migration has not run yet.

let cached: { value: boolean; at: number } | null = null
const TTL_MS = 30_000

async function hasVariantsTable(): Promise<boolean> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.value
  const rows = await prisma.$queryRaw<[{ present: boolean }]>`
    SELECT (to_regclass('public.svr_variants') IS NOT NULL) AS "present"
  `
  const value = Boolean(rows[0]?.present)
  cached = { value, at: Date.now() }
  return value
}

// child product id -> parent product id, for any of the given ids that are
// variant children. Empty when shop-variations is absent or none of them are.
export async function getVariantParents(productIds: string[]): Promise<Map<string, string>> {
  const result = new Map<string, string>()
  if (productIds.length === 0) return result
  if (!(await hasVariantsTable())) return result
  const rows = await prisma.$queryRaw<{ child_product_id: string; product_id: string }[]>`
    SELECT "child_product_id", "product_id"
    FROM "svr_variants"
    WHERE "child_product_id" IN (${Prisma.join(productIds)})
  `
  for (const r of rows) result.set(r.child_product_id, r.product_id)
  return result
}
