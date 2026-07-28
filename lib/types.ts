// Shared domain types for Advanced Shipping. Table/column names in
// migrations/001_initial.sql are the source of truth; these describe the
// camelCase shape the TypeScript layer sees.

export type FulfilmentMode = 'STOCKED' | 'MADE_TO_ORDER'
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

// How the cart's per-line delivery-tier picker is shown to the shopper: a
// compact dropdown (default) or a radio group with every tier visible at once.
export type CartControlStyle = 'dropdown' | 'radios'

export function isCartControlStyle(value: string): value is CartControlStyle {
  return value === 'dropdown' || value === 'radios'
}

export type AshSettings = {
  rangeAttributeId: string | null
  holidayRegion: HolidayRegion
  holidaysSyncedAt: string | null
  defaultTierKey: string | null
  cartControlStyle: CartControlStyle
  // Product attribute (pat_attributes.id) whose value carries the person count
  // for per-person tier pricing (e.g. a "Seats" attribute reading "6 People").
  // Null when the shop does not price anything per person.
  perPersonAttributeId: string | null
}

export type DeliveryRule = {
  id: string
  scopeType: ScopeType
  scopeRef: string | null
  fulfilmentMode: FulfilmentMode
  cutoffTime: string // "HH:MM", London wall-clock
  dispatchLeadDays: number
  mtoLeadDays: number
  transitDays: number
  shipDays: number[] // weekday numbers 0=Sun .. 6=Sat
  backorderLeadDays: number | null
  position: number
}

export type ProductOverride = {
  productId: string
  fulfilmentMode: FulfilmentMode | null
  mtoLeadDays: number | null
  cutoffTime: string | null
  dispatchLeadDays: number | null
  transitDays: number | null
  backorderLeadDays: number | null
  disabled: boolean
}

export type ServiceTier = {
  id: string
  key: string
  label: string
  // Supplier name this tier is offered for, or null when it applies to every
  // product regardless of supplier. Lets several same-named tiers coexist, one
  // per supplier - the storefront shows each line only the tiers whose supplier
  // matches its product.
  supplier: string | null
  position: number
  dispatchLeadDelta: number
  transitDelta: number
  minLeadDays: number | null
}

export type TierScopeConfig = {
  id: string
  tierId: string
  scopeType: ScopeType
  scopeRef: string | null
  available: boolean
  price: string // decimal string, "10.00"
  // When true this price is per person: multiplied by the person count read off
  // the nominated count attribute, rather than charged once per line.
  perPerson: boolean
  // Per-scope timing overrides. NULL inherits the tier's own value, so one tier
  // can run different timings per range/category/supplier without being cloned
  // (the cloning is how duplicate tier names crept into live data). A scope
  // wanting NO minimum where the tier has one sets minLeadDays to 0.
  dispatchLeadDelta: number | null
  transitDelta: number | null
  minLeadDays: number | null
}

// The rule after per-product override patching - what computeEstimate consumes.
// Structurally a DeliveryRule minus the scope/id bookkeeping.
export type ResolvedRule = {
  fulfilmentMode: FulfilmentMode
  cutoffTime: string
  dispatchLeadDays: number
  mtoLeadDays: number
  transitDays: number
  shipDays: number[]
  backorderLeadDays: number | null
}

// Tier timing modifiers applied on top of a ResolvedRule. Price/availability are
// resolved separately (they do not affect the date maths).
export type ResolvedTier = {
  dispatchLeadDelta: number
  transitDelta: number
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
  // ISO instant of the cut-off the current estimate hangs on (STOCKED only);
  // the storefront countdown ticks to this and re-fetches when it passes.
  cutoffInstantISO: string | null
  dispatchDate: string | null
  isMadeToOrder: boolean
  isBackorder: boolean
  isPreOrder: boolean
}
