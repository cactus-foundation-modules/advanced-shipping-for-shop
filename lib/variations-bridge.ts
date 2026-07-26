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

// The provider id product-attributes-for-shop registers against
// shop-variations' `option-source` point (see that module's cactus.module.json).
// A variation option built from an attribute records this as its
// svr_options.source_provider, and its source_ref is the attribute id.
const ATTRIBUTE_OPTION_PROVIDER = 'product-attributes'

// child product id -> range value ids carried by the child's OWN variation
// selection, when the range attribute has been set up as a per-variation option
// rather than a product-level attribute. The chosen option value's source_ref is
// the pat_attribute_value id, so it maps straight onto the same value ids the
// product-level range read (pat_product_values) yields - the resolver can treat
// the two identically. Empty when shop-variations is absent, no range attribute
// is nominated, or none of the ids are variant children of a range option.
export async function getVariantRangeValues(
  childProductIds: string[],
  rangeAttributeId: string,
): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>()
  if (childProductIds.length === 0 || !rangeAttributeId) return result
  if (!(await hasVariantsTable())) return result
  const rows = await prisma.$queryRaw<{ child_product_id: string; value_id: string }[]>`
    SELECT v."child_product_id", ov."source_ref" AS value_id
    FROM "svr_variants" v
    JOIN "svr_variant_values" vv ON vv."variant_id" = v."id"
    JOIN "svr_option_values" ov ON ov."id" = vv."option_value_id"
    JOIN "svr_options" o ON o."id" = ov."option_id"
    WHERE v."child_product_id" IN (${Prisma.join(childProductIds)})
      AND o."source_provider" = ${ATTRIBUTE_OPTION_PROVIDER}
      AND o."source_ref" = ${rangeAttributeId}
      AND ov."source_ref" IS NOT NULL
  `
  for (const r of rows) {
    const list = result.get(r.child_product_id) ?? []
    list.push(r.value_id)
    result.set(r.child_product_id, list)
  }
  return result
}
