// GET /api/m/advanced-shipping-for-shop/admin/options
// Everything the admin scope pickers need: suppliers, categories, the attributes
// that can act as "range" and their values, and the current tiers.
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { requireShopUser } from '@/modules/shop/lib/access'
import { listCategories } from '@/modules/shop/lib/db/catalogue'
import { listAttributes } from '@/modules/product-attributes-for-shop/lib/db/attributes'
import { getSettings } from '@/modules/advanced-shipping-for-shop/lib/db/settings'
import { listTiers } from '@/modules/advanced-shipping-for-shop/lib/db/tiers'

export async function GET() {
  const gate = await requireShopUser('shop.manage')
  if (gate.error) return gate.error

  const [supplierRows, categories, attributes, settings, tiers] = await Promise.all([
    prisma.$queryRaw<{ supplier: string }[]>`
      SELECT DISTINCT "supplier" FROM "shp_products" WHERE "supplier" IS NOT NULL AND "supplier" <> '' ORDER BY "supplier" ASC
    `,
    listCategories(),
    listAttributes(),
    getSettings(),
    listTiers(),
  ])

  const rangeAttribute = settings.rangeAttributeId ? attributes.find((a) => a.id === settings.rangeAttributeId) ?? null : null

  return NextResponse.json({
    suppliers: supplierRows.map((r) => r.supplier),
    categories: categories.map((c) => ({ id: c.id, name: c.name, parentId: c.parentId })),
    attributes: attributes.map((a) => ({ id: a.id, name: a.name })),
    rangeAttributeId: settings.rangeAttributeId,
    rangeValues: rangeAttribute ? rangeAttribute.values.map((v) => ({ id: v.id, label: v.label })) : [],
    tiers: tiers.map((t) => ({ id: t.id, key: t.key, label: t.label })),
  })
}
