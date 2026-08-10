'use client'

import { useCallback, useEffect, useState } from 'react'
import { isCartControlStyle, type CartControlStyle } from '@/modules/advanced-shipping-for-shop/lib/types'

type Options = {
  attributes: { id: string; name: string }[]
  tiers: { id: string; key: string; label: string }[]
}
type Settings = {
  rangeAttributeId: string | null
  holidayRegion: string
  defaultTierKey: string | null
  cartControlStyle: CartControlStyle
  perPersonAttributeId: string | null
  cutoffTime: string
  dispatchLeadDays: number
  shipDays: number[]
}
const REGIONS = [
  { id: 'england-and-wales', label: 'England and Wales' },
  { id: 'scotland', label: 'Scotland' },
  { id: 'northern-ireland', label: 'Northern Ireland' },
]
const WEEKDAYS = [{ n: 1, l: 'Mon' }, { n: 2, l: 'Tue' }, { n: 3, l: 'Wed' }, { n: 4, l: 'Thu' }, { n: 5, l: 'Fri' }, { n: 6, l: 'Sat' }, { n: 0, l: 'Sun' }]

const card = { border: '1px solid var(--color-border)', borderRadius: 12, padding: '1rem 1.25rem', background: 'var(--color-surface)', marginBottom: '1.5rem' } as const
const rowStyle = { display: 'grid', gridTemplateColumns: 'minmax(10rem, 14rem) 1fr', gap: '0.75rem', alignItems: 'center', marginBottom: '0.75rem' } as const

export function SettingsScreen() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [options, setOptions] = useState<Options>({ attributes: [], tiers: [] })
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)
  const [preview, setPreview] = useState<{ dispatchLabel: string | null; targetLabel: string | null; available: boolean } | null>(null)

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

  // "An order placed now" preview for the dispatch timing being edited, so a
  // mis-set cut-off is caught before it reaches a shopper. Best-effort.
  const runPreview = useCallback(async (timing: { cutoffTime: string; dispatchLeadDays: number; shipDays: number[] }) => {
    try {
      const res = await fetch('/api/m/advanced-shipping-for-shop/admin/preview', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(timing),
      })
      if (res.ok) setPreview(await res.json())
    } catch { /* preview is best-effort */ }
  }, [])

  const cutoffTime = settings?.cutoffTime
  const dispatchLeadDays = settings?.dispatchLeadDays
  const shipDaysKey = settings?.shipDays.join(',')
  useEffect(() => {
    if (cutoffTime == null || dispatchLeadDays == null || shipDaysKey == null) return
    const shipDays = shipDaysKey === '' ? [] : shipDaysKey.split(',').map(Number)
    if (shipDays.length === 0) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- delegating to an async preview call; setState runs after the await
    void runPreview({ cutoffTime, dispatchLeadDays, shipDays })
  }, [cutoffTime, dispatchLeadDays, shipDaysKey, runPreview])

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

  if (!settings) return <p style={{ color: 'var(--color-text-secondary)' }}>Loading…</p>

  const toggleShipDay = (n: number) => {
    setSettings({
      ...settings,
      shipDays: settings.shipDays.includes(n)
        ? settings.shipDays.filter((x) => x !== n)
        : [...settings.shipDays, n].sort((a, b) => a - b),
    })
  }

  return (
    <div>
      {error && <p style={{ color: 'var(--color-error)', marginBottom: '1rem' }}>{error}</p>}
      {saved && !error && <p role="status" style={{ color: 'var(--color-text-secondary)', marginBottom: '1rem' }}>Saved.</p>}

      <form onSubmit={save}>
        <section style={card}>
          <h2 style={{ fontSize: '0.9375rem', margin: '0 0 0.75rem' }}>Dispatch timing</h2>
          <div style={rowStyle}>
            <label htmlFor="ash-cutoff">Order cut-off</label>
            <input
              id="ash-cutoff"
              className="form-control"
              style={{ width: '7rem' }}
              type="time"
              value={settings.cutoffTime}
              onChange={(e) => setSettings({ ...settings, cutoffTime: e.target.value })}
            />
          </div>
          <div style={rowStyle}>
            <label htmlFor="ash-dispatch-lead">Days to dispatch</label>
            <input
              id="ash-dispatch-lead"
              className="form-control"
              style={{ width: '5rem' }}
              type="number"
              min={0}
              value={settings.dispatchLeadDays}
              onChange={(e) => setSettings({ ...settings, dispatchLeadDays: Number(e.target.value) })}
            />
          </div>
          <div style={rowStyle}>
            <span>Ships on</span>
            <span>
              {WEEKDAYS.map((w) => (
                <label key={w.n} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', marginRight: '0.625rem', fontSize: '0.8125rem' }}>
                  <input type="checkbox" checked={settings.shipDays.includes(w.n)} onChange={() => toggleShipDay(w.n)} /> {w.l}
                </label>
              ))}
            </span>
          </div>
          <p style={{ color: 'var(--color-text-secondary)', margin: 0, fontSize: '0.8125rem' }}>
            Shop-wide: orders in before the cut-off on a ship day start being prepared that day, and
            &ldquo;days to dispatch&rdquo; is how many working days preparing takes. Each delivery
            service then adds its own delivery time on top - set those on the Delivery services screen.
            {preview && (
              preview.available && preview.dispatchLabel
                ? <> An order placed now would dispatch {preview.dispatchLabel}.</>
                : <> This timing produces no dispatch date - check the ship days.</>
            )}
          </p>
        </section>

        <section style={card}>
          <h2 style={{ fontSize: '0.9375rem', margin: '0 0 0.75rem' }}>How prices match products</h2>
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
          <p style={{ color: 'var(--color-text-secondary)', margin: 0, fontSize: '0.8125rem' }}>
            Pick the product attribute that means &ldquo;range&rdquo;. A delivery service&rsquo;s prices
            and timings can then key on its values (Hyphen, Aero, and so on).
          </p>
        </section>

        <section style={card}>
          <h2 style={{ fontSize: '0.9375rem', margin: '0 0 0.75rem' }}>Per-person pricing</h2>
          <div style={rowStyle}>
            <label htmlFor="ash-count-attr">Count attribute</label>
            <select
              id="ash-count-attr"
              className="form-control"
              value={settings.perPersonAttributeId ?? ''}
              onChange={(e) => setSettings({ ...settings, perPersonAttributeId: e.target.value || null })}
            >
              <option value="">None - do not price per person</option>
              {options.attributes.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </div>
          <p style={{ color: 'var(--color-text-secondary)', margin: 0, fontSize: '0.8125rem' }}>
            Pick the attribute whose value holds a number of people (a &ldquo;Seats&rdquo; attribute
            reading &ldquo;2 People&rdquo;, &ldquo;6 People&rdquo;). Any service price you tick as
            per-person on the Delivery services screen is then multiplied by that number. A product
            missing a readable number cannot be bought with a per-person service until one is set.
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
          <p style={{ color: 'var(--color-text-secondary)', margin: 0, fontSize: '0.8125rem' }}>
            Import the calendar itself on the Holidays screen. Delivery dates always skip weekends and
            these bank holidays.
          </p>
        </section>

        <section style={card}>
          <h2 style={{ fontSize: '0.9375rem', margin: '0 0 0.75rem' }}>Default delivery service</h2>
          <div style={rowStyle}>
            <label htmlFor="ash-default-tier">Shown by default</label>
            <select
              id="ash-default-tier"
              className="form-control"
              value={settings.defaultTierKey ?? ''}
              onChange={(e) => setSettings({ ...settings, defaultTierKey: e.target.value || null })}
            >
              <option value="">First offered service</option>
              {options.tiers.map((t) => (
                <option key={t.id} value={t.key}>{t.label}</option>
              ))}
            </select>
          </div>
          <p style={{ color: 'var(--color-text-secondary)', margin: 0, fontSize: '0.8125rem' }}>
            The service a product page shows before the shopper changes it in the basket. The default
            service is offered on every product, even where it has no price row (it is then included in
            the item price).
          </p>
        </section>

        <section style={card}>
          <h2 style={{ fontSize: '0.9375rem', margin: '0 0 0.75rem' }}>Basket delivery picker</h2>
          <div style={rowStyle}>
            <label htmlFor="ash-control-style">Show services as</label>
            <select
              id="ash-control-style"
              className="form-control"
              value={settings.cartControlStyle}
              onChange={(e) => setSettings({ ...settings, cartControlStyle: isCartControlStyle(e.target.value) ? e.target.value : 'summary' })}
            >
              <option value="summary">Chosen service, with the rest as chips</option>
              <option value="dropdown">Dropdown</option>
              <option value="radios">Radio buttons</option>
            </select>
          </div>
          <p style={{ color: 'var(--color-text-secondary)', margin: 0, fontSize: '0.8125rem' }}>
            How the delivery-service picker appears on each basket line. The first option confirms the
            chosen service and its date in place, with every other service beside it as a one-click chip.
            A dropdown stays compact; radio buttons list every service.
          </p>
        </section>

        <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save settings'}</button>
      </form>
    </div>
  )
}
