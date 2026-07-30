import { describe, expect, it } from 'vitest'
import { buildBasketOffers, formatOfferPrice } from '@/modules/advanced-shipping-for-shop/lib/basket-offers'
import type { ItemEstimate } from '@/modules/advanced-shipping-for-shop/lib/estimate-service'

const TODAY = '2026-08-03'

type TierSpec = { key: string; label: string; price: number | null; date: string | null }

function item(ref: string, chosen: string, tiers: TierSpec[], overrides: Partial<ItemEstimate> = {}): ItemEstimate {
  return {
    productId: `p-${ref}`,
    ref,
    name: `Product ${ref}`,
    hasEstimate: true,
    available: true,
    targetDate: tiers.find((t) => t.key === chosen)?.date ?? null,
    targetLabel: null,
    cutoffInstantISO: null,
    isBackorder: false,
    isPreOrder: false,
    tierKey: chosen,
    tiers: tiers.map((t) => ({
      key: t.key,
      label: t.label,
      description: null,
      price: String(t.price ?? 0),
      priceEffective: t.price,
      targetDate: t.date,
      targetLabel: t.date,
      targetByLabel: t.date,
    })),
    ...overrides,
  }
}

const STANDARD: TierSpec = { key: 'std', label: 'Standard delivery', price: 0, date: '2026-08-20' }
const FAST: TierSpec = { key: 'fast', label: 'Get it faster', price: 6.95, date: '2026-08-07' }
const BUILT: TierSpec = { key: 'built', label: 'Built or installed for you', price: 22.3, date: '2026-09-11' }

describe('buildBasketOffers', () => {
  it('offers nothing for a single-line basket - its own picker covers it', () => {
    expect(buildBasketOffers([item('a', 'std', [STANDARD, FAST])], TODAY)).toEqual([])
  })

  it('offers "sooner" across the basket, priced and dated', () => {
    const offers = buildBasketOffers([
      item('a', 'std', [STANDARD, FAST]),
      item('b', 'std', [STANDARD, FAST]),
    ], TODAY)
    const sooner = offers.find((o) => o.id === 'sooner')
    expect(sooner).toBeDefined()
    expect(sooner!.itemCount).toBe(2)
    expect(sooner!.extraCost).toBe(13.9)
    // Both lines move from 20 Aug to 7 Aug, so the LAST date is what improves.
    // Inside a week the date reads as a bare weekday, which is the whole point
    // of formatDeliveryByLabel - "Friday" beats "Friday 7th August" on a chip.
    expect(sooner!.detail).toBe('everything by Friday (was Thursday 20th of August)')
    expect(sooner!.changes).toEqual([{ ref: 'a', tierKey: 'fast' }, { ref: 'b', tierKey: 'fast' }])
  })

  it('reports the first arrival when only that moves', () => {
    const offers = buildBasketOffers([
      // This line can come sooner...
      item('a', 'std', [STANDARD, FAST]),
      // ...but this one is stuck on the late date either way, so the basket's
      // last arrival is unchanged and the offer must not claim otherwise.
      item('b', 'slow', [{ key: 'slow', label: 'Standard delivery', price: 0, date: '2026-08-20' }]),
    ], TODAY)
    const sooner = offers.find((o) => o.id === 'sooner')
    expect(sooner).toBeUndefined() // only one line moves, and "sooner" wants two
  })

  it('offers a named service that several lines share, and says it lands later', () => {
    const offers = buildBasketOffers([
      item('a', 'std', [STANDARD, BUILT]),
      item('b', 'std', [STANDARD, BUILT]),
      item('c', 'std', [STANDARD, BUILT]),
    ], TODAY)
    const built = offers.find((o) => o.id === 'tier:built')
    expect(built).toBeDefined()
    expect(built!.title).toBe('Built or installed for you')
    expect(built!.itemCount).toBe(3)
    expect(built!.extraCost).toBe(66.9)
    expect(built!.detail).toBe('everything by Friday 11th Sep (was Thursday 20th of August)')
  })

  it('does not offer a service the whole basket is already on', () => {
    const offers = buildBasketOffers([
      item('a', 'built', [STANDARD, BUILT]),
      item('b', 'built', [STANDARD, BUILT]),
    ], TODAY)
    expect(offers.find((o) => o.id === 'tier:built')).toBeUndefined()
  })

  it('refuses to move a line onto a service it cannot price', () => {
    const perPerson: TierSpec = { key: 'built', label: 'Built or installed for you', price: null, date: '2026-09-11' }
    const offers = buildBasketOffers([
      item('a', 'std', [STANDARD, perPerson]),
      item('b', 'std', [STANDARD, perPerson]),
    ], TODAY)
    // Neither line can be quoted, so there is no offer at all rather than one
    // whose total the checkout would then disagree with.
    expect(offers.find((o) => o.id === 'tier:built')).toBeUndefined()
  })

  it('skips a line whose current service cannot be priced', () => {
    const offers = buildBasketOffers([
      item('a', 'std', [{ ...STANDARD, price: null }, FAST]),
      item('b', 'std', [STANDARD, FAST]),
    ], TODAY)
    // Only line b has a baseline to compare against - one line is not a
    // whole-order offer.
    expect(offers).toEqual([])
  })

  it('ignores lines with no estimate or no basket row to write back to', () => {
    const noRef = item('x', 'std', [STANDARD, FAST])
    expect(buildBasketOffers([
      { ...noRef, ref: null },
      item('b', 'std', [STANDARD, FAST]),
    ], TODAY)).toEqual([])
  })

  it('shows an identical move once, not once per name', () => {
    // "Sooner" and the named "fast" service move exactly the same lines onto
    // exactly the same service, so only the first survives.
    const offers = buildBasketOffers([
      item('a', 'std', [STANDARD, FAST]),
      item('b', 'std', [STANDARD, FAST]),
    ], TODAY)
    expect(offers).toHaveLength(1)
    expect(offers[0]!.id).toBe('sooner')
  })
})

describe('formatOfferPrice', () => {
  it('words an addition, a saving and a free upgrade', () => {
    expect(formatOfferPrice(13.9, '£')).toBe('+£13.90')
    expect(formatOfferPrice(-4, '£')).toBe('£4.00 off')
    expect(formatOfferPrice(0, '£')).toBe('Included')
  })
})
