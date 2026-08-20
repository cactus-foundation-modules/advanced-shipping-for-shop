// Shared domain types for Advanced Shipping. Table/column names in
// migrations/001_initial.sql are the source of truth; these describe the
// camelCase shape the TypeScript layer sees.

export type ScopeType = 'DEFAULT' | 'SUPPLIER' | 'CATEGORY' | 'RANGE'

// gov.uk bank-holiday division keys - the only three the shop-wide calendar
// offers. Mirrors modules/twilio/lib/holidays.ts (copied, not depended on).
export type HolidayRegion = 'england-and-wales' | 'scotland' | 'northern-ireland'

export const HOLIDAY_REGIONS: { id: HolidayRegion; label: string }[] = [
  { id: 'england-and-wales', label: 'England and Wales' },
  { id: 'scotland', label: 'Scotland' },
  { id: 'northern-ireland', label: 'Northern Ireland' },
]

export function isHolidayRegion(value: string): value is HolidayRegion {
  return HOLIDAY_REGIONS.some((r) => r.id === value)
}

// How the cart's per-line delivery-service picker is shown to the shopper: a
// compact dropdown (default) or a radio group with every service visible at once.
// How the basket shows a line's delivery services. 'summary' is the default:
// the chosen service is confirmed in place with its date and price, and every
// other service sits beside it as a one-click chip. 'dropdown' and 'radios'
// remain for a shop owner who prefers the plainer pickers.
export type CartControlStyle = 'summary' | 'dropdown' | 'radios'

export function isCartControlStyle(value: string): value is CartControlStyle {
  return value === 'summary' || value === 'dropdown' || value === 'radios'
}

// The shop-wide dispatch timing: what has to happen before any courier gets the
// parcel, regardless of which delivery service the shopper picked. Lives on the
// settings singleton because it is a fact about the warehouse.
export type DispatchTiming = {
  cutoffTime: string // "HH:MM", shop-timezone wall-clock
  dispatchLeadDays: number
  shipDays: number[] // weekday numbers 0=Sun .. 6=Sat
}

export type AshSettings = DispatchTiming & {
  rangeAttributeId: string | null
  holidayRegion: HolidayRegion
  holidaysSyncedAt: string | null
  defaultTierKey: string | null
  cartControlStyle: CartControlStyle
  // Product attribute (pat_attributes.id) whose value carries the person count
  // for per-person service pricing (e.g. a "Seats" attribute reading "6
  // People"). Null when the shop does not price anything per person.
  perPersonAttributeId: string | null
  // Whether a product page names the delivery services the chosen variation
  // cannot have - the dead chips reading "Unavailable" with the choice that
  // does carry the service. False drops them entirely, so the page shows only
  // what this variation can actually be bought with. Default true, which is the
  // behaviour every install had before the switch existed.
  showUnavailableServices: boolean
}

// A purchasable delivery service. transitDays is the service's usual courier
// time in ABSOLUTE working days (per-scope rows can override it); minLeadDays
// floors the whole estimate, never brings it in.
export type ServiceTier = {
  id: string
  key: string
  label: string
  // Shopper-facing copy shown beside the service wherever it is offered.
  description: string | null
  position: number
  transitDays: number
  minLeadDays: number | null
}

// Where a service is offered: per-scope price, per-person flag and optional
// absolute timing overrides (NULL inherits the service's own). Absence of a
// matching row IS the availability switch.
export type TierScopeConfig = {
  id: string
  tierId: string
  scopeType: ScopeType
  scopeRef: string | null
  available: boolean
  price: string // decimal string, "10.00"
  perPerson: boolean
  transitDays: number | null
  minLeadDays: number | null
}

// A service's timing after per-scope resolution - what computeEstimate consumes.
export type ResolvedTier = {
  transitDays: number
  minLeadDays: number | null
}

// The stock facts the estimate needs, lifted straight off ShpProduct.
export type StockState = {
  trackInventory: boolean
  stockCount: number | null
  outOfStockBehaviour: 'BLOCK' | 'BACKORDER'
  isPreOrder: boolean
  preOrderDispatchDate: string | null // "YYYY-MM-DD"
}

export type DeliveryEstimate = {
  available: boolean
  reason?: string
  // Delivered-by calendar date, "YYYY-MM-DD", or null when unavailable.
  targetDate: string | null
  // ISO instant of the cut-off the current estimate hangs on; the storefront
  // countdown ticks to this and re-fetches when it passes.
  cutoffInstantISO: string | null
  dispatchDate: string | null
  isBackorder: boolean
  isPreOrder: boolean
}
