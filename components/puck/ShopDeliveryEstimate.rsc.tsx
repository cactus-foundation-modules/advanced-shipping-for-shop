// RSC (server) half of the "Delivery estimate" block. It carries no server data
// itself - the client island resolves the product from the URL and fetches the
// live estimate - so this simply mounts the island. Kept as a separate .rsc file
// to match every other product-detail part's two-file shape.
import { DeliveryEstimate } from '@/modules/advanced-shipping-for-shop/components/public/DeliveryEstimate'
import { shopDeliveryEstimatePuckComponent } from '@/modules/advanced-shipping-for-shop/components/puck/ShopDeliveryEstimate'

export function ShopDeliveryEstimateRsc() {
  return <DeliveryEstimate />
}

export const shopDeliveryEstimatePuckRscComponent = {
  ...shopDeliveryEstimatePuckComponent,
  render: ShopDeliveryEstimateRsc,
}
