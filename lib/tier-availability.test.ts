import { describe, it, expect } from 'vitest'
import { availableWithGroups, availableWithPhrase } from '@/modules/advanced-shipping-for-shop/lib/tier-availability'
import type { VariantOptionValue } from '@/modules/advanced-shipping-for-shop/lib/variations-bridge'

// A listing with two options - Width (four sizes) and Finish (two woods) - built
// as the bridge hands it over: one row per option value per variation child.
const WIDTHS = ['120cm', '140cm', '160cm', '180cm']
const FINISHES = ['Oak', 'Walnut']

function child(width: string, finish: string): VariantOptionValue[] {
  return [
    { optionId: 'w', optionName: 'Width', optionPosition: 0, valueId: `w-${width}`, valueLabel: width, valuePosition: WIDTHS.indexOf(width) },
    { optionId: 'f', optionName: 'Finish', optionPosition: 1, valueId: `f-${finish}`, valueLabel: finish, valuePosition: FINISHES.indexOf(finish) },
  ]
}

const listing = new Map<string, VariantOptionValue[]>()
for (const w of WIDTHS) for (const f of FINISHES) listing.set(`${w}/${f}`, child(w, f))
const ALL = [...listing.keys()]
const withWidths = (...widths: string[]) => ALL.filter((id) => widths.includes(id.split('/')[0]!))

describe('availableWithGroups', () => {
  it('names the option that withholds the service, and only that one', () => {
    // Express is on the two smallest widths, in both finishes: the width is the
    // culprit, the finish has nothing to do with it.
    const groups = availableWithGroups(listing, ALL, withWidths('120cm', '140cm')).groups
    expect(groups).toHaveLength(1)
    expect(groups[0]!.optionName).toBe('Width')
    expect(groups[0]!.labels).toEqual(['120cm', '140cm'])
  })

  it('says nothing about an option every variation of which carries the service', () => {
    expect(availableWithGroups(listing, ALL, ALL).groups).toEqual([])
  })

  it('drops the option the shopper has already satisfied', () => {
    // Offered on 120/140 in Oak only. A shopper already on Oak needs to change
    // the width and nothing else, so only the width is named.
    const offering = ALL.filter((id) => ['120cm', '140cm'].includes(id.split('/')[0]!) && id.endsWith('Oak'))
    const groups = availableWithGroups(listing, ALL, offering, ['w-160cm', 'f-Oak']).groups
    expect(groups.map((g) => g.optionName)).toEqual(['Width'])
  })

  it('names both options when both have to move', () => {
    const offering = ALL.filter((id) => ['120cm', '140cm'].includes(id.split('/')[0]!) && id.endsWith('Oak'))
    const groups = availableWithGroups(listing, ALL, offering, ['w-160cm', 'f-Walnut']).groups
    expect(groups.map((g) => g.optionName)).toEqual(['Width', 'Finish'])
  })

  // The defect this pick-awareness was built for: a chair offering express on
  // fourteen of its colours range-wide, but only three on the arms already
  // chosen. Answering from the listing lists eleven colours that would not
  // actually bring the service back.
  it('measures an unpicked option against the picks already made, not the whole listing', () => {
    // Offered on Oak at every width, and on Walnut only at 120cm. A shopper who
    // has picked 180cm and no finish yet can only get there on Oak.
    const offering = ALL.filter((id) => id.endsWith('Oak') || id.startsWith('120cm/'))
    const groups = availableWithGroups(listing, ALL, offering, ['w-180cm']).groups
    expect(groups).toHaveLength(1)
    expect(groups[0]!.optionName).toBe('Finish')
    expect(groups[0]!.labels).toEqual(['Oak'])
  })

  it('stays silent when the picks so far rule nothing out', () => {
    // Every finish carries it at 120cm, so a shopper already on 120cm has
    // nothing left to change - and nothing to be told.
    const offering = ALL.filter((id) => id.startsWith('120cm/'))
    expect(availableWithGroups(listing, ALL, offering, ['w-120cm']).groups).toEqual([])
  })

  it('ignores a pick that belongs to some other listing', () => {
    const offering = withWidths('120cm', '140cm')
    expect(availableWithGroups(listing, ALL, offering, ['not-a-value-here']))
      .toEqual(availableWithGroups(listing, ALL, offering))
  })

  it('marks an unbroken run of values contiguous and a gapped one not', () => {
    expect(availableWithGroups(listing, ALL, withWidths('120cm', '140cm', '160cm')).groups[0]!.contiguous).toBe(true)
    expect(availableWithGroups(listing, ALL, withWidths('120cm', '160cm', '180cm')).groups[0]!.contiguous).toBe(false)
  })

  it('has nothing to say when no variation offers it at all', () => {
    expect(availableWithGroups(listing, ALL, []).groups).toEqual([])
  })

  it('is silent on a shop with no variations rather than guessing', () => {
    expect(availableWithGroups(new Map(), [], []).groups).toEqual([])
  })
})

describe('availableWithPhrase', () => {
  it('collapses three or more contiguous measurements into a range', () => {
    const groups = availableWithGroups(listing, ALL, withWidths('120cm', '140cm', '160cm'))
    expect(availableWithPhrase(groups)).toBe('Available in 120 to 160cm')
  })

  it('lists a pair, and a gapped run, out in full', () => {
    expect(availableWithPhrase(availableWithGroups(listing, ALL, withWidths('120cm', '140cm'))))
      .toBe('Available in 120cm or 140cm')
    expect(availableWithPhrase(availableWithGroups(listing, ALL, withWidths('120cm', '160cm', '180cm'))))
      .toBe('Available in 120cm, 160cm or 180cm')
  })

  it('spends its "in" once across two options', () => {
    const offering = ALL.filter((id) => ['120cm', '140cm'].includes(id.split('/')[0]!) && id.endsWith('Oak'))
    expect(availableWithPhrase(availableWithGroups(listing, ALL, offering, ['w-160cm', 'f-Walnut'])))
      .toBe('Available in 120cm or 140cm and Oak')
  })

  it('joins independent ways out with "or", not "and"', () => {
    // Offered at 120cm in any finish, and in Oak at any width. A shopper on
    // 180cm/Walnut can get there by changing EITHER - telling them to change
    // both would be twice the work and plainly wrong.
    const offering = ALL.filter((id) => id.startsWith('120cm/') || id.endsWith('Oak'))
    const result = availableWithGroups(listing, ALL, offering, ['w-180cm', 'f-Walnut'])
    expect(result.join).toBe('or')
    expect(availableWithPhrase(result)).toBe('Available in 120cm or Oak')
  })

  it('lets a value carrying its own preposition keep it', () => {
    const armed = new Map<string, VariantOptionValue[]>([
      ['a', [{ optionId: 'o', optionName: 'Arms', optionPosition: 0, valueId: 'v1', valueLabel: 'With Arms', valuePosition: 0 }]],
      ['b', [{ optionId: 'o', optionName: 'Arms', optionPosition: 0, valueId: 'v2', valueLabel: 'Without Arms', valuePosition: 1 }]],
    ])
    expect(availableWithPhrase(availableWithGroups(armed, ['a', 'b'], ['a']))).toBe('Available With Arms')
  })

  it('falls back to a plain statement when no option narrows it down', () => {
    expect(availableWithPhrase({ groups: [], join: 'and' })).toBe('Not available on this choice')
  })
})
