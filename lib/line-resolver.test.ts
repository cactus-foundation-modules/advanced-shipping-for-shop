import { describe, it, expect } from 'vitest'
import { effectiveTierPrice, tierOptionSummary } from '@/modules/advanced-shipping-for-shop/lib/line-resolver'
import type { ResolvedTierOption } from '@/modules/advanced-shipping-for-shop/lib/resolve'

function opt(price: string): ResolvedTierOption {
  return {
    key: 'full-install',
    label: 'Full installation',
    description: null,
    price,
    available: true,
    modifiers: { transitDays: 0, minLeadDays: null },
  }
}

describe('effectiveTierPrice', () => {
  it('charges the service price once per line', () => {
    expect(effectiveTierPrice(opt('50.00'))).toBe(50)
    expect(effectiveTierPrice(opt('12.50'))).toBe(12.5)
  })

  it('reads a free service as zero, and unreadable text as zero too', () => {
    expect(effectiveTierPrice(opt('0.00'))).toBe(0)
    expect(effectiveTierPrice(opt(''))).toBe(0)
  })

  it('rounds to the penny', () => {
    expect(effectiveTierPrice(opt('9.994'))).toBe(9.99)
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
    const s = tierOptionSummary('Installed', 25.95, '£', null, null)
    expect(s.headline).toBe('Installed')
    expect(s.secondary).toBeUndefined()
    expect(s.switchLabel).toBe('Installed')
    expect(s.priceLabel).toBe('+£25.95')
  })
})
