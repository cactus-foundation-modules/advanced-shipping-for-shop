# Advanced Shipping for Shop

Turns the shop's vague "within a few working days" into a concrete, live
**delivery date** on every product page and in the basket, and adds paid
**delivery-and-assembly service tiers** the shopper picks per item at checkout.

Delivery timing is worked out from the product's supplier, category and "range",
the chosen service tier, and the time of day against a daily cut-off, always
counting **working days only** - weekends and UK bank holidays are skipped.

- **Table prefix:** `ash_`
- **Depends on:**
  - `shop` (`>= 0.1.104`) - exposes the cart-line-resolver, product-detail and
    product-editor-section seams, and the generic cart-line control this module
    uses for the basket picker.
  - `product-attributes-for-shop` (`>= 0.1.27`) - supplies the structured "range"
    attribute rules key on.

## How delivery dates are worked out

1. **A rule is chosen** for the product - the most specific one that matches it:
   its **range**, else its **category** (nearest ancestor), else its
   **supplier**, else the shop **default**. The whole winning rule is used; there
   is no field-level mixing between tiers. A per-product **override** can then
   patch individual fields of the winning rule.
2. **The rule computes a date.** Two fulfilment modes:
   - **Stocked** - order before the cut-off on a shipping day and it clears
     today, otherwise the next working day; add the dispatch lead, then transit.
   - **Made to order** - no cut-off; today plus the make lead, then transit.
   Backorders add a restock lead; pre-orders dispatch on the product's pre-order
   date. Every step counts working days only.
3. **The service tier adjusts it.** A tier can shift the dispatch or transit
   days, or floor the whole estimate at a minimum (e.g. a full installation is
   never sooner than ~10 working days out). A tier that really does go out on
   the clearing day sets a dispatch delta that cancels the rule's own lead.

The storefront shows "Delivery by Tue 29 Jul" with a live countdown to the
cut-off; when the cut-off passes it re-checks and the date rolls forward.

## Admin

A **Delivery** section in the admin sidebar:

- **Delivery rules** - one rule per scope (default / supplier / category / range),
  with a live preview of the date an order placed now would land on.
- **Service tiers** - the delivery-and-assembly options, with per-scope prices
  (so Seating can cost differently from everything else).
- **Holidays** - imports the official gov.uk bank-holiday calendar for the chosen
  region and stores it, so date maths never waits on the internet. Refreshed
  weekly by a cron.
- **Delivery settings** - which attribute means "range", the bank-holiday region
  (England & Wales / Scotland / Northern Ireland), and the default tier.

Each product's editor gains a **Delivery** tab for per-product overrides.

## The basket

Each basket line shows its own delivery date and a **service-tier picker**.
Changing the tier re-prices the line (the price is worked out server-side, never
sent by the browser) and the chosen tier and promised date are snapshotted onto
the order line, so they are preserved exactly as quoted.

## Configuration

No environment variables. Everything is configured in the admin. The weekly
holiday refresh cron uses the same `CRON_SECRET` as the shop's own crons.

## Data

All tables are prefixed `ash_`: `ash_settings`, `ash_delivery_rules`,
`ash_service_tiers`, `ash_tier_scope_config`, `ash_holidays`,
`ash_product_overrides`. Times of day (cut-offs) are stored as plain `HH:MM`
London wall-clock strings, and dates are computed with native `Intl` - no
date library, no timezone maths hidden in a column.
