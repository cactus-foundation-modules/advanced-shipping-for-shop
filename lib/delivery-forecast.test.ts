import { describe, expect, it } from 'vitest'
import { buildDeliveryForecast, type ForecastMember } from './delivery-forecast'
import type { ProductDelivery, ResolveContext, ResolvedTierOption } from './resolve'
import type { AshSettings, StockState } from './types'
import type { VariantOptionValue } from './variations-bridge'

const IN_STOCK: StockState = { trackInventory: false, stockCount: null, outOfStockBehaviour: 'BLOCK', isPreOrder: false, preOrderDispatchDate: null }
const OUT_OF_STOCK: StockState = { ...IN_STOCK, trackInventory: true, stockCount: 0 }

const settings = {
  cutoffTime: '14:00', dispatchLeadDays: 1, shipDays: [1, 2, 3, 4, 5], rangeAttributeId: null,
  holidayRegion: 'none', holidaysSyncedAt: null, defaultTierKey: null, cartControlStyle: 'summary', showUnavailableServices: true,
} as unknown as AshSettings

// Monday 14 September 2026, before the cut-off.
const ctx = { now: new Date('2026-09-14T09:00:00Z'), timezone: 'Europe/London', holidays: new Set<string>() } as unknown as ResolveContext

const tier = (key: string, price: string, transitDays: number): ResolvedTierOption => ({
  key, label: key, description: null, price, available: true, modifiers: { transitDays, minLeadDays: null },
})

const colour = (label: string, position: number): VariantOptionValue =>
  ({ optionId: 'colour', optionName: 'Colour', optionPosition: 0, valueId: label, valueLabel: label, valuePosition: position })

const member = (id: string, label: string, position: number, tiers: ResolvedTierOption[], stock: StockState = IN_STOCK): ForecastMember =>
  ({ id, delivery: { productId: id, stock, tiers } as ProductDelivery, values: [colour(label, position)] })

describe('buildDeliveryForecast', () => {
  const members = [
    member('blue', 'Blue', 0, [tier('express', '10.00', 1)]),
    member('black', 'Black', 1, [tier('express', '10.00', 1)]),
    member('red', 'Red', 2, [tier('express', '10.00', 1)]),
    member('green', 'Green', 3, [tier('express', '10.00', 2)]),
  ]

  it('groups variations that share a date, soonest first, naming the colours', () => {
    const forecast = buildDeliveryForecast('listing', members, true, ctx, settings)
    const groups = forecast.services[0]!.groups
    expect(groups).toHaveLength(2)
    expect(groups[0]).toMatchObject({ price: 10, count: 3, all: false, appliesTo: [{ option: 'Colour', values: ['Blue', 'Black', 'Red'] }] })
    expect(groups[1]).toMatchObject({ count: 1, appliesTo: [{ option: 'Colour', values: ['Green'] }] })
    expect(groups[0]!.date! < groups[1]!.date!).toBe(true)
    expect(groups[0]!.dateLabel).toMatch(/^\w+day \d+(st|nd|rd|th) of September$/)
  })

  it('is one group covering everything when the variations agree', () => {
    const forecast = buildDeliveryForecast('listing', members.slice(0, 3), true, ctx, settings)
    expect(forecast.services[0]!.groups).toHaveLength(1)
    expect(forecast.services[0]!.groups[0]).toMatchObject({ all: true, appliesTo: null, count: 3 })
  })

  it('splits the same date by price', () => {
    const forecast = buildDeliveryForecast('listing', [
      member('a', 'Blue', 0, [tier('express', '10.00', 1)]),
      member('b', 'Red', 1, [tier('express', '15.00', 1)]),
    ], true, ctx, settings)
    expect(forecast.services[0]!.groups.map((g) => g.price)).toEqual([10, 15])
  })

  it('reports the variations that do not offer a service', () => {
    const forecast = buildDeliveryForecast('listing', [
      member('a', 'Blue', 0, [tier('express', '10.00', 1), tier('standard', '0.00', 3)]),
      member('b', 'Red', 1, [tier('standard', '0.00', 3)]),
    ], true, ctx, settings)
    const express = forecast.services.find((s) => s.key === 'express')!
    expect(express.notOfferedOn).toMatchObject({ appliesTo: [{ option: 'Colour', values: ['Red'] }] })
    expect(forecast.services.find((s) => s.key === 'standard')!.notOfferedOn).toBeNull()
  })

  it('puts a variation that cannot promise a date last, without a date', () => {
    const forecast = buildDeliveryForecast('listing', [
      member('a', 'Blue', 0, [tier('express', '10.00', 1)]),
      member('b', 'Red', 1, [tier('express', '10.00', 1)], OUT_OF_STOCK),
    ], true, ctx, settings)
    const groups = forecast.services[0]!.groups
    expect(groups[1]).toMatchObject({ date: null, dateLabel: null })
  })

  it('lists combinations when a group is not a clean grid of values', () => {
    const two = (id: string, c: string, w: string, tiers: ResolvedTierOption[]): ForecastMember => ({
      id, delivery: { productId: id, stock: IN_STOCK, tiers } as ProductDelivery,
      values: [colour(c, c === 'Blue' ? 0 : 1), { optionId: 'w', optionName: 'Width', optionPosition: 1, valueId: w, valueLabel: w, valuePosition: w === '120cm' ? 0 : 1 }],
    })
    const forecast = buildDeliveryForecast('listing', [
      two('1', 'Blue', '120cm', [tier('express', '10.00', 1)]),
      two('2', 'Red', '160cm', [tier('express', '10.00', 1)]),
      two('3', 'Blue', '160cm', [tier('express', '10.00', 3)]),
      two('4', 'Red', '120cm', [tier('express', '10.00', 3)]),
    ], true, ctx, settings)
    expect(forecast.services[0]!.groups[0]).toMatchObject({ appliesTo: null, combinations: ['Blue / 120cm', 'Red / 160cm'] })
  })
})
