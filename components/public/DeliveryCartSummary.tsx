'use client'

// The grouped "Arrives in N deliveries" basket banner. A self-contained client
// island: it reads the whole cart from localStorage, asks the estimate API for
// each line's date (honouring the tier chosen on that line), and folds the
// result into one summary. Dropped onto the Cart page as its own Puck block, so
// it needs no change to shop's cart at all.
import { useCallback, useEffect, useState } from 'react'
import { getCart, subscribeCart } from '@/modules/shop/components/public/cart'

type GroupedDelivery = { date: string; label: string; count: number }

const css = `.ash-cart-summary{margin:12px 0;background:var(--color-bg-subtle);border:1px solid var(--color-border);border-radius:8px;padding:10px 14px;font-size:14px;color:var(--color-fg)}
.ash-cart-summary strong{font-weight:600}
.ash-cart-summary ul{list-style:none;margin:6px 0 0;padding:0;display:grid;gap:3px}
.ash-cart-summary li{font-size:13px;color:var(--color-text-muted)}`

function items(count: number): string {
  return `${count} item${count === 1 ? '' : 's'}`
}

export function DeliveryCartSummary({ preview }: { preview?: boolean }) {
  const [deliveries, setDeliveries] = useState<GroupedDelivery[]>(preview ? PREVIEW : [])

  const refresh = useCallback(async () => {
    const cart = getCart()
    if (cart.length === 0) { setDeliveries([]); return }
    try {
      const res = await fetch('/api/m/advanced-shipping-for-shop/estimate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: cart.map((l) => ({
            productId: l.productId,
            tierKey: l.meta && typeof l.meta.shippingTier === 'string' ? l.meta.shippingTier : undefined,
            quantity: l.quantity,
          })),
        }),
      })
      if (!res.ok) return
      const data = (await res.json()) as { deliveries: GroupedDelivery[] }
      setDeliveries(data.deliveries ?? [])
    } catch {
      // Best-effort - the banner just stays hidden if the estimate can't be had.
    }
  }, [])

  useEffect(() => {
    if (preview) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- delegating to an async loader; setState runs after the estimate fetch resolves
    void refresh()
    const unsubscribe = subscribeCart(() => { void refresh() })
    // Re-check when the shopper comes back to an open cart tab, so a passed
    // cut-off doesn't leave a stale date sitting there.
    const onFocus = () => { void refresh() }
    window.addEventListener('focus', onFocus)
    return () => { unsubscribe(); window.removeEventListener('focus', onFocus) }
  }, [preview, refresh])

  if (deliveries.length === 0) return null

  if (deliveries.length === 1) {
    return (
      <>
        <style>{css}</style>
        <p className="ash-cart-summary">Everything arrives <strong>{deliveries[0]!.label}</strong>.</p>
      </>
    )
  }

  return (
    <>
      <style>{css}</style>
      <div className="ash-cart-summary">
        Arrives in <strong>{deliveries.length} deliveries</strong>:
        <ul>
          {deliveries.map((d) => (
            <li key={d.date}>{d.label} ({items(d.count)})</li>
          ))}
        </ul>
      </div>
    </>
  )
}

const PREVIEW: GroupedDelivery[] = [
  { date: '2026-07-29', label: 'Tue 29 Jul', count: 1 },
  { date: '2026-08-01', label: 'Sat 1 Aug', count: 2 },
]
