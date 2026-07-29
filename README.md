# Advanced Shipping for Shop

Turns the shop's vague "within a few working days" into a concrete, live
**delivery date** on every product page and in the basket, and adds paid
**delivery services** (standard, express, full installation…) the shopper picks
per item at checkout.

Delivery timing is worked out from the shop-wide dispatch timing (cut-off,
dispatch lead, ship days), the chosen delivery service's own delivery time -
which can differ by the product's supplier, category and "range" - always
counting **working days only**: weekends and UK bank holidays are skipped.

- **Table prefix:** `ash_`
- **Depends on:**
  - `shop` (`>= 0.1.119`) - exposes the cart-line-resolver seam and the generic
    cart-line control this module uses for the basket picker.
  - `product-attributes-for-shop` (`>= 0.1.27`) - supplies the structured "range"
    attribute prices and timings key on.

## How delivery dates are worked out

1. **Dispatch clears.** Order before the cut-off on a ship day and it clears
   today, otherwise the next working day; add the shop-wide dispatch lead. This
   part is the same whichever service is picked.
2. **The service adds its delivery time.** Each service carries its delivery
   time in working days. A service's **price rows** say where it is offered -
   the most specific row that matches the product wins: its **range**, else its
   **category** (nearest ancestor), else its **supplier**, else the everywhere
   row - and a row can override the service's delivery time and minimum for just
   that scope (so Standard can be 5 days for stocked ranges and 25 for a
   made-to-order one). No rows match = the service is simply not offered for
   that product. A service can also floor the whole estimate at a minimum (e.g.
   full installation is never sooner than ~10 working days out).
3. **Stock has the last word.** Pre-orders dispatch on the product's pre-order
   date; a product out of stock and set to block gets no promise at all.

The storefront shows "Delivery by Tue 29 Jul" with a live countdown to the
cut-off; when the cut-off passes it re-checks and the date rolls forward.

## Admin

A **Delivery** section in the admin sidebar:

- **Delivery services** - the delivery-and-assembly options: name, shopper-facing
  description, delivery time, and per-scope prices (so Seating can cost - and
  take - differently from everything else).
- **Holidays** - imports the official gov.uk bank-holiday calendar for the chosen
  region and stores it, so date maths never waits on the internet. Refreshed
  weekly by a cron.
- **Delivery settings** - the shop-wide dispatch timing (cut-off, days to
  dispatch, ship days, with a live "an order placed now" preview), which
  attribute means "range", per-person pricing, the bank-holiday region
  (England & Wales / Scotland / Northern Ireland), the default service and the
  basket picker style.

## The basket

Each basket line shows its own delivery date and a **delivery-service picker**;
each service's description appears beneath its option. Changing the service
re-prices the line (the price is worked out server-side, never sent by the
browser) and the chosen service and promised date are snapshotted onto the
order line, so they are preserved exactly as quoted.

## Configuration

No environment variables. Everything is configured in the admin. The weekly
holiday refresh cron uses the same `CRON_SECRET` as the shop's own crons.

## Data

All tables are prefixed `ash_`: `ash_settings`, `ash_service_tiers`,
`ash_tier_scope_config`, `ash_holidays`. Times of day (cut-offs) are stored as
plain `HH:MM` London wall-clock strings, and dates are computed with native
`Intl` - no date library, no timezone maths hidden in a column.

Earlier versions kept a separate delivery-rules table and a per-product override
layer; migration `007` folds both into the service grid, preserving every live
estimate.
