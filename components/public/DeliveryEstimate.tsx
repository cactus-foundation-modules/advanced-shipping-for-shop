'use client'

// The storefront "Delivery by <date>" line. A client island so it needs no
// server product context (shop only hands `_ctx` to its own detail parts): it
// reads the product slug from the URL, asks the estimate API for the standard
// tier's date, and shows a live countdown to the dispatch cut-off. When the
// cut-off passes it re-fetches, and the server rolls the date to the next day.
import { useEffect, useMemo, useState } from 'react'
import { formatCountdown } from '@/modules/advanced-shipping-for-shop/lib/countdown'
import { slugFromLocation } from '@/modules/advanced-shipping-for-shop/lib/product-slug'

type ItemEstimate = {
  hasEstimate: boolean
  available: boolean
  reason?: string
  targetLabel: string | null
  cutoffInstantISO: string | null
  isBackorder: boolean
  isPreOrder: boolean
}

const css = `.ash-delivery{margin-top:14px;background:var(--color-bg-subtle);border:1px solid var(--color-border);border-radius:8px;padding:10px 12px;font-size:14px;color:var(--color-fg)}
.ash-delivery-date{font-weight:600}
.ash-delivery-note{display:block;margin:2px 0 0;font-size:12.5px;color:var(--color-text-muted)}`

export function DeliveryEstimate({ slug: slugProp, preview }: { slug?: string; preview?: boolean }) {
  const [estimate, setEstimate] = useState<ItemEstimate | null>(preview ? PREVIEW : null)
  const [now, setNow] = useState<number>(() => Date.now())
  const slug = useMemo(() => slugProp ?? slugFromLocation(), [slugProp])

  // Fetch on mount and whenever the slug changes.
  useEffect(() => {
    if (preview || !slug) return
    let cancelled = false
    async function load() {
      try {
        const res = await fetch('/api/m/advanced-shipping-for-shop/estimate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ items: [{ slug }] }),
        })
        if (!res.ok) return
        const data = (await res.json()) as { items: ItemEstimate[] }
        if (!cancelled) setEstimate(data.items[0] ?? null)
      } catch {
        // A failed estimate simply shows nothing rather than an error - the page
        // is still perfectly usable without the delivery line.
      }
    }
    void load()
    return () => { cancelled = true }
  }, [slug, preview])

  // Tick once a second while a cut-off is pending; re-fetch when it passes so the
  // date rolls forward.
  const cutoffMs = estimate?.cutoffInstantISO ? new Date(estimate.cutoffInstantISO).getTime() : null
  useEffect(() => {
    if (preview || cutoffMs == null) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [cutoffMs, preview])

  // When the cut-off passes, ask again (the server rolls the date and returns the
  // next cut-off). Guarded so it fires once per crossing, not every tick.
  const [lastRolled, setLastRolled] = useState<number | null>(null)
  useEffect(() => {
    if (preview || cutoffMs == null || !slug) return
    if (now < cutoffMs || lastRolled === cutoffMs) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- guarded to fire once per cut-off crossing (prevents a re-fetch loop), then rolls the date
    setLastRolled(cutoffMs)
    fetch('/api/m/advanced-shipping-for-shop/estimate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: [{ slug }] }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => { if (data?.items?.[0]) setEstimate(data.items[0]) })
      .catch(() => {})
  }, [now, cutoffMs, lastRolled, slug, preview])

  if (!estimate || !estimate.hasEstimate) return null

  if (!estimate.available) {
    return (
      <>
        <style>{css}</style>
        <p className="ash-delivery">{estimate.reason || 'Delivery estimate unavailable'}</p>
      </>
    )
  }

  const remaining = cutoffMs != null ? cutoffMs - now : null
  const beforeCutoff = remaining != null && remaining > 0

  return (
    <>
      <style>{css}</style>
      <p className="ash-delivery">
        {'Delivery by '}
        <span className="ash-delivery-date">{estimate.targetLabel}</span>
        {estimate.isBackorder ? ' (on backorder)' : ''}
        {estimate.isPreOrder ? ' (pre-order)' : ''}
        {beforeCutoff && (
          <span className="ash-delivery-note">Order within {formatCountdown(remaining!)} to get it by then.</span>
        )}
      </p>
    </>
  )
}

const PREVIEW: ItemEstimate = {
  hasEstimate: true,
  available: true,
  targetLabel: 'Tue 29 Jul',
  cutoffInstantISO: null,
  isBackorder: false,
  isPreOrder: false,
}
