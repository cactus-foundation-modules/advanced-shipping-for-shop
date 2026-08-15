// RSC (server) half of the whole-order upgrade row. It carries no server data -
// the client island reads the basket and asks the estimate API - so this simply
// mounts the island, matching the module's other basket blocks.
import { alignStyle } from '@/modules/advanced-shipping-for-shop/components/puck/block-fields'
import { DeliveryBasketOffers } from '@/modules/advanced-shipping-for-shop/components/public/DeliveryBasketOffers'
import { shopDeliveryBasketOffersPuckComponent, type ShopDeliveryBasketOffersProps } from '@/modules/advanced-shipping-for-shop/components/puck/ShopDeliveryBasketOffers'

export function ShopDeliveryBasketOffersRsc(props: ShopDeliveryBasketOffersProps) {
  const style = alignStyle(props.align)
  // Same shape as the editor half: no wrapper unless the alignment asks
  // for one, so an existing layout's markup is untouched.
  return style ? <div style={style}><DeliveryBasketOffers /></div> : <DeliveryBasketOffers />
}

export const shopDeliveryBasketOffersPuckRscComponent = {
  ...shopDeliveryBasketOffersPuckComponent,
  render: ShopDeliveryBasketOffersRsc,
}
