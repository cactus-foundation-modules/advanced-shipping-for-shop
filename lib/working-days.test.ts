import { describe, it, expect } from 'vitest'
import {
  addCalendarDays,
  addWorkingDays,
  cutoffInstant,
  formatDeliveryDate,
  isWorkingDay,
  nextWorkingDay,
  todayInZone,
  weekdayOf,
} from '@/modules/advanced-shipping-for-shop/lib/working-days'

const MON_FRI = [1, 2, 3, 4, 5]
const NONE = new Set<string>()

describe('weekdayOf', () => {
  it('reads the calendar weekday (0=Sun)', () => {
    expect(weekdayOf('2026-07-24')).toBe(5) // Friday
    expect(weekdayOf('2026-07-25')).toBe(6) // Saturday
    expect(weekdayOf('2026-07-26')).toBe(0) // Sunday
    expect(weekdayOf('2026-07-27')).toBe(1) // Monday
  })
})

describe('addCalendarDays', () => {
  it('crosses a month boundary', () => {
    expect(addCalendarDays('2026-07-31', 1)).toBe('2026-08-01')
    expect(addCalendarDays('2026-01-01', -1)).toBe('2025-12-31')
  })
})

describe('isWorkingDay', () => {
  it('is false on weekends and holidays', () => {
    expect(isWorkingDay('2026-07-24', NONE, MON_FRI)).toBe(true)
    expect(isWorkingDay('2026-07-25', NONE, MON_FRI)).toBe(false) // Saturday
    expect(isWorkingDay('2026-07-27', new Set(['2026-07-27']), MON_FRI)).toBe(false) // holiday
  })
  it('honours a ship-days subset', () => {
    // Ships Mon and Wed only.
    expect(isWorkingDay('2026-07-27', NONE, [1, 3])).toBe(true) // Monday
    expect(isWorkingDay('2026-07-28', NONE, [1, 3])).toBe(false) // Tuesday - not a ship day
    expect(isWorkingDay('2026-07-29', NONE, [1, 3])).toBe(true) // Wednesday
  })
})

describe('nextWorkingDay', () => {
  it('returns the day unchanged when already a working day', () => {
    expect(nextWorkingDay('2026-07-24', NONE, MON_FRI)).toBe('2026-07-24')
  })
  it('rolls a weekend forward to Monday', () => {
    expect(nextWorkingDay('2026-07-25', NONE, MON_FRI)).toBe('2026-07-27')
  })
  it('skips a holiday', () => {
    expect(nextWorkingDay('2026-07-27', new Set(['2026-07-27']), MON_FRI)).toBe('2026-07-28')
  })
})

describe('addWorkingDays', () => {
  it('returns the same date for n=0', () => {
    expect(addWorkingDays('2026-07-24', 0, NONE, MON_FRI)).toBe('2026-07-24')
  })
  it('steps over the weekend', () => {
    expect(addWorkingDays('2026-07-24', 1, NONE, MON_FRI)).toBe('2026-07-27') // Fri +1 -> Mon
    expect(addWorkingDays('2026-07-24', 3, NONE, MON_FRI)).toBe('2026-07-29') // Fri +3 -> Wed
  })
  it('steps over a holiday', () => {
    expect(addWorkingDays('2026-07-24', 1, new Set(['2026-07-27']), MON_FRI)).toBe('2026-07-28')
  })
  it('honours a Mon/Wed ship-days subset', () => {
    expect(addWorkingDays('2026-07-24', 1, NONE, [1, 3])).toBe('2026-07-27') // -> Mon
    expect(addWorkingDays('2026-07-24', 2, NONE, [1, 3])).toBe('2026-07-29') // -> Wed
    expect(addWorkingDays('2026-07-29', 2, NONE, [1, 3])).toBe('2026-08-05') // Wed +2 -> Mon, Wed
  })
})

describe('cutoffInstant', () => {
  it('resolves a London wall-clock cut-off in British Summer Time', () => {
    // Late July is BST (UTC+1), so 12:00 London is 11:00 UTC.
    expect(cutoffInstant('2026-07-24', '12:00', 'Europe/London').toISOString()).toBe('2026-07-24T11:00:00.000Z')
  })
  it('resolves the same cut-off in GMT', () => {
    // Mid January is GMT (UTC+0), so 12:00 London is 12:00 UTC.
    expect(cutoffInstant('2026-01-15', '12:00', 'Europe/London').toISOString()).toBe('2026-01-15T12:00:00.000Z')
  })
})

describe('todayInZone', () => {
  it('reads the calendar date in the zone', () => {
    // 23:30 UTC on 24 Jul is already 00:30 on the 25th in London (BST).
    expect(todayInZone(new Date('2026-07-24T23:30:00Z'), 'Europe/London')).toBe('2026-07-25')
  })
})

describe('formatDeliveryDate', () => {
  it('formats as "Wed 29 Jul"', () => {
    expect(formatDeliveryDate('2026-07-29')).toBe('Wed 29 Jul')
    expect(formatDeliveryDate('2026-08-01')).toBe('Sat 1 Aug')
  })
})
