import { prisma } from '@/lib/db/prisma'
import { Prisma } from '@prisma/client'
import type { FulfilmentMode, ProductOverride } from '@/modules/advanced-shipping-for-shop/lib/types'

function mapRow(r: Record<string, unknown>): ProductOverride {
  return {
    productId: r.product_id as string,
    fulfilmentMode: (r.fulfilment_mode as FulfilmentMode | null) ?? null,
    mtoLeadDays: r.mto_lead_days == null ? null : Number(r.mto_lead_days),
    cutoffTime: (r.cutoff_time as string | null) ?? null,
    dispatchLeadDays: r.dispatch_lead_days == null ? null : Number(r.dispatch_lead_days),
    transitDays: r.transit_days == null ? null : Number(r.transit_days),
    backorderLeadDays: r.backorder_lead_days == null ? null : Number(r.backorder_lead_days),
    disabled: r.disabled as boolean,
  }
}

export async function getOverride(productId: string): Promise<ProductOverride | null> {
  const rows = await prisma.$queryRaw<Record<string, unknown>[]>`
    SELECT * FROM "ash_product_overrides" WHERE "product_id" = ${productId} LIMIT 1
  `
  return rows[0] ? mapRow(rows[0]) : null
}

export async function getOverridesByProduct(productIds: string[]): Promise<Map<string, ProductOverride>> {
  const result = new Map<string, ProductOverride>()
  if (productIds.length === 0) return result
  const rows = await prisma.$queryRaw<Record<string, unknown>[]>`
    SELECT * FROM "ash_product_overrides" WHERE "product_id" IN (${Prisma.join(productIds)})
  `
  for (const r of rows) {
    const o = mapRow(r)
    result.set(o.productId, o)
  }
  return result
}

export type OverrideInput = Omit<ProductOverride, 'productId'>

export async function upsertOverride(productId: string, input: OverrideInput): Promise<void> {
  await prisma.$executeRaw`
    INSERT INTO "ash_product_overrides" (
      "product_id", "fulfilment_mode", "mto_lead_days", "cutoff_time",
      "dispatch_lead_days", "transit_days", "backorder_lead_days", "disabled", "updated_at"
    ) VALUES (
      ${productId}, ${input.fulfilmentMode}, ${input.mtoLeadDays}, ${input.cutoffTime},
      ${input.dispatchLeadDays}, ${input.transitDays}, ${input.backorderLeadDays}, ${input.disabled}, CURRENT_TIMESTAMP
    )
    ON CONFLICT ("product_id") DO UPDATE SET
      "fulfilment_mode" = ${input.fulfilmentMode},
      "mto_lead_days" = ${input.mtoLeadDays},
      "cutoff_time" = ${input.cutoffTime},
      "dispatch_lead_days" = ${input.dispatchLeadDays},
      "transit_days" = ${input.transitDays},
      "backorder_lead_days" = ${input.backorderLeadDays},
      "disabled" = ${input.disabled},
      "updated_at" = CURRENT_TIMESTAMP
  `
}

export async function deleteOverride(productId: string): Promise<void> {
  await prisma.$executeRaw`DELETE FROM "ash_product_overrides" WHERE "product_id" = ${productId}`
}
