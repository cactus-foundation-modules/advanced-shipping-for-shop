import { describe, expect, it } from 'vitest'
import { mergeVariantDeliveries } from './merge-variant-deliveries'
import type { ProductDelivery, ResolveContext, ResolvedTierOption } from './resolve'
import type { AshSettings, StockState } from './types'

const IN_STOCK: StockState = {
  trackInventory: false, stockCount: null, outOfStockBehaviour: 'BLOCK',
  isPreOrder: false, preOrderDispatchDate: null,
}

const settings = {
  cutoffTime: '14:00',
  dispatchLeadDays: 1,
  shipDays: [1, 2, 3, 4, 5],
  rangeAttributeId: null,
  holidayRegion: 'none',
  holidaysSyncedAt: null,
  defaultTierKey: null,
  cartControlStyle: 'summary',
  showUnavailableServices: true,
} as unknown as AshSettings

const ctx: ResolveContext = {
  now: new Date('2026-09-14T09:00:00Z'),
  timezone: 'Europe/London',
  holidays: new Set<string>(),
} as unknown as ResolveContext

const tier = (key: string, price: string, transitDays = 3): ResolvedTierOption => ({
  key,
  label: key,
  description: null,
  price,
  available: true,
  modifiers: { transitDays, minLeadDays: null },
})

const child = (id: string, tiers: ResolvedTierOption[], stock: StockState = IN_STOCK): ProductDelivery =>
  ({ productId: id, stock, tiers })

describe('mergeVariantDeliveries', () => {
  it('is null when the listing has no variations to speak for it', () => {
    expect(mergeVariantDeliveries('listing', [], ctx, settings)).toBeNull()
  })

  it('is null when none of them is offered a service', () => {
    expect(mergeVariantDeliveries('listing', [child('a', [])], ctx, settings)).toBeNull()
  })

  it('offers every service the variations offer between them', () => {
    const merged = mergeVariantDeliveries('listing', [
      child('a', [tier('flat-pack', '0.00'), tier('express', '4.95')]),
      child('b', [tier('made-to-order', '0.00')]),
    ], ctx, settings)
    expect(merged?.tiers.map((t) => t.key)).toEqual(['flat-pack', 'express', 'made-to-order'])
  })

  it('takes the DEAREST price of a service, so a listing never undercuts the combination chosen', () => {
    const merged = mergeVariantDeliveries('listing', [
      child('cheap', [tier('installation', '17.95')]),
      child('dear', [tier('installation', '37.95')]),
    ], ctx, settings)
    expect(merged?.tiers.find((t) => t.key === 'installation')?.price).toBe('37.95')
  })

  it('answers for the listing it was asked about, not for a variation', () => {
    const merged = mergeVariantDeliveries('listing', [child('a', [tier('flat-pack', '0.00')])], ctx, settings)
    expect(merged?.productId).toBe('listing')
  })

  it('decides each service\'s stock per service, not once for the listing', () => {
    // The stand-in for a service is chosen among the variations that OFFER it.
    // A listing-wide stand-in would date express off a variation that does not
    // sell express, whose stock has nothing to say about when it would land.
    const backordered: StockState = { ...IN_STOCK, trackInventory: true, stockCount: 0, outOfStockBehaviour: 'BACKORDER' }
    const merged = mergeVariantDeliveries('listing', [
      child('stocked', [tier('flat-pack', '0.00'), tier('express', '4.95', 1)]),
      child('backordered', [tier('flat-pack', '0.00')], backordered),
    ], ctx, settings)
    // Only one variation sells express, so express answers with that one's stock.
    expect(merged?.stockByTier?.get('express')).toEqual(IN_STOCK)
    // Both sell flat-pack, so it answers with one of theirs - never with nothing.
    expect(merged?.stockByTier?.has('flat-pack')).toBe(true)
  })
})
