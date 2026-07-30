// RSC (server) half of the "Shipping options" block. It carries no server data
// of its own - the client island resolves the product from the URL and asks the
// estimate API for every service, its price and its date - so this simply mounts
// the island, matching the module's other product-detail block.
import { DeliveryServicePicker } from '@/modules/advanced-shipping-for-shop/components/public/DeliveryServicePicker'
import { shopShippingOptionsPuckComponent, type ShopShippingOptionsProps } from '@/modules/advanced-shipping-for-shop/components/puck/ShopShippingOptions'

export function ShopShippingOptionsRsc(props: ShopShippingOptionsProps) {
  return <DeliveryServicePicker heading={props.heading} />
}

export const shopShippingOptionsPuckRscComponent = {
  ...shopShippingOptionsPuckComponent,
  render: ShopShippingOptionsRsc,
}
