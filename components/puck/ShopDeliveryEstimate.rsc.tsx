// RSC (server) half of the "Delivery estimate" block. It carries no server data
// itself - the client island resolves the product from the URL and fetches the
// live estimate - so this simply mounts the island. Kept as a separate .rsc file
// to match every other product-detail part's two-file shape.
import { alignStyle } from '@/modules/advanced-shipping-for-shop/components/puck/block-fields'
import { DeliveryEstimate } from '@/modules/advanced-shipping-for-shop/components/public/DeliveryEstimate'
import { shopDeliveryEstimatePuckComponent, type ShopDeliveryEstimateProps } from '@/modules/advanced-shipping-for-shop/components/puck/ShopDeliveryEstimate'

export function ShopDeliveryEstimateRsc(props: ShopDeliveryEstimateProps) {
  const style = alignStyle(props.align)
  // Same shape as the editor half: no wrapper unless the alignment asks
  // for one, so an existing layout's markup is untouched.
  return style ? <div style={style}><DeliveryEstimate /></div> : <DeliveryEstimate />
}

export const shopDeliveryEstimatePuckRscComponent = {
  ...shopDeliveryEstimatePuckComponent,
  render: ShopDeliveryEstimateRsc,
}
