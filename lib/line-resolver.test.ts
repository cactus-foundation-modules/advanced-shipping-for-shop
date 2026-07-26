import { describe, it, expect } from 'vitest'
import { effectiveTierPrice } from '@/modules/advanced-shipping-for-shop/lib/line-resolver'
import type { ResolvedTierOption } from '@/modules/advanced-shipping-for-shop/lib/resolve'

function opt(price: string, perPerson: boolean): ResolvedTierOption {
  return {
    key: 'full-install',
    label: 'Full installation',
    price,
    available: true,
    perPerson,
    modifiers: { isNextDay: false, dispatchLeadDelta: 0, transitDelta: 0, minLeadDays: null },
  }
}

describe('effectiveTierPrice', () => {
  it('charges a flat tier once, ignoring the count', () => {
    expect(effectiveTierPrice(opt('50.00', false), 6)).toBe(50)
    expect(effectiveTierPrice(opt('50.00', false), null)).toBe(50)
  })

  it('multiplies a per-person tier by the count', () => {
    expect(effectiveTierPrice(opt('50.00', true), 6)).toBe(300)
    expect(effectiveTierPrice(opt('50.00', true), 2)).toBe(100)
    expect(effectiveTierPrice(opt('12.50', true), 4)).toBe(50)
  })

  it('rounds a per-person total to the penny', () => {
    expect(effectiveTierPrice(opt('9.99', true), 3)).toBe(29.97)
  })

  it('cannot price a per-person tier with no readable count (blocks the line)', () => {
    expect(effectiveTierPrice(opt('50.00', true), null)).toBeNull()
  })
})
