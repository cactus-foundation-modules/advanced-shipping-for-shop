import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { AshSettings, ServiceTier, TierScopeConfig } from '@/modules/advanced-shipping-for-shop/lib/types'
import type { ProductScopeFacts } from '@/modules/advanced-shipping-for-shop/lib/resolve'

// The catalogue is a read of six things and a shape. Every one of those reads
// is stubbed here, because what is worth testing is the shape - the scope ids,
// the naming, the ordering and, above all, that the scope a product is put in
// is the one the basket's own resolver would put it in.
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }))

const settings = vi.hoisted(() => ({ value: {} as AshSettings }))
const tiers = vi.hoisted(() => ({ value: [] as ServiceTier[] }))
const config = vi.hoisted(() => ({ value: [] as TierScopeConfig[] }))
const facts = vi.hoisted(() => ({ value: new Map<string, ProductScopeFacts>() }))

vi.mock('@/modules/advanced-shipping-for-shop/lib/db/settings', () => ({
  getSettingsCached: async () => settings.value,
}))
vi.mock('@/modules/advanced-shipping-for-shop/lib/db/tiers', () => ({
  listTiersCached: async () => tiers.value,
  listTierConfigCached: async () => config.value,
}))
vi.mock('@/modules/advanced-shipping-for-shop/lib/db/holidays', () => ({
  listHolidays: async () => [{ date: '2026-12-25', name: 'Christmas Day' }],
}))
vi.mock('@/modules/advanced-shipping-for-shop/lib/context', () => ({
  getShopTimezone: async () => 'Europe/London',
}))
vi.mock('@/modules/shop/lib/db/catalogue', () => ({
  listCategories: async () => [
    { id: 'cat-chairs', name: 'Office chairs', parentId: null },
    { id: 'cat-desks', name: 'Desks', parentId: null },
  ],
}))
vi.mock('@/modules/product-attributes-for-shop/lib/db/attributes', () => ({
  listAttributes: async () => [
    { id: 'attr-range', name: 'Range', values: [{ id: 'val-orion', label: 'Orion' }, { id: 'val-vega', label: 'Vega' }] },
  ],
}))
// Only the one function is stubbed; pickMostSpecific and SCOPE_SPECIFICITY stay
// real, because they ARE the thing under test.
vi.mock('@/modules/advanced-shipping-for-shop/lib/resolve', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/modules/advanced-shipping-for-shop/lib/resolve')>()),
  resolveProductScopeFacts: async () => facts.value,
}))

const {
  DEFAULT_SCOPE_ID,
  buildDeliveryCatalogue,
  deliveryScopeId,
  resolveProductDeliveryScopes,
} = await import('@/modules/advanced-shipping-for-shop/lib/delivery-catalogue')

function tier(id: string, key: string, label: string, extra: Partial<ServiceTier> = {}): ServiceTier {
  return { id, key, label, description: null, position: 0, transitDays: 2, minLeadDays: null, ...extra }
}

function scopeConfig(tierId: string, scopeType: TierScopeConfig['scopeType'], scopeRef: string | null, price: string, extra: Partial<TierScopeConfig> = {}): TierScopeConfig {
  return { id: `${tierId}-${scopeRef ?? 'default'}`, tierId, scopeType, scopeRef, available: true, price, transitDays: null, minLeadDays: null, ...extra }
}

function ctx(rangeValueIds: string[], categoryChain: string[], supplier: string | null): ProductScopeFacts {
  return {
    row: {
      id: 'p1', supplier, master_category_id: categoryChain[0] ?? null,
      track_inventory: false, stock_count: null, out_of_stock_behaviour: 'BLOCK',
      is_pre_order: false, pre_order_dispatch_date: null,
    },
    scope: { rangeValueIds, categoryChain, supplier },
  }
}

beforeEach(() => {
  settings.value = {
    rangeAttributeId: 'attr-range',
    holidayRegion: 'england-and-wales',
    holidaysSyncedAt: null,
    defaultTierKey: null,
    cartControlStyle: 'summary',
    showUnavailableServices: true,
    cutoffTime: '14:30',
    dispatchLeadDays: 1,
    shipDays: [1, 2, 3, 4, 5],
  }
  tiers.value = []
  config.value = []
  facts.value = new Map()
})

describe('deliveryScopeId', () => {
  it('names a scope by its kind and reference, and the catch-all by itself', () => {
    expect(deliveryScopeId('RANGE', 'val-orion')).toBe('range:val-orion')
    expect(deliveryScopeId('CATEGORY', 'cat-chairs')).toBe('category:cat-chairs')
    expect(deliveryScopeId('SUPPLIER', 'Furdeco')).toBe('supplier:Furdeco')
    expect(deliveryScopeId('DEFAULT', null)).toBe(DEFAULT_SCOPE_ID)
  })
})

describe('buildDeliveryCatalogue', () => {
  it('publishes every scope a rule is written against, named as the shop names it', async () => {
    tiers.value = [tier('t1', 'standard', 'Standard')]
    config.value = [
      scopeConfig('t1', 'RANGE', 'val-orion', '9.99'),
      scopeConfig('t1', 'CATEGORY', 'cat-chairs', '14.99'),
      scopeConfig('t1', 'SUPPLIER', 'Furdeco', '19.99'),
      scopeConfig('t1', 'DEFAULT', null, '4.95'),
    ]
    const catalogue = await buildDeliveryCatalogue()
    expect(catalogue.scopes).toEqual([
      { id: 'range:val-orion', kind: 'RANGE', ref: 'val-orion', label: 'Orion' },
      { id: 'category:cat-chairs', kind: 'CATEGORY', ref: 'cat-chairs', label: 'Office chairs' },
      { id: 'supplier:Furdeco', kind: 'SUPPLIER', ref: 'Furdeco', label: 'Furdeco' },
      { id: 'default', kind: 'DEFAULT', ref: null, label: 'Everything' },
    ])
  })

  it('names a scope whose thing has been deleted rather than hiding it', async () => {
    tiers.value = [tier('t1', 'standard', 'Standard')]
    config.value = [scopeConfig('t1', 'CATEGORY', 'cat-gone', '5.00')]
    const catalogue = await buildDeliveryCatalogue()
    expect(catalogue.scopes[0]?.label).toBe('Deleted category')
  })

  it('carries the price, the dispatch rules and the holidays, and says it charges per unit', async () => {
    tiers.value = [tier('t1', 'standard', 'Standard', { transitDays: 3, minLeadDays: 5 })]
    config.value = [scopeConfig('t1', 'RANGE', 'val-orion', '9.99')]
    const catalogue = await buildDeliveryCatalogue()
    expect(catalogue.services[0]?.rates).toEqual([
      { scopeId: 'range:val-orion', available: true, price: 9.99, transitDays: 3, minLeadDays: 5 },
    ])
    expect(catalogue.dispatch).toEqual({ cutoffTime: '14:30', timezone: 'Europe/London', shipDays: [1, 2, 3, 4, 5], dispatchLeadDays: 1 })
    expect(catalogue.holidays).toEqual([{ date: '2026-12-25', name: 'Christmas Day' }])
    expect(catalogue.pricing).toBe('per-unit')
  })

  it('resolves a scope\'s own timing override in place of the service\'s', async () => {
    tiers.value = [tier('t1', 'standard', 'Standard', { transitDays: 3, minLeadDays: null })]
    config.value = [scopeConfig('t1', 'RANGE', 'val-orion', '9.99', { transitDays: 10, minLeadDays: 12 })]
    const catalogue = await buildDeliveryCatalogue()
    expect(catalogue.services[0]?.rates[0]).toMatchObject({ transitDays: 10, minLeadDays: 12 })
  })

  it('marks the shop\'s designated default service', async () => {
    settings.value = { ...settings.value, defaultTierKey: 'standard' }
    tiers.value = [tier('t1', 'standard', 'Standard'), tier('t2', 'express', 'Express')]
    const catalogue = await buildDeliveryCatalogue()
    expect(catalogue.services.map((service) => service.isDefault)).toEqual([true, false])
  })

  // Published so a consumer labelling products by an attribute of its own can
  // tell whether its labels and these scope names are the same words. A RANGE
  // scope's ref is a value of THIS attribute, and nothing else says so.
  it('publishes the attribute its range scopes point into', async () => {
    tiers.value = [tier('t1', 'standard', 'Standard')]
    config.value = [scopeConfig('t1', 'RANGE', 'val-orion', '9.99')]
    expect((await buildDeliveryCatalogue()).rangeAttributeId).toBe('attr-range')
  })

  it('publishes no range attribute where the shop has not chosen one', async () => {
    settings.value = { ...settings.value, rangeAttributeId: null }
    expect((await buildDeliveryCatalogue()).rangeAttributeId).toBeNull()
  })

  it('keeps a rule that says a service is NOT offered, so the caller can see it', async () => {
    tiers.value = [tier('t1', 'express', 'Express')]
    config.value = [scopeConfig('t1', 'RANGE', 'val-orion', '0.00', { available: false })]
    expect((await buildDeliveryCatalogue()).services[0]?.rates[0]?.available).toBe(false)
  })
})

describe('resolveProductDeliveryScopes', () => {
  it('follows the house order: range beats category beats supplier beats everything', async () => {
    tiers.value = [tier('t1', 'standard', 'Standard')]
    config.value = [
      scopeConfig('t1', 'RANGE', 'val-orion', '1'),
      scopeConfig('t1', 'CATEGORY', 'cat-chairs', '2'),
      scopeConfig('t1', 'SUPPLIER', 'Furdeco', '3'),
      scopeConfig('t1', 'DEFAULT', null, '4'),
    ]
    facts.value = new Map([['p1', ctx(['val-orion'], ['cat-chairs'], 'Furdeco')]])
    expect((await resolveProductDeliveryScopes(['p1'])).get('p1')?.scopeId).toBe('range:val-orion')

    facts.value = new Map([['p1', ctx([], ['cat-chairs'], 'Furdeco')]])
    expect((await resolveProductDeliveryScopes(['p1'])).get('p1')?.scopeId).toBe('category:cat-chairs')

    facts.value = new Map([['p1', ctx([], [], 'Furdeco')]])
    expect((await resolveProductDeliveryScopes(['p1'])).get('p1')?.scopeId).toBe('supplier:Furdeco')

    facts.value = new Map([['p1', ctx([], [], null)]])
    expect((await resolveProductDeliveryScopes(['p1'])).get('p1')?.scopeId).toBe(DEFAULT_SCOPE_ID)
  })

  it('prefers the nearest category over a distant ancestor, with no tie', async () => {
    tiers.value = [tier('t1', 'standard', 'Standard')]
    config.value = [
      scopeConfig('t1', 'CATEGORY', 'cat-desks', '2'),
      scopeConfig('t1', 'CATEGORY', 'cat-chairs', '3'),
    ]
    facts.value = new Map([['p1', ctx([], ['cat-chairs', 'cat-desks'], null)]])
    // Only the nearest category's rows come back, so a chain is never a tie.
    expect((await resolveProductDeliveryScopes(['p1'])).get('p1')?.tiedWith).toEqual([])
    expect((await resolveProductDeliveryScopes(['p1'])).get('p1')?.scopeId).toBe('category:cat-chairs')
  })

  // A product in no group at all must be absent, not guessed at: a caller
  // inventing a group for it would price it on somebody else's rule.
  it('leaves a product matching nothing out of the map', async () => {
    tiers.value = [tier('t1', 'standard', 'Standard')]
    config.value = [scopeConfig('t1', 'RANGE', 'val-orion', '1')]
    facts.value = new Map([['p1', ctx([], ['cat-chairs'], 'Furdeco')]])
    expect((await resolveProductDeliveryScopes(['p1'])).has('p1')).toBe(false)
  })

  it('answers nothing at all when the shop has written no delivery rules', async () => {
    facts.value = new Map([['p1', ctx(['val-orion'], [], null)]])
    expect((await resolveProductDeliveryScopes(['p1'])).size).toBe(0)
  })

  // Two ranges on one listing: the answer has to be the same every time, or a
  // product would move between groups from one feed build to the next.
  it('is stable when a product matches two scopes of the same kind', async () => {
    tiers.value = [tier('t1', 'standard', 'Standard')]
    config.value = [
      scopeConfig('t1', 'RANGE', 'val-vega', '1'),
      scopeConfig('t1', 'RANGE', 'val-orion', '2'),
    ]
    facts.value = new Map([['p1', ctx(['val-orion', 'val-vega'], [], null)]])
    const first = (await resolveProductDeliveryScopes(['p1'])).get('p1')
    // Rules come back from Postgres in no particular order, so the same set the
    // other way round must still give the same answer.
    config.value = [...config.value].reverse()
    expect((await resolveProductDeliveryScopes(['p1'])).get('p1')).toEqual(first)
  })

  // The tie is published rather than thrown away, and it costs nothing:
  // pickMostSpecific already works the whole set out. A consumer that has to
  // put each product in ONE group cannot see this any other way.
  it('names the other groups a product equally matched', async () => {
    tiers.value = [tier('t1', 'standard', 'Standard')]
    config.value = [
      scopeConfig('t1', 'RANGE', 'val-orion', '1'),
      scopeConfig('t1', 'RANGE', 'val-vega', '2'),
    ]
    facts.value = new Map([['p1', ctx(['val-orion', 'val-vega'], [], null)]])
    const answer = (await resolveProductDeliveryScopes(['p1'])).get('p1')
    expect(answer?.scopeId).toBe('range:val-orion')
    expect(answer?.tiedWith).toEqual(['range:val-vega'])
  })

  it('reports no tie for the ordinary product in one group', async () => {
    tiers.value = [tier('t1', 'standard', 'Standard')]
    config.value = [
      scopeConfig('t1', 'RANGE', 'val-orion', '1'),
      scopeConfig('t1', 'RANGE', 'val-vega', '2'),
    ]
    facts.value = new Map([['p1', ctx(['val-orion'], [], null)]])
    expect((await resolveProductDeliveryScopes(['p1'])).get('p1')?.tiedWith).toEqual([])
  })
})
