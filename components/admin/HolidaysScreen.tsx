'use client'

import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { useAdminConfirm } from '@/components/admin/useAdminConfirm'

type Holiday = { date: string; name: string; source?: 'calendar' | 'custom' }
type CustomClosure = { id: string; startDate: string; endDate: string; name: string }
type Region = { id: string; label: string }

const BASE = '/api/m/advanced-shipping-for-shop/admin/holidays'

const card = { border: '1px solid var(--color-border)', borderRadius: 12, padding: '1rem 1.25rem', background: 'var(--color-surface)', marginBottom: '1.5rem' } as const

function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y!, m! - 1, d!, 12)).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
}

function formatRun(c: CustomClosure): string {
  return c.startDate === c.endDate ? formatDate(c.startDate) : `${formatDate(c.startDate)} to ${formatDate(c.endDate)}`
}

const field = { display: 'grid', gap: '0.25rem', fontSize: '0.8125rem' } as const
const tag = { fontSize: '0.75rem', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)', borderRadius: 999, padding: '0 0.5rem', marginLeft: '0.5rem' } as const

// A refresh time is a clock time, so it needs the shop's zone naming explicitly
// - the browser's own is right only for an admin sitting in it.
function formatStamp(iso: string, timezone: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
    }).format(date)
  } catch {
    return date.toISOString()
  }
}

export function HolidaysScreen() {
  const [holidays, setHolidays] = useState<Holiday[]>([])
  const [custom, setCustom] = useState<CustomClosure[]>([])
  const [draft, setDraft] = useState({ name: '', startDate: '', endDate: '' })
  const [saving, setSaving] = useState(false)
  const [askConfirm, confirmNode] = useAdminConfirm()
  const [regions, setRegions] = useState<Region[]>([])
  const [region, setRegion] = useState<string>('england-and-wales')
  const [syncedAt, setSyncedAt] = useState<string | null>(null)
  // Both come from the server so this screen reads the shop's clock rather than
  // the admin's own: "today" decides which holidays are still ahead, and the
  // zone formats the refresh stamp.
  const [timezone, setTimezone] = useState<string>('UTC')
  const [today, setToday] = useState<string>('')
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch(BASE)
      if (!res.ok) { setError('Could not load the holiday calendar.'); return }
      const data = await res.json()
      setHolidays(data.holidays ?? [])
      setCustom(data.custom ?? [])
      setRegions(data.regions ?? [])
      setRegion(data.region ?? 'england-and-wales')
      setSyncedAt(data.syncedAt ?? null)
      setTimezone(data.timezone ?? 'UTC')
      setToday(data.today ?? '')
    } catch {
      setError('Could not load the holiday calendar.')
    }
  }, [])

  // eslint-disable-next-line react-hooks/set-state-in-effect -- delegating to an async loader; every setState runs after an await
  useEffect(() => { void load() }, [load])

  async function importHolidays() {
    setBusy(true); setError(null); setNote(null)
    try {
      const res = await fetch(`${BASE}/import`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) setError(data.error || 'The holiday list could not be imported.')
      else { setNote(`Imported ${data.count} date${data.count === 1 ? '' : 's'}.`); await load() }
    } catch {
      setError('The holiday list could not be imported.')
    } finally {
      setBusy(false)
    }
  }

  async function addClosure(event: FormEvent) {
    event.preventDefault()
    setSaving(true); setError(null); setNote(null)
    try {
      const res = await fetch(`${BASE}/custom`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: draft.name, startDate: draft.startDate, endDate: draft.endDate || undefined }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setError(data.error || 'The closed day could not be added.'); return }
      setDraft({ name: '', startDate: '', endDate: '' })
      await load()
    } catch {
      setError('The closed day could not be added.')
    } finally {
      setSaving(false)
    }
  }

  async function removeClosure(c: CustomClosure) {
    const ok = await askConfirm({ title: `Remove "${c.name}"?`, message: `${formatRun(c)} goes back to being an ordinary working day for delivery dates.`, confirmLabel: 'Remove' })
    if (!ok) return
    setError(null)
    try {
      const res = await fetch(`${BASE}/custom/${encodeURIComponent(c.id)}`, { method: 'DELETE' })
      // Already gone is the outcome asked for, so a 404 just refreshes the list.
      if (!res.ok && res.status !== 404) { setError('The closed day could not be removed.'); return }
      await load()
    } catch {
      setError('The closed day could not be removed.')
    }
  }

  const regionLabel = regions.find((r) => r.id === region)?.label ?? region
  // Before the first load answers there is no shop date to compare against, so
  // show the lot rather than silently hiding dates against the wrong clock.
  const upcoming = today ? holidays.filter((h) => h.date >= today) : holidays

  return (
    <div>
      {error && <div className="alert alert-danger" role="alert">{error}</div>}

      <section style={card}>
        <h2 style={{ fontSize: '0.9375rem', margin: '0 0 0.5rem' }}>{regionLabel} bank holidays</h2>
        <p style={{ color: 'var(--color-text-secondary)', margin: '0 0 0.75rem', fontSize: '0.8125rem' }}>
          Fetched from the official gov.uk calendar and stored here so delivery dates never wait on the internet. Change the region on the Settings screen.
          {syncedAt ? ` Last refreshed ${formatStamp(syncedAt, timezone)}.` : ' Not imported yet.'}
        </p>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <button type="button" className="btn btn-primary" onClick={importHolidays} disabled={busy}>
            {busy ? 'Importing…' : 'Import / refresh now'}
          </button>
          {note && <span role="status" style={{ color: 'var(--color-text-secondary)', fontSize: '0.8125rem' }}>{note}</span>}
        </div>
      </section>

      <section style={card}>
        <h2 style={{ fontSize: '0.9375rem', margin: '0 0 0.5rem' }}>Your own closed days</h2>
        <p style={{ color: 'var(--color-text-secondary)', margin: '0 0 0.75rem', fontSize: '0.8125rem' }}>
          Add days the shop is shut beyond the bank holidays, such as a Christmas shutdown or a stocktake. Delivery dates skip them just like a bank holiday. Leave the last day empty for a single day.
        </p>
        <form onSubmit={addClosure} style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'flex-end', marginBottom: custom.length ? '1rem' : 0 }}>
          <label style={{ ...field, flex: '1 1 14rem' }}>
            <span>Name</span>
            <input className="form-control" type="text" required maxLength={120} placeholder="e.g. Christmas shutdown" value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} />
          </label>
          <label style={field}>
            <span>First day</span>
            <input className="form-control" type="date" required value={draft.startDate} onChange={(e) => setDraft((d) => ({ ...d, startDate: e.target.value }))} />
          </label>
          <label style={field}>
            <span>Last day (optional)</span>
            <input className="form-control" type="date" min={draft.startDate || undefined} value={draft.endDate} onChange={(e) => setDraft((d) => ({ ...d, endDate: e.target.value }))} />
          </label>
          <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Adding…' : 'Add closed day'}</button>
        </form>
        {custom.length > 0 && (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: '0.375rem' }}>
            {custom.map((c) => {
              const past = today !== '' && c.endDate < today
              return (
                <li key={c.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', fontSize: '0.875rem', borderBottom: '1px solid var(--color-border)', paddingBottom: '0.375rem', color: past ? 'var(--color-text-secondary)' : undefined }}>
                  <span>{c.name}{past && <span style={tag}>Past</span>}</span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <span style={{ color: 'var(--color-text-secondary)', whiteSpace: 'nowrap' }}>{formatRun(c)}</span>
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => void removeClosure(c)}>Remove</button>
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <section style={card}>
        <h2 style={{ fontSize: '0.9375rem', margin: '0 0 0.75rem' }}>Upcoming closed days ({upcoming.length})</h2>
        {upcoming.length === 0 ? (
          <p style={{ color: 'var(--color-text-secondary)', margin: 0 }}>No upcoming closed days. Import the calendar or add your own above.</p>
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: '0.375rem' }}>
            {upcoming.map((h) => (
              <li key={h.date} style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', fontSize: '0.875rem', borderBottom: '1px solid var(--color-border)', paddingBottom: '0.375rem' }}>
                <span>{h.name}{h.source === 'custom' && <span style={tag}>Your closure</span>}</span>
                <span style={{ color: 'var(--color-text-secondary)', whiteSpace: 'nowrap' }}>{formatDate(h.date)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      {confirmNode}
    </div>
  )
}
