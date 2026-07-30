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
.ash-svc-h{margin:0 0 8px;font-size:0.9375rem;font-weight:600;color:var(--color-text)}`

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

  const slug = slugProp ?? (typeof window === 'undefined' ? null : slugFromLocation())

  const load = useCallback(async (tierKey: string | null) => {
    if (!slug) return
    try {
      const res = await fetch('/api/m/advanced-shipping-for-shop/estimate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: [{ slug, tierKey: tierKey ?? undefined }] }),
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

  useEffect(() => {
    if (preview || !slug) return
    knownKeys.current = new Set(getCart().map(cartLineKey))
    // eslint-disable-next-line react-hooks/set-state-in-effect -- delegating to an async loader; setState runs after the estimate fetch resolves
    void load(readStoredTier(slug))
  }, [preview, slug, load])

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
  if (!control) return null

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
        <CartLineControlView
          control={control}
          groupName={`ash-svc-${item?.productId ?? 'preview'}`}
          preview={preview}
          onChange={onChange}
        />
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
}
