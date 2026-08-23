import { prisma } from '@/lib/db/prisma'
import type { AshSettings, CartControlStyle, HolidayRegion } from '@/modules/advanced-shipping-for-shop/lib/types'
import { isCartControlStyle, isHolidayRegion } from '@/modules/advanced-shipping-for-shop/lib/types'
import { ttlCached } from '@/modules/advanced-shipping-for-shop/lib/ttl-cache'

const DEFAULT_SHIP_DAYS = [1, 2, 3, 4, 5]
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/

const FALLBACK: AshSettings = {
  rangeAttributeId: null,
  holidayRegion: 'england-and-wales',
  holidaysSyncedAt: null,
  defaultTierKey: null,
  cartControlStyle: 'summary',
  showUnavailableServices: true,
  cutoffTime: '12:00',
  dispatchLeadDays: 1,
  shipDays: DEFAULT_SHIP_DAYS,
}

function toShipDays(value: unknown): number[] {
  if (!Array.isArray(value)) return DEFAULT_SHIP_DAYS
  const days = value.filter((n): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= 6)
  return days.length > 0 ? [...new Set(days)].sort((a, b) => a - b) : DEFAULT_SHIP_DAYS
}

function toCutoff(value: unknown): string {
  return typeof value === 'string' && TIME_RE.test(value) ? value : '12:00'
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
    cartControlStyle: style && isCartControlStyle(style) ? style : 'summary',
    // A row written before the column existed reads null, which is the same
    // answer as "not set" - and the setting's default is on.
    showUnavailableServices: r.show_unavailable_services !== false,
    cutoffTime: toCutoff(r.cutoff_time),
    dispatchLeadDays: r.dispatch_lead_days == null ? 1 : Math.max(0, Number(r.dispatch_lead_days)),
    shipDays: toShipDays(r.ship_days),
  }
}

export async function getSettings(): Promise<AshSettings> {
  const rows = await prisma.$queryRaw<Record<string, unknown>[]>`
    SELECT * FROM "ash_settings" WHERE "id" = 'singleton' LIMIT 1
  `
  return rows[0] ? mapRow(rows[0]) : FALLBACK
}

// Cross-request TTL memo for the hot resolve path: the product page, cart and
// estimate API each fold many lines per request, and the settings singleton is
// read several times per line (context, resolver, service defaulting, dispatch
// timing). The TTL collapses all of those - and every request within the window
// - to one query, while admin edits still land within ten seconds (writes below
// also invalidate, so the editing instance sees them at once). Kept separate
// from getSettings so write paths (updateSettings) still read through fresh.
const settingsCache = ttlCached(getSettings, 10_000)
export const getSettingsCached = (): Promise<AshSettings> => settingsCache.get()
export const invalidateSettingsCache = (): void => settingsCache.invalidate()

// holidayRegion is accepted as a plain string (from the API's zod enum) and
// re-validated here, so callers need not carry the HolidayRegion literal type.
export async function updateSettings(input: {
  rangeAttributeId?: string | null
  holidayRegion?: string
  defaultTierKey?: string | null
  cartControlStyle?: string
  showUnavailableServices?: boolean
  cutoffTime?: string
  dispatchLeadDays?: number
  shipDays?: number[]
}): Promise<AshSettings> {
  const current = await getSettings()
  const merged = { ...current, ...input }
  const region: HolidayRegion = isHolidayRegion(merged.holidayRegion) ? merged.holidayRegion : 'england-and-wales'
  const style: CartControlStyle = isCartControlStyle(merged.cartControlStyle) ? merged.cartControlStyle : 'summary'
  const showUnavailable = merged.showUnavailableServices !== false
  const cutoff = toCutoff(merged.cutoffTime)
  const lead = Math.max(0, Math.trunc(merged.dispatchLeadDays))
  const shipDays = toShipDays(merged.shipDays)
  await prisma.$executeRaw`
    INSERT INTO "ash_settings" ("id", "range_attribute_id", "holiday_region", "default_tier_key", "cart_control_style", "show_unavailable_services", "cutoff_time", "dispatch_lead_days", "ship_days", "updated_at")
    VALUES ('singleton', ${merged.rangeAttributeId}, ${region}, ${merged.defaultTierKey}, ${style}, ${showUnavailable}, ${cutoff}, ${lead}, ${JSON.stringify(shipDays)}::jsonb, CURRENT_TIMESTAMP)
    ON CONFLICT ("id") DO UPDATE SET
      "range_attribute_id" = ${merged.rangeAttributeId},
      "holiday_region" = ${region},
      "default_tier_key" = ${merged.defaultTierKey},
      "cart_control_style" = ${style},
      "show_unavailable_services" = ${showUnavailable},
      "cutoff_time" = ${cutoff},
      "dispatch_lead_days" = ${lead},
      "ship_days" = ${JSON.stringify(shipDays)}::jsonb,
      "updated_at" = CURRENT_TIMESTAMP
  `
  settingsCache.invalidate()
  return getSettings()
}

// Stamped after a holiday import so the admin can see when the calendar was last
// refreshed. Separate from updateSettings because the cron writes only this.
export async function markHolidaysSynced(): Promise<void> {
  await prisma.$executeRaw`
    UPDATE "ash_settings" SET "holidays_synced_at" = CURRENT_TIMESTAMP WHERE "id" = 'singleton'
  `
  settingsCache.invalidate()
}
