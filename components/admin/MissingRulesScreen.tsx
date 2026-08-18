'use client'

// Which shipping-attribute values no delivery service prices. A value with no
// price row of its own still sells - it falls back to the category, supplier or
// everywhere price - so nothing here is broken as such; it is a list of the
// places where the fallback is doing the deciding.
import { useCallback, useEffect, useState } from 'react'

type Tier = { id: string; label: string }
type ValueRow = { id: string; label: string; productCount: number; coveredTierIds: string[] }
type Report = { attributeName: string | null; tiers: Tier[]; values: ValueRow[] }

const card = { border: '1px solid var(--color-border)', borderRadius: 12, background: 'var(--color-surface)', marginBottom: '1.25rem', overflow: 'hidden' } as const
const cardPad = { padding: '1rem 1.25rem' } as const
const help = { color: 'var(--color-text-secondary)', fontSize: '0.8125rem', margin: '0.375rem 0 0', lineHeight: 1.45 }
const th = { padding: '0.5rem 0.75rem', fontWeight: 600 } as const
const td = { padding: '0.5rem 0.75rem', verticalAlign: 'top' as const }

const pill = {
  fontSize: '0.75rem', padding: '0.15rem 0.5rem', borderRadius: 999,
  border: '1px solid var(--color-border)', background: 'var(--color-surface-raised)',
  color: 'var(--color-text-secondary)', whiteSpace: 'nowrap' as const,
} as const
const pillMuted = { ...pill, background: 'transparent' } as const

const EMPTY: Report = { attributeName: null, tiers: [], values: [] }

function products(n: number): string {
  return `${n} product${n === 1 ? '' : 's'}`
}

export function MissingRulesScreen() {
  const [report, setReport] = useState<Report>(EMPTY)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/m/advanced-shipping-for-shop/admin/missing-rules')
      if (!res.ok) { setError('Could not work out which shipping attributes are covered.'); return }
      setReport(await res.json())
    } catch {
      setError('Could not work out which shipping attributes are covered.')
    } finally {
      setLoaded(true)
    }
  }, [])

  // eslint-disable-next-line react-hooks/set-state-in-effect -- delegating to an async loader; every setState runs after an await
  useEffect(() => { void load() }, [load])

  const { attributeName, tiers, values } = report
  // Busiest first: a value on 200 products matters more than one on none.
  const byUse = (a: ValueRow, b: ValueRow) => b.productCount - a.productCount || a.label.localeCompare(b.label)
  const missing = values.filter((v) => v.coveredTierIds.length === 0).sort(byUse)
  const partial = values
    .filter((v) => v.coveredTierIds.length > 0 && v.coveredTierIds.length < tiers.length)
    .sort(byUse)
    .map((v) => ({ ...v, missingTiers: tiers.filter((t) => !v.coveredTierIds.includes(t.id)) }))

  return (
    <div>
      {error && <div className="alert alert-danger" role="alert">{error}</div>}

      <p style={{ color: 'var(--color-text-secondary)', margin: '0 0 1.25rem', fontSize: '0.875rem', lineHeight: 1.5, maxWidth: '46rem' }}>
        Every value of your shipping attribute that no delivery service gives a price of its own.
        Those values still sell - they fall back to the category, supplier or everywhere price - so
        this is a list of what the fallback is currently deciding for you, not a list of faults.
        Add a price on the Delivery services screen to take one off this list.
      </p>

      {loaded && !attributeName && (
        <section style={{ ...card, ...cardPad }}>
          <h2 style={{ fontSize: '0.9375rem', margin: '0 0 0.375rem' }}>No shipping attribute chosen</h2>
          <p style={{ ...help, marginTop: 0 }}>
            Pick one on the Delivery settings screen and this list fills itself in. Until then every
            price is matched on category, supplier or the whole shop.
          </p>
        </section>
      )}

      {loaded && attributeName && (
        <>
          <section style={card}>
            <div style={{ ...cardPad, borderBottom: missing.length > 0 ? '1px solid var(--color-border)' : 'none' }}>
              <h2 style={{ fontSize: '0.9375rem', margin: 0 }}>
                Not priced by any service{missing.length > 0 ? ` (${missing.length})` : ''}
              </h2>
              <p style={{ ...help, marginBottom: 0 }}>
                Values of your &ldquo;{attributeName}&rdquo; attribute that appear on no delivery
                service at all.
              </p>
            </div>
            {missing.length === 0 ? (
              <p style={{ ...cardPad, margin: 0, fontSize: '0.8125rem', color: 'var(--color-text-secondary)' }}>
                Every value has a price on at least one service. Rather satisfying.
              </p>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8125rem' }}>
                <thead>
                  <tr style={{ textAlign: 'left', color: 'var(--color-text-secondary)', background: 'var(--color-surface-raised)' }}>
                    <th style={th}>Shipping attribute</th>
                    <th style={th}>Products using it</th>
                  </tr>
                </thead>
                <tbody>
                  {missing.map((v) => (
                    <tr key={v.id} style={{ borderTop: '1px solid var(--color-border)' }}>
                      <td style={td}>{v.label}</td>
                      <td style={td}>
                        {v.productCount === 0
                          ? <span style={{ color: 'var(--color-text-secondary)' }}>Nothing uses it yet</span>
                          : products(v.productCount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          {partial.length > 0 && (
            <section style={card}>
              <div style={{ ...cardPad, borderBottom: '1px solid var(--color-border)' }}>
                <h2 style={{ fontSize: '0.9375rem', margin: 0 }}>Priced by some services only ({partial.length})</h2>
                <p style={{ ...help, marginBottom: 0 }}>
                  These have a price on at least one service, but not on all of them. The services
                  listed fall back to a broader price here.
                </p>
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8125rem' }}>
                <thead>
                  <tr style={{ textAlign: 'left', color: 'var(--color-text-secondary)', background: 'var(--color-surface-raised)' }}>
                    <th style={th}>Shipping attribute</th>
                    <th style={th}>Products using it</th>
                    <th style={th}>No price on</th>
                  </tr>
                </thead>
                <tbody>
                  {partial.map((v) => (
                    <tr key={v.id} style={{ borderTop: '1px solid var(--color-border)' }}>
                      <td style={td}>{v.label}</td>
                      <td style={td}>
                        {v.productCount === 0
                          ? <span style={{ color: 'var(--color-text-secondary)' }}>Nothing uses it yet</span>
                          : products(v.productCount)}
                      </td>
                      <td style={td}>
                        <span style={{ display: 'inline-flex', gap: '0.25rem', flexWrap: 'wrap' }}>
                          {v.missingTiers.map((t) => (<span key={t.id} style={pillMuted}>{t.label}</span>))}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
        </>
      )}
    </div>
  )
}
