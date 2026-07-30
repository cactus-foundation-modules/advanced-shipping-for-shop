// Turns one product's delivery estimate into the very same declarative picker
// the basket renders (shop's CartLineControl), so the product page can show a
// shopper their delivery services before they commit to anything.
//
// The basket's copy is built server-side by the cart-line resolver, which has
// the product, the tax display and the shop's currency to hand. The product page
// has none of that - it is a client island with an estimate API response - so
// the SHAPE is rebuilt here from that response while the WORDING comes from the
// same pure helpers the resolver uses (lib/tier-labels.ts). Two callers, one set
// of strings: the picker on the product page cannot word a service differently
// from the picker in the basket.
//
// Pure: no database, no window. The API response is the only input.
import type { CartLineControl } from '@/modules/shop/lib/line-meta'
import type { ItemEstimate } from '@/modules/advanced-shipping-for-shop/lib/estimate-service'
import type { CartControlStyle } from '@/modules/advanced-shipping-for-shop/lib/types'
import { tierOptionLabel, tierOptionSummary } from '@/modules/advanced-shipping-for-shop/lib/tier-labels'

// The shop owner's chosen basket picker, said the way shop's renderer names it.
// Mirrors the cart-line resolver's own mapping, so "Delivery settings" moves
// both pickers at once.
export function controlRenderAs(style: CartControlStyle): NonNullable<CartLineControl['renderAs']> {
  if (style === 'radios') return 'radios'
  if (style === 'dropdown') return 'select'
  return 'summary'
}

// Null when this product offers nothing to choose between - no services at all,
// so there is no picker to show and the block renders nothing.
export function buildProductTierControl(
  item: Pick<ItemEstimate, 'hasEstimate' | 'tierKey' | 'tiers'>,
  currencySymbol: string,
  style: CartControlStyle,
  chosenKey?: string | null,
): CartLineControl | null {
  if (!item.hasEstimate || item.tiers.length === 0) return null
  // The shopper's own pick wins, but only while it is still one of the services
  // offered; otherwise the estimate's own chosen service stands.
  const chosen = (chosenKey && item.tiers.some((t) => t.key === chosenKey) ? chosenKey : null)
    ?? item.tierKey
    ?? item.tiers[0]!.key

  return {
    key: 'shippingTier',
    label: 'Delivery',
    value: chosen,
    // Every option states its own date and price, so shop renders the picker
    // bare - exactly as it does in the basket.
    optionsSelfLabelled: true,
    options: item.tiers.map((t) => ({
      value: t.key,
      label: tierOptionLabel(t.label, t.priceEffective, currencySymbol, t.targetByLabel),
      priceAdjust: t.priceEffective ?? 0,
      description: t.description ?? undefined,
      summary: tierOptionSummary(t.label, t.priceEffective, currencySymbol, t.targetByLabel, t.targetLabel),
    })),
    renderAs: controlRenderAs(style),
  }
}
