// Published at `shop.product-delivery-forecast`: for each product asked about,
// every delivery service with the dates and prices its variations would get,
// grouped (see delivery-forecast.ts). A sibling of `shop.product-delivery-timing`
// rather than a change to it: that seam carries working-day counts safe to
// cache and publish in a feed; this one carries real dates for a caller
// answering a person there and then.
import { getResolveContext } from '@/modules/advanced-shipping-for-shop/lib/context'
import { getSettingsCached } from '@/modules/advanced-shipping-for-shop/lib/db/settings'
import { buildDeliveryForecast, type ForecastMember, type ProductDeliveryForecast } from '@/modules/advanced-shipping-for-shop/lib/delivery-forecast'
import { resolveProductDeliveries } from '@/modules/advanced-shipping-for-shop/lib/resolve'
import { getVariantChildIds, getVariantOptionValues } from '@/modules/advanced-shipping-for-shop/lib/variations-bridge'

/** Products the shop offers no delivery service at all are absent from the map. */
export async function advancedShippingDeliveryForecast(
  productIds: string[],
  now: Date = new Date(),
): Promise<Map<string, ProductDeliveryForecast>> {
  const result = new Map<string, ProductDeliveryForecast>()
  const ids = [...new Set(productIds)].filter(Boolean)
  if (ids.length === 0) return result

  const [ctx, settings, childIdsByListing] = await Promise.all([
    getResolveContext(now),
    getSettingsCached(),
    getVariantChildIds(ids),
  ])
  const childIds = [...new Set([...childIdsByListing.values()].flat())]
  // A listing with variations is never the thing bought, so its own row is not
  // asked; a product without any is its own single member.
  const plainIds = ids.filter((id) => (childIdsByListing.get(id)?.length ?? 0) === 0)
  const [deliveries, optionValues] = await Promise.all([
    resolveProductDeliveries([...childIds, ...plainIds], ctx),
    childIds.length > 0 ? getVariantOptionValues(childIds) : Promise.resolve(new Map()),
  ])

  for (const id of ids) {
    const children = childIdsByListing.get(id) ?? []
    const members: ForecastMember[] = (children.length > 0 ? children : [id]).flatMap((memberId) => {
      const delivery = deliveries.get(memberId)
      return delivery ? [{ id: memberId, delivery, values: optionValues.get(memberId) ?? [] }] : []
    })
    if (members.length === 0) continue
    const forecast = buildDeliveryForecast(id, members, children.length > 0, ctx, settings)
    if (forecast.services.length > 0) result.set(id, forecast)
  }
  return result
}
