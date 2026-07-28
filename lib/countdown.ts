// Shared cut-off countdown helpers, used by both storefront islands: the
// product-detail delivery line (one product, its own cut-off) and the basket
// summary (one countdown for the whole cart, but only when every line shares
// the same cut-off instant - otherwise a single figure would be a lie).

function plural(n: number, unit: string): string {
  return `${n} ${unit}${n === 1 ? '' : 's'}`
}

// "6 hours and 12 minutes" / "12 minutes and 48 seconds" / "48 seconds" - the
// largest two useful units of the time left, spelled out. A whole unit drops the
// smaller half entirely ("6 hours", not "6 hours and 0 minutes").
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) return m > 0 ? `${plural(h, 'hour')} and ${plural(m, 'minute')}` : plural(h, 'hour')
  if (m > 0) return s > 0 ? `${plural(m, 'minute')} and ${plural(s, 'second')}` : plural(m, 'minute')
  return plural(s, 'second')
}

export type CutoffBearing = { hasEstimate: boolean; available: boolean; cutoffInstantISO: string | null }

// The one cut-off the whole basket shares, or null when there isn't one. Null
// whenever a line has no cut-off of its own (made to order, no rule) or two
// lines disagree, so the basket falls back to saying nothing rather than
// promising a deadline that only holds for some of it. Lines with no estimate,
// and unavailable ones, carry no promise and are ignored.
export function sharedCutoffInstant(items: CutoffBearing[]): string | null {
  const promising = items.filter((i) => i.hasEstimate && i.available)
  if (promising.length === 0) return null
  const first = promising[0]!.cutoffInstantISO
  if (!first) return null
  return promising.every((i) => i.cutoffInstantISO === first) ? first : null
}
