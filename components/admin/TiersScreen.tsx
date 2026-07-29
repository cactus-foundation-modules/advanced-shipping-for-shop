'use client'

import { useCallback, useEffect, useState } from 'react'
import type { ScopeType, ServiceTier, TierScopeConfig } from '@/modules/advanced-shipping-for-shop/lib/types'
import { ScopePicker, scopeRefLabel, type ScopeOptions } from '@/modules/advanced-shipping-for-shop/components/admin/scope-picker'

const card = { border: '1px solid var(--color-border)', borderRadius: 12, background: 'var(--color-surface)', marginBottom: '1.25rem', overflow: 'hidden' } as const
const cardPad = { padding: '1rem 1.25rem' } as const
const field = { display: 'flex', flexDirection: 'column' as const, gap: '0.25rem', fontSize: '0.8125rem' }
const legend = { fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '0.04em', color: 'var(--color-text-muted)', margin: '0 0 0.5rem' }
const help = { color: 'var(--color-text-muted)', fontSize: '0.8125rem', margin: '0.375rem 0 0', lineHeight: 1.45 }
const num = { width: '5rem' }
const EMPTY_OPTIONS: ScopeOptions = { suppliers: [], categories: [], rangeValues: [] }

const pill = {
  fontSize: '0.75rem', padding: '0.15rem 0.5rem', borderRadius: 999,
  border: '1px solid var(--color-border)', background: 'var(--color-surface-raised)',
  color: 'var(--color-text-muted)', whiteSpace: 'nowrap' as const,
} as const
const pillAccent = {
  ...pill, border: '1px solid var(--color-primary)', color: 'var(--color-primary)',
  background: 'transparent',
} as const

type NewTier = { label: string; description: string; transitDays: number; minLeadDays: number | null }
const NEW_TIER: NewTier = { label: '', description: '', transitDays: 2, minLeadDays: null }

// Turn a service's timing into plain-English chips a shop owner can read at a
// glance.
function timingChips(t: { transitDays: number; minLeadDays: number | null }): string[] {
  const days = (n: number) => `${n} working day${n === 1 ? '' : 's'}`
  const chips: string[] = [t.transitDays === 0 ? 'Delivered on the dispatch day' : `${days(t.transitDays)} to deliver`]
  if (t.minLeadDays != null) chips.push(`Never sooner than ${days(t.minLeadDays)}`)
  return chips
}

// Chips for a price row's timing overrides - only the fields it actually
// overrides, so an all-null row shows nothing.
function overrideChips(c: TierScopeConfig): string[] {
  const days = (n: number) => `${n} working day${n === 1 ? '' : 's'}`
  const chips: string[] = []
  if (c.transitDays != null) chips.push(`${days(c.transitDays)} to deliver here`)
  if (c.minLeadDays != null) chips.push(c.minLeadDays === 0 ? 'No minimum here' : `Never sooner than ${days(c.minLeadDays)} here`)
  return chips
}

export function TiersScreen() {
  const [tiers, setTiers] = useState<ServiceTier[]>([])
  const [config, setConfig] = useState<TierScopeConfig[]>([])
  const [options, setOptions] = useState<ScopeOptions>(EMPTY_OPTIONS)
  const [newTier, setNewTier] = useState<NewTier>(NEW_TIER)
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const [tRes, cRes, oRes] = await Promise.all([
        fetch('/api/m/advanced-shipping-for-shop/admin/tiers'),
        fetch('/api/m/advanced-shipping-for-shop/admin/tier-config'),
        fetch('/api/m/advanced-shipping-for-shop/admin/options'),
      ])
      if (tRes.ok) setTiers((await tRes.json()).tiers ?? [])
      if (cRes.ok) setConfig((await cRes.json()).config ?? [])
      if (oRes.ok) {
        const o = await oRes.json()
        setOptions({ suppliers: o.suppliers ?? [], categories: o.categories ?? [], rangeValues: o.rangeValues ?? [] })
      }
    } catch {
      setError('Could not load delivery services.')
    }
  }, [])

  // eslint-disable-next-line react-hooks/set-state-in-effect -- delegating to an async loader; every setState runs after an await
  useEffect(() => { void load() }, [load])

  async function send(url: string, method: string, body?: unknown) {
    setBusy(true); setError(null)
    try {
      const res = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined })
      if (!res.ok) { const d = await res.json().catch(() => ({})); setError(d.error ?? 'Something went wrong.'); return false }
      await load(); return true
    } catch { setError('Something went wrong.'); return false } finally { setBusy(false) }
  }

  async function addTier() {
    if (!newTier.label.trim()) { setError('Give the service a name.'); return }
    if (await send('/api/m/advanced-shipping-for-shop/admin/tiers', 'POST', { ...newTier, description: newTier.description.trim() || null })) {
      setNewTier(NEW_TIER); setAdding(false)
    }
  }

  return (
    <div>
      {error && <div className="alert alert-danger" role="alert">{error}</div>}

      <p style={{ color: 'var(--color-text-muted)', margin: '0 0 1.25rem', fontSize: '0.875rem', lineHeight: 1.5, maxWidth: '46rem' }}>
        Delivery services are the options a shopper picks for each item in their basket, such as
        <em> Standard delivery</em> or <em>Full installation</em>. Each service says how many working
        days it takes after dispatch (dispatch timing itself lives in Delivery settings) and what it
        costs - and where a price applies is also where the service is offered at all. Set one up
        below, then say what it costs and where.
      </p>

      {/* Add a service - tucked behind a button so the list stays the star of the show */}
      <section style={{ ...card, borderStyle: adding ? 'solid' : 'dashed' }}>
        {!adding ? (
          <button
            type="button"
            onClick={() => { setError(null); setAdding(true) }}
            style={{ ...cardPad, width: '100%', textAlign: 'left', background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--color-primary)', fontSize: '0.9375rem', fontWeight: 600 }}
          >
            + Add a delivery service
          </button>
        ) : (
          <div style={cardPad}>
            <h2 style={{ fontSize: '0.9375rem', margin: '0 0 1rem' }}>New delivery service</h2>

            <fieldset style={{ border: 'none', padding: 0, margin: '0 0 1.25rem', minInlineSize: 'auto' }}>
              <legend style={legend}>What it&rsquo;s called</legend>
              <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                <label style={{ ...field, flex: '2 1 14rem' }}>Service name
                  <input className="form-control" value={newTier.label} placeholder="e.g. Full installation" onChange={(e) => setNewTier({ ...newTier, label: e.target.value })} />
                </label>
              </div>
              <label style={{ ...field, marginTop: '0.75rem' }}>Description <span style={{ fontWeight: 400, color: 'var(--color-text-muted)' }}>(optional, shown to shoppers)</span>
                <textarea
                  className="form-control"
                  rows={2}
                  value={newTier.description}
                  placeholder="e.g. Delivered to the room of your choice, assembled, packaging taken away."
                  onChange={(e) => setNewTier({ ...newTier, description: e.target.value })}
                />
              </label>
            </fieldset>

            <fieldset style={{ border: 'none', padding: 0, margin: 0, minInlineSize: 'auto' }}>
              <legend style={legend}>How long it takes</legend>
              <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                <label style={field}>Working days to deliver
                  <input className="form-control" style={num} type="number" min={0} value={newTier.transitDays} onChange={(e) => setNewTier({ ...newTier, transitDays: Number(e.target.value) })} />
                </label>
                <label style={field}>Never sooner than
                  <input className="form-control" style={num} type="number" min={0} value={newTier.minLeadDays ?? ''} placeholder="—" onChange={(e) => setNewTier({ ...newTier, minLeadDays: e.target.value === '' ? null : Number(e.target.value) })} />
                </label>
              </div>
              <p style={help}>Working days from dispatch to the shopper&rsquo;s door. Dispatch itself (cut-off time, days to pick and pack) is set once for the whole shop in Delivery settings. &ldquo;Never sooner than&rdquo; sets a floor in working days for services that need booking, like installation. You can give the service a different delivery time for one range or category when you add its price below.</p>
            </fieldset>

            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1.25rem' }}>
              <button type="button" className="btn btn-primary" onClick={addTier} disabled={busy}>Add service</button>
              <button type="button" className="btn btn-secondary" onClick={() => { setNewTier(NEW_TIER); setAdding(false); setError(null) }} disabled={busy}>Cancel</button>
            </div>
          </div>
        )}
      </section>

      {tiers.length === 0 && (
        <p style={{ color: 'var(--color-text-muted)', textAlign: 'center', padding: '2rem 1rem' }}>
          No delivery services yet. Add your first one above to start offering delivery choices at checkout.
        </p>
      )}
      {tiers.map((tier) => (
        <TierCard
          key={tier.id}
          tier={tier}
          config={config.filter((c) => c.tierId === tier.id)}
          options={options}
          busy={busy}
          send={send}
        />
      ))}
    </div>
  )
}

function TierCard({
  tier, config, options, busy, send,
}: {
  tier: ServiceTier
  config: TierScopeConfig[]
  options: ScopeOptions
  busy: boolean
  send: (url: string, method: string, body?: unknown) => Promise<boolean>
}) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState({ label: tier.label, description: tier.description ?? '', transitDays: tier.transitDays, minLeadDays: tier.minLeadDays })
  const [priceScope, setPriceScope] = useState<{
    scopeType: ScopeType; scopeRef: string | null; price: number; available: boolean; perPerson: boolean
    transitDays: number | null; minLeadDays: number | null
  }>({ scopeType: 'DEFAULT', scopeRef: null, price: 0, available: true, perPerson: false, transitDays: null, minLeadDays: null })
  // Reveals the per-scope timing inputs; closing it clears them back to
  // "inherit the service's timing" so nothing is sent by accident.
  const [customTiming, setCustomTiming] = useState(false)

  const base = `/api/m/advanced-shipping-for-shop/admin/tiers/${tier.id}`
  const chips = timingChips(tier)
  const priceSummary = config.length === 0 ? 'No prices set yet' : `${config.length} price${config.length === 1 ? '' : 's'} set`

  return (
    <section style={card}>
      {/* Header: everything a shop owner needs to recognise the service at a glance */}
      <div style={{ ...cardPad, display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 16rem', minWidth: 0 }}>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '0.375rem' }}>
            <strong style={{ fontSize: '0.9375rem' }}>{tier.label}</strong>
          </div>
          {tier.description && (
            <p style={{ margin: '0 0 0.375rem', fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>{tier.description}</p>
          )}
          <div style={{ display: 'flex', gap: '0.375rem', flexWrap: 'wrap' }}>
            {chips.map((c, i) => (<span key={i} style={pillAccent}>{c}</span>))}
            <span style={pill}>{priceSummary}</span>
          </div>
        </div>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          {open ? 'Done' : 'Edit'}
        </button>
      </div>

      {open && (
        <div style={{ ...cardPad, borderTop: '1px solid var(--color-border)', background: 'var(--color-surface-raised)' }}>
          {/* Name + timing */}
          <fieldset style={{ border: 'none', padding: 0, margin: '0 0 1.25rem', minInlineSize: 'auto' }}>
            <legend style={legend}>Name &amp; timing</legend>
            <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <label style={{ ...field, flex: '1 1 14rem' }}>Service name
                <input className="form-control" value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} />
              </label>
            </div>
            <label style={{ ...field, marginTop: '0.75rem' }}>Description <span style={{ fontWeight: 400, color: 'var(--color-text-muted)' }}>(optional, shown to shoppers)</span>
              <textarea
                className="form-control"
                rows={2}
                value={draft.description}
                placeholder="e.g. Delivered to the room of your choice, assembled, packaging taken away."
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              />
            </label>
            <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginTop: '0.75rem' }}>
              <label style={field}>Working days to deliver
                <input className="form-control" style={num} type="number" min={0} value={draft.transitDays} onChange={(e) => setDraft({ ...draft, transitDays: Number(e.target.value) })} />
              </label>
              <label style={field}>Never sooner than
                <input className="form-control" style={num} type="number" min={0} value={draft.minLeadDays ?? ''} placeholder="—" onChange={(e) => setDraft({ ...draft, minLeadDays: e.target.value === '' ? null : Number(e.target.value) })} />
              </label>
            </div>
            <p style={help}>Working days from dispatch to the door. A price row below can give this service a different delivery time for just that range or category.</p>
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.875rem' }}>
              <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => send(base, 'PATCH', { label: draft.label, description: draft.description.trim() || null, transitDays: draft.transitDays, minLeadDays: draft.minLeadDays })}>Save changes</button>
              <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => { if (confirm(`Delete the "${tier.label}" service?`)) void send(base, 'DELETE') }}>Delete service</button>
            </div>
          </fieldset>

          {/* Prices */}
          <fieldset style={{ border: 'none', padding: 0, margin: 0, minInlineSize: 'auto' }}>
            <legend style={legend}>Prices &amp; where it&rsquo;s offered</legend>
            <p style={{ ...help, marginTop: 0, marginBottom: '0.75rem' }}>
              A service is offered wherever it has a price row, and the most specific one wins: a range
              price beats a category price, which beats a supplier price, which beats the everywhere
              price. No rows anywhere means the service is never offered.
            </p>

            {config.length === 0 ? (
              <p style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)', margin: '0 0 0.75rem' }}>Not offered anywhere yet - add a price below to make this service available.</p>
            ) : (
              <div style={{ border: '1px solid var(--color-border)', borderRadius: 8, overflow: 'hidden', marginBottom: '0.875rem' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8125rem' }}>
                  <thead>
                    <tr style={{ textAlign: 'left', color: 'var(--color-text-muted)', background: 'var(--color-surface)' }}>
                      <th style={{ padding: '0.5rem 0.75rem', fontWeight: 600 }}>Applies to</th>
                      <th style={{ padding: '0.5rem 0.75rem', fontWeight: 600 }}>Price</th>
                      <th style={{ padding: '0.5rem 0.75rem', fontWeight: 600 }} aria-label="Actions" />
                    </tr>
                  </thead>
                  <tbody>
                    {config.map((c) => (
                      <tr key={c.id} style={{ borderTop: '1px solid var(--color-border)' }}>
                        <td style={{ padding: '0.5rem 0.75rem' }}>
                          {scopeRefLabel(c.scopeType, c.scopeRef, options)}
                          {overrideChips(c).length > 0 && (
                            <span style={{ display: 'inline-flex', gap: '0.25rem', flexWrap: 'wrap', marginLeft: '0.5rem', verticalAlign: 'middle' }}>
                              {overrideChips(c).map((chip, i) => (<span key={i} style={pillAccent}>{chip}</span>))}
                            </span>
                          )}
                        </td>
                        <td style={{ padding: '0.5rem 0.75rem' }}>
                          {c.available
                            ? <>£{c.price}{c.perPerson && <span style={{ color: 'var(--color-text-muted)' }}> per person</span>}</>
                            : <span style={{ color: 'var(--color-text-muted)' }}>Not available</span>}
                        </td>
                        <td style={{ padding: '0.5rem 0.75rem', textAlign: 'right' }}>
                          <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => send(`/api/m/advanced-shipping-for-shop/admin/tier-config/${c.id}`, 'DELETE')}>Remove</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div style={{ border: '1px dashed var(--color-border)', borderRadius: 8, padding: '0.875rem', display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <label style={{ ...field, flex: '1 1 16rem' }}>Applies to
                <ScopePicker
                  scopeType={priceScope.scopeType}
                  scopeRef={priceScope.scopeRef}
                  options={options}
                  allowRange
                  onChange={(scopeType, scopeRef) => setPriceScope({ ...priceScope, scopeType, scopeRef })}
                />
              </label>
              <label style={field}>Price (£)
                <input className="form-control" style={{ width: '6rem' }} type="number" min={0} step="0.01" value={priceScope.price} onChange={(e) => setPriceScope({ ...priceScope, price: Number(e.target.value) })} />
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', fontSize: '0.8125rem', paddingBottom: '0.5rem' }}>
                <input type="checkbox" checked={priceScope.available} onChange={(e) => setPriceScope({ ...priceScope, available: e.target.checked })} /> Available here
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', fontSize: '0.8125rem', paddingBottom: '0.5rem' }} title="Multiply this price by the person count on each product (set the count attribute on the Delivery settings screen).">
                <input type="checkbox" checked={priceScope.perPerson} onChange={(e) => setPriceScope({ ...priceScope, perPerson: e.target.checked })} /> Per person
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', fontSize: '0.8125rem', paddingBottom: '0.5rem' }} title="Give this service different timing where this price applies, instead of its usual timing.">
                <input
                  type="checkbox"
                  checked={customTiming}
                  onChange={(e) => {
                    setCustomTiming(e.target.checked)
                    if (!e.target.checked) setPriceScope({ ...priceScope, transitDays: null, minLeadDays: null })
                  }}
                /> Different timing here
              </label>
              {customTiming && (
                <div style={{ flexBasis: '100%', display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
                  <label style={field}>Working days to deliver
                    <input className="form-control" style={num} type="number" min={0} placeholder="—" value={priceScope.transitDays ?? ''} onChange={(e) => setPriceScope({ ...priceScope, transitDays: e.target.value === '' ? null : Number(e.target.value) })} />
                  </label>
                  <label style={field}>Never sooner than
                    <input className="form-control" style={num} type="number" min={0} placeholder="—" value={priceScope.minLeadDays ?? ''} onChange={(e) => setPriceScope({ ...priceScope, minLeadDays: e.target.value === '' ? null : Number(e.target.value) })} />
                  </label>
                  <p style={{ ...help, flexBasis: '100%', margin: 0 }}>Only fill in what should differ - anything left blank keeps the service&rsquo;s usual timing. Set &ldquo;Never sooner than&rdquo; to 0 to lift the service&rsquo;s minimum here.</p>
                </div>
              )}
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={busy}
                onClick={() => send('/api/m/advanced-shipping-for-shop/admin/tier-config', 'POST', { tierId: tier.id, ...priceScope })}
              >
                Add price
              </button>
            </div>
          </fieldset>
        </div>
      )}
    </section>
  )
}
