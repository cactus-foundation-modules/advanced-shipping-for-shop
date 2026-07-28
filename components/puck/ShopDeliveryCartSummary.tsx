// Editor (client) half of the basket cut-off countdown. Shows a static preview
// on the Puck canvas; the live figure is computed on the storefront by the
// client island (see the .rsc half). Drop it on the Cart page above the basket
// lines, where it reads as a heading over the Delivery column.
import { DeliveryCartSummary } from '@/modules/advanced-shipping-for-shop/components/public/DeliveryCartSummary'

export function ShopDeliveryCartSummary() {
  return <DeliveryCartSummary preview />
}

export const shopDeliveryCartSummaryPuckComponent = {
  label: 'Delivery: basket cut-off countdown',
  fields: {},
  defaultProps: {},
  render: ShopDeliveryCartSummary,
}
