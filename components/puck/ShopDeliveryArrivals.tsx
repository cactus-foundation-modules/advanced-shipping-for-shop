// Editor (client) half of the basket arrivals panel. Shows a static three-date
// preview on the Puck canvas; the live panel is built on the storefront from the
// shopper's own basket (see the .rsc half). Drop it on the Cart page underneath
// the basket lines.
import { DeliveryArrivals, DEFAULT_ARRIVALS_NOTE } from '@/modules/advanced-shipping-for-shop/components/public/DeliveryArrivals'

export function ShopDeliveryArrivals({ note }: { note?: string }) {
  return <DeliveryArrivals preview note={note} />
}

export const shopDeliveryArrivalsPuckComponent = {
  label: 'Delivery: basket arrivals summary',
  fields: {
    // Emptied deliberately, the footnote goes altogether - some shops would
    // rather not commit to confirming days by email.
    note: { type: 'textarea' as const, label: 'Footnote (empty to hide)' },
  },
  defaultProps: { note: DEFAULT_ARRIVALS_NOTE },
  render: ShopDeliveryArrivals,
}
