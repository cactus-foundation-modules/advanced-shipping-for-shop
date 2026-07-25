// RSC (server) half of the grouped-deliveries basket banner. It carries no
// server data - the client island reads the cart and fetches the estimate - so
// this simply mounts the island. Kept as a separate .rsc file to match the
// module's other blocks.
import { DeliveryCartSummary } from '@/modules/advanced-shipping-for-shop/components/public/DeliveryCartSummary'
import { shopDeliveryCartSummaryPuckComponent } from '@/modules/advanced-shipping-for-shop/components/puck/ShopDeliveryCartSummary'

export function ShopDeliveryCartSummaryRsc() {
  return <DeliveryCartSummary />
}

export const shopDeliveryCartSummaryPuckRscComponent = {
  ...shopDeliveryCartSummaryPuckComponent,
  render: ShopDeliveryCartSummaryRsc,
}
