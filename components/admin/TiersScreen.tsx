'use client'

import { useCallback, useEffect, useState } from 'react'
import type { ScopeType, ServiceTier, TierScopeConfig } from '@/modules/advanced-shipping-for-shop/lib/types'
import { ScopePicker, scopeRefLabel, type ScopeOptions } from '@/modules/advanced-shipping-for-shop/components/admin/scope-picker'

const card = { border: '1px solid var(--color-border)', borderRadius: 12, padding: '1rem 1.25rem', background: 'var(--color-surface)', marginBottom: '1.25rem' } as const
const field = { display: 'flex', flexDirection: 'column' as const, gap: '0.25rem', fontSize: '0.8125rem' }
const num = { width: '5.5rem' }
const EMPTY_OPTIONS: ScopeOptions = { suppliers: [], categories: [], rangeValues: [] }

type NewTier = { label: string; isNextDay: boolean; dispatchLeadDelta: number; transitDelta: number; minLeadDays: number | null }
const NEW_TIER: NewTier = { label: '', isNextDay: false, dispatchLeadDelta: 0, transitDelta: 0, minLeadDays: null }

export function TiersScreen() {
  const [tiers, setTiers] = useState<ServiceTier[]>([])
  const [config, setConfig] = useState<TierScopeConfig[]>([])
  const [options, setOptions] = useState<ScopeOptions>(EMPTY_OPTIONS)
  const [newTier, setNewTier] = useState<NewTier>(NEW_TIER)
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
    if (await send('/api/m/advanced-shipping-for-shop/admin/tiers', 'POST', newTier)) setNewTier(NEW_TIER)
  }

  return (
    <div>
      <div className="page-header"><h1 className="page-title">Service tiers</h1></div>
      {error && <div className="alert alert-danger" role="alert">{error}</div>}
      <p style={{ color: 'var(--color-text-muted)', margin: '0 0 1rem', fontSize: '0.875rem' }}>
        Delivery-and-assembly options a shopper picks per item in the basket. Timing tweaks apply on top of whichever delivery rule matches the product; prices are set per scope below each tier.
      </p>

      <section style={card}>
        <h2 style={{ fontSize: '0.9375rem', margin: '0 0 0.75rem' }}>Add a tier</h2>
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label style={{ ...field, flex: '1 1 12rem' }}>Name
            <input className="form-control" value={newTier.label} placeholder="e.g. Full installation" onChange={(e) => setNewTier({ ...newTier, label: e.target.value })} />
          </label>
          <label style={{ ...field }}>Dispatch ±days
            <input className="form-control" style={num} type="number" value={newTier.dispatchLeadDelta} onChange={(e) => setNewTier({ ...newTier, dispatchLeadDelta: Number(e.target.value) })} />
          </label>
          <label style={{ ...field }}>Transit ±days
            <input className="form-control" style={num} type="number" value={newTier.transitDelta} onChange={(e) => setNewTier({ ...newTier, transitDelta: Number(e.target.value) })} />
          </label>
          <label style={{ ...field }}>Min working days
            <input className="form-control" style={num} type="number" min={0} value={newTier.minLeadDays ?? ''} placeholder="none" onChange={(e) => setNewTier({ ...newTier, minLeadDays: e.target.value === '' ? null : Number(e.target.value) })} />
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', fontSize: '0.8125rem' }}>
            <input type="checkbox" checked={newTier.isNextDay} onChange={(e) => setNewTier({ ...newTier, isNextDay: e.target.checked })} /> Next day
          </label>
          <button type="button" className="btn btn-primary" onClick={addTier} disabled={busy}>Add tier</button>
        </div>
      </section>

      {tiers.length === 0 && <p style={{ color: 'var(--color-text-muted)' }}>No tiers yet.</p>}
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
  const [draft, setDraft] = useState(tier)
  const [priceScope, setPriceScope] = useState<{ scopeType: ScopeType; scopeRef: string | null; price: number; available: boolean }>({ scopeType: 'DEFAULT', scopeRef: null, price: 0, available: true })

  const base = `/api/m/advanced-shipping-for-shop/admin/tiers/${tier.id}`
  return (
    <section style={card}>
      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: '0.75rem' }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', fontSize: '0.8125rem', flex: '1 1 12rem' }}>Name
          <input className="form-control" value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', fontSize: '0.8125rem' }}>Dispatch ±days
          <input className="form-control" style={{ width: '5.5rem' }} type="number" value={draft.dispatchLeadDelta} onChange={(e) => setDraft({ ...draft, dispatchLeadDelta: Number(e.target.value) })} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', fontSize: '0.8125rem' }}>Transit ±days
          <input className="form-control" style={{ width: '5.5rem' }} type="number" value={draft.transitDelta} onChange={(e) => setDraft({ ...draft, transitDelta: Number(e.target.value) })} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', fontSize: '0.8125rem' }}>Min working days
          <input className="form-control" style={{ width: '5.5rem' }} type="number" min={0} value={draft.minLeadDays ?? ''} placeholder="none" onChange={(e) => setDraft({ ...draft, minLeadDays: e.target.value === '' ? null : Number(e.target.value) })} />
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', fontSize: '0.8125rem' }}>
          <input type="checkbox" checked={draft.isNextDay} onChange={(e) => setDraft({ ...draft, isNextDay: e.target.checked })} /> Next day
        </label>
        <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => send(base, 'PATCH', { label: draft.label, isNextDay: draft.isNextDay, dispatchLeadDelta: draft.dispatchLeadDelta, transitDelta: draft.transitDelta, minLeadDays: draft.minLeadDays })}>Save</button>
        <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => { if (confirm(`Delete the "${tier.label}" tier?`)) void send(base, 'DELETE') }}>Delete</button>
      </div>

      <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: '0.75rem' }}>
        <p style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)', margin: '0 0 0.5rem' }}>Prices (most specific wins - a range price beats a category price beats a supplier price beats the default)</p>
        {config.length === 0 && <p style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)', margin: '0 0 0.5rem' }}>Not offered anywhere yet - add a price below.</p>}
        <ul style={{ listStyle: 'none', margin: '0 0 0.5rem', padding: 0, display: 'grid', gap: '0.25rem' }}>
          {config.map((c) => (
            <li key={c.id} style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', fontSize: '0.8125rem', alignItems: 'center' }}>
              <span>{scopeRefLabel(c.scopeType, c.scopeRef, options)} - {c.available ? `£${c.price}` : 'not available'}</span>
              <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => send(`/api/m/advanced-shipping-for-shop/admin/tier-config/${c.id}`, 'DELETE')}>Remove</button>
            </li>
          ))}
        </ul>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <ScopePicker
            scopeType={priceScope.scopeType}
            scopeRef={priceScope.scopeRef}
            options={options}
            allowRange
            onChange={(scopeType, scopeRef) => setPriceScope({ ...priceScope, scopeType, scopeRef })}
          />
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.8125rem' }}>£
            <input className="form-control" style={{ width: '6rem' }} type="number" min={0} step="0.01" value={priceScope.price} onChange={(e) => setPriceScope({ ...priceScope, price: Number(e.target.value) })} />
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', fontSize: '0.8125rem' }}>
            <input type="checkbox" checked={priceScope.available} onChange={(e) => setPriceScope({ ...priceScope, available: e.target.checked })} /> Available
          </label>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={busy}
            onClick={() => send('/api/m/advanced-shipping-for-shop/admin/tier-config', 'POST', { tierId: tier.id, ...priceScope })}
          >
            Set price
          </button>
        </div>
      </div>
    </section>
  )
}
