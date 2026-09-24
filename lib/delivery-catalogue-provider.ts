// The `shop.delivery-services-catalogue` extension point.
//
// Two questions, one provider, because they are only useful together: what the
// shop's delivery rules ARE, and which of its groups a given product falls in.
// A caller reproducing the rules somewhere else needs both - the rules to set
// the other system up, and the grouping to tell it which products each rule
// covers - and a caller that had to find them at two different points would be
// free to pair up two answers taken at different moments.
//
// Server only. Every call here reads the database, and no client has any
// business holding the whole shop's delivery pricing.
import {
  buildDeliveryCatalogue,
  resolveProductDeliveryScopes,
  type DeliveryCatalogue,
  type ProductDeliveryScope,
} from '@/modules/advanced-shipping-for-shop/lib/delivery-catalogue'

export type {
  DeliveryCatalogue,
  DeliveryDispatchRules,
  DeliveryHoliday,
  DeliveryScope,
  DeliveryScopeKind,
  DeliveryScopeRate,
  DeliveryServiceEntry,
  ProductDeliveryScope,
} from '@/modules/advanced-shipping-for-shop/lib/delivery-catalogue'

export const advancedShippingDeliveryCatalogue = {
  /** The shop's delivery services, scopes, prices, timing and holidays. */
  catalogue(): Promise<DeliveryCatalogue> {
    return buildDeliveryCatalogue()
  },
  /** The scope each product falls in, keyed by product id, with any equally
   *  specific groups it also matched. Products matching no scope are absent. */
  scopesForProducts(productIds: string[]): Promise<Map<string, ProductDeliveryScope>> {
    return resolveProductDeliveryScopes(productIds)
  },
}
