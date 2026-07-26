'use client'

// Shared scope picker used by both the Rules and Service-tier pricing screens:
// a scope-type select plus a matching reference select (supplier name, category
// id, or range value id). DEFAULT needs no reference.
import type { ScopeType } from '@/modules/advanced-shipping-for-shop/lib/types'

export type ScopeOptions = {
  suppliers: string[]
  categories: { id: string; name: string; parentId: string | null }[]
  rangeValues: { id: string; label: string }[]
}

const SCOPE_LABELS: Record<ScopeType, string> = {
  DEFAULT: 'Everything (default)',
  SUPPLIER: 'A supplier',
  CATEGORY: 'A category',
  RANGE: 'A range',
}

export function ScopePicker({
  scopeType,
  scopeRef,
  options,
  onChange,
  allowRange,
  allowSupplier = true,
}: {
  scopeType: ScopeType
  scopeRef: string | null
  options: ScopeOptions
  onChange: (scopeType: ScopeType, scopeRef: string | null) => void
  allowRange: boolean
  // Service-tier prices no longer scope by supplier (a tier carries its own
  // supplier), so that screen hides the SUPPLIER option. Rules still use it.
  allowSupplier?: boolean
}) {
  const base: ScopeType[] = allowSupplier ? ['DEFAULT', 'SUPPLIER', 'CATEGORY'] : ['DEFAULT', 'CATEGORY']
  const types: ScopeType[] = allowRange ? [...base, 'RANGE'] : base
  return (
    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
      <select
        className="form-control"
        style={{ flex: '0 0 12rem' }}
        value={scopeType}
        onChange={(e) => {
          const next = e.target.value as ScopeType
          onChange(next, next === 'DEFAULT' ? null : '')
        }}
        aria-label="Applies to"
      >
        {types.map((t) => (
          <option key={t} value={t}>{SCOPE_LABELS[t]}</option>
        ))}
      </select>

      {scopeType === 'SUPPLIER' && (
        <select className="form-control" style={{ flex: '1 1 12rem' }} value={scopeRef ?? ''} onChange={(e) => onChange('SUPPLIER', e.target.value || null)} aria-label="Supplier">
          <option value="">Choose a supplier…</option>
          {options.suppliers.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      )}
      {scopeType === 'CATEGORY' && (
        <select className="form-control" style={{ flex: '1 1 12rem' }} value={scopeRef ?? ''} onChange={(e) => onChange('CATEGORY', e.target.value || null)} aria-label="Category">
          <option value="">Choose a category…</option>
          {options.categories.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      )}
      {scopeType === 'RANGE' && (
        <select className="form-control" style={{ flex: '1 1 12rem' }} value={scopeRef ?? ''} onChange={(e) => onChange('RANGE', e.target.value || null)} aria-label="Range">
          <option value="">Choose a range…</option>
          {options.rangeValues.map((v) => (
            <option key={v.id} value={v.id}>{v.label}</option>
          ))}
        </select>
      )}
    </div>
  )
}

export function scopeRefLabel(scopeType: ScopeType, scopeRef: string | null, options: ScopeOptions): string {
  if (scopeType === 'DEFAULT') return 'Everything'
  if (scopeType === 'SUPPLIER') return scopeRef ?? '—'
  if (scopeType === 'CATEGORY') return options.categories.find((c) => c.id === scopeRef)?.name ?? '(deleted category)'
  return options.rangeValues.find((v) => v.id === scopeRef)?.label ?? '(deleted range)'
}
