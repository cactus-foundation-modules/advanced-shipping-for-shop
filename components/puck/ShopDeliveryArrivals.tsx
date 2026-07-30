// Editor (client) half of the basket arrivals panel. Shows a static three-date
// preview on the Puck canvas; the live panel is built on the storefront from the
// shopper's own basket (see the .rsc half). Drop it on the Cart page underneath
// the basket lines.
import { DeliveryArrivals, DEFAULT_ARRIVALS_NOTE, type ArrivalsItemDisplay } from '@/modules/advanced-shipping-for-shop/components/public/DeliveryArrivals'

export type ShopDeliveryArrivalsProps = { note?: string; itemDisplay?: ArrivalsItemDisplay }

export function ShopDeliveryArrivals({ note, itemDisplay }: ShopDeliveryArrivalsProps) {
  return <DeliveryArrivals preview note={note} itemDisplay={itemDisplay} />
}

export const shopDeliveryArrivalsPuckComponent = {
  label: 'Delivery: basket arrivals summary',
  fields: {
    // Emptied deliberately, the footnote goes altogether - some shops would
    // rather not commit to confirming days by email.
    note: { type: 'textarea' as const, label: 'Footnote (empty to hide)' },
    // A basket of long variation names turns each card into a paragraph; the
    // photos say the same thing at a glance and keep the names and the chosen
    // options a hover away. A product with no photo shows an empty tile, so a
    // catalogue without pictures is better off with the names.
    itemDisplay: {
      type: 'radio' as const,
      label: 'Show each arrival as',
      options: [
        { value: 'names', label: 'Item names' },
        { value: 'photos', label: 'Product photos' },
      ],
    },
  },
  defaultProps: { note: DEFAULT_ARRIVALS_NOTE, itemDisplay: 'names' } as ShopDeliveryArrivalsProps,
  render: ShopDeliveryArrivals,
}
