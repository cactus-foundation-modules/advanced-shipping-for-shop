import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ShopCardDelivery, shopCardDeliveryPuckComponent, shopCardDeliveryPuckRscComponent } from '@/modules/advanced-shipping-for-shop/components/puck/card-delivery'
import { CARD_DELIVERY_FACT_ID, type CardDeliveryFacts } from '@/modules/advanced-shipping-for-shop/lib/card-delivery'
import type { CardPartContext } from '@/modules/shop/components/puck/parts/part-context'

// The block is a pure view over what the provider resolved, so these pin the
// three things a card can get wrong on a live storefront: printing a promise
// for a product that has none, printing "Installation available." where it is
// not, and quietly gaining styling nobody asked for.

function ctxWith(facts?: CardDeliveryFacts): CardPartContext {
  // Only `facts` is read by this block; the rest of the card context is shop's
  // and is not worth building here.
  return { facts: facts ? [{ id: CARD_DELIVERY_FACT_ID, payload: facts }] : [] } as unknown as CardPartContext
}

const DEFAULTS = shopCardDeliveryPuckComponent.defaultProps

const FAST: CardDeliveryFacts = { days: 4, workingDays: 3, services: ['Flat-Pack', 'Express Flat-Pack', 'Installation'] }
const NO_INSTALL: CardDeliveryFacts = { days: 9, workingDays: 6, services: ['Flat-Pack', 'Pre-Assembled'] }

describe('Card: Delivery', () => {
  it('prints the soonest figure under the price', () => {
    const html = renderToStaticMarkup(<ShopCardDelivery {...DEFAULTS} _ctx={ctxWith(FAST)} />)
    expect(html).toContain('Delivery in as little as 4 days.')
  })

  it('adds the installation line only where a service carries the word', () => {
    expect(renderToStaticMarkup(<ShopCardDelivery {...DEFAULTS} _ctx={ctxWith(FAST)} />)).toContain('Installation available.')
    expect(renderToStaticMarkup(<ShopCardDelivery {...DEFAULTS} _ctx={ctxWith(NO_INSTALL)} />)).not.toContain('Installation available.')
  })

  it('counts working days when the owner asks it to', () => {
    const html = renderToStaticMarkup(<ShopCardDelivery {...DEFAULTS} dayCount="working" _ctx={ctxWith(FAST)} />)
    expect(html).toContain('as little as 3 days.')
  })

  it('says nothing at all for a product with no delivery answer', () => {
    expect(renderToStaticMarkup(<ShopCardDelivery {...DEFAULTS} _ctx={ctxWith()} />)).toBe('')
  })

  it('shows a sample in the layout editor, where there is no product', () => {
    const html = renderToStaticMarkup(<ShopCardDelivery {...DEFAULTS} />)
    expect(html).toContain('Delivery in as little as')
    expect(html).toContain('Installation available.')
  })

  it('takes its size, colour, alignment and padding from the block', () => {
    const html = renderToStaticMarkup(
      <ShopCardDelivery
        {...DEFAULTS}
        size={15}
        colour="light-dark(var(--color-3), var(--color-7))"
        align="center"
        padTop={6}
        padBottom={10}
        _ctx={ctxWith(FAST)}
      />,
    )
    expect(html).toContain('font-size:15px')
    expect(html).toContain('color:light-dark(var(--color-3), var(--color-7))')
    expect(html).toContain('text-align:center')
    expect(html).toContain('padding-top:6px')
    expect(html).toContain('padding-bottom:10px')
  })

  it('leaves the card alone where nothing was set', () => {
    const html = renderToStaticMarkup(<ShopCardDelivery {...DEFAULTS} _ctx={ctxWith(FAST)} />)
    expect(html).not.toContain('text-align')
    expect(html).not.toContain('padding-top')
    expect(html).not.toContain('padding-bottom')
    // The card's own proportional size, so the two-up mobile grid shrinks this
    // line with everything else on the tile.
    expect(html).toContain('font-size:.8125em')
  })

  it('renders the same markup in the editor as on the storefront', () => {
    expect(shopCardDeliveryPuckRscComponent.render).toBe(shopCardDeliveryPuckComponent.render)
  })
})
