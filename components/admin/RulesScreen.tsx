'use client'

import { useCallback, useEffect, useState } from 'react'
import type { DeliveryRule, FulfilmentMode, ScopeType } from '@/modules/advanced-shipping-for-shop/lib/types'
import { ScopePicker, scopeRefLabel, type ScopeOptions } from '@/modules/advanced-shipping-for-shop/components/admin/scope-picker'

const card = { border: '1px solid var(--color-border)', borderRadius: 12, padding: '1rem 1.25rem', background: 'var(--color-surface)', marginBottom: '1.25rem' } as const
const field = { display: 'flex', flexDirection: 'column' as const, gap: '0.25rem', fontSize: '0.8125rem' }
const num = { width: '5rem' }
const EMPTY_OPTIONS: ScopeOptions = { suppliers: [], categories: [], rangeValues: [] }
const WEEKDAYS = [{ n: 1, l: 'Mon' }, { n: 2, l: 'Tue' }, { n: 3, l: 'Wed' }, { n: 4, l: 'Thu' }, { n: 5, l: 'Fri' }, { n: 6, l: 'Sat' }, { n: 0, l: 'Sun' }]

type RuleDraft = {
  scopeType: ScopeType
  scopeRef: string | null
  fulfilmentMode: FulfilmentMode
  cutoffTime: string
  dispatchLeadDays: number
  mtoLeadDays: number
  transitDays: number
  shipDays: number[]
  backorderLeadDays: number | null
}

const NEW_RULE: RuleDraft = {
  scopeType: 'DEFAULT', scopeRef: null, fulfilmentMode: 'STOCKED', cutoffTime: '12:00',
  dispatchLeadDays: 1, mtoLeadDays: 10, transitDays: 2, shipDays: [1, 2, 3, 4, 5], backorderLeadDays: null,
}

export function RulesScreen() {
  const [rules, setRules] = useState<DeliveryRule[]>([])
  const [options, setOptions] = useState<ScopeOptions>(EMPTY_OPTIONS)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const [rRes, oRes] = await Promise.all([
        fetch('/api/m/advanced-shipping-for-shop/admin/rules'),
        fetch('/api/m/advanced-shipping-for-shop/admin/options'),
      ])
      if (rRes.ok) setRules((await rRes.json()).rules ?? [])
      if (oRes.ok) {
        const o = await oRes.json()
        setOptions({ suppliers: o.suppliers ?? [], categories: o.categories ?? [], rangeValues: o.rangeValues ?? [] })
      }
    } catch {
      setError('Could not load delivery rules.')
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

  return (
    <div>
      {error && <div className="alert alert-danger" role="alert">{error}</div>}
      <p style={{ color: 'var(--color-text-muted)', margin: '0 0 1rem', fontSize: '0.875rem' }}>
        A product uses the most specific rule that matches it: range, then category, then supplier, then the default. Every date counts working days only, skipping weekends and imported bank holidays.
      </p>

      <RuleForm title="Add a rule" options={options} busy={busy} onSubmit={(draft) => send('/api/m/advanced-shipping-for-shop/admin/rules', 'POST', draft)} submitLabel="Add rule" resetAfter />

      {rules.length === 0 && <p style={{ color: 'var(--color-text-muted)' }}>No rules yet - add a default rule so every product gets an estimate.</p>}
      {rules.map((rule) => (
        <div key={rule.id} style={card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
            <strong style={{ fontSize: '0.9375rem' }}>{scopeRefLabel(rule.scopeType, rule.scopeRef, options)}</strong>
            <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => { if (confirm('Delete this rule?')) void send(`/api/m/advanced-shipping-for-shop/admin/rules/${rule.id}`, 'DELETE') }}>Delete</button>
          </div>
          <RuleForm
            options={options}
            busy={busy}
            initial={rule}
            onSubmit={(draft) => send(`/api/m/advanced-shipping-for-shop/admin/rules/${rule.id}`, 'PATCH', draft)}
            submitLabel="Save"
          />
        </div>
      ))}
    </div>
  )
}

function RuleForm({
  title, options, busy, initial, onSubmit, submitLabel, resetAfter,
}: {
  title?: string
  options: ScopeOptions
  busy: boolean
  initial?: DeliveryRule
  onSubmit: (draft: RuleDraft) => Promise<boolean>
  submitLabel: string
  resetAfter?: boolean
}) {
  const [draft, setDraft] = useState<RuleDraft>(initial ? { ...initial } : NEW_RULE)
  const [preview, setPreview] = useState<{ dispatchLabel: string | null; targetLabel: string | null; available: boolean } | null>(null)

  const runPreview = useCallback(async (d: RuleDraft) => {
    try {
      const res = await fetch('/api/m/advanced-shipping-for-shop/admin/preview', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fulfilmentMode: d.fulfilmentMode, cutoffTime: d.cutoffTime, dispatchLeadDays: d.dispatchLeadDays, mtoLeadDays: d.mtoLeadDays, transitDays: d.transitDays, shipDays: d.shipDays, backorderLeadDays: d.backorderLeadDays }),
      })
      if (res.ok) setPreview(await res.json())
    } catch { /* preview is best-effort */ }
  }, [])

  // eslint-disable-next-line react-hooks/set-state-in-effect -- delegating to an async preview call; setState runs after the await
  useEffect(() => { void runPreview(draft) }, [draft, runPreview])

  const toggleShipDay = (n: number) => {
    setDraft((d) => ({ ...d, shipDays: d.shipDays.includes(n) ? d.shipDays.filter((x) => x !== n) : [...d.shipDays, n].sort((a, b) => a - b) }))
  }

  const wrap = initial ? {} : card
  const isMto = draft.fulfilmentMode === 'MADE_TO_ORDER'

  return (
    <section style={wrap}>
      {title && <h2 style={{ fontSize: '0.9375rem', margin: '0 0 0.75rem' }}>{title}</h2>}

      {!initial && (
        <div style={{ marginBottom: '0.75rem' }}>
          <ScopePicker scopeType={draft.scopeType} scopeRef={draft.scopeRef} options={options} allowRange onChange={(scopeType, scopeRef) => setDraft({ ...draft, scopeType, scopeRef })} />
        </div>
      )}

      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: '0.75rem' }}>
        <label style={{ ...field }}>Fulfilment
          <select className="form-control" value={draft.fulfilmentMode} onChange={(e) => setDraft({ ...draft, fulfilmentMode: e.target.value as FulfilmentMode })}>
            <option value="STOCKED">Stocked (dispatch from stock)</option>
            <option value="MADE_TO_ORDER">Made to order</option>
          </select>
        </label>
        {!isMto && (
          <label style={{ ...field }}>Cut-off (London)
            <input className="form-control" style={{ width: '6rem' }} type="time" value={draft.cutoffTime} onChange={(e) => setDraft({ ...draft, cutoffTime: e.target.value })} />
          </label>
        )}
        {!isMto && (
          <label style={{ ...field }}>Dispatch lead
            <input className="form-control" style={num} type="number" min={0} value={draft.dispatchLeadDays} onChange={(e) => setDraft({ ...draft, dispatchLeadDays: Number(e.target.value) })} />
          </label>
        )}
        {isMto && (
          <label style={{ ...field }}>Made-to-order lead
            <input className="form-control" style={num} type="number" min={0} value={draft.mtoLeadDays} onChange={(e) => setDraft({ ...draft, mtoLeadDays: Number(e.target.value) })} />
          </label>
        )}
        <label style={{ ...field }}>Transit days
          <input className="form-control" style={num} type="number" min={0} value={draft.transitDays} onChange={(e) => setDraft({ ...draft, transitDays: Number(e.target.value) })} />
        </label>
        {!isMto && (
          <label style={{ ...field }}>Backorder lead
            <input className="form-control" style={num} type="number" min={0} value={draft.backorderLeadDays ?? ''} placeholder="none" onChange={(e) => setDraft({ ...draft, backorderLeadDays: e.target.value === '' ? null : Number(e.target.value) })} />
          </label>
        )}
      </div>

      <div style={{ marginBottom: '0.75rem' }}>
        <span style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)', marginRight: '0.5rem' }}>Ships on:</span>
        {WEEKDAYS.map((w) => (
          <label key={w.n} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', marginRight: '0.625rem', fontSize: '0.8125rem' }}>
            <input type="checkbox" checked={draft.shipDays.includes(w.n)} onChange={() => toggleShipDay(w.n)} /> {w.l}
          </label>
        ))}
      </div>

      {preview && (
        <p style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)', margin: '0 0 0.75rem' }}>
          {preview.available && preview.targetLabel
            ? `An order placed now would dispatch ${preview.dispatchLabel} and arrive by ${preview.targetLabel}.`
            : 'This configuration produces no deliverable date - check the ship days.'}
        </p>
      )}

      <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={async () => { const ok = await onSubmit(draft); if (ok && resetAfter) setDraft(NEW_RULE) }}>{submitLabel}</button>
    </section>
  )
}
