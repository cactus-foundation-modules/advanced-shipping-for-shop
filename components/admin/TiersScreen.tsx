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

type NewTier = { label: string; supplier: string | null; isNextDay: boolean; dispatchLeadDelta: number; transitDelta: number; minLeadDays: number | null }
const NEW_TIER: NewTier = { label: '', supplier: null, isNextDay: false, dispatchLeadDelta: 0, transitDelta: 0, minLeadDays: null }

// Turn a tier's timing modifiers into plain-English chips a shop owner can read
// at a glance, without knowing what a "±day delta" is.
function timingChips(t: { isNextDay: boolean; dispatchLeadDelta: number; transitDelta: number; minLeadDays: number | null }): string[] {
  if (t.isNextDay) return ['Next working day']
  const chips: string[] = []
  const days = (n: number) => `${Math.abs(n)} working day${Math.abs(n) === 1 ? '' : 's'}`
  if (t.dispatchLeadDelta > 0) chips.push(`${days(t.dispatchLeadDelta)} slower to dispatch`)
  else if (t.dispatchLeadDelta < 0) chips.push(`${days(t.dispatchLeadDelta)} faster to dispatch`)
  if (t.transitDelta > 0) chips.push(`${days(t.transitDelta)} longer in transit`)
  else if (t.transitDelta < 0) chips.push(`${days(t.transitDelta)} quicker in transit`)
  if (t.minLeadDays != null) chips.push(`Never sooner than ${days(t.minLeadDays)}`)
  if (chips.length === 0) chips.push('Same timing as the standard rule')
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
      setError('Could not load service tiers.')
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
    if (!newTier.label.trim()) { setError('Give the tier a name.'); return }
    if (await send('/api/m/advanced-shipping-for-shop/admin/tiers', 'POST', newTier)) {
      setNewTier(NEW_TIER); setAdding(false)
    }
  }

  return (
    <div>
      {error && <div className="alert alert-danger" role="alert">{error}</div>}

      <p style={{ color: 'var(--color-text-muted)', margin: '0 0 1.25rem', fontSize: '0.875rem', lineHeight: 1.5, maxWidth: '46rem' }}>
        Service tiers are the delivery-and-assembly options a shopper picks for each item in their basket,
        such as <em>Standard delivery</em> or <em>Full installation</em>. Each tier can nudge the delivery
        estimate and carries its own price. Set one up below, then say what it costs.
      </p>

      {/* Add a tier - tucked behind a button so the list stays the star of the show */}
      <section style={{ ...card, borderStyle: adding ? 'solid' : 'dashed' }}>
        {!adding ? (
          <button
            type="button"
            onClick={() => { setError(null); setAdding(true) }}
            style={{ ...cardPad, width: '100%', textAlign: 'left', background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--color-primary)', fontSize: '0.9375rem', fontWeight: 600 }}
          >
            + Add a service tier
          </button>
        ) : (
          <div style={cardPad}>
            <h2 style={{ fontSize: '0.9375rem', margin: '0 0 1rem' }}>New service tier</h2>

            <fieldset style={{ border: 'none', padding: 0, margin: '0 0 1.25rem', minInlineSize: 'auto' }}>
              <legend style={legend}>What it&rsquo;s called</legend>
              <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                <label style={{ ...field, flex: '2 1 14rem' }}>Tier name
                  <input className="form-control" value={newTier.label} placeholder="e.g. Full installation" onChange={(e) => setNewTier({ ...newTier, label: e.target.value })} />
                </label>
                <label style={{ ...field, flex: '1 1 12rem' }}>Offered for supplier
                  <select className="form-control" value={newTier.supplier ?? ''} onChange={(e) => setNewTier({ ...newTier, supplier: e.target.value || null })}>
                    <option value="">Every supplier</option>
                    {options.suppliers.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </label>
              </div>
              <p style={help}>Shoppers only see a tier on items whose supplier matches. Leave it on &ldquo;Every supplier&rdquo; to offer it everywhere.</p>
            </fieldset>

            <fieldset style={{ border: 'none', padding: 0, margin: 0, minInlineSize: 'auto' }}>
              <legend style={legend}>How it changes the delivery estimate <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(optional)</span></legend>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.875rem', marginBottom: '0.75rem' }}>
                <input type="checkbox" checked={newTier.isNextDay} onChange={(e) => setNewTier({ ...newTier, isNextDay: e.target.checked })} />
                Guaranteed next working day (overrides the timings below)
              </label>
              <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', opacity: newTier.isNextDay ? 0.45 : 1 }}>
                <label style={field}>Dispatch, +/− days
                  <input className="form-control" style={num} type="number" disabled={newTier.isNextDay} value={newTier.dispatchLeadDelta} onChange={(e) => setNewTier({ ...newTier, dispatchLeadDelta: Number(e.target.value) })} />
                </label>
                <label style={field}>Transit, +/− days
                  <input className="form-control" style={num} type="number" disabled={newTier.isNextDay} value={newTier.transitDelta} onChange={(e) => setNewTier({ ...newTier, transitDelta: Number(e.target.value) })} />
                </label>
                <label style={field}>Never sooner than
                  <input className="form-control" style={num} type="number" min={0} disabled={newTier.isNextDay} value={newTier.minLeadDays ?? ''} placeholder="—" onChange={(e) => setNewTier({ ...newTier, minLeadDays: e.target.value === '' ? null : Number(e.target.value) })} />
                </label>
              </div>
              <p style={help}>These adjust whatever the standard delivery rule works out. Use a plus to make the tier slower, a minus to make it faster (e.g. <strong>-1</strong> dispatch for a quicker option). &ldquo;Never sooner than&rdquo; sets a floor in working days. Leave everything at zero to match the standard rule exactly.</p>
            </fieldset>

            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1.25rem' }}>
              <button type="button" className="btn btn-primary" onClick={addTier} disabled={busy}>Add tier</button>
              <button type="button" className="btn btn-secondary" onClick={() => { setNewTier(NEW_TIER); setAdding(false); setError(null) }} disabled={busy}>Cancel</button>
            </div>
          </div>
        )}
      </section>

      {tiers.length === 0 && (
        <p style={{ color: 'var(--color-text-muted)', textAlign: 'center', padding: '2rem 1rem' }}>
          No service tiers yet. Add your first one above to start offering delivery choices at checkout.
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
  const [draft, setDraft] = useState(tier)
  const [priceScope, setPriceScope] = useState<{ scopeType: ScopeType; scopeRef: string | null; price: number; available: boolean; perPerson: boolean }>({ scopeType: 'DEFAULT', scopeRef: null, price: 0, available: true, perPerson: false })

  const base = `/api/m/advanced-shipping-for-shop/admin/tiers/${tier.id}`
  const chips = timingChips(tier)
  const priceSummary = config.length === 0 ? 'No prices set yet' : `${config.length} price${config.length === 1 ? '' : 's'} set`

  return (
    <section style={card}>
      {/* Header: everything a shop owner needs to recognise the tier at a glance */}
      <div style={{ ...cardPad, display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 16rem', minWidth: 0 }}>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '0.375rem' }}>
            <strong style={{ fontSize: '0.9375rem' }}>{tier.label}</strong>
            <span style={pill}>{tier.supplier ? tier.supplier : 'Every supplier'}</span>
          </div>
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
              <label style={{ ...field, flex: '1 1 14rem' }}>Tier name
                <input className="form-control" value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} />
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.875rem', paddingBottom: '0.5rem' }}>
                <input type="checkbox" checked={draft.isNextDay} onChange={(e) => setDraft({ ...draft, isNextDay: e.target.checked })} />
                Guaranteed next working day
              </label>
            </div>
            <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginTop: '0.75rem', opacity: draft.isNextDay ? 0.45 : 1 }}>
              <label style={field}>Dispatch, +/− days
                <input className="form-control" style={num} type="number" disabled={draft.isNextDay} value={draft.dispatchLeadDelta} onChange={(e) => setDraft({ ...draft, dispatchLeadDelta: Number(e.target.value) })} />
              </label>
              <label style={field}>Transit, +/− days
                <input className="form-control" style={num} type="number" disabled={draft.isNextDay} value={draft.transitDelta} onChange={(e) => setDraft({ ...draft, transitDelta: Number(e.target.value) })} />
              </label>
              <label style={field}>Never sooner than
                <input className="form-control" style={num} type="number" min={0} disabled={draft.isNextDay} value={draft.minLeadDays ?? ''} placeholder="—" onChange={(e) => setDraft({ ...draft, minLeadDays: e.target.value === '' ? null : Number(e.target.value) })} />
              </label>
            </div>
            <p style={help}>Plus makes this tier slower than the standard rule, minus makes it faster. Supplier can&rsquo;t be changed after a tier is created.</p>
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.875rem' }}>
              <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => send(base, 'PATCH', { label: draft.label, isNextDay: draft.isNextDay, dispatchLeadDelta: draft.dispatchLeadDelta, transitDelta: draft.transitDelta, minLeadDays: draft.minLeadDays })}>Save changes</button>
              <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => { if (confirm(`Delete the "${tier.label}" tier?`)) void send(base, 'DELETE') }}>Delete tier</button>
            </div>
          </fieldset>

          {/* Prices */}
          <fieldset style={{ border: 'none', padding: 0, margin: 0, minInlineSize: 'auto' }}>
            <legend style={legend}>Prices</legend>
            <p style={{ ...help, marginTop: 0, marginBottom: '0.75rem' }}>
              Set a price for where this tier applies. The most specific one wins: a range price beats a category price, which beats the everywhere price.
            </p>

            {config.length === 0 ? (
              <p style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)', margin: '0 0 0.75rem' }}>Not offered anywhere yet - add a price below to make this tier available.</p>
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
                        <td style={{ padding: '0.5rem 0.75rem' }}>{scopeRefLabel(c.scopeType, c.scopeRef, options)}</td>
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
                  allowSupplier={false}
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
