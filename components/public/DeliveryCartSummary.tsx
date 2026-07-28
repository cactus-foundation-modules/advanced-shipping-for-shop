'use client'

// The basket's dispatch countdown: ONE line for the whole cart, shown only when
// every item shares the same cut-off instant. A self-contained client island -
// it reads the cart from localStorage and asks the estimate API for each line's
// date (honouring the tier chosen on that line), so it needs no change to shop's
// cart at all. Dropped onto the Cart page as its own Puck block, above the
// basket lines, where it reads as a heading over the Delivery column.
//
// It deliberately shows no dates of its own. Every cart line already states its
// own delivery date beside its tier picker, and a restatement of the same dates
// in a banner above them was just noise.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { getCart, subscribeCart } from '@/modules/shop/components/public/cart'
import { formatCountdown, sharedCutoffInstant, type CutoffBearing } from '@/modules/advanced-shipping-for-shop/lib/countdown'

type GroupedDelivery = { date: string; label: string; count: number }

const css = `.ash-cart-cutoff{margin:12px 0;background:var(--color-bg-subtle);border:1px solid var(--color-border);border-radius:8px;padding:10px 14px;font-size:14px;color:var(--color-fg)}
.ash-cart-cutoff strong{font-weight:600}`

export function DeliveryCartSummary({ preview }: { preview?: boolean }) {
  const [deliveries, setDeliveries] = useState<GroupedDelivery[]>([])
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
      // Best-effort - the line just stays hidden if the estimate can't be had.
    }
  }, [])

  useEffect(() => {
    if (preview) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- delegating to an async loader; setState runs after the estimate fetch resolves
    void refresh()
    const unsubscribe = subscribeCart(() => { void refresh() })
    // Re-check when the shopper comes back to an open cart tab, so a passed
    // cut-off doesn't leave a stale figure sitting there.
    const onFocus = () => { void refresh() }
    window.addEventListener('focus', onFocus)
    return () => { unsubscribe(); window.removeEventListener('focus', onFocus) }
  }, [preview, refresh])

  // One cut-off for the whole basket, or none at all (see sharedCutoffInstant).
  const cutoffMs = useMemo(() => {
    const iso = sharedCutoffInstant(estimates)
    return iso ? new Date(iso).getTime() : null
  }, [estimates])

  // Tick once a second while a cut-off is pending, so the seconds move.
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

  const remaining = cutoffMs != null ? cutoffMs - now : null
  const countdown = preview ? PREVIEW_COUNTDOWN : remaining != null && remaining > 0 ? formatCountdown(remaining) : null
  if (!countdown) return null

  // Plural only: the dates themselves belong to the cart lines, not here.
  const dates = preview ? 2 : deliveries.length

  return (
    <>
      <style>{css}</style>
      <p className="ash-cart-cutoff">
        Order within <strong>{countdown}</strong> to keep {dates === 1 ? 'this delivery date' : 'these delivery dates'}.
      </p>
    </>
  )
}

const PREVIEW_COUNTDOWN = '5 hours and 12 minutes'
