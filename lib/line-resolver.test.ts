import { describe, it, expect } from 'vitest'
import { effectiveTierPrice, tierOptionSummary } from '@/modules/advanced-shipping-for-shop/lib/line-resolver'
import type { ResolvedTierOption } from '@/modules/advanced-shipping-for-shop/lib/resolve'

function opt(price: string, perPerson: boolean): ResolvedTierOption {
  return {
    key: 'full-install',
    label: 'Full installation',
    description: null,
    price,
    available: true,
    perPerson,
    modifiers: { transitDays: 0, minLeadDays: null },
  }
}

describe('effectiveTierPrice', () => {
  it('charges a flat service once, ignoring the count', () => {
    expect(effectiveTierPrice(opt('50.00', false), 6)).toBe(50)
    expect(effectiveTierPrice(opt('50.00', false), null)).toBe(50)
  })

  it('multiplies a per-person service by the count', () => {
    expect(effectiveTierPrice(opt('50.00', true), 6)).toBe(300)
    expect(effectiveTierPrice(opt('50.00', true), 2)).toBe(100)
    expect(effectiveTierPrice(opt('12.50', true), 4)).toBe(50)
  })

  it('rounds a per-person total to the penny', () => {
    expect(effectiveTierPrice(opt('9.99', true), 3)).toBe(29.97)
  })

  it('cannot price a per-person service with no readable count (blocks the line)', () => {
    expect(effectiveTierPrice(opt('50.00', true), null)).toBeNull()
  })
})

// The basket's summary presentation displays these strings verbatim - it never
// parses a label - so the split is the contract between the two modules.
describe('tierOptionSummary', () => {
  it('leads on the date and drops the service to a qualifier', () => {
    expect(tierOptionSummary('Flat-pack', 0, '£', 'Friday', 'Fri 8 Aug')).toEqual({
      headline: 'Arrives by Fri 8 Aug',
      secondary: 'Flat-pack',
      switchLabel: 'Flat-pack by Friday',
      priceLabel: 'Free',
    })
  })

  it('states a paid service as an addition', () => {
    expect(tierOptionSummary('Installed', 25.95, '£', 'Thu 13th', 'Thu 13 Aug').priceLabel).toBe('+£25.95')
  })

  it('falls back to the service name when there is no date to promise', () => {
    const s = tierOptionSummary('Installed', null, '£', null, null)
    expect(s.headline).toBe('Installed')
    expect(s.secondary).toBeUndefined()
    expect(s.switchLabel).toBe('Installed')
    expect(s.priceLabel).toBe('Per person')
  })
})
