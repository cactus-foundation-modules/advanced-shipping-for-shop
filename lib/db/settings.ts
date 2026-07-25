import { cache } from 'react'
import { prisma } from '@/lib/db/prisma'
import type { AshSettings, CartControlStyle, HolidayRegion } from '@/modules/advanced-shipping-for-shop/lib/types'
import { isCartControlStyle, isHolidayRegion } from '@/modules/advanced-shipping-for-shop/lib/types'

const FALLBACK: AshSettings = {
  rangeAttributeId: null,
  holidayRegion: 'england-and-wales',
  holidaysSyncedAt: null,
  defaultTierKey: null,
  cartControlStyle: 'dropdown',
}

function mapRow(r: Record<string, unknown>): AshSettings {
  const region = r.holiday_region as string | null
  const synced = r.holidays_synced_at as Date | string | null
  const style = r.cart_control_style as string | null
  return {
    rangeAttributeId: (r.range_attribute_id as string | null) ?? null,
    holidayRegion: region && isHolidayRegion(region) ? region : 'england-and-wales',
    holidaysSyncedAt: synced ? new Date(synced).toISOString() : null,
    defaultTierKey: (r.default_tier_key as string | null) ?? null,
    cartControlStyle: style && isCartControlStyle(style) ? style : 'dropdown',
  }
}

export async function getSettings(): Promise<AshSettings> {
  const rows = await prisma.$queryRaw<Record<string, unknown>[]>`
    SELECT * FROM "ash_settings" WHERE "id" = 'singleton' LIMIT 1
  `
  return rows[0] ? mapRow(rows[0]) : FALLBACK
}

// Request-scoped memo for the hot resolve path: the product page, cart and
// estimate API each fold many lines per request, and the settings singleton is
// read several times per line (context, resolver, tier defaulting). React
// cache() collapses all of those to one query per request and dedupes the
// concurrent reads once the cart lines resolve in parallel. Kept separate from
// getSettings so write paths (updateSettings) still read through fresh after
// their own write within the same request.
export const getSettingsCached = cache(getSettings)

// holidayRegion is accepted as a plain string (from the API's zod enum) and
// re-validated here, so callers need not carry the HolidayRegion literal type.
export async function updateSettings(input: {
  rangeAttributeId?: string | null
  holidayRegion?: string
  defaultTierKey?: string | null
  cartControlStyle?: string
}): Promise<AshSettings> {
  const current = await getSettings()
  const merged = { ...current, ...input }
  const region: HolidayRegion = isHolidayRegion(merged.holidayRegion) ? merged.holidayRegion : 'england-and-wales'
  const style: CartControlStyle = isCartControlStyle(merged.cartControlStyle) ? merged.cartControlStyle : 'dropdown'
  await prisma.$executeRaw`
    INSERT INTO "ash_settings" ("id", "range_attribute_id", "holiday_region", "default_tier_key", "cart_control_style", "updated_at")
    VALUES ('singleton', ${merged.rangeAttributeId}, ${region}, ${merged.defaultTierKey}, ${style}, CURRENT_TIMESTAMP)
    ON CONFLICT ("id") DO UPDATE SET
      "range_attribute_id" = ${merged.rangeAttributeId},
      "holiday_region" = ${region},
      "default_tier_key" = ${merged.defaultTierKey},
      "cart_control_style" = ${style},
      "updated_at" = CURRENT_TIMESTAMP
  `
  return getSettings()
}

// Stamped after a holiday import so the admin can see when the calendar was last
// refreshed. Separate from updateSettings because the cron writes only this.
export async function markHolidaysSynced(): Promise<void> {
  await prisma.$executeRaw`
    UPDATE "ash_settings" SET "holidays_synced_at" = CURRENT_TIMESTAMP WHERE "id" = 'singleton'
  `
}
