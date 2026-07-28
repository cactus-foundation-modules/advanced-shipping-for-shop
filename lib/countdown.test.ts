import { describe, it, expect } from 'vitest'
import { formatCountdown, sharedCutoffInstant, type CutoffBearing } from '@/modules/advanced-shipping-for-shop/lib/countdown'

function item(cutoffInstantISO: string | null, patch: Partial<CutoffBearing> = {}): CutoffBearing {
  return { hasEstimate: true, available: true, cutoffInstantISO, ...patch }
}

const A = '2026-07-28T13:00:00.000Z'
const B = '2026-07-28T16:00:00.000Z'

describe('formatCountdown', () => {
  it('shows hours and minutes over an hour', () => {
    expect(formatCountdown((6 * 3600 + 12 * 60 + 30) * 1000)).toBe('6 hours and 12 minutes')
  })

  it('shows minutes and seconds under an hour', () => {
    expect(formatCountdown((12 * 60 + 48) * 1000)).toBe('12 minutes and 48 seconds')
  })

  it('shows seconds in the last minute, and never a negative figure', () => {
    expect(formatCountdown(48_000)).toBe('48 seconds')
    expect(formatCountdown(-5_000)).toBe('0 seconds')
  })

  it('drops the smaller half on a whole unit', () => {
    expect(formatCountdown(2 * 3600 * 1000)).toBe('2 hours')
    expect(formatCountdown(5 * 60 * 1000)).toBe('5 minutes')
  })

  it('says one hour, one minute, one second - not 1 hours', () => {
    expect(formatCountdown((3600 + 60) * 1000)).toBe('1 hour and 1 minute')
    expect(formatCountdown(61_000)).toBe('1 minute and 1 second')
    expect(formatCountdown(1_000)).toBe('1 second')
  })
})

describe('sharedCutoffInstant', () => {
  it('returns the instant when every line shares one', () => {
    expect(sharedCutoffInstant([item(A), item(A), item(A)])).toBe(A)
  })

  it('returns it for a single-line basket', () => {
    expect(sharedCutoffInstant([item(A)])).toBe(A)
  })

  it('returns null when two lines disagree', () => {
    expect(sharedCutoffInstant([item(A), item(B)])).toBeNull()
  })

  it('returns null when any line has no cut-off of its own', () => {
    expect(sharedCutoffInstant([item(A), item(null)])).toBeNull()
    expect(sharedCutoffInstant([item(null), item(A)])).toBeNull()
  })

  it('ignores lines with no estimate and unavailable lines', () => {
    expect(sharedCutoffInstant([item(A), item(B, { hasEstimate: false }), item(B, { available: false })])).toBe(A)
  })

  it('returns null for an empty basket, or one with nothing promising', () => {
    expect(sharedCutoffInstant([])).toBeNull()
    expect(sharedCutoffInstant([item(A, { available: false })])).toBeNull()
  })
})
