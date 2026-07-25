// Editor (client) half of the grouped-deliveries basket banner. Shows a static
// preview on the Puck canvas; the live summary is computed on the storefront by
// the client island (see the .rsc half). Drop it on the Cart page near the
// basket lines.
import { DeliveryCartSummary } from '@/modules/advanced-shipping-for-shop/components/public/DeliveryCartSummary'

export function ShopDeliveryCartSummary() {
  return <DeliveryCartSummary preview />
}

export const shopDeliveryCartSummaryPuckComponent = {
  label: 'Delivery: basket summary',
  fields: {},
  defaultProps: {},
  render: ShopDeliveryCartSummary,
}
