import { describe, it, expect } from 'vitest'
import { computeEstimate } from '@/modules/advanced-shipping-for-shop/lib/estimate'
import type { ResolvedRule, ResolvedTier, StockState } from '@/modules/advanced-shipping-for-shop/lib/types'

const TZ = 'Europe/London'
const NO_HOLIDAYS = new Set<string>()

const STOCKED: ResolvedRule = {
  fulfilmentMode: 'STOCKED',
  cutoffTime: '12:00',
  dispatchLeadDays: 1,
  mtoLeadDays: 10,
  transitDays: 2,
  shipDays: [1, 2, 3, 4, 5],
  backorderLeadDays: null,
}

const IN_STOCK: StockState = {
  trackInventory: true,
  stockCount: 25,
  outOfStockBehaviour: 'BLOCK',
  isPreOrder: false,
  preOrderDispatchDate: null,
}

const UNTRACKED: StockState = { ...IN_STOCK, trackInventory: false, stockCount: null }

function tier(patch: Partial<ResolvedTier>): ResolvedTier {
  return { dispatchLeadDelta: 0, transitDelta: 0, minLeadDays: null, ...patch }
}

describe('computeEstimate - stocked, cut-off', () => {
  it('dispatches today when ordered before the cut-off', () => {
    // Fri 24 Jul, 10:00 BST (09:00 UTC), before the 12:00 cut-off.
    const e = computeEstimate({ now: new Date('2026-07-24T09:00:00Z'), timezone: TZ, holidays: NO_HOLIDAYS, rule: STOCKED, stock: IN_STOCK })
    expect(e.available).toBe(true)
    expect(e.dispatchDate).toBe('2026-07-27') // Fri +1 working day -> Mon
    expect(e.targetDate).toBe('2026-07-29') // +2 transit -> Wed
    expect(e.cutoffInstantISO).toBe('2026-07-24T11:00:00.000Z')
  })

  it('rolls to the next working day when ordered after the cut-off', () => {
    // Fri 24 Jul, 13:00 BST (12:00 UTC), after the 11:00 UTC cut-off.
    const e = computeEstimate({ now: new Date('2026-07-24T12:00:00Z'), timezone: TZ, holidays: NO_HOLIDAYS, rule: STOCKED, stock: IN_STOCK })
    expect(e.dispatchDate).toBe('2026-07-28') // clears Mon, +1 -> Tue
    expect(e.targetDate).toBe('2026-07-30') // +2 transit -> Thu
    expect(e.cutoffInstantISO).toBe('2026-07-27T11:00:00.000Z') // countdown now targets Monday's cut-off
  })

  it('rolls over the weekend', () => {
    // Sat 25 Jul: not a working day, so the order clears Monday.
    const e = computeEstimate({ now: new Date('2026-07-25T09:00:00Z'), timezone: TZ, holidays: NO_HOLIDAYS, rule: STOCKED, stock: IN_STOCK })
    expect(e.dispatchDate).toBe('2026-07-28')
    expect(e.targetDate).toBe('2026-07-30')
  })

  it('skips a bank holiday', () => {
    const e = computeEstimate({ now: new Date('2026-07-24T09:00:00Z'), timezone: TZ, holidays: new Set(['2026-07-27']), rule: STOCKED, stock: IN_STOCK })
    expect(e.dispatchDate).toBe('2026-07-28') // Mon 27th is a holiday, dispatch Tue
    expect(e.targetDate).toBe('2026-07-30')
  })

  it('honours a Mon/Wed ship-days subset', () => {
    const rule: ResolvedRule = { ...STOCKED, shipDays: [1, 3] }
    const e = computeEstimate({ now: new Date('2026-07-24T09:00:00Z'), timezone: TZ, holidays: NO_HOLIDAYS, rule, stock: IN_STOCK })
    // Fri not a ship day -> clears Mon 27; +1 ship -> Wed 29; +2 transit -> Mon 3, Wed 5.
    expect(e.dispatchDate).toBe('2026-07-29')
    expect(e.targetDate).toBe('2026-08-05')
  })

  it('resolves the cut-off in GMT out of British Summer Time', () => {
    // Thu 15 Jan, 11:30 UTC, before the 12:00 GMT cut-off.
    const e = computeEstimate({ now: new Date('2026-01-15T11:30:00Z'), timezone: TZ, holidays: NO_HOLIDAYS, rule: STOCKED, stock: IN_STOCK })
    expect(e.cutoffInstantISO).toBe('2026-01-15T12:00:00.000Z')
  })
})

describe('computeEstimate - made to order', () => {
  it('ignores the cut-off and counts lead + transit', () => {
    const rule: ResolvedRule = { ...STOCKED, fulfilmentMode: 'MADE_TO_ORDER', mtoLeadDays: 10, transitDays: 3 }
    const e = computeEstimate({ now: new Date('2026-07-24T09:00:00Z'), timezone: TZ, holidays: NO_HOLIDAYS, rule, stock: UNTRACKED })
    expect(e.isMadeToOrder).toBe(true)
    expect(e.cutoffInstantISO).toBeNull()
    expect(e.dispatchDate).toBe('2026-08-07') // 10 working days on from Fri
    expect(e.targetDate).toBe('2026-08-12') // +3 transit
  })
})

describe('computeEstimate - stock behaviour', () => {
  it('adds the restock lead on a backorder', () => {
    const rule: ResolvedRule = { ...STOCKED, backorderLeadDays: 5 }
    const stock: StockState = { ...IN_STOCK, stockCount: 0, outOfStockBehaviour: 'BACKORDER' }
    const e = computeEstimate({ now: new Date('2026-07-24T09:00:00Z'), timezone: TZ, holidays: NO_HOLIDAYS, rule, stock })
    expect(e.isBackorder).toBe(true)
    expect(e.dispatchDate).toBe('2026-08-03') // dispatch lead 1 + restock 5 = 6 working days
    expect(e.targetDate).toBe('2026-08-05')
  })

  it('is unavailable when out of stock and set to block', () => {
    const stock: StockState = { ...IN_STOCK, stockCount: 0, outOfStockBehaviour: 'BLOCK' }
    const e = computeEstimate({ now: new Date('2026-07-24T09:00:00Z'), timezone: TZ, holidays: NO_HOLIDAYS, rule: STOCKED, stock })
    expect(e.available).toBe(false)
    expect(e.targetDate).toBeNull()
    expect(e.reason).toBe('Out of stock')
  })

  it('dispatches on the pre-order date', () => {
    const stock: StockState = { ...UNTRACKED, isPreOrder: true, preOrderDispatchDate: '2026-09-01' }
    const e = computeEstimate({ now: new Date('2026-07-24T09:00:00Z'), timezone: TZ, holidays: NO_HOLIDAYS, rule: STOCKED, stock })
    expect(e.isPreOrder).toBe(true)
    expect(e.dispatchDate).toBe('2026-09-01') // Tuesday, a working day
    expect(e.targetDate).toBe('2026-09-03') // +2 transit
    expect(e.cutoffInstantISO).toBeNull()
  })
})

describe('computeEstimate - tier modifiers', () => {
  it('ships on the clearing day when the delta cancels the rule lead', () => {
    const rule: ResolvedRule = { ...STOCKED, dispatchLeadDays: 3 }
    const e = computeEstimate({ now: new Date('2026-07-24T09:00:00Z'), timezone: TZ, holidays: NO_HOLIDAYS, rule, stock: IN_STOCK, tier: tier({ dispatchLeadDelta: -3 }) })
    expect(e.dispatchDate).toBe('2026-07-24') // clears and ships the same day
    expect(e.targetDate).toBe('2026-07-28') // +2 transit
  })

  it('adds a dispatch-lead delta', () => {
    const e = computeEstimate({ now: new Date('2026-07-24T09:00:00Z'), timezone: TZ, holidays: NO_HOLIDAYS, rule: STOCKED, stock: IN_STOCK, tier: tier({ dispatchLeadDelta: 2 }) })
    expect(e.dispatchDate).toBe('2026-07-29') // lead 1 + 2 = 3 working days
    expect(e.targetDate).toBe('2026-07-31')
  })

  it('floors the estimate at the tier minimum (full installation)', () => {
    const e = computeEstimate({ now: new Date('2026-07-24T09:00:00Z'), timezone: TZ, holidays: NO_HOLIDAYS, rule: STOCKED, stock: IN_STOCK, tier: tier({ minLeadDays: 10 }) })
    // The plain estimate would be Wed 29 Jul; the floor pushes it to 10 working days out.
    expect(e.targetDate).toBe('2026-08-07')
  })
})
