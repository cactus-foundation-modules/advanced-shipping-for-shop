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
import { postCartValidate } from '@/modules/shop/components/public/validated-cache'
import type { GroupedDelivery, ItemEstimate } from '@/modules/advanced-shipping-for-shop/lib/estimate-service'

const css = `
.ash-arr{margin:20px 0;background:var(--color-bg-subtle);border-radius:12px;padding:1.5rem}
.ash-arr-h{margin:0 0 1.125rem;font-size:1.5rem;font-weight:700;color:var(--color-text)}
.ash-arr-g{display:flex;flex-wrap:wrap;gap:0.75rem}
.ash-arr-c{flex:1 1 210px;min-width:0;background:var(--color-surface);border-radius:8px;padding:0.875rem 1.125rem}
.ash-arr-d{margin:0;font-size:1rem;font-weight:700;color:var(--color-primary)}
.ash-arr-n{margin:0.3125rem 0 0;font-size:0.9375rem;color:var(--color-text-secondary);overflow-wrap:anywhere}
.ash-arr-f{display:flex;align-items:flex-start;gap:0.625rem;margin:1.125rem 0 0;font-size:0.9375rem;color:var(--color-text-secondary)}
.ash-arr-f svg{flex:none;margin-top:2px;color:var(--color-primary)}
.ash-arr-ph{display:flex;flex-wrap:wrap;gap:0.5rem;margin:0.625rem 0 0}
.ash-arr-p{position:relative;display:inline-flex}
.ash-arr-pb{display:block;padding:0;border:1px solid var(--color-border);border-radius:8px;background:var(--color-bg-subtle);cursor:pointer;line-height:0;overflow:hidden}
.ash-arr-pb:focus-visible{outline:2px solid var(--color-primary);outline-offset:2px}
.ash-arr-pb img{display:block;width:56px;height:56px;object-fit:cover}
.ash-arr-pe{display:block;width:56px;height:56px}
.ash-arr-tt{position:absolute;bottom:calc(100% + 6px);left:50%;transform:translateX(-50%);z-index:20;width:max-content;max-width:200px;padding:0.375rem 0.5rem;background:var(--color-surface);color:var(--color-text);border:1px solid var(--color-border);border-radius:8px;box-shadow:var(--shadow-md);font-size:0.8125rem;line-height:1.35;text-align:center;pointer-events:none;opacity:0;visibility:hidden;transition:opacity 120ms ease}
.ash-arr-p:hover .ash-arr-tt,.ash-arr-pb:focus-visible+.ash-arr-tt,.ash-arr-tt[data-open]{opacity:1;visibility:visible}
.ash-arr-tt b{display:block;font-weight:600;overflow-wrap:anywhere}
.ash-arr-tt span{display:block;color:var(--color-text-muted);overflow-wrap:anywhere}
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

// The same made-up basket as photo tiles. No image urls - the canvas has no real
// products to point at - so the editor shows the empty tile, which is exactly
// what a live product with no photo gets too.
const PREVIEW_ITEMS: Record<string, ArrivalItem[]> = {
  '2026-08-06': [
    { key: 'p1', name: 'Task chair', options: ['Colour: Graphite'], imageUrl: null },
    { key: 'p2', name: 'Desk with storage', options: ['Width: 160cm', 'Finish: Oak'], imageUrl: null },
  ],
  '2026-08-20': [{ key: 'p3', name: 'Boardroom table', options: ['Seats: 8'], imageUrl: null }],
  '2026-09-04': [{ key: 'p4', name: 'Desktop screens', options: [], imageUrl: null }],
}

// How each arrival card says what is in it: the item names written out, or the
// products' own photos with the name and chosen options on hover. Undefined
// means a block saved before the choice existed, which keeps the names it was
// already showing.
export type ArrivalsItemDisplay = 'names' | 'photos'

// One item landing on an arrival date, as the photo tiles need it: a picture to
// show and the wording for its tooltip. `options` is the shopper's own choices
// on that line (a variation, an engraving), never the delivery service - the
// card's own headline already states that.
type ArrivalItem = { key: string; name: string; options: string[]; imageUrl: string | null }

// What the photo tiles need out of shop's cart validation. A narrow read of a
// much wider response: the same fields shop's own basket lines are drawn from.
type ValidatedLine = {
  productId: string
  lineId?: string | null
  name: string
  imageUrl: string | null
  displayTitle?: { name: string; secondary?: string } | null
  lineMeta?: { fields: { label: string; value: string }[] } | null
  control?: { label: string } | null
}

// Photo tiles per arrival date, matched line-for-line between the estimate (which
// knows WHEN each line lands) and shop's cart validation (which knows what it
// looks like and what was chosen). Both are keyed by the cart line key, so two of
// the same product on different options stay two tiles.
function itemsByDate(items: ItemEstimate[], lines: ValidatedLine[]): Record<string, ArrivalItem[]> {
  const byKey = new Map(lines.map((line) => [line.lineId ?? line.productId, line]))
  const out: Record<string, ArrivalItem[]> = {}
  for (const item of items) {
    if (!item.available || !item.targetDate) continue
    const line = item.ref ? byKey.get(item.ref) : undefined
    const name = line?.displayTitle?.name || line?.name || item.name
    if (!name) continue
    // The delivery tier's own confirmed field is the one meta field left out:
    // it restates the control's label, and the card's headline says it already.
    const fields = (line?.lineMeta?.fields ?? []).filter((f) => f.label !== line?.control?.label)
    const options = [
      ...(line?.displayTitle?.secondary ? [line.displayTitle.secondary] : []),
      ...fields.map((f) => `${f.label}: ${f.value}`),
    ]
    ;(out[item.targetDate] ??= []).push({
      key: item.ref ?? `${item.productId}-${out[item.targetDate]?.length ?? 0}`,
      name,
      options,
      imageUrl: line?.imageUrl ?? null,
    })
  }
  return out
}

function VanIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M1 3h15v13H1z" /><path d="M16 8h4l3 3v5h-7V8z" />
      <circle cx="5.5" cy="18.5" r="2.5" /><circle cx="18.5" cy="18.5" r="2.5" />
    </svg>
  )
}

export function DeliveryArrivals({ preview, note, itemDisplay }: { preview?: boolean; note?: string; itemDisplay?: ArrivalsItemDisplay }) {
  const photos = itemDisplay === 'photos'
  const [groups, setGroups] = useState<GroupedDelivery[]>(preview ? PREVIEW_GROUPS : [])
  const [items, setItems] = useState<Record<string, ArrivalItem[]>>(preview && photos ? PREVIEW_ITEMS : {})
  // Which tile's tooltip a tap opened. Hover handles a mouse; a touch screen has
  // no hover, so the tile is a button and tapping it holds the tooltip open.
  const [openKey, setOpenKey] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const cart = getCart()
    if (cart.length === 0) { setGroups([]); setItems({}); return }
    try {
      // Shop's own validation is asked for the pictures and the chosen options,
      // and only in photo mode. It single-flights with the basket's own call on
      // the same page, so the tiles cost no extra server work there.
      const [res, validated] = await Promise.all([
        fetch('/api/m/advanced-shipping-for-shop/estimate', {
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
        }),
        photos ? postCartValidate<ValidatedLine>(cart) : Promise.resolve(null),
      ])
      if (!res.ok) return
      const data = (await res.json()) as { deliveries: GroupedDelivery[]; items?: ItemEstimate[] }
      setGroups(data.deliveries ?? [])
      // No validation to hand (an older shop, a closed shop, a failed
      // round-trip) leaves the map empty, and each card falls back to writing
      // the names out - a card saying nothing at all would be worse.
      setItems(photos && validated ? itemsByDate(data.items ?? [], validated.lines) : {})
    } catch {
      // Best-effort - the panel stays hidden if the estimate can't be had.
    }
  }, [photos])

  useEffect(() => {
    if (preview) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- delegating to an async loader; setState runs after the estimate fetch resolves
    void refresh()
    const unsubscribe = subscribeCart(() => { void refresh() })
    const onFocus = () => { void refresh() }
    window.addEventListener('focus', onFocus)
    return () => { unsubscribe(); window.removeEventListener('focus', onFocus) }
  }, [preview, refresh])

  // The editor swaps between the two looks without a fetch, so the canvas has to
  // follow the field rather than whatever the first render happened to set.
  useEffect(() => {
    if (!preview) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the canvas preview IS derived from the field; there is no fetch to derive it from
    setItems(photos ? PREVIEW_ITEMS : {})
  }, [preview, photos])

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
              {(items[group.date]?.length ?? 0) > 0 ? (
                <div className="ash-arr-ph">
                  {items[group.date]!.map((item) => (
                    <span key={item.key} className="ash-arr-p">
                      {/* The name and the options ride the button's own label, so
                          they are never hover-only for a keyboard or screen
                          reader shopper; the chip itself is decoration. */}
                      <button
                        type="button"
                        className="ash-arr-pb"
                        aria-label={[item.name, ...item.options].join(' - ')}
                        onClick={() => setOpenKey((k) => (k === item.key ? null : item.key))}
                      >
                        {item.imageUrl
                          // eslint-disable-next-line @next/next/no-img-element -- storefront island; the url is a signed media url, not a static asset
                          ? <img src={item.imageUrl} alt="" />
                          : <span className="ash-arr-pe" />}
                      </button>
                      <span className="ash-arr-tt" aria-hidden="true" {...(openKey === item.key ? { 'data-open': '' } : {})}>
                        <b>{item.name}</b>
                        {item.options.map((option) => <span key={option}>{option}</span>)}
                      </span>
                    </span>
                  ))}
                </div>
              ) : (
                <p className="ash-arr-n">
                  {group.names.length > 0
                    ? group.names.join(' + ')
                    : `${group.count} item${group.count === 1 ? '' : 's'}`}
                </p>
              )}
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
