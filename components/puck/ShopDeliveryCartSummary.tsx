// Editor (client) half of the basket cut-off countdown. Shows a static preview
// on the Puck canvas; the live figure is computed on the storefront by the
// client island (see the .rsc half). Drop it on the Cart page above the basket
// lines, where it reads as a heading over the Delivery column.
import { alignField, alignStyle } from '@/modules/advanced-shipping-for-shop/components/puck/block-fields'
import { DeliveryCartSummary } from '@/modules/advanced-shipping-for-shop/components/public/DeliveryCartSummary'

export type ShopDeliveryCartSummaryProps = { align?: string }

export function ShopDeliveryCartSummary(props: ShopDeliveryCartSummaryProps) {
  const style = alignStyle(props.align)
  // Wrapped only when there is something to say - no wrapper, no markup
  // change, for every layout saved before this setting existed.
  return style ? <div style={style}><DeliveryCartSummary preview /></div> : <DeliveryCartSummary preview />
}

export const shopDeliveryCartSummaryPuckComponent = {
  label: 'Delivery: basket cut-off countdown',
  fields: { align: alignField },
  defaultProps: { align: 'left' },
  render: ShopDeliveryCartSummary,
}
