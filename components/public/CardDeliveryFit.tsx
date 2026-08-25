'use client'

// The delivery line in its "shrink to fit on one line" mode (see the Card:
// Delivery block in components/puck/card-delivery.tsx). A card is narrow and the
// sentence is as long as the number in it - "in as little as 8 days" plus
// "Installation available." wraps on a four-up grid and does not on a two-up -
// so the only way to keep it to one line is to measure the card it landed in.
//
// Client, because that is a per-card, per-viewport measurement no stylesheet can
// express. Mounted ONLY when the owner asks for it: with the setting off, the
// block is plain server-rendered markup and this file never reaches the browser.
//
// The text is server-rendered and readable before this runs; the measurement
// only ever makes it smaller, so with scripts unavailable the line simply wraps
// as it would have anyway. Same bargain shop's own ShopCardFillBlurb strikes.
//
// It shrinks by setting a MULTIPLIER, never by writing a font size. The size on
// the element is the owner's (`calc(<their size> * var(--ash-card-fit, 1))`), so
// overwriting it would silently throw away whatever they set on the block and
// measure the card's inherited size instead - which is what an earlier version
// did, and why the line still ran out of its column after "fitting".
//
// It never shrinks below MIN_PX - the same 8px floor the block's own "Text size"
// field stops at, so this can never take the line somewhere the owner could not
// have set it by hand. A sentence needing less than that has been given more
// words than the card has room for, and a line nobody can read is worse than a
// line that wraps, so past the floor it is left to wrap.
import { useLayoutEffect, useRef, type CSSProperties } from 'react'

/** The custom property the block's font size is multiplied by. */
export const FIT_VAR = '--ash-card-fit'

const MIN_PX = 8
// Type does not scale quite linearly (hinting and sub-pixel rounding), so one
// division lands close but can still be a few pixels over. Each pass measures
// what actually happened and takes the remainder off; two or three settle it.
const MAX_PASSES = 4

export function CardDeliveryFit({ text, style }: { text: string; style?: CSSProperties }) {
  const ref = useRef<HTMLSpanElement>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    // The width the last sum was worked out for. The observer below fires on
    // height changes too - including the ones this effect causes by changing the
    // type size - so without this the two would chase each other. The element is
    // display:block with no em padding, so its width does not depend on the font
    // size being measured.
    let lastWidth = -1

    const wrapInstead = () => {
      el.style.setProperty(FIT_VAR, '1')
      el.style.removeProperty('white-space')
    }

    const measure = () => {
      const available = el.clientWidth
      if (available === lastWidth) return
      lastWidth = available
      // Back to the owner's own size and to one line, so each pass measures the
      // sentence itself rather than the last pass's answer.
      el.style.setProperty(FIT_VAR, '1')
      el.style.whiteSpace = 'nowrap'
      const base = parseFloat(getComputedStyle(el).fontSize)
      // Nothing measurable yet (a hidden tab, a card not laid out). Leave it
      // wrapping and wait - the observer fires again once it has a box.
      if (!(available > 0) || !Number.isFinite(base) || base <= 0) {
        wrapInstead()
        lastWidth = -1
        return
      }
      const floor = Math.min(base, MIN_PX)
      let ratio = 1
      for (let pass = 0; pass < MAX_PASSES && el.scrollWidth > available; pass++) {
        ratio = (ratio * available) / el.scrollWidth
        if (base * ratio < floor) {
          wrapInstead()
          return
        }
        el.style.setProperty(FIT_VAR, String(ratio))
      }
      // Still over after every pass: a sentence this card was never going to
      // hold on one line. Wrapping is the honest answer, not clipping it.
      if (el.scrollWidth > available) wrapInstead()
    }

    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [text])

  // display:block so the span's width IS the card's text column - an inline span
  // would report its own shrink-wrapped width and there would be nothing to fit
  // the sentence into.
  return (
    <span ref={ref} style={{ ...style, display: 'block' }}>
      {text}
    </span>
  )
}
