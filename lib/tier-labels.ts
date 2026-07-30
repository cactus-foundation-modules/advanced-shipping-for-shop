// How a delivery service is worded and priced for a shopper. Pure arithmetic and
// string building - no database, no request context - so both the server-side
// cart-line resolver and the storefront's own client islands can use it and the
// wording can never drift between the basket and the product page.
//
// The service's price is a base figure that may be multiplied per person, and
// its wording is assembled in two shapes: one flat label (for a dropdown or a
// radio) and the same parts pre-split for the summary card the basket renders.

// The parts of a service this file needs to price it. Structural, so both the
// resolved tier (lib/resolve.ts) and a plain API row satisfy it without either
// side importing the other.
export type PricedTier = { price: string; perPerson: boolean }

// The amount a service adds to a line: its base price, or base × person count
// when it is priced per person. Returns null for a per-person service on a line
// with no readable count - it cannot be priced, so the line is blocked rather
// than guessed. Rounded to the penny so the optimistic client figure matches.
export function effectiveTierPrice(t: PricedTier, count: number | null): number | null {
  const base = Number(t.price) || 0
  if (!t.perPerson) return base
  if (count == null) return null
  return Math.round(base * count * 100) / 100
}

export function tierOptionLabel(label: string, price: number | null, symbol: string, byLabel: string | null): string {
  const base = byLabel ? `${label} by ${byLabel}` : label
  // A per-person service on a line whose count could not be read has no price to
  // show; the shopper is told it is priced per person and the line blocks on
  // selection until a person count is set.
  if (price == null) return `${base} (price per person)`
  if (price <= 0) return `${base} (included)`
  return `${base} (+${symbol}${price.toFixed(2)})`
}

// The same option, broken into the parts the basket's summary presentation lays
// out - so the basket never has to pick a label apart to find the date, the
// service or the price. `headline` is what the line reads once this service is
// the chosen one, `switchLabel` is the compact wording on the chip that swaps to
// it, and `priceLabel` is the price on its own.
export function tierOptionSummary(
  label: string, price: number | null, symbol: string, byLabel: string | null, dateLabel: string | null,
) {
  return {
    headline: dateLabel ? `Arrives by ${dateLabel}` : label,
    secondary: dateLabel ? label : undefined,
    switchLabel: byLabel ? `${label} by ${byLabel}` : label,
    priceLabel: price == null ? 'Per person' : price <= 0 ? 'Free' : `+${symbol}${price.toFixed(2)}`,
  }
}
