'use client'

// A type-to-search replacement for a plain <select> where the option list is
// long enough that scrolling it is a chore - shipping attribute values, mostly.
// Keeps the same shape as a select: a value (option id or null) and onChange.
// The list is portalled to <body> because the admin cards clip their overflow,
// which would otherwise chop the dropdown off after the first row.
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

export type SearchableOption = { id: string; label: string }

type Placement = { left: number; top: number; width: number; maxHeight: number; above: boolean }

const GAP = 2
const MIN_LIST = 8 * 16 // never squeeze the list below 8rem before flipping

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
  const [place, setPlace] = useState<Placement | null>(null)

  const selected = options.find((o) => o.id === value) ?? null
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return options
    return options.filter((o) => o.label.toLowerCase().includes(q))
  }, [options, query])

  // Sit the list under the input in viewport coordinates - or above it, when
  // the input is near the bottom of the window.
  const measure = useCallback(() => {
    const el = wrapRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const below = window.innerHeight - r.bottom - GAP - 8
    const above = r.top - GAP - 8
    const flip = below < MIN_LIST && above > below
    setPlace({
      left: r.left,
      top: flip ? r.top - GAP : r.bottom + GAP,
      width: r.width,
      maxHeight: Math.max(96, Math.min(240, flip ? above : below)),
      above: flip,
    })
  }, [])

  useLayoutEffect(() => {
    if (!open) return
    measure()
    // Any scroll container between here and the viewport moves the input.
    window.addEventListener('scroll', measure, true)
    window.addEventListener('resize', measure)
    return () => {
      window.removeEventListener('scroll', measure, true)
      window.removeEventListener('resize', measure)
    }
  }, [open, measure])

  // Close on a click anywhere else on the page (the list is outside the wrapper
  // now, so it needs testing separately).
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (!wrapRef.current?.contains(t) && !listRef.current?.contains(t)) {
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

  const list = open && place && (
    <ul
      ref={listRef}
      id={listId}
      role="listbox"
      style={{
        position: 'fixed', zIndex: 1000,
        left: place.left, width: place.width,
        ...(place.above ? { bottom: window.innerHeight - place.top } : { top: place.top }),
        maxHeight: place.maxHeight, overflowY: 'auto', margin: 0, padding: '0.25rem',
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
  )

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
      {typeof document !== 'undefined' && list ? createPortal(list, document.body) : null}
    </div>
  )
}
