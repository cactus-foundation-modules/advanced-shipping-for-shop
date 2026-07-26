import { randomUUID } from 'crypto'
import { prisma } from '@/lib/db/prisma'
import { Prisma } from '@prisma/client'
import type { ScopeType, ServiceTier, TierScopeConfig } from '@/modules/advanced-shipping-for-shop/lib/types'
import { ttlCached } from '@/modules/advanced-shipping-for-shop/lib/ttl-cache'

function mapTier(r: Record<string, unknown>): ServiceTier {
  return {
    id: r.id as string,
    key: r.key as string,
    label: r.label as string,
    supplier: (r.supplier as string | null) ?? null,
    position: Number(r.position),
    isNextDay: r.is_next_day as boolean,
    dispatchLeadDelta: Number(r.dispatch_lead_delta),
    transitDelta: Number(r.transit_delta),
    minLeadDays: r.min_lead_days == null ? null : Number(r.min_lead_days),
  }
}

function mapConfig(r: Record<string, unknown>): TierScopeConfig {
  return {
    id: r.id as string,
    tierId: r.tier_id as string,
    scopeType: r.scope_type as ScopeType,
    scopeRef: (r.scope_ref as string | null) ?? null,
    available: r.available as boolean,
    price: (r.price as { toString(): string }).toString(),
    perPerson: (r.per_person as boolean | null) ?? false,
    isNextDay: (r.is_next_day as boolean | null) ?? null,
    dispatchLeadDelta: r.dispatch_lead_delta == null ? null : Number(r.dispatch_lead_delta),
    transitDelta: r.transit_delta == null ? null : Number(r.transit_delta),
    minLeadDays: r.min_lead_days == null ? null : Number(r.min_lead_days),
  }
}

export async function listTiers(): Promise<ServiceTier[]> {
  const rows = await prisma.$queryRaw<Record<string, unknown>[]>`
    SELECT * FROM "ash_service_tiers" ORDER BY "position" ASC, "created_at" ASC
  `
  return rows.map(mapTier)
}

// Cross-request TTL memo for the resolve path (see listRulesCached). Admin
// writes go through getTier/create/update/delete and invalidate below.
const tiersCache = ttlCached(listTiers, 10_000)
export const listTiersCached = (): Promise<ServiceTier[]> => tiersCache.get()
export const invalidateTiersCache = (): void => tiersCache.invalidate()

export async function getTier(id: string): Promise<ServiceTier | null> {
  const rows = await prisma.$queryRaw<Record<string, unknown>[]>`
    SELECT * FROM "ash_service_tiers" WHERE "id" = ${id} LIMIT 1
  `
  return rows[0] ? mapTier(rows[0]) : null
}

export type TierInput = {
  key: string
  label: string
  supplier: string | null
  position?: number
  isNextDay: boolean
  dispatchLeadDelta: number
  transitDelta: number
  minLeadDays: number | null
}

// A key unique across all tiers. Same-named tiers (one per supplier) now
// coexist, so the caller's desired key can already be taken; append -2, -3 …
// until it is free rather than letting the UNIQUE index throw a 500.
async function ensureUniqueKey(desired: string): Promise<string> {
  const base = desired || 'tier'
  const taken = new Set(
    (await prisma.$queryRaw<{ key: string }[]>`SELECT "key" FROM "ash_service_tiers"`).map((r) => r.key),
  )
  if (!taken.has(base)) return base
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`
    if (!taken.has(candidate)) return candidate
  }
}

export async function createTier(input: TierInput): Promise<ServiceTier> {
  const id = randomUUID()
  const key = await ensureUniqueKey(input.key)
  await prisma.$executeRaw`
    INSERT INTO "ash_service_tiers" (
      "id", "key", "label", "supplier", "position", "is_next_day", "dispatch_lead_delta",
      "transit_delta", "min_lead_days", "created_at", "updated_at"
    ) VALUES (
      ${id}, ${key}, ${input.label}, ${input.supplier}, ${input.position ?? 0}, ${input.isNextDay},
      ${input.dispatchLeadDelta}, ${input.transitDelta}, ${input.minLeadDays}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    )
  `
  const row = await getTier(id)
  if (!row) throw new Error('Failed to create service tier')
  tiersCache.invalidate()
  return row
}

export async function updateTier(id: string, patch: Partial<TierInput>): Promise<void> {
  const sets: Prisma.Sql[] = []
  if (patch.key !== undefined) sets.push(Prisma.sql`"key" = ${patch.key}`)
  if (patch.label !== undefined) sets.push(Prisma.sql`"label" = ${patch.label}`)
  if (patch.supplier !== undefined) sets.push(Prisma.sql`"supplier" = ${patch.supplier}`)
  if (patch.position !== undefined) sets.push(Prisma.sql`"position" = ${patch.position}`)
  if (patch.isNextDay !== undefined) sets.push(Prisma.sql`"is_next_day" = ${patch.isNextDay}`)
  if (patch.dispatchLeadDelta !== undefined) sets.push(Prisma.sql`"dispatch_lead_delta" = ${patch.dispatchLeadDelta}`)
  if (patch.transitDelta !== undefined) sets.push(Prisma.sql`"transit_delta" = ${patch.transitDelta}`)
  if (patch.minLeadDays !== undefined) sets.push(Prisma.sql`"min_lead_days" = ${patch.minLeadDays}`)
  if (sets.length === 0) return
  sets.push(Prisma.sql`"updated_at" = CURRENT_TIMESTAMP`)
  await prisma.$executeRaw`UPDATE "ash_service_tiers" SET ${Prisma.join(sets, ', ')} WHERE "id" = ${id}`
  tiersCache.invalidate()
}

export async function deleteTier(id: string): Promise<void> {
  // Scope config rows cascade via the tier FK.
  await prisma.$executeRaw`DELETE FROM "ash_service_tiers" WHERE "id" = ${id}`
  tiersCache.invalidate()
  tierConfigCache.invalidate()
}

// ---------------------------------------------------------------------------
// Per-scope price / availability for a tier (ash_tier_scope_config)
// ---------------------------------------------------------------------------

export async function listTierConfig(): Promise<TierScopeConfig[]> {
  const rows = await prisma.$queryRaw<Record<string, unknown>[]>`
    SELECT * FROM "ash_tier_scope_config"
  `
  return rows.map(mapConfig)
}

// Cross-request TTL memo for the resolve path (see listRulesCached).
const tierConfigCache = ttlCached(listTierConfig, 10_000)
export const listTierConfigCached = (): Promise<TierScopeConfig[]> => tierConfigCache.get()
export const invalidateTierConfigCache = (): void => tierConfigCache.invalidate()

export async function listTierConfigForTier(tierId: string): Promise<TierScopeConfig[]> {
  const rows = await prisma.$queryRaw<Record<string, unknown>[]>`
    SELECT * FROM "ash_tier_scope_config" WHERE "tier_id" = ${tierId}
  `
  return rows.map(mapConfig)
}

export type TierConfigInput = {
  tierId: string
  scopeType: ScopeType
  scopeRef: string | null
  available: boolean
  price: number
  perPerson: boolean
  // Nullable timing overrides; null inherits the tier's own timing.
  isNextDay: boolean | null
  dispatchLeadDelta: number | null
  transitDelta: number | null
  minLeadDays: number | null
}

// Upsert on the (tier, scope) unique key so an admin editing one scope's price
// twice does not stack duplicate rows.
export async function upsertTierConfig(input: TierConfigInput): Promise<void> {
  const id = randomUUID()
  const scopeRef = input.scopeType === 'DEFAULT' ? null : input.scopeRef
  await prisma.$executeRaw`
    INSERT INTO "ash_tier_scope_config" (
      "id", "tier_id", "scope_type", "scope_ref", "available", "price", "per_person",
      "is_next_day", "dispatch_lead_delta", "transit_delta", "min_lead_days", "created_at", "updated_at"
    ) VALUES (
      ${id}, ${input.tierId}, ${input.scopeType}, ${scopeRef}, ${input.available}, ${input.price}, ${input.perPerson},
      ${input.isNextDay}, ${input.dispatchLeadDelta}, ${input.transitDelta}, ${input.minLeadDays}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    )
    ON CONFLICT ("tier_id", "scope_type", COALESCE("scope_ref", '')) DO UPDATE SET
      "available" = ${input.available},
      "price" = ${input.price},
      "per_person" = ${input.perPerson},
      "is_next_day" = ${input.isNextDay},
      "dispatch_lead_delta" = ${input.dispatchLeadDelta},
      "transit_delta" = ${input.transitDelta},
      "min_lead_days" = ${input.minLeadDays},
      "updated_at" = CURRENT_TIMESTAMP
  `
  tierConfigCache.invalidate()
}

export async function deleteTierConfig(id: string): Promise<void> {
  await prisma.$executeRaw`DELETE FROM "ash_tier_scope_config" WHERE "id" = ${id}`
  tierConfigCache.invalidate()
}
