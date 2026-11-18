// The cost-price snapshot the cart-line resolver writes onto each order line.
// Pure: no database, no request context.
//
// A delivery service has two prices per scope row: the sales price the shopper
// is charged (folded into the line price, attributed as the line's "Delivery"
// charge) and the cost price the shop pays for it. The cost is recorded on the
// line at checkout so anything raising a purchase order later - which must pay
// the supplier the cost, never the customer's charge - reads what the service
// cost on the day it was sold, not whatever the price grid says months on.
//
// Namespaced, because every resolver's data shares one bag on the line (shop's
// LineMeta.data). Kept separate from the dated-promise state (`ashDelivery`),
// which is only written when a date can be promised: the cost is a fact about
// every line that bought a service, dated or not.
export const DELIVERY_COST_META_KEY = 'ashDeliveryCost'

export type DeliveryCostLineState = {
  // The service the cost belongs to.
  tierKey: string
  // What the shop pays for that service on ONE unit of the line, in major units,
  // on the same side of tax as the sales price it sits beside. Zero is a real
  // answer ("this costs us nothing"), not a missing one.
  unitCost: number
}

export function deliveryCostState(tierKey: string, costPrice: string | number): DeliveryCostLineState {
  const value = Number(costPrice)
  return { tierKey, unitCost: Number.isFinite(value) && value > 0 ? Math.round(value * 100) / 100 : 0 }
}
