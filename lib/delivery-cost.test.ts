import { describe, expect, it } from 'vitest'
import { deliveryCostState } from '@/modules/advanced-shipping-for-shop/lib/delivery-cost'

describe('deliveryCostState', () => {
  it('records the cost price per unit, to the penny', () => {
    expect(deliveryCostState('pre-assembled', '30.00')).toEqual({ tierKey: 'pre-assembled', unitCost: 30 })
    expect(deliveryCostState('express', 12.345)).toEqual({ tierKey: 'express', unitCost: 12.35 })
  })

  it('records a free or unreadable cost as zero, never as missing', () => {
    expect(deliveryCostState('standard', '0.00').unitCost).toBe(0)
    expect(deliveryCostState('standard', 'n/a').unitCost).toBe(0)
    expect(deliveryCostState('standard', -5).unitCost).toBe(0)
  })
})
