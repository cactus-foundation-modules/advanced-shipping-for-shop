import { describe, it, expect } from 'vitest'
import { pickMostSpecific, latestConfig, tierModifiers } from '@/modules/advanced-shipping-for-shop/lib/resolve'
import type { ScopeType, ServiceTier, TierScopeConfig } from '@/modules/advanced-shipping-for-shop/lib/types'

function config(scopeType: ScopeType, scopeRef: string | null, patch: Partial<TierScopeConfig> = {}): TierScopeConfig {
  return {
    id: `${scopeType}:${scopeRef ?? 'default'}`,
    tierId: 't1',
    scopeType,
    scopeRef,
    available: true,
    price: '0.00',
    transitDays: null,
    minLeadDays: null,
    ...patch,
  }
}

const TIER: ServiceTier = {
  id: 't1', key: 'standard', label: 'Standard delivery', description: null, position: 0,
  transitDays: 5, minLeadDays: null,
}

const CTX = {
  rangeValueIds: ['val-1'],
  categoryChain: ['cat-self', 'cat-parent', 'cat-root'],
  supplier: 'Acme',
}

describe('pickMostSpecific', () => {
  const all = [
    config('DEFAULT', null),
    config('SUPPLIER', 'Acme'),
    config('CATEGORY', 'cat-parent'),
    config('CATEGORY', 'cat-self'),
    config('RANGE', 'val-1'),
  ]

  it('range beats category beats supplier beats default', () => {
    expect(pickMostSpecific(all, CTX)[0]!.scopeType).toBe('RANGE')
  })

  it('falls to nearest category when no range matches', () => {
    const noRange = all.filter((r) => r.scopeType !== 'RANGE')
    const picked = pickMostSpecific(noRange, CTX)
    expect(picked).toHaveLength(1)
    expect(picked[0]!.scopeRef).toBe('cat-self') // nearest ancestor, not the parent
  })

  it('falls to supplier when no range or category matches', () => {
    const rows = [config('DEFAULT', null), config('SUPPLIER', 'Acme')]
    expect(pickMostSpecific(rows, CTX)[0]!.scopeType).toBe('SUPPLIER')
  })

  it('falls to default when nothing else matches', () => {
    const rows = [config('DEFAULT', null), config('SUPPLIER', 'Someone Else'), config('CATEGORY', 'cat-x'), config('RANGE', 'val-x')]
    expect(pickMostSpecific(rows, CTX)[0]!.scopeType).toBe('DEFAULT')
  })

  it('matches nothing when no row applies (the service is simply not offered)', () => {
    const rows = [config('SUPPLIER', 'Someone Else'), config('RANGE', 'val-x')]
    expect(pickMostSpecific(rows, CTX)).toHaveLength(0)
  })

  it('returns every equal-specificity match for a multi-value range', () => {
    const rows = [config('RANGE', 'val-1'), config('RANGE', 'val-2')]
    const ctx = { ...CTX, rangeValueIds: ['val-1', 'val-2'] }
    expect(pickMostSpecific(rows, ctx)).toHaveLength(2)
  })
})

describe('latestConfig', () => {
  it('picks the candidate that delivers latest (never over-promise)', () => {
    const quick = config('RANGE', 'val-1', { transitDays: 2 })
    const slow = config('RANGE', 'val-2', { transitDays: 10 })
    expect(latestConfig(TIER, [quick, slow]).id).toBe(slow.id)
    expect(latestConfig(TIER, [slow, quick]).id).toBe(slow.id)
  })

  it('treats an inherited transit as the service default', () => {
    const inherits = config('RANGE', 'val-1') // inherits 5 from the service
    const slower = config('RANGE', 'val-2', { transitDays: 7 })
    expect(latestConfig(TIER, [inherits, slower]).id).toBe(slower.id)
    const quicker = config('RANGE', 'val-3', { transitDays: 3 })
    expect(latestConfig(TIER, [inherits, quicker]).id).toBe(inherits.id)
  })

  it('breaks a transit tie on the larger minimum floor', () => {
    const noFloor = config('RANGE', 'val-1')
    const floored = config('RANGE', 'val-2', { minLeadDays: 10 })
    expect(latestConfig(TIER, [noFloor, floored]).id).toBe(floored.id)
  })
})

describe('tierModifiers', () => {
  const tier: ServiceTier = { ...TIER, key: 'installation', label: 'Installation', transitDays: 10, minLeadDays: 5 }

  it('uses the service timing when the scope overrides nothing', () => {
    expect(tierModifiers(tier, config('RANGE', 'val-1'))).toEqual({ transitDays: 10, minLeadDays: 5 })
  })

  it('uses the service timing when there is no scope config at all', () => {
    expect(tierModifiers(tier)).toEqual({ transitDays: 10, minLeadDays: 5 })
  })

  it('patches only the non-null scope fields', () => {
    expect(tierModifiers(tier, config('RANGE', 'val-1', { transitDays: 30 }))).toEqual({ transitDays: 30, minLeadDays: 5 })
  })

  it('a scope can lift the service minimum with an explicit 0', () => {
    expect(tierModifiers(tier, config('RANGE', 'val-1', { minLeadDays: 0 })).minLeadDays).toBe(0)
  })

  it('a scope can set a zero transit with an explicit 0', () => {
    expect(tierModifiers(tier, config('RANGE', 'val-1', { transitDays: 0 })).transitDays).toBe(0)
  })
})
