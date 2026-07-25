import { randomUUID } from 'crypto'
import { cache } from 'react'
import { prisma } from '@/lib/db/prisma'
import { Prisma } from '@prisma/client'
import type { DeliveryRule, FulfilmentMode, ScopeType } from '@/modules/advanced-shipping-for-shop/lib/types'

const DEFAULT_SHIP_DAYS = [1, 2, 3, 4, 5]

function toShipDays(value: unknown): number[] {
  if (!Array.isArray(value)) return DEFAULT_SHIP_DAYS
  const days = value.filter((n): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= 6)
  return days.length > 0 ? [...new Set(days)].sort((a, b) => a - b) : DEFAULT_SHIP_DAYS
}

function mapRow(r: Record<string, unknown>): DeliveryRule {
  return {
    id: r.id as string,
    scopeType: r.scope_type as ScopeType,
    scopeRef: (r.scope_ref as string | null) ?? null,
    fulfilmentMode: r.fulfilment_mode as FulfilmentMode,
    cutoffTime: r.cutoff_time as string,
    dispatchLeadDays: Number(r.dispatch_lead_days),
    mtoLeadDays: Number(r.mto_lead_days),
    transitDays: Number(r.transit_days),
    shipDays: toShipDays(r.ship_days),
    backorderLeadDays: r.backorder_lead_days == null ? null : Number(r.backorder_lead_days),
    position: Number(r.position),
  }
}

export async function listRules(): Promise<DeliveryRule[]> {
  const rows = await prisma.$queryRaw<Record<string, unknown>[]>`
    SELECT * FROM "ash_delivery_rules" ORDER BY "position" ASC, "created_at" ASC
  `
  return rows.map(mapRow)
}

// Request-scoped memo for the resolve path: the whole rule set is scanned per
// product, so a cart re-reads it once per request instead of once per line.
// Admin write paths use getRule/create/update/delete, never this.
export const listRulesCached = cache(listRules)

export async function getRule(id: string): Promise<DeliveryRule | null> {
  const rows = await prisma.$queryRaw<Record<string, unknown>[]>`
    SELECT * FROM "ash_delivery_rules" WHERE "id" = ${id} LIMIT 1
  `
  return rows[0] ? mapRow(rows[0]) : null
}

export type RuleInput = {
  scopeType: ScopeType
  scopeRef: string | null
  fulfilmentMode: FulfilmentMode
  cutoffTime: string
  dispatchLeadDays: number
  mtoLeadDays: number
  transitDays: number
  shipDays: number[]
  backorderLeadDays: number | null
  position?: number
}

export async function createRule(input: RuleInput): Promise<DeliveryRule> {
  const id = randomUUID()
  const scopeRef = input.scopeType === 'DEFAULT' ? null : input.scopeRef
  await prisma.$executeRaw`
    INSERT INTO "ash_delivery_rules" (
      "id", "scope_type", "scope_ref", "fulfilment_mode", "cutoff_time",
      "dispatch_lead_days", "mto_lead_days", "transit_days", "ship_days",
      "backorder_lead_days", "position", "created_at", "updated_at"
    ) VALUES (
      ${id}, ${input.scopeType}, ${scopeRef}, ${input.fulfilmentMode}, ${input.cutoffTime},
      ${input.dispatchLeadDays}, ${input.mtoLeadDays}, ${input.transitDays},
      ${JSON.stringify(toShipDays(input.shipDays))}::jsonb,
      ${input.backorderLeadDays}, ${input.position ?? 0}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    )
  `
  const row = await getRule(id)
  if (!row) throw new Error('Failed to create delivery rule')
  return row
}

export async function updateRule(id: string, patch: Partial<RuleInput>): Promise<void> {
  const sets: Prisma.Sql[] = []
  if (patch.scopeType !== undefined) sets.push(Prisma.sql`"scope_type" = ${patch.scopeType}`)
  if (patch.scopeRef !== undefined) sets.push(Prisma.sql`"scope_ref" = ${patch.scopeRef}`)
  if (patch.fulfilmentMode !== undefined) sets.push(Prisma.sql`"fulfilment_mode" = ${patch.fulfilmentMode}`)
  if (patch.cutoffTime !== undefined) sets.push(Prisma.sql`"cutoff_time" = ${patch.cutoffTime}`)
  if (patch.dispatchLeadDays !== undefined) sets.push(Prisma.sql`"dispatch_lead_days" = ${patch.dispatchLeadDays}`)
  if (patch.mtoLeadDays !== undefined) sets.push(Prisma.sql`"mto_lead_days" = ${patch.mtoLeadDays}`)
  if (patch.transitDays !== undefined) sets.push(Prisma.sql`"transit_days" = ${patch.transitDays}`)
  if (patch.shipDays !== undefined) sets.push(Prisma.sql`"ship_days" = ${JSON.stringify(toShipDays(patch.shipDays))}::jsonb`)
  if (patch.backorderLeadDays !== undefined) sets.push(Prisma.sql`"backorder_lead_days" = ${patch.backorderLeadDays}`)
  if (patch.position !== undefined) sets.push(Prisma.sql`"position" = ${patch.position}`)
  if (sets.length === 0) return
  sets.push(Prisma.sql`"updated_at" = CURRENT_TIMESTAMP`)
  await prisma.$executeRaw`UPDATE "ash_delivery_rules" SET ${Prisma.join(sets, ', ')} WHERE "id" = ${id}`
}

export async function deleteRule(id: string): Promise<void> {
  await prisma.$executeRaw`DELETE FROM "ash_delivery_rules" WHERE "id" = ${id}`
}
