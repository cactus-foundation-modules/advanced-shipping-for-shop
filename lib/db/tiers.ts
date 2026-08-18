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
    description: (r.description as string | null) ?? null,
    position: Number(r.position),
    transitDays: Number(r.transit_days),
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
    transitDays: r.transit_days == null ? null : Number(r.transit_days),
    minLeadDays: r.min_lead_days == null ? null : Number(r.min_lead_days),
  }
}

export async function listTiers(): Promise<ServiceTier[]> {
  const rows = await prisma.$queryRaw<Record<string, unknown>[]>`
    SELECT * FROM "ash_service_tiers" ORDER BY "position" ASC, "created_at" ASC
  `
  return rows.map(mapTier)
}

// Cross-request TTL memo for the resolve path (see getSettingsCached). Admin
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
  description: string | null
  position?: number
  transitDays: number
  minLeadDays: number | null
}

// A key unique across all services. The caller's desired key can already be
// taken; append -2, -3 … until it is free rather than letting the UNIQUE index
// throw a 500.
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
  // A new service joins the BACK of the running order unless the caller says
  // otherwise. Defaulting to 0 would have put it in front of everything the
  // owner had already arranged.
  const position = input.position ?? (
    await prisma.$queryRaw<{ next: number }[]>`
      SELECT COALESCE(MAX("position") + 1, 0)::int AS "next" FROM "ash_service_tiers"
    `
  )[0]?.next ?? 0
  await prisma.$executeRaw`
    INSERT INTO "ash_service_tiers" (
      "id", "key", "label", "description", "position", "transit_days",
      "min_lead_days", "created_at", "updated_at"
    ) VALUES (
      ${id}, ${key}, ${input.label}, ${input.description}, ${position},
      ${input.transitDays}, ${input.minLeadDays}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    )
  `
  const row = await getTier(id)
  if (!row) throw new Error('Failed to create delivery service')
  tiersCache.invalidate()
  return row
}

export async function updateTier(id: string, patch: Partial<TierInput>): Promise<void> {
  const sets: Prisma.Sql[] = []
  if (patch.key !== undefined) sets.push(Prisma.sql`"key" = ${patch.key}`)
  if (patch.label !== undefined) sets.push(Prisma.sql`"label" = ${patch.label}`)
  if (patch.description !== undefined) sets.push(Prisma.sql`"description" = ${patch.description}`)
  if (patch.position !== undefined) sets.push(Prisma.sql`"position" = ${patch.position}`)
  if (patch.transitDays !== undefined) sets.push(Prisma.sql`"transit_days" = ${patch.transitDays}`)
  if (patch.minLeadDays !== undefined) sets.push(Prisma.sql`"min_lead_days" = ${patch.minLeadDays}`)
  if (sets.length === 0) return
  sets.push(Prisma.sql`"updated_at" = CURRENT_TIMESTAMP`)
  await prisma.$executeRaw`UPDATE "ash_service_tiers" SET ${Prisma.join(sets, ', ')} WHERE "id" = ${id}`
  tiersCache.invalidate()
}

// Write the running order in one go: the caller sends every service id in the
// order it wants them, and each row's position becomes its index. Whole-list
// rather than swap-a-pair on purpose - every existing install has all its
// services sitting on position 0 (nothing ever set it), so the first reorder has
// to normalise the lot or the order would depend on created_at tie-breaks.
// Unknown ids are simply not matched; ids left out keep the position they had.
export async function reorderTiers(ids: string[]): Promise<void> {
  if (ids.length === 0) return
  // The casts are load-bearing: bare parameters inside a VALUES list give
  // Postgres nothing to infer from ("could not determine data type of parameter").
  const rows = ids.map((id, i) => Prisma.sql`(${id}::text, ${i}::int)`)
  await prisma.$executeRaw`
    UPDATE "ash_service_tiers" t
    SET "position" = v."position", "updated_at" = CURRENT_TIMESTAMP
    FROM (VALUES ${Prisma.join(rows, ', ')}) AS v("id", "position")
    WHERE t."id" = v."id"
  `
  tiersCache.invalidate()
}

export async function deleteTier(id: string): Promise<void> {
  // Scope config rows cascade via the tier FK.
  await prisma.$executeRaw`DELETE FROM "ash_service_tiers" WHERE "id" = ${id}`
  tiersCache.invalidate()
  tierConfigCache.invalidate()
}

// ---------------------------------------------------------------------------
// Per-scope price / timing for a service (ash_tier_scope_config)
// ---------------------------------------------------------------------------

export async function listTierConfig(): Promise<TierScopeConfig[]> {
  const rows = await prisma.$queryRaw<Record<string, unknown>[]>`
    SELECT * FROM "ash_tier_scope_config"
  `
  return rows.map(mapConfig)
}

// Cross-request TTL memo for the resolve path (see getSettingsCached).
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
  // Nullable absolute timing overrides; null inherits the service's own.
  transitDays: number | null
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
      "transit_days", "min_lead_days", "created_at", "updated_at"
    ) VALUES (
      ${id}, ${input.tierId}, ${input.scopeType}, ${scopeRef}, ${input.available}, ${input.price}, ${input.perPerson},
      ${input.transitDays}, ${input.minLeadDays}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    )
    ON CONFLICT ("tier_id", "scope_type", COALESCE("scope_ref", '')) DO UPDATE SET
      "available" = ${input.available},
      "price" = ${input.price},
      "per_person" = ${input.perPerson},
      "transit_days" = ${input.transitDays},
      "min_lead_days" = ${input.minLeadDays},
      "updated_at" = CURRENT_TIMESTAMP
  `
  tierConfigCache.invalidate()
}

// Edit a price row in place. Scope stays put - moving a price to a different
// scope is what the upsert above is for - so only the numbers and switches
// here. Undefined fields are left alone; null clears a timing override back to
// "inherit the service's own".
export async function updateTierConfig(
  id: string,
  patch: Partial<Omit<TierConfigInput, 'tierId' | 'scopeType' | 'scopeRef'>>,
): Promise<void> {
  const sets: Prisma.Sql[] = []
  if (patch.available !== undefined) sets.push(Prisma.sql`"available" = ${patch.available}`)
  if (patch.price !== undefined) sets.push(Prisma.sql`"price" = ${patch.price}`)
  if (patch.perPerson !== undefined) sets.push(Prisma.sql`"per_person" = ${patch.perPerson}`)
  if (patch.transitDays !== undefined) sets.push(Prisma.sql`"transit_days" = ${patch.transitDays}`)
  if (patch.minLeadDays !== undefined) sets.push(Prisma.sql`"min_lead_days" = ${patch.minLeadDays}`)
  if (sets.length === 0) return
  sets.push(Prisma.sql`"updated_at" = CURRENT_TIMESTAMP`)
  await prisma.$executeRaw`UPDATE "ash_tier_scope_config" SET ${Prisma.join(sets, ', ')} WHERE "id" = ${id}`
  tierConfigCache.invalidate()
}

export async function getTierConfig(id: string): Promise<TierScopeConfig | null> {
  const rows = await prisma.$queryRaw<Record<string, unknown>[]>`
    SELECT * FROM "ash_tier_scope_config" WHERE "id" = ${id} LIMIT 1
  `
  return rows[0] ? mapConfig(rows[0]) : null
}

export async function deleteTierConfig(id: string): Promise<void> {
  await prisma.$executeRaw`DELETE FROM "ash_tier_scope_config" WHERE "id" = ${id}`
  tierConfigCache.invalidate()
}
