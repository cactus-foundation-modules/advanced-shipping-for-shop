'use client'

import { useCallback, useEffect, useState } from 'react'
import type { FulfilmentMode, ProductOverride } from '@/modules/advanced-shipping-for-shop/lib/types'

const field = { display: 'flex', flexDirection: 'column' as const, gap: '0.25rem', fontSize: '0.8125rem' }
const num = { width: '6rem' }

type Draft = Omit<ProductOverride, 'productId'>
const BLANK: Draft = {
  fulfilmentMode: null, mtoLeadDays: null, cutoffTime: null, dispatchLeadDays: null, transitDays: null, backorderLeadDays: null, disabled: false,
}

// Any override field is null -> "inherit the matching rule". Only the fields the
// owner sets patch the rule; everything else falls through, so an override is an
// exception, not a second full rule.
export function ProductDeliveryEditor({ productId }: { productId: string }) {
  const [draft, setDraft] = useState<Draft>(BLANK)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/m/advanced-shipping-for-shop/admin/overrides/${productId}`)
      if (res.ok) {
        const data = await res.json()
        if (data.override) setDraft({ ...BLANK, ...data.override })
      }
    } catch {
      setError('Could not load the delivery override.')
    } finally {
      setLoaded(true)
    }
  }, [productId])

  // eslint-disable-next-line react-hooks/set-state-in-effect -- delegating to an async loader; every setState runs after an await
  useEffect(() => { void load() }, [load])

  const numHandler = (key: keyof Draft) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setDraft((d) => ({ ...d, [key]: e.target.value === '' ? null : Number(e.target.value) }))

  async function save() {
    setSaving(true); setError(null); setSaved(false)
    try {
      const res = await fetch(`/api/m/advanced-shipping-for-shop/admin/overrides/${productId}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(draft),
      })
      const data = await res.json()
      if (!res.ok) setError(data.error || 'Could not save the override.')
      else { if (data.override) setDraft({ ...BLANK, ...data.override }); setSaved(true) }
    } catch {
      setError('Could not save the override.')
    } finally {
      setSaving(false)
    }
  }

  if (!loaded) return <p style={{ color: 'var(--color-text-muted)' }}>Loading…</p>

  return (
    <div style={{ maxWidth: '40rem' }}>
      <p style={{ color: 'var(--color-text-muted)', fontSize: '0.875rem', margin: '0 0 1rem' }}>
        Leave a field blank to use whichever delivery rule matches this product. Fill one in only to override it for this product alone.
      </p>
      {error && <div className="alert alert-danger" role="alert">{error}</div>}
      {saved && !error && <p role="status" style={{ color: 'var(--color-text-muted)' }}>Saved.</p>}

      <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.875rem', marginBottom: '1rem' }}>
        <input type="checkbox" checked={draft.disabled} onChange={(e) => setDraft({ ...draft, disabled: e.target.checked })} />
        Hide the delivery estimate for this product
      </label>

      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'flex-end', opacity: draft.disabled ? 0.5 : 1 }}>
        <label style={{ ...field }}>Fulfilment
          <select className="form-control" value={draft.fulfilmentMode ?? ''} onChange={(e) => setDraft({ ...draft, fulfilmentMode: (e.target.value || null) as FulfilmentMode | null })}>
            <option value="">Inherit</option>
            <option value="STOCKED">Stocked</option>
            <option value="MADE_TO_ORDER">Made to order</option>
          </select>
        </label>
        <label style={{ ...field }}>Cut-off (London)
          <input className="form-control" style={{ width: '6rem' }} type="time" value={draft.cutoffTime ?? ''} onChange={(e) => setDraft({ ...draft, cutoffTime: e.target.value || null })} />
        </label>
        <label style={{ ...field }}>Dispatch lead
          <input className="form-control" style={num} type="number" min={0} value={draft.dispatchLeadDays ?? ''} placeholder="inherit" onChange={numHandler('dispatchLeadDays')} />
        </label>
        <label style={{ ...field }}>Made-to-order lead
          <input className="form-control" style={num} type="number" min={0} value={draft.mtoLeadDays ?? ''} placeholder="inherit" onChange={numHandler('mtoLeadDays')} />
        </label>
        <label style={{ ...field }}>Transit days
          <input className="form-control" style={num} type="number" min={0} value={draft.transitDays ?? ''} placeholder="inherit" onChange={numHandler('transitDays')} />
        </label>
        <label style={{ ...field }}>Backorder lead
          <input className="form-control" style={num} type="number" min={0} value={draft.backorderLeadDays ?? ''} placeholder="inherit" onChange={numHandler('backorderLeadDays')} />
        </label>
      </div>

      <div style={{ marginTop: '1rem' }}>
        <button type="button" className="btn btn-primary" disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save delivery override'}</button>
      </div>
    </div>
  )
}
