// Editor (client) half of the "Delivery estimate" product-detail block. Renders
// a static preview on the Puck canvas; the live date is computed on the
// storefront by the client island (see the .rsc half). Drop it right after the
// Price part on a Product Detail layout.
import { DeliveryEstimate } from '@/modules/advanced-shipping-for-shop/components/public/DeliveryEstimate'

export function ShopDeliveryEstimate() {
  return <DeliveryEstimate preview />
}

export const shopDeliveryEstimatePuckComponent = {
  label: 'Product: Delivery estimate',
  fields: {},
  defaultProps: {},
  render: ShopDeliveryEstimate,
}
