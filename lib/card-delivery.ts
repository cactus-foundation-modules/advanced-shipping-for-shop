// The shape of a product card's delivery line, and the pure rules for turning it
// into words. Deliberately free of prisma and of anything server-only: the card
// part-block (components/puck/card-delivery.tsx) imports the id, the types and
// the two functions below, and that block is registered as an EDITOR component
// too, so anything it touches lands in the client bundle. The provider that
// actually reads the database lives next door in card-delivery-provider.ts.
//
// Same split, for the same reason, as shop-variations' card-options.ts.

/** The id this module registers its card provider under. Shop hands the payload
 *  back tagged with it (CardFact), and the block looks itself up by the same
 *  string. */
export const CARD_DELIVERY_FACT_ID = 'advanced-shipping-card-delivery'

/** The block type registered against shop's `shopProductCard` layout type. The
 *  provider looks for this string inside the saved card layouts to decide
 *  whether the delivery sums are worth running at all - see the provider. */
export const CARD_DELIVERY_BLOCK_TYPE = 'ShopCardDelivery'

/** What one product's card is told about its delivery. Crosses the RSC boundary
 *  as a Puck block prop, so plain JSON only. */
export type CardDeliveryFacts = {
  /** Whole days from today to the soonest date any of the product's services
   *  can deliver by - the "as little as" figure, counted the way a shopper
   *  counts (weekends included). Never below 1. */
  days: number
  /** The same gap counted in the shop's own working days (its ship days, bank
   *  holidays taken out). Never below 1. */
  workingDays: number
  /** The labels of every delivery service this product is actually offered.
   *  The block matches its own word against these rather than the provider
   *  deciding, so which word means "installation" stays a per-block setting. */
  services: string[]
}

export const DEFAULT_DELIVERY_TEXT = 'Delivery in as little as {days} days.'
export const DEFAULT_INSTALLATION_TEXT = 'Installation available.'
export const DEFAULT_INSTALLATION_MATCH = 'Installation'

/** The custom property the "shrink to fit on one line" island multiplies the
 *  block's own font size by (see components/public/CardDeliveryFit.tsx).
 *
 *  Lives here, in a plain module, rather than in that island's own file: every
 *  export of a `'use client'` file becomes an opaque server reference when a
 *  server component imports it, which is exactly right for the component
 *  itself (rendered via JSX, the reference resolves at the client boundary)
 *  and exactly wrong for a plain string a server component wants to read
 *  directly - `card-delivery.tsx` builds `calc(<size> * var(${FIT_VAR}, 1))`
 *  on the server, so `FIT_VAR` has to be a real value there, not a proxy that
 *  throws "attempted to call FIT_VAR() from the server" the moment it is used
 *  outside a render. */
export const FIT_VAR = '--ash-card-fit'

/** The delivery sentence with its figure filled in.
 *
 *  `{days}` is replaced by the number. One small courtesy on top: where the
 *  wording says "{days} days" and the answer is one, the plural is dropped, so
 *  the owner can type the sentence they want to read in the common case without
 *  ending up with "in as little as 1 days" on the one product that is quickest.
 *  Nothing else in the wording is touched. */
export function renderDeliveryText(template: string, days: number): string {
  const text = days === 1 ? template.replace(/\{days\}(\s*)days\b/gi, '{days}$1day') : template
  return text.replace(/\{days\}/g, String(days))
}

/** Whether any of the product's delivery services is an installation one.
 *
 *  A plain case-insensitive contains, so "Installation" and "Made To Order
 *  Installation" both count and a shop that calls it "Fitting" or "Assembly"
 *  simply says so on the block. An empty word matches nothing at all rather
 *  than everything - a blank setting means "do not print the extra line". */
export function mentionsInstallation(services: readonly string[] | undefined, word: string): boolean {
  const needle = word.trim().toLowerCase()
  if (!needle || !services) return false
  return services.some((label) => label.toLowerCase().includes(needle))
}
