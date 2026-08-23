// How a delivery service is worded and priced for a shopper. Pure arithmetic and
// string building - no database, no request context - so both the server-side
// cart-line resolver and the storefront's own client islands can use it and the
// wording can never drift between the basket and the product page.
//
// A service's price is a flat figure per line, and its wording is assembled in
// two shapes: one flat label (for a dropdown or a radio) and the same parts
// pre-split for the summary card the basket renders.

// The parts of a service this file needs to price it. Structural, so both the
// resolved tier (lib/resolve.ts) and a plain API row satisfy it without either
// side importing the other.
export type PricedTier = { price: string }

// The amount a service adds to a line. Rounded to the penny so the optimistic
// client figure matches the server's.
export function effectiveTierPrice(t: PricedTier): number {
  return Math.round((Number(t.price) || 0) * 100) / 100
}

export function tierOptionLabel(label: string, price: number, symbol: string, byLabel: string | null): string {
  const base = byLabel ? `${label} by ${byLabel}` : label
  if (price <= 0) return `${base} (included)`
  return `${base} (+${symbol}${price.toFixed(2)})`
}

// The same option, broken into the parts the basket's summary presentation lays
// out - so the basket never has to pick a label apart to find the date, the
// service or the price. `headline` is what the line reads once this service is
// the chosen one, `switchLabel` is the compact wording on the chip that swaps to
// it, and `priceLabel` is the price on its own.
export function tierOptionSummary(
  label: string, price: number, symbol: string, byLabel: string | null, dateLabel: string | null,
) {
  return {
    headline: dateLabel ? `Arrives by ${dateLabel}` : label,
    secondary: dateLabel ? label : undefined,
    switchLabel: byLabel ? `${label} by ${byLabel}` : label,
    priceLabel: price <= 0 ? 'Free' : `+${symbol}${price.toFixed(2)}`,
  }
}
