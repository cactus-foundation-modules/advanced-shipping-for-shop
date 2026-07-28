'use client'

// The grouped "Arrives in N deliveries" basket banner. A self-contained client
// island: it reads the whole cart from localStorage, asks the estimate API for
// each line's date (honouring the tier chosen on that line), and folds the
// result into one summary. Dropped onto the Cart page as its own Puck block, so
// it needs no change to shop's cart at all.
//
// It also carries the basket's dispatch countdown - ONE line for the lot, shown
// only when every item shares the same cut-off instant. Per-item countdowns in a
// cart are noise (and a per-line one that disagreed with its neighbour would
// just puzzle the shopper), so a mixed basket simply shows the dates and no
// deadline.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { getCart, subscribeCart } from '@/modules/shop/components/public/cart'
import { formatCountdown, sharedCutoffInstant, type CutoffBearing } from '@/modules/advanced-shipping-for-shop/lib/countdown'

type GroupedDelivery = { date: string; label: string; count: number }

const css = `.ash-cart-summary{margin:12px 0;background:var(--color-bg-subtle);border:1px solid var(--color-border);border-radius:8px;padding:10px 14px;font-size:14px;color:var(--color-fg)}
.ash-cart-summary strong{font-weight:600}
.ash-cart-summary p{margin:0}
.ash-cart-summary ul{list-style:none;margin:6px 0 0;padding:0;display:grid;gap:3px}
.ash-cart-summary li{font-size:13px;color:var(--color-text-muted)}
.ash-cart-cutoff{margin:0 0 4px}`

function items(count: number): string {
  return `${count} item${count === 1 ? '' : 's'}`
}

export function DeliveryCartSummary({ preview }: { preview?: boolean }) {
  const [deliveries, setDeliveries] = useState<GroupedDelivery[]>(preview ? PREVIEW : [])
  const [estimates, setEstimates] = useState<CutoffBearing[]>([])
  const [now, setNow] = useState<number>(() => Date.now())

  const refresh = useCallback(async () => {
    const cart = getCart()
    if (cart.length === 0) { setDeliveries([]); setEstimates([]); return }
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
      const data = (await res.json()) as { deliveries: GroupedDelivery[]; items: CutoffBearing[] }
      setDeliveries(data.deliveries ?? [])
      setEstimates(data.items ?? [])
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

  // One cut-off for the whole basket, or none at all (see sharedCutoffInstant).
  const cutoffMs = useMemo(() => {
    const iso = sharedCutoffInstant(estimates)
    return iso ? new Date(iso).getTime() : null
  }, [estimates])

  // Tick once a second while a cut-off is pending.
  useEffect(() => {
    if (preview || cutoffMs == null) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [cutoffMs, preview])

  // When the cut-off passes, ask again - the server rolls every line's date on
  // to the next dispatch. Guarded so it fires once per crossing, not every tick.
  const [lastRolled, setLastRolled] = useState<number | null>(null)
  useEffect(() => {
    if (preview || cutoffMs == null) return
    if (now < cutoffMs || lastRolled === cutoffMs) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- guarded to fire once per cut-off crossing (prevents a re-fetch loop), then rolls the dates
    setLastRolled(cutoffMs)
    void refresh()
  }, [now, cutoffMs, lastRolled, preview, refresh])

  if (deliveries.length === 0) return null

  const remaining = cutoffMs != null ? cutoffMs - now : null
  const countdown = preview ? PREVIEW_COUNTDOWN : remaining != null && remaining > 0 ? formatCountdown(remaining) : null

  return (
    <>
      <style>{css}</style>
      <div className="ash-cart-summary">
        {countdown && (
          <p className="ash-cart-cutoff">
            Order within <strong>{countdown}</strong> to keep {deliveries.length === 1 ? 'this date' : 'these dates'}.
          </p>
        )}
        {deliveries.length === 1 ? (
          <p>Everything arrives <strong>{deliveries[0]!.label}</strong>.</p>
        ) : (
          <>
            <p>Arrives in <strong>{deliveries.length} deliveries</strong>:</p>
            <ul>
              {deliveries.map((d) => (
                <li key={d.date}>{d.label} ({items(d.count)})</li>
              ))}
            </ul>
          </>
        )}
      </div>
    </>
  )
}

const PREVIEW: GroupedDelivery[] = [
  { date: '2026-07-29', label: 'Tue 29 Jul', count: 1 },
  { date: '2026-08-01', label: 'Sat 1 Aug', count: 2 },
]
const PREVIEW_COUNTDOWN = '5 hours and 12 minutes'
