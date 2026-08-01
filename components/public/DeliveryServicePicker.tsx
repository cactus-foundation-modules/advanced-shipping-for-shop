'use client'

// The product page's delivery-service picker: the SAME control the basket shows
// beside a cart line, on the product itself, so a shopper can see what every
// delivery service costs and when it lands before adding anything.
//
// It renders shop's own CartLineControlView from data (never a copy of shop's
// markup), so the picker on the product page and the picker in the basket are
// one component and cannot drift apart. Like the delivery-estimate line beside
// it, it is a self-contained client island: it reads the product slug from the
// URL and asks the estimate API, because shop hands its server-side product
// context only to its own detail parts.
//
// What a pick actually does:
//  - it is remembered for this product for the rest of the browsing session, so
//    coming back to the page (or reloading it) does not silently reset it;
//  - if the product is already in the basket, that line is switched to the same
//    service straight away, so the two surfaces never contradict each other;
//  - otherwise it is applied to the line the next add-to-cart creates - including
//    a variation's own product, which is a different product id than this page's.
//    An unoffered service is simply ignored server-side (the cart-line resolver
//    falls back to the shop's default), so a variant that does not carry the
//    chosen service is priced correctly rather than wrongly.
//
// The money is never settled here: the cart re-prices the chosen service
// server-side on every validate, exactly as it does for a pick made in the
// basket.
import { useCallback, useEffect, useRef, useState } from 'react'
import { CartLineControlView } from '@/modules/shop/components/public/CartLineControlView'
import { CART_LINE_CSS } from '@/modules/shop/components/public/cart-line-css'
import { getCart, cartLineKey, setLineMeta, subscribeCartAdd } from '@/modules/shop/components/public/cart'
import { buildProductTierControl } from '@/modules/advanced-shipping-for-shop/lib/product-control'
import { slugFromLocation } from '@/modules/advanced-shipping-for-shop/lib/product-slug'
import type { ItemEstimate } from '@/modules/advanced-shipping-for-shop/lib/estimate-service'
import type { CartControlStyle } from '@/modules/advanced-shipping-for-shop/lib/types'

const css = `.ash-svc{margin-top:14px}
.ash-svc-h{margin:0 0 8px;font-size:0.9375rem;font-weight:600;color:var(--color-text)}
/* The switch-to chips run 10% smaller here than in the basket. A cart line has a
   column of its own to fill; on a product page the row sits under the buy panel
   beside the price and the add button, where the basket's size reads loud. Every
   number below is shop's own value times 0.9, scoped to this block so the cart
   keeps its own. The coarse-pointer copy is repeated for the same reason it
   exists in shop's sheet - a fingertip still needs the bigger target - shrunk by
   the same tenth. */
.ash-svc .scl-hints{gap:0.3375rem;margin-top:0.45rem}
.ash-svc .scl-hints-t{font-size:0.7313rem}
.ash-svc .scl-hint{font-size:0.7313rem;padding:0.225rem 0.5625rem}
.ash-svc .scl-hint-fee{margin-left:0.3938rem}
@media (pointer:coarse){
  .ash-svc .scl-hint{padding:0.45rem 0.7875rem}
}
/* A service another variation of this listing carries but this one does not:
   the same chip, dead, saying "Unavailable" where a live chip carries its price,
   with a line under it saying which choice does carry it. The name is left
   readable rather than struck through - a shopper is meant to recognise the
   service, and the word in the price slot is what says they cannot have it here.
   Dashed like an out-of-reach variation choice, and in the same muted ink, so the
   two rows on a product page read as one language rather than two. Not a
   <button> and not a radio - there is nothing here to pick. */
.ash-svc-off{display:flex;flex-wrap:wrap;align-items:flex-start;gap:0.3375rem;margin-top:0.45rem}
/* The two lines are one statement - the service and where it is to be had - so
   they sit as close as their own text allows: no gap between them, and a line
   height just past the letters rather than the page's roomy default. */
.ash-svc .ash-svc-offchip{display:inline-flex;flex-direction:column;align-items:flex-start;gap:0;line-height:1.15;
  white-space:normal;border-style:dashed;color:var(--color-text-muted);cursor:default;font-weight:500}
/* The chip is inert, so it must not light up under the pointer the way a live
   switch chip does. */
.ash-svc .ash-svc-offchip:hover{border-color:var(--color-border);background:var(--color-surface)}
.ash-svc-offchip .ash-svc-offname{font-weight:600}
.ash-svc-offchip .scl-hint-fee{color:var(--color-text-muted)}
.ash-svc-note{font-size:0.6875rem;font-weight:500;line-height:1.15;color:var(--color-text-muted)}`

// Per-product, per-session: a pick survives a reload and a trip to another page
// and back, but it is not a standing preference the shopper never agreed to.
const STORE_PREFIX = 'cactus_ash_product_tier:'

function readStoredTier(slug: string): string | null {
  try {
    return window.sessionStorage.getItem(STORE_PREFIX + slug)
  } catch {
    return null
  }
}

function storeTier(slug: string, key: string): void {
  try {
    window.sessionStorage.setItem(STORE_PREFIX + slug, key)
  } catch {
    // A locked-down browser simply forgets the pick on reload; everything else
    // about the picker still works.
  }
}

type EstimateResponse = { items: ItemEstimate[]; controlStyle?: CartControlStyle }

// shop-variations' page-wide announcement of the variation in hand. Read as a
// plain browser event with no import, because '@/modules/shop-variations/...'
// does not exist on an install without that module and a static import would
// break the build there (the same rule the delivery module's variations bridge
// follows on the server). A catalogue with no variations simply never fires it.
const VARIANT_SELECTION_EVENT = 'cactus-shop-variant-selection'
// `chosenValueIds` arrived alongside the rest in shop-variations 0.1.104 and is
// read defensively: an older copy of that module publishes the same event
// without it, which simply reads as "nothing picked yet" and words the
// unavailable services from the listing as a whole, exactly as before.
type VariantSelectionDetail = { slug: string; parentProductId: string | null; productId: string | null; allOptionsChosen: boolean; chosenValueIds?: string[] }

function currentVariantSelection(): VariantSelectionDetail | null {
  if (typeof window === 'undefined') return null
  const snapshot = (window as unknown as { __cactusVariantSelection?: VariantSelectionDetail }).__cactusVariantSelection
  return snapshot ?? null
}

export function DeliveryServicePicker({
  heading, slug: slugProp, preview,
}: { heading?: string; slug?: string; preview?: boolean }) {
  const [item, setItem] = useState<ItemEstimate | null>(preview ? PREVIEW_ITEM : null)
  const [style, setStyle] = useState<CartControlStyle>('summary')
  const [currencySymbol, setCurrencySymbol] = useState('£')
  const [chosen, setChosen] = useState<string | null>(null)
  // Whether the shopper picked a service themselves. Only a real pick is written
  // onto a cart line - pinning the shop's own default onto every line would
  // freeze a choice nobody made.
  const touched = useRef(false)
  // The cart as it stood at the last add (or at mount). A line whose key is not
  // in here is one the shopper has just added, which is the line a pick made on
  // this page belongs to. Deliberately not refreshed on every cart change: the
  // change event fires BEFORE the add event, so refreshing there would erase the
  // very difference this is here to spot.
  const knownKeys = useRef<Set<string>>(new Set())
  // The variation the shopper has settled on, or null while the combination is
  // incomplete (or there are no variations at all). Null asks about the listing
  // with the variant fallback on; a value asks about that exact variation.
  const [variantId, setVariantId] = useState<string | null>(null)
  // The options picked so far, whether or not they add up to a whole variation.
  // A half-built combination still decides where a service it cannot have IS to
  // be had - "in Black Fabric, Blue or Charcoal" means given the arms and
  // adjustments already chosen, not across the range as a whole. Joined into one
  // string so it can be an effect dependency without re-firing on every render.
  const [chosenValueKey, setChosenValueKey] = useState('')

  const slug = slugProp ?? (typeof window === 'undefined' ? null : slugFromLocation())

  const load = useCallback(async (tierKey: string | null, variantProductId: string | null, valueKey: string) => {
    if (!slug) return
    const chosenValueIds = valueKey ? valueKey.split('|') : undefined
    try {
      const res = await fetch('/api/m/advanced-shipping-for-shop/estimate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: [variantProductId
            // Either way the answer covers the whole listing: what this product
            // can have, and (as `otherTiers`) what the rest of its variations can
            // that it cannot, so nothing the shop sells is quietly dropped.
            ? { productId: variantProductId, tierKey: tierKey ?? undefined, variantAlternatives: true, chosenValueIds }
            // Nothing settled yet: ask about the listing, and let the server
            // answer from its variations where the listing itself carries no
            // services (a catalogue that keys delivery off the variations).
            : { slug, tierKey: tierKey ?? undefined, variantFallback: true, variantAlternatives: true, chosenValueIds }],
        }),
      })
      if (!res.ok) return
      const data = (await res.json()) as EstimateResponse
      const first = data.items?.[0] ?? null
      setItem(first)
      if (data.controlStyle) setStyle(data.controlStyle)
      // The server has already dropped a stored service the product no longer
      // offers, so its answer is the one to trust.
      if (first?.tierKey) setChosen(first.tierKey)
    } catch {
      // Best-effort chrome: a failed estimate leaves the block empty rather than
      // putting an error in front of a shopper trying to buy something.
    }
  }, [slug])

  // Follow the shopper's variation. A listing's own services are a preview of
  // what every variation agrees on; the moment one is settled, the picker asks
  // again for that exact variation and shows its real services and dates.
  useEffect(() => {
    if (preview) return
    const apply = (detail: VariantSelectionDetail | null) => {
      if (detail && slug && detail.slug && detail.slug !== slug) return
      setVariantId(detail?.productId ?? null)
      setChosenValueKey((detail?.chosenValueIds ?? []).join('|'))
    }
    apply(currentVariantSelection())
    const onSelection = (e: Event) => apply((e as CustomEvent<VariantSelectionDetail>).detail)
    window.addEventListener(VARIANT_SELECTION_EVENT, onSelection)
    return () => window.removeEventListener(VARIANT_SELECTION_EVENT, onSelection)
  }, [preview, slug])

  useEffect(() => {
    if (preview || !slug) return
    knownKeys.current = new Set(getCart().map(cartLineKey))
    // eslint-disable-next-line react-hooks/set-state-in-effect -- delegating to an async loader; setState runs after the estimate fetch resolves
    void load(readStoredTier(slug), variantId, chosenValueKey)
  }, [preview, slug, variantId, chosenValueKey, load])

  useEffect(() => {
    if (preview) return
    let cancelled = false
    fetch('/api/m/shop/public/config')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => { if (!cancelled && data?.currencySymbol) setCurrencySymbol(data.currencySymbol) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [preview])

  // A line added while this page is open takes the service chosen on it. Written
  // only to lines that carry no service of their own, so a line another surface
  // has already settled is left alone.
  useEffect(() => {
    if (preview) return
    return subscribeCartAdd(() => {
      const cart = getCart()
      if (touched.current && chosen) {
        for (const line of cart) {
          const key = cartLineKey(line)
          if (knownKeys.current.has(key)) continue
          if (line.meta && typeof line.meta.shippingTier === 'string') continue
          setLineMeta(key, { shippingTier: chosen })
        }
      }
      knownKeys.current = new Set(getCart().map(cartLineKey))
    })
  }, [preview, chosen])

  const onChange = useCallback((value: string) => {
    if (preview) return
    touched.current = true
    setChosen(value)
    if (slug) storeTier(slug, value)
    // Already in the basket: switch it there too, so the page and the basket
    // never show the shopper two different answers. Shop re-validates and
    // re-prices the line off the back of the write.
    const productId = item?.productId
    if (productId) {
      for (const line of getCart()) {
        if (line.productId === productId) setLineMeta(cartLineKey(line), { shippingTier: value })
      }
    }
  }, [preview, slug, item?.productId])

  const control = item
    ? buildProductTierControl(item, currencySymbol, style, preview ? null : chosen)
    : null
  // Services the rest of the listing carries and this product does not. Shown
  // even when there is no picker at all - a listing whose variations agree on no
  // single service still has services to tell a shopper about, and an empty
  // block would be the one answer that is plainly wrong.
  const others = item?.otherTiers ?? []
  if (!control && others.length === 0) return null

  return (
    <>
      {/* The basket's own stylesheet, which is where this picker's look lives.
          Imported whole rather than cherry-picked: shop owns those rules, and a
          copy of them here would be the drift this block exists to avoid. The
          rest of it matches nothing on a product page. */}
      <style>{CART_LINE_CSS}</style>
      <style>{css}</style>
      <div className="ash-svc">
        {heading ? <p className="ash-svc-h">{heading}</p> : null}
        {control && (
          <CartLineControlView
            control={control}
            groupName={`ash-svc-${item?.productId ?? 'preview'}`}
            preview={preview}
            onChange={onChange}
          />
        )}
        {others.length > 0 && (
          <div className="ash-svc-off">
            {others.map((o) => (
              // The whole sentence rides on `title` as well as being printed:
              // the chip is narrow, the note wraps, and a shopper hovering the
              // dead name should not have to read it twice to be sure.
              <span key={o.key} className="scl-hint ash-svc-offchip" title={`${o.label} - unavailable. ${o.note}`}>
                <span>
                  <span className="ash-svc-offname">{o.label}</span>
                  {/* Where a live chip carries its fee. The price of a service
                      this variation cannot have is not a price the shopper can
                      pay, so the slot says so instead of quoting a number. */}
                  <span className="scl-hint-fee">Unavailable</span>
                </span>
                <span className="ash-svc-note">{o.note}</span>
              </span>
            ))}
          </div>
        )}
      </div>
    </>
  )
}

// A product with three services, priced and dated, so the editor canvas shows
// the block at its real size without a shop behind it.
const PREVIEW_ITEM: ItemEstimate = {
  productId: 'preview',
  ref: null,
  name: 'Preview product',
  hasEstimate: true,
  available: true,
  targetDate: '2026-08-07',
  targetLabel: 'Fri 7 Aug',
  cutoffInstantISO: null,
  isBackorder: false,
  isPreOrder: false,
  tierKey: 'standard',
  tiers: [
    { key: 'standard', label: 'Standard delivery', description: null, price: '0.00', priceEffective: 0, targetDate: '2026-08-07', targetLabel: 'Fri 7 Aug', targetByLabel: 'Friday' },
    { key: 'express', label: 'Express delivery', description: null, price: '9.95', priceEffective: 9.95, targetDate: '2026-08-04', targetLabel: 'Tue 4 Aug', targetByLabel: 'Tuesday' },
    { key: 'installed', label: 'Delivered and installed', description: 'Built in the room of your choice, packaging taken away.', price: '66.00', priceEffective: 66, targetDate: '2026-08-14', targetLabel: 'Fri 14 Aug', targetByLabel: 'Fri 14th' },
  ],
  // One service the preview product's other variations carry and this one does
  // not, so the editor canvas shows the unavailable-service row at its real size
  // too.
  otherTiers: [
    { key: 'two-man', label: 'Two-person delivery', description: null, priceEffective: 24, note: 'Available in 160 to 200cm' },
  ],
}
