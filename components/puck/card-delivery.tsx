// "Card: Delivery" - a part-block for shop's Product Card layout that prints how
// soon the product on the tile could arrive: "Delivery in as little as 4 days.",
// and, where one of the services it is offered is an installation one,
// "Installation available." after it. Drop it under the Card: Price part on the
// Product Card layout and every grid that stamps that card - categories,
// collections, tag pages, filter collections, related and featured strips -
// prints it.
//
// The figure is not fetched here. This module resolves it once per grid through
// shop's `shop.card-media` point (lib/card-delivery-provider.ts) and shop injects
// it into every card part's `_ctx`, so a grid of forty products costs one batched
// pass rather than forty. That is also why this file has no 'use client' and no
// prisma import: it is a pure view, server-rendered on the storefront and drawn
// as a labelled sample in the layout editor, from one file like shop's own card
// parts. The id, the types and the wording rules come from lib/card-delivery.ts
// for the same reason - this file is registered as an editor component too, so
// anything it imports at runtime ends up in the client bundle.
import type { CSSProperties } from 'react'
import { SiteColourField } from '@/lib/puck/SiteColourField'
import type { CardPartContext } from '@/modules/shop/components/puck/parts/part-context'
import { alignField, alignStyle } from '@/modules/advanced-shipping-for-shop/components/puck/block-fields'
import { CardDeliveryFit } from '@/modules/advanced-shipping-for-shop/components/public/CardDeliveryFit'
import {
  CARD_DELIVERY_FACT_ID,
  DEFAULT_DELIVERY_TEXT,
  DEFAULT_INSTALLATION_MATCH,
  DEFAULT_INSTALLATION_TEXT,
  FIT_VAR,
  mentionsInstallation,
  renderDeliveryText,
  type CardDeliveryFacts,
} from '@/modules/advanced-shipping-for-shop/lib/card-delivery'

// Puck attaches the drag handle to a part's own root element. Shop's card parts
// explain why at length (modules/shop/components/puck/parts/card-parts.tsx): a
// wrapper div between `.shop-card` and the part breaks the card's child-based
// layout rules - the image beside/overlay looks are `:has()` and `~` selectors on
// the card's direct children - so the ref goes on the root here too and the block
// is declared `inline`.
type PuckPart = { puck?: { dragRef?: ((element: Element | null) => void) | null } }

export type ShopCardDeliveryProps = PuckPart & {
  _ctx?: CardPartContext
  text?: string
  dayCount?: string
  installMatch?: string
  installText?: string
  size?: number
  colour?: string
  align?: string
  padTop?: number
  padBottom?: number
  oneLine?: string
}

function dragRefOf(props: PuckPart) {
  return props.puck?.dragRef ?? undefined
}

// What the editor canvas shows, where there is no product to read. A figure and
// an installation service, so the author can see both halves of the line while
// placing and styling the block.
const SAMPLE: CardDeliveryFacts = { days: 4, workingDays: 3, services: ['Express Delivery', 'Installation'] }

// px where a size was set, otherwise the card's own proportional size. Every
// measurement on a card is in em off `.shop-card`'s font-size so the whole tile
// can be scaled as a unit (the two-up mobile grid does exactly that), and this
// line follows the short description's .8125em by default. A px size opts out of
// that, exactly as it does on shop's own Name and Price parts.
function textSize(size?: number): string {
  const n = Number(size)
  return Number.isFinite(n) && n > 0 ? `${n}px` : '.8125em'
}

// The gap above and below, in px, left off entirely when unset so the block
// keeps the card's own rhythm (the .5em top margin below) rather than gaining a
// style attribute full of zeroes.
function padStyle(padTop?: number, padBottom?: number): CSSProperties {
  const top = Number(padTop)
  const bottom = Number(padBottom)
  return {
    ...(Number.isFinite(top) && top >= 0 ? { paddingTop: top } : {}),
    ...(Number.isFinite(bottom) && bottom >= 0 ? { paddingBottom: bottom } : {}),
  }
}

export function ShopCardDelivery(props: ShopCardDeliveryProps) {
  const ctx = props._ctx
  // Live: this module's own entry in whatever companion modules contributed for
  // this product. A product no delivery service reaches, or one whose stock
  // rules refuse to promise a date, has none - and the block renders nothing at
  // all rather than an empty gap in the tile.
  const facts = ctx?.facts?.find((f) => f.id === CARD_DELIVERY_FACT_ID)?.payload as CardDeliveryFacts | undefined
  const resolved = ctx ? facts : SAMPLE
  if (!resolved) return null

  const days = props.dayCount === 'working' ? resolved.workingDays : resolved.days
  const sentence = renderDeliveryText(props.text || DEFAULT_DELIVERY_TEXT, days)
  const installText = props.installText ?? DEFAULT_INSTALLATION_TEXT
  const install = installText && mentionsInstallation(resolved.services, props.installMatch ?? DEFAULT_INSTALLATION_MATCH)
    ? installText
    : ''
  const line = install ? `${sentence} ${install}` : sentence
  if (!line.trim()) return null

  // The words carry the size and the colour; the paragraph carries the card's
  // 1em side inset, so the line stays flush with the name and the price row
  // whatever size the type is set to. Padding shorthand first, the owner's own
  // top/bottom after it - a longhand set inline outranks a shorthand set inline.
  const oneLine = props.oneLine === 'yes'
  const size = textSize(props.size)
  const textStyle: CSSProperties = {
    // In one-line mode the size is multiplied by a custom property the island
    // sets, so it can shrink the line without ever overwriting - or having to
    // read back - whatever size was set on the block.
    fontSize: oneLine ? `calc(${size} * var(${FIT_VAR}, 1))` : size,
    lineHeight: 1.4,
    // Blank leaves it on the muted text token, which is where a supporting line
    // on a card belongs. A chosen colour may carry its own dark-mode arm as
    // `light-dark(...)` (see lib/puck/lightDark.ts) - the browser picks the side,
    // so a card server-rendered once is right in both themes.
    color: props.colour || 'var(--color-text-muted)',
  }

  return (
    <p
      style={{ margin: '.5em 0 0', padding: '0 1em', ...padStyle(props.padTop, props.padBottom), ...alignStyle(props.align) }}
      ref={dragRefOf(props)}
    >
      {oneLine
        ? <CardDeliveryFit text={line} style={textStyle} />
        : <span style={textStyle}>{line}</span>}
    </p>
  )
}

const yesNo = [
  { value: 'no', label: 'No' },
  { value: 'yes', label: 'Yes' },
]

export const shopCardDeliveryPuckComponent = {
  label: 'Card: Delivery',
  inline: true,
  fields: {
    text: { type: 'text' as const, label: 'Wording ({days} is the figure)' },
    dayCount: {
      type: 'select' as const,
      label: 'Count the days as',
      options: [
        { value: 'calendar', label: 'Ordinary days (weekends counted)' },
        { value: 'working', label: 'Working days' },
      ],
    },
    installMatch: { type: 'text' as const, label: 'Word that marks a service as installation' },
    installText: { type: 'text' as const, label: 'Line to add when it is offered' },
    size: { type: 'number' as const, label: 'Text size (px, blank follows the card)', min: 8, max: 48 },
    colour: {
      type: 'custom' as const,
      label: 'Text colour',
      // Puck prints no label above a custom field, so the swatch grid carries
      // its own or the author is left guessing which row is which.
      render: ({ value, onChange, field }: { value: string; onChange: (v: string) => void; field?: { label?: string } }) => (
        <SiteColourField value={value} onChange={onChange} label={field?.label ?? 'Text colour'} />
      ),
    },
    align: alignField,
    padTop: { type: 'number' as const, label: 'Space above (px)', min: 0, max: 120 },
    padBottom: { type: 'number' as const, label: 'Space below (px)', min: 0, max: 120 },
    oneLine: { type: 'select' as const, label: 'Shrink the wording to fit on one line', options: yesNo },
  },
  defaultProps: {
    text: DEFAULT_DELIVERY_TEXT,
    dayCount: 'calendar',
    installMatch: DEFAULT_INSTALLATION_MATCH,
    installText: DEFAULT_INSTALLATION_TEXT,
    size: undefined,
    colour: '',
    align: 'left',
    padTop: undefined,
    padBottom: undefined,
    oneLine: 'no',
  },
  render: ShopCardDelivery,
}

export const shopCardDeliveryPuckRscComponent = { ...shopCardDeliveryPuckComponent, render: ShopCardDelivery }
