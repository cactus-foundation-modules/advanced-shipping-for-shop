'use client'

// The basket's arrivals panel: when the order is complete, and what turns up
// when. A basket drawn from several suppliers arrives in more than one parcel,
// and a shopper reading a column of per-line dates has to do the grouping in
// their head. This does it for them - one card per arrival date, naming what
// lands on it - and leads with the date the order is actually finished.
//
// Shown only when there is more than one date to reconcile. With everything
// landing together, each line already says so beside itself and a panel
// restating it is noise.
//
// Self-contained like the module's other basket blocks: it reads the cart from
// localStorage and asks the estimate API. Drop it on the Cart page underneath
// the basket lines.
import { useCallback, useEffect, useState } from 'react'
import { getCart, cartLineKey, subscribeCart } from '@/modules/shop/components/public/cart'
import type { GroupedDelivery } from '@/modules/advanced-shipping-for-shop/lib/estimate-service'

const css = `
.ash-arr{margin:20px 0;background:var(--color-bg-subtle);border-radius:12px;padding:1.5rem}
.ash-arr-h{margin:0 0 1.125rem;font-size:1.5rem;font-weight:700;color:var(--color-text)}
.ash-arr-g{display:flex;flex-wrap:wrap;gap:0.75rem}
.ash-arr-c{flex:1 1 210px;min-width:0;background:var(--color-surface);border-radius:8px;padding:0.875rem 1.125rem}
.ash-arr-d{margin:0;font-size:1rem;font-weight:700;color:var(--color-primary)}
.ash-arr-n{margin:0.3125rem 0 0;font-size:0.9375rem;color:var(--color-text-secondary);overflow-wrap:anywhere}
.ash-arr-f{display:flex;align-items:flex-start;gap:0.625rem;margin:1.125rem 0 0;font-size:0.9375rem;color:var(--color-text-secondary)}
.ash-arr-f svg{flex:none;margin-top:2px;color:var(--color-primary)}
@media (max-width:640px){
  .ash-arr{padding:1.125rem;border-radius:10px}
  .ash-arr-h{font-size:1.25rem}
  .ash-arr-c{flex-basis:100%}
}
`

// A canvas preview with three arrival dates, so the editor shows the panel at
// the size it actually reaches rather than a single tidy card.
const PREVIEW_GROUPS: GroupedDelivery[] = [
  { date: '2026-08-06', label: 'Thursday 6th of August', count: 2, names: ['Task chair', 'Desk with storage'], tierLabels: ['Flat-pack delivery'] },
  { date: '2026-08-20', label: 'Thursday 20th of August', count: 1, names: ['Boardroom table'], tierLabels: ['Flat-pack delivery'] },
  { date: '2026-09-04', label: 'Friday 4th of September', count: 1, names: ['Desktop screens'], tierLabels: ['Standard delivery'] },
]

function VanIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M1 3h15v13H1z" /><path d="M16 8h4l3 3v5h-7V8z" />
      <circle cx="5.5" cy="18.5" r="2.5" /><circle cx="18.5" cy="18.5" r="2.5" />
    </svg>
  )
}

export function DeliveryArrivals({ preview, note }: { preview?: boolean; note?: string }) {
  const [groups, setGroups] = useState<GroupedDelivery[]>(preview ? PREVIEW_GROUPS : [])

  const refresh = useCallback(async () => {
    const cart = getCart()
    if (cart.length === 0) { setGroups([]); return }
    try {
      const res = await fetch('/api/m/advanced-shipping-for-shop/estimate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: cart.map((l) => ({
            productId: l.productId,
            tierKey: l.meta && typeof l.meta.shippingTier === 'string' ? l.meta.shippingTier : undefined,
            quantity: l.quantity,
            ref: cartLineKey(l),
          })),
        }),
      })
      if (!res.ok) return
      const data = (await res.json()) as { deliveries: GroupedDelivery[] }
      setGroups(data.deliveries ?? [])
    } catch {
      // Best-effort - the panel stays hidden if the estimate can't be had.
    }
  }, [])

  useEffect(() => {
    if (preview) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- delegating to an async loader; setState runs after the estimate fetch resolves
    void refresh()
    const unsubscribe = subscribeCart(() => { void refresh() })
    const onFocus = () => { void refresh() }
    window.addEventListener('focus', onFocus)
    return () => { unsubscribe(); window.removeEventListener('focus', onFocus) }
  }, [preview, refresh])

  // One date, or none at all: nothing here the lines don't already say.
  if (groups.length < 2) return null

  // Dates arrive sorted, so the order is complete on the last of them.
  const complete = groups[groups.length - 1]!

  return (
    <>
      <style>{css}</style>
      <section className="ash-arr" aria-label="When your order arrives">
        <h2 className="ash-arr-h">Everything arrives by {complete.label}</h2>
        <div className="ash-arr-g">
          {groups.map((group) => (
            <div key={group.date} className="ash-arr-c">
              {/* The service leads where every item in this group is on the same
                  one; a mixed group just states the date, since naming one of
                  several services would misdescribe the rest. */}
              <p className="ash-arr-d">
                {group.tierLabels.length === 1 ? `${group.tierLabels[0]} by ${group.label}` : `Arrives by ${group.label}`}
              </p>
              <p className="ash-arr-n">
                {group.names.length > 0
                  ? group.names.join(' + ')
                  : `${group.count} item${group.count === 1 ? '' : 's'}`}
              </p>
            </div>
          ))}
        </div>
        {/* Undefined means a block saved before the field existed, which keeps
            the wording it was already showing; emptied on purpose means gone. */}
        {note !== '' && (
          <p className="ash-arr-f">
            <VanIcon />
            <span>{note ?? DEFAULT_ARRIVALS_NOTE}</span>
          </p>
        )}
      </section>
    </>
  )
}

// The block's starting wording, exported so the Puck field can offer it as the
// default the owner then edits or clears.
export const DEFAULT_ARRIVALS_NOTE =
  'Each piece comes straight from the warehouse that makes it, and every date is the latest your delivery will arrive. Most land sooner; we confirm exact days by email.'
