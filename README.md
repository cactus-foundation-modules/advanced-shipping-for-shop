<p align="center">
  <img src="module-art.webp" alt="Advanced Shipping for Shop" width="640" />
</p>

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
  - `shop` (`>= 0.1.142`) - exposes the cart-line-resolver seam, the generic
    cart-line control this module uses for the basket picker, the shared picker
    component the product page's own block borrows, and the add-to-cart
    subscription that carries a product-page choice onto the new basket line.
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
- **Missing shipping rules** - the values of the nominated shipping attribute no
  delivery service prices, with a live-product count each, plus the values only
  some services price. Read-only: it names the gaps, the Delivery services
  screen fills them.
- **Holidays** - imports the official gov.uk bank-holiday calendar for the chosen
  region and stores it, so date maths never waits on the internet. Refreshed
  weekly by a cron.
- **Delivery settings** - the shop-wide dispatch timing (cut-off, days to
  dispatch, ship days, with a live "an order placed now" preview), which
  attribute is the **shipping attribute** (the one that usually means "range"),
  the bank-holiday region
  (England & Wales / Scotland / Northern Ireland), the default service, the
  basket picker style, and whether a product page names the services the chosen
  variation cannot have.

## The product page

Two blocks, both droppable on a Product Detail layout:

- **Product: Delivery estimate** - the "Delivery by Tue 29 Jul" line with its
  countdown.
- **Product: Shipping options** - the delivery-service picker, exactly as the
  basket shows it: every service the product is offered, what each one adds and
  when each one lands. It is shop's own picker component rendered from this
  module's data, so the two surfaces cannot drift apart, and it follows the
  basket picker style set in Delivery settings. It carries no heading by
  default, since each option already states its own outcome - set one on the
  block if the page wants it.

On a product with variations the picker follows the shopper's combination. Until
one is settled it shows only the services EVERY variation of that product
offers, each costed and dated at its worst across them, so nothing shown can be
withdrawn or dearer once they choose; as soon as a full combination is picked it
re-asks for that exact variation. That matters on a catalogue where the delivery
scope (the shipping attribute) is set on the variations rather than the listing -
the listing itself resolves to no services at all, so without this the block
would never appear. shop-variations announces the selection as a plain browser
event (`cactus-shop-variant-selection`, latest detail on
`window.__cactusVariantSelection`); this module listens for it without importing
anything, so an install without variations is unaffected.

Services the rest of the listing carries and the chosen variation does not are
named beneath the live ones, greyed out, with the choice that does carry them -
until a shop turns that off. **Services this choice cannot have** in Delivery
settings (`ash_settings.show_unavailable_services`, on by default) decides it,
and it is enforced server-side: with it off the estimate carries no
`otherTiers`, so the extra variation queries are never run and the picker has
nothing to draw.

A choice made on the product page is remembered for that product for the rest of
the browsing session, applied straight away to that product's basket line if it
is already in the basket, and otherwise carried onto the line the next
add-to-cart creates. Nothing is priced in the browser: the basket re-prices the
chosen service server-side exactly as it does for a choice made in the basket,
and a service the added item is not actually offered falls back to the shop's
default rather than being honoured.

## The basket

Each basket line shows its own delivery date and a **delivery-service picker**;
each service's description appears beneath its option. Changing the service
re-prices the line (the price is worked out server-side, never sent by the
browser) and the chosen service and promised date are snapshotted onto the
order line, so they are preserved exactly as quoted.

## Orders that are paid for later

A delivery date is counted from dispatch, and nothing is dispatched before it is
paid for. On a method that takes the money at the checkout those are the same
afternoon, so the date the basket promised stands. On a **pay-later method**
(bank transfer, cash) they are not: the shopper can sit on it for a fortnight,
and a receipt still reading "Delivery by Tuesday the 5th" is a promise nobody can
keep.

So on any payment method whose provider declares itself `confirmMode: 'manual'`:

- **At the checkout**, picking that method adds a line under it saying delivery
  dates start from the day the payment clears, and what the lead time on this
  basket actually is.
- **While the order is unpaid**, every line states its lead time instead of a
  date - "Standard Delivery - 5 working days from when your payment reaches us" -
  on the confirmation page, in the account's order history and in the admin.
- **The moment the payment is confirmed**, every line is re-dated from the day
  the money arrived and reads as a date again. The confirmation email, which only
  goes out then, carries the new date rather than the old one.

A pre-order line is left alone throughout: its date comes from the stock's own
arrival, which payment does not move.

Nothing here names bank transfer. It keys on the payment provider's own
`confirmMode`, so a later method with the same shape is covered without a change,
and every automatic method is untouched. It rides on shop's
`shop.order-payment-state` seam, which shop calls when an order is placed and
again when it is paid.

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
