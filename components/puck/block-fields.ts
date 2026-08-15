import type { CSSProperties } from 'react'

// Shared field bits for this module's blocks, so a setting is described once and
// every block that offers it reads the same.
//
// These blocks each render a single line or row and all three shipped with
// `fields: {}` - an owner could drop a delivery estimate onto a centred product
// layout and then had no way to stop it hugging the left margin.

export const alignOptions = [
  { value: 'left', label: 'Left' },
  { value: 'center', label: 'Centre' },
  { value: 'right', label: 'Right' },
]

export const alignField = {
  type: 'select' as const,
  label: 'Alignment',
  options: alignOptions,
}

/** The style for an alignment choice, or undefined for the default.
 *
 *  undefined rather than `{ textAlign: 'left' }` on purpose: React emits no
 *  style attribute at all for undefined, so a block saved before this setting
 *  existed renders byte-identical markup rather than gaining an attribute. */
export function alignStyle(align?: string): CSSProperties | undefined {
  return align === 'center' || align === 'right' ? { textAlign: align } : undefined
}
