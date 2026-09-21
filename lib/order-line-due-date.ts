// shop.order-line-due-date provider: the day each order line this module
// promised is due at the customer's door, so the shop's orders list can say when
// the next delivery is before any parcel has been booked.
//
// Read straight back off the state the cart-line resolver snapshotted onto the
// line at checkout (and the payment restatement updated), so it answers for every
// order already placed as well as new ones. A line this module promised nothing
// for is left out, and shop hears nothing about it.
import type { OrderLineForDueDate } from '@/modules/shop/lib/order-line-due-date'
import { lineDueDate, readDeliveryLineState } from '@/modules/advanced-shipping-for-shop/lib/deferred-delivery'

export function advancedShippingLineDueDates(lines: OrderLineForDueDate[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of lines) {
    const state = readDeliveryLineState(line.lineMeta?.data)
    const date = state ? lineDueDate(state, line.paid) : null
    if (date) out[line.itemId] = date
  }
  return out
}
