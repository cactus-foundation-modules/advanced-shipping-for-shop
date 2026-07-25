'use client'

import { useCallback, useEffect, useState } from 'react'

type Options = {
  attributes: { id: string; name: string }[]
  tiers: { id: string; key: string; label: string }[]
}
type Settings = {
  rangeAttributeId: string | null
  holidayRegion: string
  defaultTierKey: string | null
}
const REGIONS = [
  { id: 'england-and-wales', label: 'England and Wales' },
  { id: 'scotland', label: 'Scotland' },
  { id: 'northern-ireland', label: 'Northern Ireland' },
]

const card = { border: '1px solid var(--color-border)', borderRadius: 12, padding: '1rem 1.25rem', background: 'var(--color-surface)', marginBottom: '1.5rem' } as const
const rowStyle = { display: 'grid', gridTemplateColumns: 'minmax(10rem, 14rem) 1fr', gap: '0.75rem', alignItems: 'center', marginBottom: '0.75rem' } as const

export function SettingsScreen() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [options, setOptions] = useState<Options>({ attributes: [], tiers: [] })
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    try {
      const [sRes, oRes] = await Promise.all([
        fetch('/api/m/advanced-shipping-for-shop/admin/settings'),
        fetch('/api/m/advanced-shipping-for-shop/admin/options'),
      ])
      if (sRes.ok) setSettings((await sRes.json()).settings)
      if (oRes.ok) {
        const o = await oRes.json()
        setOptions({ attributes: o.attributes ?? [], tiers: o.tiers ?? [] })
      }
    } catch {
      setError('Could not load delivery settings.')
    }
  }, [])

  // eslint-disable-next-line react-hooks/set-state-in-effect -- delegating to an async loader; every setState runs after an await
  useEffect(() => { void load() }, [load])

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (!settings) return
    setSaving(true); setError(null); setSaved(false)
    try {
      const res = await fetch('/api/m/advanced-shipping-for-shop/admin/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      })
      const data = await res.json()
      if (!res.ok) setError(data.error || 'Could not save these settings.')
      else { setSettings(data.settings); setSaved(true) }
    } catch {
      setError('Could not save these settings.')
    } finally {
      setSaving(false)
    }
  }

  if (!settings) return <p style={{ color: 'var(--color-text-muted)' }}>Loading…</p>

  return (
    <div>
      <div className="page-header"><h1 className="page-title">Delivery settings</h1></div>
      {error && <p style={{ color: 'var(--color-error)', marginBottom: '1rem' }}>{error}</p>}
      {saved && !error && <p role="status" style={{ color: 'var(--color-text-muted)', marginBottom: '1rem' }}>Saved.</p>}

      <form onSubmit={save}>
        <section style={card}>
          <h2 style={{ fontSize: '0.9375rem', margin: '0 0 0.75rem' }}>How rules match products</h2>
          <div style={rowStyle}>
            <label htmlFor="ash-range">Range attribute</label>
            <select
              id="ash-range"
              className="form-control"
              value={settings.rangeAttributeId ?? ''}
              onChange={(e) => setSettings({ ...settings, rangeAttributeId: e.target.value || null })}
            >
              <option value="">None - do not match on range</option>
              {options.attributes.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </div>
          <p style={{ color: 'var(--color-text-muted)', margin: 0, fontSize: '0.8125rem' }}>
            Pick the product attribute that means &ldquo;range&rdquo;. Delivery rules can then key on its values (Hyphen, Aero, and so on).
          </p>
        </section>

        <section style={card}>
          <h2 style={{ fontSize: '0.9375rem', margin: '0 0 0.75rem' }}>Working-day calendar</h2>
          <div style={rowStyle}>
            <label htmlFor="ash-region">Bank-holiday region</label>
            <select
              id="ash-region"
              className="form-control"
              value={settings.holidayRegion}
              onChange={(e) => setSettings({ ...settings, holidayRegion: e.target.value })}
            >
              {REGIONS.map((r) => (
                <option key={r.id} value={r.id}>{r.label}</option>
              ))}
            </select>
          </div>
          <p style={{ color: 'var(--color-text-muted)', margin: 0, fontSize: '0.8125rem' }}>
            Import the calendar itself on the Holidays screen. Delivery dates always skip weekends and these bank holidays.
          </p>
        </section>

        <section style={card}>
          <h2 style={{ fontSize: '0.9375rem', margin: '0 0 0.75rem' }}>Default service tier</h2>
          <div style={rowStyle}>
            <label htmlFor="ash-default-tier">Shown by default</label>
            <select
              id="ash-default-tier"
              className="form-control"
              value={settings.defaultTierKey ?? ''}
              onChange={(e) => setSettings({ ...settings, defaultTierKey: e.target.value || null })}
            >
              <option value="">First offered tier</option>
              {options.tiers.map((t) => (
                <option key={t.id} value={t.key}>{t.label}</option>
              ))}
            </select>
          </div>
          <p style={{ color: 'var(--color-text-muted)', margin: 0, fontSize: '0.8125rem' }}>
            The tier a product page shows before the shopper changes it in the basket.
          </p>
        </section>

        <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save settings'}</button>
      </form>
    </div>
  )
}
