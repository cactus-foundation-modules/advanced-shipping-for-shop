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
  defaultProps: { heading: 'Shipping options' } as ShopShippingOptionsProps,
  render: ShopShippingOptions,
}
