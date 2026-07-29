// RSC (server) half of the basket arrivals panel. It carries no server data -
// the client island reads the basket and asks the estimate API - so this simply
// mounts the island, matching the module's other basket blocks.
import { DeliveryArrivals } from '@/modules/advanced-shipping-for-shop/components/public/DeliveryArrivals'
import { shopDeliveryArrivalsPuckComponent } from '@/modules/advanced-shipping-for-shop/components/puck/ShopDeliveryArrivals'

export function ShopDeliveryArrivalsRsc({ note }: { note?: string }) {
  return <DeliveryArrivals note={note} />
}

export const shopDeliveryArrivalsPuckRscComponent = {
  ...shopDeliveryArrivalsPuckComponent,
  render: ShopDeliveryArrivalsRsc,
}
