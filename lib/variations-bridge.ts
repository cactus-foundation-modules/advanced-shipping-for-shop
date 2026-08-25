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

// parent product id -> its enabled variation children, for the storefront's
// product-page picker. A listing page knows only the parent, and on a catalogue
// where the range lives on the variations the parent resolves to no services at
// all - so the page would show nothing until the shopper picked a combination.
// The children are what actually carry the delivery facts, so the picker asks
// for them and shows what they agree on until the shopper settles on one.
// Disabled variants are left out: they are not on sale, so their services are
// not the shop's promise.
export async function getVariantChildIds(parentProductIds: string[]): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>()
  if (parentProductIds.length === 0) return result
  if (!(await hasVariantsTable())) return result
  const rows = await prisma.$queryRaw<{ product_id: string; child_product_id: string }[]>`
    SELECT "product_id", "child_product_id"
    FROM "svr_variants"
    WHERE "product_id" IN (${Prisma.join(parentProductIds)})
      AND "enabled" = true
  `
  for (const r of rows) {
    const list = result.get(r.product_id) ?? []
    list.push(r.child_product_id)
    result.set(r.product_id, list)
  }
  return result
}

// One option value a variation was built from. The option's own name and both
// positions ride along so a caller can order and group these the way the product
// page's own option controls do, without a second query.
export type VariantOptionValue = {
  optionId: string
  optionName: string
  optionPosition: number
  valueId: string
  valueLabel: string
  valuePosition: number
}

// child product id -> the option values that variation is made of. Read straight
// off shop-variations' tables rather than through an import, for the reason at
// the top of this file. Empty when the module is absent, which leaves every
// caller with nothing to say about where a service is to be had - and saying
// nothing is exactly right on a shop with no variations.
export async function getVariantOptionValues(childProductIds: string[]): Promise<Map<string, VariantOptionValue[]>> {
  const result = new Map<string, VariantOptionValue[]>()
  if (childProductIds.length === 0) return result
  if (!(await hasVariantsTable())) return result
  const rows = await prisma.$queryRaw<{
    child_product_id: string
    option_id: string
    option_name: string
    option_position: number
    value_id: string
    value_label: string
    value_position: number
  }[]>`
    SELECT v."child_product_id", o."id" AS option_id, o."name" AS option_name, o."position" AS option_position,
           ov."id" AS value_id, ov."label" AS value_label, ov."position" AS value_position
    FROM "svr_variants" v
    JOIN "svr_variant_values" vv ON vv."variant_id" = v."id"
    JOIN "svr_option_values" ov ON ov."id" = vv."option_value_id"
    JOIN "svr_options" o ON o."id" = ov."option_id"
    WHERE v."child_product_id" IN (${Prisma.join(childProductIds)})
    ORDER BY o."position", ov."position"
  `
  for (const r of rows) {
    const list = result.get(r.child_product_id) ?? []
    list.push({
      optionId: r.option_id,
      optionName: r.option_name,
      optionPosition: Number(r.option_position),
      valueId: r.value_id,
      valueLabel: r.value_label,
      valuePosition: Number(r.value_position),
    })
    result.set(r.child_product_id, list)
  }
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

// shipping-attribute value id -> the parent listings whose ENABLED variations
// carry that value, for the "Missing shipping rules" admin screen. Same reading
// as getVariantRangeValues, turned the other way round and rolled up to the
// listing, because the screen counts listings an owner would recognise rather
// than hidden variant children. Empty when shop-variations is absent or the
// range attribute drives no variation option.
export async function getRangeValueParents(rangeAttributeId: string): Promise<Map<string, Set<string>>> {
  const result = new Map<string, Set<string>>()
  if (!rangeAttributeId) return result
  if (!(await hasVariantsTable())) return result
  const rows = await prisma.$queryRaw<{ value_id: string; product_id: string }[]>`
    SELECT DISTINCT ov."source_ref" AS value_id, v."product_id"
    FROM "svr_variants" v
    JOIN "svr_variant_values" vv ON vv."variant_id" = v."id"
    JOIN "svr_option_values" ov ON ov."id" = vv."option_value_id"
    JOIN "svr_options" o ON o."id" = ov."option_id"
    WHERE o."source_provider" = ${ATTRIBUTE_OPTION_PROVIDER}
      AND o."source_ref" = ${rangeAttributeId}
      AND ov."source_ref" IS NOT NULL
      AND v."enabled" = true
  `
  for (const r of rows) {
    const set = result.get(r.value_id) ?? new Set<string>()
    set.add(r.product_id)
    result.set(r.value_id, set)
  }
  return result
}

// parent product id -> a handful of its variations that between them cover every
// delivery answer the listing has, for a browse GRID.
//
// A product page asks about one listing and can afford to resolve all of its
// variations (getVariantChildIds). A category page cannot: sixty listings of two
// hundred variations each is twelve thousand products to resolve for sixty lines
// of text, which measured at several seconds on a live catalogue.
//
// It does not need them. Delivery keys on the range value, the category and the
// supplier, and a variation carries none of the last two - it inherits its
// parent's. So every variation of a listing sharing a range value resolves to
// exactly the same services, at the same prices, on the same timing. One of them
// speaks for the lot, and a listing usually has just the one range value.
//
// Which one speaks matters only for stock, which is the one fact that does vary
// between them - so the pick is ordered to hand back the variation that can be
// delivered soonest: one that is actually purchasable ahead of one that is
// blocked out of stock, stock ahead of pre-order, and the earliest promised
// dispatch date among pre-orders. That makes the representative exact for
// "soonest", not an approximation of it.
//
// The range value is read from BOTH places a variation can carry one: a
// product-level attribute value on the child, and the child's own variation
// selection where the range attribute drives an option (the two sources
// getVariantRangeValues explains). Children carrying none at all group together
// under NULL and get a representative of their own, since they resolve through
// their parent's scope facts and so agree with each other too.
export async function getRepresentativeVariants(
  parentProductIds: string[],
  rangeAttributeId: string | null,
): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>()
  if (parentProductIds.length === 0) return result
  if (!(await hasVariantsTable())) return result

  const ids = Prisma.join(parentProductIds)
  // No nominated range attribute means nothing distinguishes one variation from
  // another, so a single representative per listing answers for all of them.
  const ranged = rangeAttributeId
    ? Prisma.sql`
        SELECT k.listing_id, k.child_id, pv."value_id"
        FROM kids k
        JOIN "pat_product_values" pv ON pv."product_id" = k.child_id
        JOIN "pat_attribute_values" av ON av."id" = pv."value_id" AND av."attribute_id" = ${rangeAttributeId}
        UNION
        SELECT k.listing_id, k.child_id, ov."source_ref" AS "value_id"
        FROM kids k
        JOIN "svr_variant_values" vv ON vv."variant_id" = k.variant_id
        JOIN "svr_option_values" ov ON ov."id" = vv."option_value_id"
        JOIN "svr_options" o ON o."id" = ov."option_id"
        WHERE o."source_provider" = ${ATTRIBUTE_OPTION_PROVIDER}
          AND o."source_ref" = ${rangeAttributeId}
          AND ov."source_ref" IS NOT NULL`
    : Prisma.sql`SELECT k.listing_id, k.child_id, NULL::text AS "value_id" FROM kids k WHERE false`

  const rows = await prisma.$queryRaw<{ listing_id: string; child_id: string }[]>`
    WITH kids AS (
      SELECT v."product_id" AS listing_id, v."child_product_id" AS child_id, v."id" AS variant_id
      FROM "svr_variants" v
      WHERE v."product_id" IN (${ids}) AND v."enabled" = true
    ),
    ranged AS (${ranged}),
    tagged AS (
      SELECT k.listing_id, k.child_id, r."value_id"
      FROM kids k
      LEFT JOIN ranged r ON r.child_id = k.child_id AND r.listing_id = k.listing_id
    )
    SELECT DISTINCT ON (t.listing_id, t."value_id") t.listing_id, t.child_id
    FROM tagged t
    JOIN "shp_products" p ON p."id" = t.child_id
    ORDER BY t.listing_id, t."value_id",
      (CASE WHEN p."track_inventory" AND COALESCE(p."stock_count", 0) <= 0 AND p."out_of_stock_behaviour" = 'BLOCK' THEN 1 ELSE 0 END),
      (CASE WHEN p."is_pre_order" THEN 1 ELSE 0 END),
      p."pre_order_dispatch_date" ASC NULLS FIRST,
      t.child_id
  `
  for (const r of rows) {
    const list = result.get(r.listing_id) ?? []
    list.push(r.child_id)
    result.set(r.listing_id, list)
  }
  return result
}
