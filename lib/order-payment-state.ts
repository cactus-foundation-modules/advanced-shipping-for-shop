// shop.order-payment-state provider: keeps an order's delivery promise honest
// across a payment that has not happened yet.
//
// Shop calls this twice for a given order - when it is placed (and so first knows
// which payment method it is on) and again when the money lands. Everything it
// decides comes off the payment provider's own `confirmMode`: 'manual' means the
// shop is not taking the money at the checkout, so the order can sit unpaid for
// as long as the shopper likes. Bank transfer is the case that prompted this;
// nothing here names it, because "cash on collection" has exactly the same
// problem and any later method with the same shape will too. Every automatic
// method returns null on the first line and costs nothing.
//
// The wording and the maths live next door in lib/deferred-delivery.ts (pure, and
// unit-tested); this file is the plumbing that fetches what they need.
import type { OrderPaymentStateInput, OrderPaymentStateResult } from '@/modules/shop/lib/order-payment-state'
import type { LineMetaField } from '@/modules/shop/lib/types'
import { getPaymentProvider } from '@/modules/shop/lib/payments/registry'
import { computeEstimate, effectiveShipDays } from '@/modules/advanced-shipping-for-shop/lib/estimate'
import { findTierOption } from '@/modules/advanced-shipping-for-shop/lib/resolve'
import { getProductDelivery } from '@/modules/advanced-shipping-for-shop/lib/delivery-cache'
import { getResolveContext } from '@/modules/advanced-shipping-for-shop/lib/context'
import { getSettingsCached } from '@/modules/advanced-shipping-for-shop/lib/db/settings'
import { addWorkingDays, nextWorkingDay, todayInZone } from '@/modules/advanced-shipping-for-shop/lib/working-days'
import {
  DELIVERY_FIELD_LABEL,
  deferredPaymentNote,
  paidDeliveryValue,
  readDeliveryLineState,
  unpaidDeliveryValue,
  type DeliveryLineState,
} from '@/modules/advanced-shipping-for-shop/lib/deferred-delivery'

export async function restateDeliveryForPayment(
  { order, items }: OrderPaymentStateInput,
): Promise<OrderPaymentStateResult | null> {
  // Money taken at the checkout: the date the basket promised was counted from
  // the right day, and nothing here has anything to add.
  if (getPaymentProvider(order.paymentMethod)?.confirmMode !== 'manual') return null

  // Only lines this module actually promised something for. A basket of plain
  // products, or one ordered before this module was installed, carries no state
  // and is left exactly as it is.
  const ours = items
    .map((item) => ({ item, state: readDeliveryLineState(item.lineMeta?.data) }))
    .filter((row): row is { item: typeof row.item; state: DeliveryLineState } => row.state !== null)
    // A pre-order's date is the stock's own arrival date. Payment does not move
    // it, so it is neither restated as a lead time nor re-dated when paid.
    .filter((row) => !row.state.isPreOrder)
  if (ours.length === 0) return null

  const paid = order.paymentStatus === 'PAID'
  const fields: Array<{ itemId: string; fields: LineMetaField[] }> = []

  if (!paid) {
    for (const { item, state } of ours) {
      fields.push({ itemId: item.id, fields: [{ label: DELIVERY_FIELD_LABEL, value: unpaidDeliveryValue(state) }] })
    }
    // The basket-wide figure is the longest lead in it - the day the whole order
    // has landed, which is the one the shopper is really waiting on.
    const longest = ours.reduce((max, row) => Math.max(max, row.state.leadDays), 0)
    return { items: fields, note: deferredPaymentNote(longest > 0 ? longest : null) }
  }

  // Paid. Re-date every line from the day the money actually arrived, using the
  // service the shopper bought - so a transfer that sat for a fortnight gets a
  // fortnight-later date, not the one quoted when they clicked.
  const paidAt = order.paidAt ?? new Date()
  const [ctx, settings] = await Promise.all([getResolveContext(paidAt), getSettingsCached()])
  const shipDays = effectiveShipDays(settings)
  const paidDate = todayInZone(paidAt, ctx.timezone)

  for (const { item, state } of ours) {
    let targetDate: string | null = null

    // The live re-resolve is the better answer: it re-applies the cut-off, the
    // ship days and the holidays against the actual payment moment, exactly as a
    // fresh order would have been dated.
    if (item.productId) {
      const delivery = await getProductDelivery(item.productId, ctx)
      const tier = delivery ? findTierOption(delivery, state.tierKey) : null
      if (delivery && tier) {
        const est = computeEstimate({
          now: paidAt,
          timezone: ctx.timezone,
          holidays: ctx.holidays,
          timing: settings,
          tier: tier.modifiers,
          stock: delivery.stock,
        })
        if (est.available && est.targetDate) targetDate = est.targetDate
      }
    }

    // No live answer - the product is gone, the service was retired, or the line
    // is out of stock and set to block. The promise made at checkout still holds
    // and is still countable, so it is honoured from the payment date rather than
    // abandoned: this line has been paid for.
    if (!targetDate) {
      targetDate = addWorkingDays(nextWorkingDay(paidDate, ctx.holidays, shipDays), state.leadDays, ctx.holidays, shipDays)
    }

    fields.push({
      itemId: item.id,
      fields: [{ label: DELIVERY_FIELD_LABEL, value: paidDeliveryValue(state.tierText, targetDate) }],
    })
  }

  return { items: fields }
}
