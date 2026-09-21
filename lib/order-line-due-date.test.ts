import { describe, it, expect } from 'vitest'
import { advancedShippingLineDueDates } from '@/modules/advanced-shipping-for-shop/lib/order-line-due-date'
import { DELIVERY_META_KEY, type DeliveryLineState } from '@/modules/advanced-shipping-for-shop/lib/deferred-delivery'

const STATE: DeliveryLineState = {
  tierKey: 'standard',
  tierText: 'Flat-Pack',
  leadDays: 6,
  targetDate: '2026-09-28',
  isPreOrder: false,
}

const line = (itemId: string, data: Record<string, unknown> | undefined, paid = true) => ({
  itemId,
  orderId: 'o1',
  lineMeta: data ? { fields: [], data } : null,
  paid,
})

describe('advancedShippingLineDueDates', () => {
  it('answers each line it promised a day for, by item id', () => {
    expect(advancedShippingLineDueDates([
      line('a', { [DELIVERY_META_KEY]: STATE }),
      line('b', { [DELIVERY_META_KEY]: { ...STATE, targetDate: '2026-09-23' } }),
    ])).toEqual({ a: '2026-09-28', b: '2026-09-23' })
  })

  it('leaves out a line it never promised anything for', () => {
    expect(advancedShippingLineDueDates([
      line('a', undefined),
      line('b', { someOtherModule: { colour: 'red' } }),
    ])).toEqual({})
  })

  it('leaves out an unpaid line, whose promise is not a date yet', () => {
    expect(advancedShippingLineDueDates([line('a', { [DELIVERY_META_KEY]: STATE }, false)])).toEqual({})
  })
})
