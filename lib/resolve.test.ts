import { describe, it, expect } from 'vitest'
import { pickMostSpecific, applyOverride, latestRule, ruleToResolved, parsePersonCount, tierAppliesToSupplier } from '@/modules/advanced-shipping-for-shop/lib/resolve'
import type { DeliveryRule, ProductOverride, ScopeType, StockState } from '@/modules/advanced-shipping-for-shop/lib/types'

function rule(scopeType: ScopeType, scopeRef: string | null, patch: Partial<DeliveryRule> = {}): DeliveryRule {
  return {
    id: `${scopeType}:${scopeRef ?? 'default'}`,
    scopeType,
    scopeRef,
    fulfilmentMode: 'STOCKED',
    cutoffTime: '12:00',
    dispatchLeadDays: 1,
    mtoLeadDays: 10,
    transitDays: 2,
    shipDays: [1, 2, 3, 4, 5],
    backorderLeadDays: null,
    position: 0,
    ...patch,
  }
}

const CTX = {
  rangeValueIds: ['val-1'],
  categoryChain: ['cat-self', 'cat-parent', 'cat-root'],
  supplier: 'Acme',
}

const IN_STOCK: StockState = {
  trackInventory: true,
  stockCount: 10,
  outOfStockBehaviour: 'BLOCK',
  isPreOrder: false,
  preOrderDispatchDate: null,
}

describe('pickMostSpecific', () => {
  const all = [
    rule('DEFAULT', null),
    rule('SUPPLIER', 'Acme'),
    rule('CATEGORY', 'cat-parent'),
    rule('CATEGORY', 'cat-self'),
    rule('RANGE', 'val-1'),
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
    const rows = [rule('DEFAULT', null), rule('SUPPLIER', 'Acme')]
    expect(pickMostSpecific(rows, CTX)[0]!.scopeType).toBe('SUPPLIER')
  })

  it('falls to default when nothing else matches', () => {
    const rows = [rule('DEFAULT', null), rule('SUPPLIER', 'Someone Else'), rule('CATEGORY', 'cat-x'), rule('RANGE', 'val-x')]
    expect(pickMostSpecific(rows, CTX)[0]!.scopeType).toBe('DEFAULT')
  })

  it('returns every equal-specificity match for a multi-value range', () => {
    const rows = [rule('RANGE', 'val-1'), rule('RANGE', 'val-2')]
    const ctx = { ...CTX, rangeValueIds: ['val-1', 'val-2'] }
    expect(pickMostSpecific(rows, ctx)).toHaveLength(2)
  })
})

describe('tierAppliesToSupplier', () => {
  it('offers a supplier-agnostic tier to every product', () => {
    expect(tierAppliesToSupplier({ supplier: null }, 'Acme')).toBe(true)
    expect(tierAppliesToSupplier({ supplier: null }, null)).toBe(true)
  })

  it('offers a supplier-bound tier only to its own supplier', () => {
    expect(tierAppliesToSupplier({ supplier: 'Acme' }, 'Acme')).toBe(true)
    expect(tierAppliesToSupplier({ supplier: 'Acme' }, 'Other')).toBe(false)
    expect(tierAppliesToSupplier({ supplier: 'Acme' }, null)).toBe(false)
  })
})

describe('applyOverride', () => {
  const base = ruleToResolved(rule('DEFAULT', null))

  it('patches only the non-null override fields', () => {
    const override: ProductOverride = {
      productId: 'p1',
      fulfilmentMode: null,
      mtoLeadDays: null,
      cutoffTime: '15:00',
      dispatchLeadDays: 5,
      transitDays: null,
      backorderLeadDays: null,
      disabled: false,
    }
    const patched = applyOverride(base, override)
    expect(patched.cutoffTime).toBe('15:00')
    expect(patched.dispatchLeadDays).toBe(5)
    expect(patched.transitDays).toBe(base.transitDays) // untouched
    expect(patched.fulfilmentMode).toBe('STOCKED')
  })

  it('returns the rule unchanged when there is no override', () => {
    expect(applyOverride(base, undefined)).toEqual(base)
  })
})

describe('latestRule', () => {
  it('picks the candidate that delivers latest (never over-promise)', () => {
    const quick = rule('RANGE', 'val-1', { transitDays: 2 })
    const slow = rule('RANGE', 'val-2', { transitDays: 10 })
    const ctx = { now: new Date('2026-07-24T09:00:00Z'), timezone: 'Europe/London', holidays: new Set<string>() }
    expect(latestRule([quick, slow], IN_STOCK, ctx).id).toBe(slow.id)
    expect(latestRule([slow, quick], IN_STOCK, ctx).id).toBe(slow.id)
  })
})

describe('parsePersonCount', () => {
  it('reads the first whole number from a value label', () => {
    expect(parsePersonCount('6 People')).toBe(6)
    expect(parsePersonCount('2 People')).toBe(2)
    expect(parsePersonCount('12 People')).toBe(12)
    expect(parsePersonCount('6')).toBe(6)
    expect(parsePersonCount('6-seat bench')).toBe(6)
    expect(parsePersonCount('Seats: 4')).toBe(4)
  })

  it('returns null when there is no positive number to read', () => {
    expect(parsePersonCount('Single')).toBeNull()
    expect(parsePersonCount('')).toBeNull()
    expect(parsePersonCount(null)).toBeNull()
    expect(parsePersonCount(undefined)).toBeNull()
    expect(parsePersonCount('0 People')).toBeNull()
  })
})
