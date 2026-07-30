// RSC (server) half of the basket arrivals panel. It carries no server data -
// the client island reads the basket and asks the estimate API - so this simply
// mounts the island, matching the module's other basket blocks.
import { DeliveryArrivals } from '@/modules/advanced-shipping-for-shop/components/public/DeliveryArrivals'
import { shopDeliveryArrivalsPuckComponent, type ShopDeliveryArrivalsProps } from '@/modules/advanced-shipping-for-shop/components/puck/ShopDeliveryArrivals'

export function ShopDeliveryArrivalsRsc({ note, itemDisplay }: ShopDeliveryArrivalsProps) {
  return <DeliveryArrivals note={note} itemDisplay={itemDisplay} />
}

export const shopDeliveryArrivalsPuckRscComponent = {
  ...shopDeliveryArrivalsPuckComponent,
  render: ShopDeliveryArrivalsRsc,
}
