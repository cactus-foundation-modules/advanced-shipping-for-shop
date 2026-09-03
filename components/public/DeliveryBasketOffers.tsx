'use client'

// The whole-order upgrade row: one chip per upgrade that only makes sense
// across the WHOLE basket - "get everything sooner", "have it all built for
// you" - which no single line can offer, because each line only knows itself.
//
// Self-contained, like the cut-off countdown beside it: it reads the cart from
// localStorage, asks the estimate API what every service would cost and when it
// would land on every line, and writes the shopper's choice straight back to the
// cart lines. Shop's cart then re-validates and re-prices on its own, so this
// needs no change to shop's cart at all.
//
// Drop it on the Cart page under the cut-off countdown, above the basket lines.
import { useCallback, useEffect, useState } from 'react'
import { getCart, cartLineKey, setLineMeta, subscribeCart } from '@/modules/shop/components/public/cart'
import { buildBasketOffers, formatOfferPrice, type BasketOffer } from '@/modules/advanced-shipping-for-shop/lib/basket-offers'
import type { ItemEstimate } from '@/modules/advanced-shipping-for-shop/lib/estimate-service'

const css = `
.ash-offers{display:flex;flex-wrap:wrap;align-items:center;gap:0.5rem 0.75rem;margin:12px 0}
.ash-offers-t{font-size:0.75rem;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:var(--color-text-muted)}
.ash-offer{display:inline-flex;flex-wrap:wrap;align-items:baseline;gap:0.5rem;border:1px solid var(--color-border);
  background:var(--color-surface);border-radius:9999px;padding:0.4375rem 1rem;font-family:inherit;font-size:0.875rem;
  text-align:left;cursor:pointer;transition:border-color 120ms ease-out,background 120ms ease-out}
.ash-offer:hover:not(:disabled){border-color:var(--color-primary);background:var(--color-primary-subtle)}
.ash-offer:disabled{cursor:default;opacity:0.6}
.ash-offer-title{font-weight:700;color:var(--color-primary)}
.ash-offer-fee{font-weight:700;color:var(--color-text)}
.ash-offer-free{color:var(--color-success)}
.ash-offer-detail{color:var(--color-text-secondary)}
@media (pointer:coarse){.ash-offer{padding:0.5625rem 1rem}}
@media (prefers-reduced-motion:reduce){.ash-offer{transition:none}}
`

// A basket the editor canvas can show without a cart or a round-trip. Two
// upgrades, priced and dated, exactly as a real basket of several suppliers'
// items tends to produce.
const PREVIEW_OFFERS: BasketOffer[] = [
  { id: 'sooner', title: 'Get everything sooner', extraCost: 13.9, itemCount: 2, detail: 'first arrives Friday (was Thursday 6th of August)', changes: [] },
  { id: 'tier:built', title: 'Built or installed for you', extraCost: 66.9, itemCount: 3, detail: 'everything by Friday 11th Sep (was Friday 4th of September)', changes: [] },
]

export function DeliveryBasketOffers({ preview }: { preview?: boolean }) {
  const [offers, setOffers] = useState<BasketOffer[]>(preview ? PREVIEW_OFFERS : [])
  const [currencySymbol, setCurrencySymbol] = useState('£')
  // Set while a chip's writes are landing, so a second click can't half-apply a
  // different offer over the first one's lines.
  const [applying, setApplying] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const cart = getCart()
    if (cart.length < 2) { setOffers([]); return }
    try {
      const res = await fetch('/api/m/advanced-shipping-for-shop/estimate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: cart.map((l) => ({
            productId: l.productId,
            tierKey: l.meta && typeof l.meta.shippingTier === 'string' ? l.meta.shippingTier : undefined,
            quantity: l.quantity,
            // The cart line's own key, so an offer can be written back to the
            // right row - two of the same product on different services are one
            // product id but two lines.
            ref: cartLineKey(l),
          })),
        }),
      })
      if (!res.ok) return
      const data = (await res.json()) as { items: ItemEstimate[]; today?: string }
      // "Today" decides how chatty a date label is allowed to be ("tomorrow"
      // rather than a date). It has to be the SHOP's today, because every date
      // being labelled was worked out in the shop's timezone - a shopper whose
      // own clock has already rolled over would otherwise be told "tomorrow"
      // about a date that, to the shop, is today. Falls back to the browser's
      // day only if an older estimate endpoint does not send one.
      const today = data.today ?? new Intl.DateTimeFormat('en-CA').format(new Date())
      setOffers(buildBasketOffers(data.items ?? [], today))
    } catch {
      // Best-effort chrome - the row simply stays hidden if the estimate fails.
    }
  }, [])

  useEffect(() => {
    if (preview) return
    let cancelled = false
    fetch('/api/m/shop/public/config')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => { if (!cancelled && data?.currencySymbol) setCurrencySymbol(data.currencySymbol) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [preview])

  useEffect(() => {
    if (preview) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- delegating to an async loader; setState runs after the estimate fetch resolves
    void refresh()
    const unsubscribe = subscribeCart(() => { void refresh() })
    // A cut-off passing while the tab sits open changes every date behind these
    // offers, so re-check on the way back in rather than showing stale ones.
    const onFocus = () => { void refresh() }
    window.addEventListener('focus', onFocus)
    return () => { unsubscribe(); window.removeEventListener('focus', onFocus) }
  }, [preview, refresh])

  async function apply(offer: BasketOffer) {
    if (preview || applying) return
    setApplying(offer.id)
    try {
      // Each write publishes a cart change, which shop's cart picks up and
      // re-validates on its own. The row is held disabled until this offer's
      // own re-read lands, so a second click can't act on figures that describe
      // the basket as it was before the first one.
      for (const change of offer.changes) setLineMeta(change.ref, { shippingTier: change.tierKey })
      await refresh()
    } finally {
      setApplying(null)
    }
  }

  if (offers.length === 0) return null

  return (
    <>
      <style>{css}</style>
      <div className="ash-offers">
        <span className="ash-offers-t">Whole order</span>
        {offers.map((offer) => (
          <button
            key={offer.id}
            type="button"
            className="ash-offer"
            disabled={preview || applying !== null}
            onClick={() => { void apply(offer) }}
          >
            <span className="ash-offer-title">{offer.title}</span>
            <span className={`ash-offer-fee${offer.extraCost <= 0 ? ' ash-offer-free' : ''}`}>
              {formatOfferPrice(offer.extraCost, currencySymbol)}
            </span>
            <span className="ash-offer-detail">
              ({offer.itemCount} item{offer.itemCount === 1 ? '' : 's'}){offer.detail ? ` · ${offer.detail}` : ''}
            </span>
          </button>
        ))}
      </div>
    </>
  )
}
