// GET /api/m/advanced-shipping-for-shop/admin/missing-rules
// Coverage report for the nominated shipping attribute: every one of its values
// with the delivery services that actually price it, so the admin screen can
// show the ones no service prices at all. "range" in the schema is "shipping
// attribute" on screen - same thing, older name.
import { NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db/prisma'
import { requireShopUser } from '@/modules/shop/lib/access'
import { listAttributes } from '@/modules/product-attributes-for-shop/lib/db/attributes'
import { getSettings } from '@/modules/advanced-shipping-for-shop/lib/db/settings'
import { listTiers, listTierConfig } from '@/modules/advanced-shipping-for-shop/lib/db/tiers'
import { getRangeValueParents, getVariantParents } from '@/modules/advanced-shipping-for-shop/lib/variations-bridge'

export type MissingRulesValue = {
  id: string
  label: string
  // Live listings carrying this value, whether on the listing itself or on any
  // of its variations. Zero means nothing is waiting on the rule.
  productCount: number
  coveredTierIds: string[]
}

export type MissingRulesReport = {
  attributeName: string | null
  tiers: { id: string; label: string }[]
  values: MissingRulesValue[]
}

// value id -> live listing ids carrying it, counting a variation child as its
// parent listing so the number matches what an owner sees in the catalogue.
async function countProductsByValue(valueIds: string[], rangeAttributeId: string): Promise<Map<string, number>> {
  const byValue = new Map<string, Set<string>>()
  if (valueIds.length === 0) return new Map()

  const direct = await prisma.$queryRaw<{ value_id: string; product_id: string }[]>`
    SELECT "value_id", "product_id" FROM "pat_product_values"
    WHERE "value_id" IN (${Prisma.join(valueIds)})
  `
  const parents = await getVariantParents(direct.map((r) => r.product_id))
  for (const r of direct) {
    const set = byValue.get(r.value_id) ?? new Set<string>()
    set.add(parents.get(r.product_id) ?? r.product_id)
    byValue.set(r.value_id, set)
  }

  for (const [valueId, productIds] of await getRangeValueParents(rangeAttributeId)) {
    if (!valueIds.includes(valueId)) continue
    const set = byValue.get(valueId) ?? new Set<string>()
    for (const id of productIds) set.add(id)
    byValue.set(valueId, set)
  }

  // Drafts and archived listings are not the shop's promise, so they do not
  // make a missing rule urgent - drop them before counting.
  const all = [...new Set([...byValue.values()].flatMap((s) => [...s]))]
  if (all.length === 0) return new Map()
  const live = new Set(
    (await prisma.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "shp_products" WHERE "id" IN (${Prisma.join(all)}) AND "status" = 'ACTIVE'
    `).map((r) => r.id),
  )

  const counts = new Map<string, number>()
  for (const [valueId, set] of byValue) {
    counts.set(valueId, [...set].filter((id) => live.has(id)).length)
  }
  return counts
}

export async function GET() {
  const gate = await requireShopUser('shop.manage')
  if (gate.error) return gate.error

  const settings = await getSettings()
  if (!settings.rangeAttributeId) {
    return NextResponse.json({ attributeName: null, tiers: [], values: [] } satisfies MissingRulesReport)
  }

  const [attributes, tiers, config] = await Promise.all([listAttributes(), listTiers(), listTierConfig()])
  const attribute = attributes.find((a) => a.id === settings.rangeAttributeId) ?? null
  if (!attribute) {
    return NextResponse.json({ attributeName: null, tiers: [], values: [] } satisfies MissingRulesReport)
  }

  const valueIds = attribute.values.map((v) => v.id)
  const counts = await countProductsByValue(valueIds, settings.rangeAttributeId)

  const covered = new Map<string, Set<string>>()
  for (const c of config) {
    if (c.scopeType !== 'RANGE' || !c.scopeRef) continue
    const set = covered.get(c.scopeRef) ?? new Set<string>()
    set.add(c.tierId)
    covered.set(c.scopeRef, set)
  }

  return NextResponse.json({
    attributeName: attribute.name,
    tiers: tiers.map((t) => ({ id: t.id, label: t.label })),
    values: attribute.values.map((v) => ({
      id: v.id,
      label: v.label,
      productCount: counts.get(v.id) ?? 0,
      coveredTierIds: [...(covered.get(v.id) ?? [])],
    })),
  } satisfies MissingRulesReport)
}
