// Editor (client) half of the whole-order upgrade row. Shows a static preview
// on the Puck canvas; the live chips are built on the storefront by the client
// island from the shopper's own basket (see the .rsc half). Drop it on the Cart
// page under the cut-off countdown, above the basket lines.
import { DeliveryBasketOffers } from '@/modules/advanced-shipping-for-shop/components/public/DeliveryBasketOffers'

export function ShopDeliveryBasketOffers() {
  return <DeliveryBasketOffers preview />
}

export const shopDeliveryBasketOffersPuckComponent = {
  label: 'Delivery: whole-order upgrades',
  fields: {},
  defaultProps: {},
  render: ShopDeliveryBasketOffers,
}
