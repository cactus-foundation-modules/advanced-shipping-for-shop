// Editor (client) half of the whole-order upgrade row. Shows a static preview
// on the Puck canvas; the live chips are built on the storefront by the client
// island from the shopper's own basket (see the .rsc half). Drop it on the Cart
// page under the cut-off countdown, above the basket lines.
import { alignField, alignStyle } from '@/modules/advanced-shipping-for-shop/components/puck/block-fields'
import { DeliveryBasketOffers } from '@/modules/advanced-shipping-for-shop/components/public/DeliveryBasketOffers'

export type ShopDeliveryBasketOffersProps = { align?: string }

export function ShopDeliveryBasketOffers(props: ShopDeliveryBasketOffersProps) {
  const style = alignStyle(props.align)
  // Wrapped only when there is something to say - no wrapper, no markup
  // change, for every layout saved before this setting existed.
  return style ? <div style={style}><DeliveryBasketOffers preview /></div> : <DeliveryBasketOffers preview />
}

export const shopDeliveryBasketOffersPuckComponent = {
  label: 'Delivery: whole-order upgrades',
  fields: { align: alignField },
  defaultProps: { align: 'left' },
  render: ShopDeliveryBasketOffers,
}
