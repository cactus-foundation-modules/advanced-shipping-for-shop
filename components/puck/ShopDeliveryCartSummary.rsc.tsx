// RSC (server) half of the basket cut-off countdown. It carries no server data
// - the client island reads the cart and fetches the estimate - so this simply
// mounts the island. Kept as a separate .rsc file to match the module's other
// blocks.
import { alignStyle } from '@/modules/advanced-shipping-for-shop/components/puck/block-fields'
import { DeliveryCartSummary } from '@/modules/advanced-shipping-for-shop/components/public/DeliveryCartSummary'
import { shopDeliveryCartSummaryPuckComponent, type ShopDeliveryCartSummaryProps } from '@/modules/advanced-shipping-for-shop/components/puck/ShopDeliveryCartSummary'

export function ShopDeliveryCartSummaryRsc(props: ShopDeliveryCartSummaryProps) {
  const style = alignStyle(props.align)
  // Same shape as the editor half: no wrapper unless the alignment asks
  // for one, so an existing layout's markup is untouched.
  return style ? <div style={style}><DeliveryCartSummary /></div> : <DeliveryCartSummary />
}

export const shopDeliveryCartSummaryPuckRscComponent = {
  ...shopDeliveryCartSummaryPuckComponent,
  render: ShopDeliveryCartSummaryRsc,
}
