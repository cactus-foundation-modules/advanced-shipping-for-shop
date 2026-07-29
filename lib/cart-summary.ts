// shop.cart-summary provider: one line about the WHOLE basket - the date by
// which every item in it has arrived. Each cart line already states its own
// date beside it, so the basket-wide note is the one thing the lines cannot say
// between them: the last of those dates, which is when the order is actually
// complete. Shop shows it in the sticky checkout bar beside the item count.
//
// It runs after shop has resolved the lines, so every product's delivery is
// already in the request-scoped cache the prefetcher warmed - this is date
// arithmetic, not another round of queries.
import type { CartSummaryLine, CartSummaryNote } from '@/modules/shop/lib/cart-summary'
import { formatDeliveryByLabel, todayInZone } from '@/modules/advanced-shipping-for-shop/lib/working-days'
import { computeEstimate } from '@/modules/advanced-shipping-for-shop/lib/estimate'
import { findTierOption } from '@/modules/advanced-shipping-for-shop/lib/resolve'
import { getProductDelivery } from '@/modules/advanced-shipping-for-shop/lib/delivery-cache'
import { getResolveContext } from '@/modules/advanced-shipping-for-shop/lib/context'
import { getSettingsCached } from '@/modules/advanced-shipping-for-shop/lib/db/settings'
import { chosenTierKey } from '@/modules/advanced-shipping-for-shop/lib/line-resolver'

export async function summariseCartDelivery(lines: CartSummaryLine[]): Promise<CartSummaryNote | null> {
  const ctx = await getResolveContext()
  const settings = await getSettingsCached()

  // ISO dates compare correctly as plain strings, so the latest promised date is
  // simply the largest one.
  let latest: string | null = null
  for (const line of lines) {
    const delivery = await getProductDelivery(line.product.id, ctx)
    if (!delivery || delivery.tiers.length === 0) continue
    const tier = findTierOption(delivery, chosenTierKey(delivery, line.meta, settings.defaultTierKey))
    if (!tier) continue
    const est = computeEstimate({
      now: ctx.now,
      timezone: ctx.timezone,
      holidays: ctx.holidays,
      timing: settings,
      tier: tier.modifiers,
      stock: delivery.stock,
    })
    // A line that cannot be promised a date (out of stock and set to block) is
    // left out rather than guessed at - the basket has bigger news for the
    // shopper on that line than a summary.
    if (!est.available || !est.targetDate) continue
    if (!latest || est.targetDate > latest) latest = est.targetDate
  }

  // Nothing in the basket has a delivery date - a downloads-only cart, say. No
  // note at all beats an empty one.
  if (!latest) return null
  return { id: 'delivery', text: `everything by ${formatDeliveryByLabel(latest, todayInZone(ctx.now, ctx.timezone))}` }
}
