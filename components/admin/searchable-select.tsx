'use client'

// A type-to-search replacement for a plain <select> where the option list is
// long enough that scrolling it is a chore - shipping attribute values, mostly.
// Keeps the same shape as a select: a value (option id or null) and onChange.
import { useEffect, useId, useMemo, useRef, useState } from 'react'

export type SearchableOption = { id: string; label: string }

export function SearchableSelect({
  value,
  options,
  onChange,
  placeholder,
  ariaLabel,
  style,
}: {
  value: string | null
  options: SearchableOption[]
  onChange: (id: string | null) => void
  placeholder: string
  ariaLabel: string
  style?: React.CSSProperties
}) {
  const listId = useId()
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const listRef = useRef<HTMLUListElement | null>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)

  const selected = options.find((o) => o.id === value) ?? null
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return options
    return options.filter((o) => o.label.toLowerCase().includes(q))
  }, [options, query])

  // Close on a click anywhere else on the page.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) {
        setOpen(false)
        setQuery('')
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  // Keep the highlighted row in view while arrowing through a long list.
  useEffect(() => {
    if (!open) return
    listRef.current?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [open, active])

  const commit = (opt: SearchableOption | undefined) => {
    if (!opt) return
    onChange(opt.id)
    setOpen(false)
    setQuery('')
  }

  return (
    <div ref={wrapRef} style={{ position: 'relative', ...style }}>
      <input
        className="form-control"
        style={{ width: '100%' }}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-label={ariaLabel}
        autoComplete="off"
        placeholder={placeholder}
        value={open ? query : (selected?.label ?? '')}
        onFocus={() => { setOpen(true); setActive(0) }}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); setActive(0) }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            if (!open) { setOpen(true); setActive(0); return }
            setActive((i) => Math.min(i + 1, matches.length - 1))
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setActive((i) => Math.max(i - 1, 0))
          } else if (e.key === 'Enter') {
            if (open) { e.preventDefault(); commit(matches[active]) }
          } else if (e.key === 'Escape') {
            if (open) { e.preventDefault(); setOpen(false); setQuery('') }
          } else if (e.key === 'Tab') {
            setOpen(false)
            setQuery('')
          }
        }}
      />
      {open && (
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          style={{
            position: 'absolute', zIndex: 30, top: 'calc(100% + 2px)', left: 0, right: 0,
            maxHeight: '15rem', overflowY: 'auto', margin: 0, padding: '0.25rem',
            listStyle: 'none', border: '1px solid var(--color-border)', borderRadius: 8,
            background: 'var(--color-surface)', boxShadow: '0 8px 24px rgb(0 0 0 / 0.15)',
          }}
        >
          {matches.length === 0 && (
            <li style={{ padding: '0.5rem 0.625rem', fontSize: '0.8125rem', color: 'var(--color-text-secondary)' }}>Nothing matches that</li>
          )}
          {matches.map((o, i) => (
            <li
              key={o.id}
              role="option"
              aria-selected={o.id === value}
              data-active={i === active}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => { e.preventDefault(); commit(o) }}
              style={{
                padding: '0.375rem 0.625rem', borderRadius: 6, cursor: 'pointer', fontSize: '0.8125rem',
                background: i === active ? 'var(--color-surface-raised)' : 'transparent',
                color: o.id === value ? 'var(--color-primary)' : 'var(--color-text)',
                fontWeight: o.id === value ? 600 : 400,
              }}
            >
              {o.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
