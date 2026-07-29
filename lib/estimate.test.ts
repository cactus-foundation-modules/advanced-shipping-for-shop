import { describe, it, expect } from 'vitest'
import { computeEstimate } from '@/modules/advanced-shipping-for-shop/lib/estimate'
import type { DispatchTiming, ResolvedTier, StockState } from '@/modules/advanced-shipping-for-shop/lib/types'

const TZ = 'Europe/London'
const NO_HOLIDAYS = new Set<string>()

const TIMING: DispatchTiming = {
  cutoffTime: '12:00',
  dispatchLeadDays: 1,
  shipDays: [1, 2, 3, 4, 5],
}

const IN_STOCK: StockState = {
  trackInventory: true,
  stockCount: 25,
  outOfStockBehaviour: 'BLOCK',
  isPreOrder: false,
  preOrderDispatchDate: null,
}

const UNTRACKED: StockState = { ...IN_STOCK, trackInventory: false, stockCount: null }

function tier(patch: Partial<ResolvedTier> = {}): ResolvedTier {
  return { transitDays: 2, minLeadDays: null, ...patch }
}

describe('computeEstimate - cut-off', () => {
  it('dispatches today when ordered before the cut-off', () => {
    // Fri 24 Jul, 10:00 BST (09:00 UTC), before the 12:00 cut-off.
    const e = computeEstimate({ now: new Date('2026-07-24T09:00:00Z'), timezone: TZ, holidays: NO_HOLIDAYS, timing: TIMING, tier: tier(), stock: IN_STOCK })
    expect(e.available).toBe(true)
    expect(e.dispatchDate).toBe('2026-07-27') // Fri +1 working day -> Mon
    expect(e.targetDate).toBe('2026-07-29') // +2 transit -> Wed
    expect(e.cutoffInstantISO).toBe('2026-07-24T11:00:00.000Z')
  })

  it('rolls to the next working day when ordered after the cut-off', () => {
    // Fri 24 Jul, 13:00 BST (12:00 UTC), after the 11:00 UTC cut-off.
    const e = computeEstimate({ now: new Date('2026-07-24T12:00:00Z'), timezone: TZ, holidays: NO_HOLIDAYS, timing: TIMING, tier: tier(), stock: IN_STOCK })
    expect(e.dispatchDate).toBe('2026-07-28') // clears Mon, +1 -> Tue
    expect(e.targetDate).toBe('2026-07-30') // +2 transit -> Thu
    expect(e.cutoffInstantISO).toBe('2026-07-27T11:00:00.000Z') // countdown now targets Monday's cut-off
  })

  it('rolls over the weekend', () => {
    // Sat 25 Jul: not a working day, so the order clears Monday.
    const e = computeEstimate({ now: new Date('2026-07-25T09:00:00Z'), timezone: TZ, holidays: NO_HOLIDAYS, timing: TIMING, tier: tier(), stock: IN_STOCK })
    expect(e.dispatchDate).toBe('2026-07-28')
    expect(e.targetDate).toBe('2026-07-30')
  })

  it('skips a bank holiday', () => {
    const e = computeEstimate({ now: new Date('2026-07-24T09:00:00Z'), timezone: TZ, holidays: new Set(['2026-07-27']), timing: TIMING, tier: tier(), stock: IN_STOCK })
    expect(e.dispatchDate).toBe('2026-07-28') // Mon 27th is a holiday, dispatch Tue
    expect(e.targetDate).toBe('2026-07-30')
  })

  it('honours a Mon/Wed ship-days subset', () => {
    const timing: DispatchTiming = { ...TIMING, shipDays: [1, 3] }
    const e = computeEstimate({ now: new Date('2026-07-24T09:00:00Z'), timezone: TZ, holidays: NO_HOLIDAYS, timing, tier: tier(), stock: IN_STOCK })
    // Fri not a ship day -> clears Mon 27; +1 ship -> Wed 29; +2 transit -> Mon 3, Wed 5.
    expect(e.dispatchDate).toBe('2026-07-29')
    expect(e.targetDate).toBe('2026-08-05')
  })

  it('resolves the cut-off in GMT out of British Summer Time', () => {
    // Thu 15 Jan, 11:30 UTC, before the 12:00 GMT cut-off.
    const e = computeEstimate({ now: new Date('2026-01-15T11:30:00Z'), timezone: TZ, holidays: NO_HOLIDAYS, timing: TIMING, tier: tier(), stock: IN_STOCK })
    expect(e.cutoffInstantISO).toBe('2026-01-15T12:00:00.000Z')
  })

  it('ships on the clearing day itself when the dispatch lead is 0', () => {
    const timing: DispatchTiming = { ...TIMING, dispatchLeadDays: 0 }
    const e = computeEstimate({ now: new Date('2026-07-24T09:00:00Z'), timezone: TZ, holidays: NO_HOLIDAYS, timing, tier: tier(), stock: IN_STOCK })
    expect(e.dispatchDate).toBe('2026-07-24') // clears and ships the same day
    expect(e.targetDate).toBe('2026-07-28') // +2 transit
  })
})

describe('computeEstimate - stock behaviour', () => {
  it('is unavailable when out of stock and set to block', () => {
    const stock: StockState = { ...IN_STOCK, stockCount: 0, outOfStockBehaviour: 'BLOCK' }
    const e = computeEstimate({ now: new Date('2026-07-24T09:00:00Z'), timezone: TZ, holidays: NO_HOLIDAYS, timing: TIMING, tier: tier(), stock })
    expect(e.available).toBe(false)
    expect(e.targetDate).toBeNull()
    expect(e.reason).toBe('Out of stock')
  })

  it('still promises a date on a backorderable line, flagged as backorder', () => {
    const stock: StockState = { ...IN_STOCK, stockCount: 0, outOfStockBehaviour: 'BACKORDER' }
    const e = computeEstimate({ now: new Date('2026-07-24T09:00:00Z'), timezone: TZ, holidays: NO_HOLIDAYS, timing: TIMING, tier: tier(), stock })
    expect(e.available).toBe(true)
    expect(e.isBackorder).toBe(true)
    expect(e.targetDate).toBe('2026-07-29')
  })

  it('dispatches on the pre-order date', () => {
    const stock: StockState = { ...UNTRACKED, isPreOrder: true, preOrderDispatchDate: '2026-09-01' }
    const e = computeEstimate({ now: new Date('2026-07-24T09:00:00Z'), timezone: TZ, holidays: NO_HOLIDAYS, timing: TIMING, tier: tier(), stock })
    expect(e.isPreOrder).toBe(true)
    expect(e.dispatchDate).toBe('2026-09-01') // Tuesday, a working day
    expect(e.targetDate).toBe('2026-09-03') // +2 transit
    expect(e.cutoffInstantISO).toBeNull()
  })
})

describe('computeEstimate - service timing', () => {
  it('delivers on the dispatch day itself with zero transit', () => {
    const e = computeEstimate({ now: new Date('2026-07-24T09:00:00Z'), timezone: TZ, holidays: NO_HOLIDAYS, timing: TIMING, tier: tier({ transitDays: 0 }), stock: IN_STOCK })
    expect(e.dispatchDate).toBe('2026-07-27')
    expect(e.targetDate).toBe('2026-07-27')
  })

  it('counts a long transit in working days (made-to-order ranges)', () => {
    const e = computeEstimate({ now: new Date('2026-07-24T09:00:00Z'), timezone: TZ, holidays: NO_HOLIDAYS, timing: TIMING, tier: tier({ transitDays: 10 }), stock: UNTRACKED })
    expect(e.dispatchDate).toBe('2026-07-27')
    expect(e.targetDate).toBe('2026-08-10') // Mon + 10 working days
  })

  it('floors the estimate at the service minimum (full installation)', () => {
    const e = computeEstimate({ now: new Date('2026-07-24T09:00:00Z'), timezone: TZ, holidays: NO_HOLIDAYS, timing: TIMING, tier: tier({ minLeadDays: 10 }), stock: IN_STOCK })
    // The plain estimate would be Wed 29 Jul; the floor pushes it to 10 working days out.
    expect(e.targetDate).toBe('2026-08-07')
  })

  it('never lets the floor bring an estimate in', () => {
    const e = computeEstimate({ now: new Date('2026-07-24T09:00:00Z'), timezone: TZ, holidays: NO_HOLIDAYS, timing: TIMING, tier: tier({ transitDays: 20, minLeadDays: 5 }), stock: IN_STOCK })
    expect(e.targetDate).toBe('2026-08-24') // the real timing, not the smaller floor
  })
})
