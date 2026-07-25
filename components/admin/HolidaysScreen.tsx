'use client'

import { useCallback, useEffect, useState } from 'react'

type Holiday = { date: string; name: string }
type Region = { id: string; label: string }

const card = { border: '1px solid var(--color-border)', borderRadius: 12, padding: '1rem 1.25rem', background: 'var(--color-surface)', marginBottom: '1.5rem' } as const

function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y!, m! - 1, d!, 12)).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
}

export function HolidaysScreen() {
  const [holidays, setHolidays] = useState<Holiday[]>([])
  const [regions, setRegions] = useState<Region[]>([])
  const [region, setRegion] = useState<string>('england-and-wales')
  const [syncedAt, setSyncedAt] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/m/advanced-shipping-for-shop/admin/holidays')
      if (!res.ok) { setError('Could not load the holiday calendar.'); return }
      const data = await res.json()
      setHolidays(data.holidays ?? [])
      setRegions(data.regions ?? [])
      setRegion(data.region ?? 'england-and-wales')
      setSyncedAt(data.syncedAt ?? null)
    } catch {
      setError('Could not load the holiday calendar.')
    }
  }, [])

  // eslint-disable-next-line react-hooks/set-state-in-effect -- delegating to an async loader; every setState runs after an await
  useEffect(() => { void load() }, [load])

  async function importHolidays() {
    setBusy(true); setError(null); setNote(null)
    try {
      const res = await fetch('/api/m/advanced-shipping-for-shop/admin/holidays/import', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) setError(data.error || 'The holiday list could not be imported.')
      else { setNote(`Imported ${data.count} date${data.count === 1 ? '' : 's'}.`); await load() }
    } catch {
      setError('The holiday list could not be imported.')
    } finally {
      setBusy(false)
    }
  }

  const regionLabel = regions.find((r) => r.id === region)?.label ?? region
  const upcoming = holidays.filter((h) => h.date >= new Date().toISOString().slice(0, 10))

  return (
    <div>
      {error && <div className="alert alert-danger" role="alert">{error}</div>}

      <section style={card}>
        <h2 style={{ fontSize: '0.9375rem', margin: '0 0 0.5rem' }}>{regionLabel} bank holidays</h2>
        <p style={{ color: 'var(--color-text-muted)', margin: '0 0 0.75rem', fontSize: '0.8125rem' }}>
          Fetched from the official gov.uk calendar and stored here so delivery dates never wait on the internet. Change the region on the Settings screen.
          {syncedAt ? ` Last refreshed ${new Date(syncedAt).toLocaleString('en-GB')}.` : ' Not imported yet.'}
        </p>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <button type="button" className="btn btn-primary" onClick={importHolidays} disabled={busy}>
            {busy ? 'Importing…' : 'Import / refresh now'}
          </button>
          {note && <span role="status" style={{ color: 'var(--color-text-muted)', fontSize: '0.8125rem' }}>{note}</span>}
        </div>
      </section>

      <section style={card}>
        <h2 style={{ fontSize: '0.9375rem', margin: '0 0 0.75rem' }}>Upcoming closed days ({upcoming.length})</h2>
        {upcoming.length === 0 ? (
          <p style={{ color: 'var(--color-text-muted)', margin: 0 }}>No upcoming holidays stored. Import the calendar above.</p>
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: '0.375rem' }}>
            {upcoming.map((h) => (
              <li key={h.date} style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', fontSize: '0.875rem', borderBottom: '1px solid var(--color-border)', paddingBottom: '0.375rem' }}>
                <span>{h.name}</span>
                <span style={{ color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>{formatDate(h.date)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
