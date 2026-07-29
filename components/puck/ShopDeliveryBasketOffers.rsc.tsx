// RSC (server) half of the whole-order upgrade row. It carries no server data -
// the client island reads the basket and asks the estimate API - so this simply
// mounts the island, matching the module's other basket blocks.
import { DeliveryBasketOffers } from '@/modules/advanced-shipping-for-shop/components/public/DeliveryBasketOffers'
import { shopDeliveryBasketOffersPuckComponent } from '@/modules/advanced-shipping-for-shop/components/puck/ShopDeliveryBasketOffers'

export function ShopDeliveryBasketOffersRsc() {
  return <DeliveryBasketOffers />
}

export const shopDeliveryBasketOffersPuckRscComponent = {
  ...shopDeliveryBasketOffersPuckComponent,
  render: ShopDeliveryBasketOffersRsc,
}
