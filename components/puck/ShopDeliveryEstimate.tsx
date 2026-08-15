// Editor (client) half of the "Delivery estimate" product-detail block. Renders
// a static preview on the Puck canvas; the live date is computed on the
// storefront by the client island (see the .rsc half). Drop it right after the
// Price part on a Product Detail layout.
import { alignField, alignStyle } from '@/modules/advanced-shipping-for-shop/components/puck/block-fields'
import { DeliveryEstimate } from '@/modules/advanced-shipping-for-shop/components/public/DeliveryEstimate'

export type ShopDeliveryEstimateProps = { align?: string }

export function ShopDeliveryEstimate(props: ShopDeliveryEstimateProps) {
  const style = alignStyle(props.align)
  // Wrapped only when there is something to say - no wrapper, no markup
  // change, for every layout saved before this setting existed.
  return style ? <div style={style}><DeliveryEstimate preview /></div> : <DeliveryEstimate preview />
}

export const shopDeliveryEstimatePuckComponent = {
  label: 'Product: Delivery estimate',
  fields: { align: alignField },
  defaultProps: { align: 'left' },
  render: ShopDeliveryEstimate,
}
