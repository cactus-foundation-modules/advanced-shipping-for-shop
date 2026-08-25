import { describe, it, expect } from 'vitest'
import {
  DEFAULT_DELIVERY_TEXT,
  DEFAULT_INSTALLATION_MATCH,
  mentionsInstallation,
  renderDeliveryText,
} from '@/modules/advanced-shipping-for-shop/lib/card-delivery'

describe('renderDeliveryText', () => {
  it('puts the figure into the default wording', () => {
    expect(renderDeliveryText(DEFAULT_DELIVERY_TEXT, 4)).toBe('Delivery in as little as 4 days.')
  })

  it('drops the plural on the one day it would read wrong', () => {
    expect(renderDeliveryText(DEFAULT_DELIVERY_TEXT, 1)).toBe('Delivery in as little as 1 day.')
  })

  it('leaves the word "days" alone where it is not the figure being counted', () => {
    expect(renderDeliveryText('Delivery days: {days} days. Ships weekdays.', 1)).toBe('Delivery days: 1 day. Ships weekdays.')
  })

  it('takes any wording the owner types, placeholder or not', () => {
    expect(renderDeliveryText('Yours within {days} working days', 6)).toBe('Yours within 6 working days')
    expect(renderDeliveryText('Quick delivery', 6)).toBe('Quick delivery')
  })

  it('fills every placeholder, not just the first', () => {
    expect(renderDeliveryText('{days} days - yes, {days}.', 3)).toBe('3 days - yes, 3.')
  })
})

describe('mentionsInstallation', () => {
  const services = ['Flat-Pack', 'Express Flat-Pack', 'Made To Order Installation']

  it('finds the word anywhere in a service name, whatever the case', () => {
    expect(mentionsInstallation(services, DEFAULT_INSTALLATION_MATCH)).toBe(true)
    expect(mentionsInstallation(['installation and assembly'], 'Installation')).toBe(true)
  })

  it('says no when no service carries it', () => {
    expect(mentionsInstallation(['Flat-Pack', 'Pre-Assembled'], 'Installation')).toBe(false)
  })

  it('lets a shop use its own word for it', () => {
    expect(mentionsInstallation(['Delivered and fitted'], 'fitted')).toBe(true)
  })

  it('matches nothing at all on a blank word, rather than everything', () => {
    expect(mentionsInstallation(services, '')).toBe(false)
    expect(mentionsInstallation(services, '   ')).toBe(false)
  })

  it('is safe on a product that contributed no services', () => {
    expect(mentionsInstallation(undefined, 'Installation')).toBe(false)
    expect(mentionsInstallation([], 'Installation')).toBe(false)
  })
})
