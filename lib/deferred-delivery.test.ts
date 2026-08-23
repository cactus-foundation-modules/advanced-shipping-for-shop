import { describe, it, expect } from 'vitest'
import {
  DELIVERY_META_KEY,
  deferredPaymentNote,
  formatWorkingDays,
  isDeliveryLineState,
  paidDeliveryValue,
  readDeliveryLineState,
  unpaidDeliveryValue,
  type DeliveryLineState,
} from '@/modules/advanced-shipping-for-shop/lib/deferred-delivery'

const STATE: DeliveryLineState = {
  tierKey: 'standard',
  tierText: 'Standard Delivery',
  leadDays: 5,
  targetDate: '2026-07-31',
  isPreOrder: false,
}

describe('formatWorkingDays', () => {
  it('singularises one day', () => {
    expect(formatWorkingDays(1)).toBe('1 working day')
    expect(formatWorkingDays(5)).toBe('5 working days')
  })
})

describe('unpaidDeliveryValue', () => {
  it('states the lead time and what starts it, never a date', () => {
    expect(unpaidDeliveryValue(STATE)).toBe('Standard Delivery - 5 working days from when your payment reaches us')
  })
  it('keeps the service wording the order was placed with', () => {
    expect(unpaidDeliveryValue({ ...STATE, tierText: 'Full installation', leadDays: 10 }))
      .toBe('Full installation - 10 working days from when your payment reaches us')
  })
  it('says the plain thing when there is no lead to quote', () => {
    expect(unpaidDeliveryValue({ ...STATE, leadDays: 0 })).toBe('Standard Delivery - dispatched once your payment reaches us')
  })
})

describe('paidDeliveryValue', () => {
  it('reads exactly as the basket promised it', () => {
    expect(paidDeliveryValue('Standard Delivery', '2026-07-29')).toBe('Standard Delivery - by Wednesday 29th of July')
  })
})

describe('deferredPaymentNote', () => {
  it('names the basket lead when there is one', () => {
    expect(deferredPaymentNote(5)).toContain('5 working days from the day it clears')
    expect(deferredPaymentNote(5)).toContain('start from the day it clears rather than today')
  })
  it('drops the figure rather than trailing off when there is none', () => {
    expect(deferredPaymentNote(null)).not.toContain('working days from the day')
    expect(deferredPaymentNote(0)).not.toContain('working days from the day')
  })
})

describe('readDeliveryLineState', () => {
  it('reads back what the resolver wrote', () => {
    expect(readDeliveryLineState({ [DELIVERY_META_KEY]: STATE })).toEqual(STATE)
  })
  it('is null for a line this module never touched', () => {
    expect(readDeliveryLineState(undefined)).toBeNull()
    expect(readDeliveryLineState({ someOtherModule: { colour: 'red' } })).toBeNull()
  })
  it('refuses a half-written state rather than trusting it', () => {
    // An order placed by an older version of this module carries no state at all,
    // and a partial one would produce a sentence with "undefined" in it.
    expect(isDeliveryLineState({ tierKey: 'standard' })).toBe(false)
    expect(readDeliveryLineState({ [DELIVERY_META_KEY]: { tierKey: 'standard', tierText: 'Standard' } })).toBeNull()
  })
})
