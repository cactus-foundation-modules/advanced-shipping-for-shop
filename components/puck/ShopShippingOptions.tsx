// Editor (client) half of the "Shipping options" product-detail block. Shows the
// picker with a made-up set of services on the Puck canvas; the storefront's own
// services, prices and dates are fetched by the client island (see the .rsc
// half). Drop it under the Price part on a Product Detail layout.
import { DeliveryServicePicker } from '@/modules/advanced-shipping-for-shop/components/public/DeliveryServicePicker'

export type ShopShippingOptionsProps = { heading?: string }

export function ShopShippingOptions(props: ShopShippingOptionsProps) {
  return <DeliveryServicePicker heading={props.heading} preview />
}

export const shopShippingOptionsPuckComponent = {
  label: 'Product: Shipping options',
  fields: {
    heading: { type: 'text' as const, label: 'Heading (leave empty for none)' },
  },
  // No heading by default. The options state their own outcome ("Flat-Pack by
  // Friday, free"), exactly as they do in the basket, where they sit bare - a
  // label over the top only repeats what the shopper is already reading.
  defaultProps: { heading: '' } as ShopShippingOptionsProps,
  render: ShopShippingOptions,
}
