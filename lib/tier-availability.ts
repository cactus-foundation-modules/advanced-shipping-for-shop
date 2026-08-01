// Where a delivery service a shopper cannot have here IS to be had.
//
// A listing's variations do not all carry the same services: a 200cm desk may be
// too big for the express van, a leather chair may be the only one built in the
// room. Showing only what every variation agrees on (or, once one is settled,
// only what that one offers) quietly hides services the shop does sell, and the
// shopper never learns that a different width would have brought it back. So the
// picker shows all of them and crosses out the ones that are not on offer here,
// with a line saying which choice carries them - the same thing the variation
// options themselves do when a pick is out of reach.
//
// This file works out that line. Pure: sets of ids in, wording out, no database
// and no window, so it is unit-testable and the server can hand the finished
// groups to the client without either side re-deriving them.
//
// The grammar deliberately matches shop-variations' own ("available in 160 to
// 180cm", "available With Headrest") so the two sit side by side on a product
// page without reading as two different shops. It is a re-statement rather than
// an import: '@/modules/shop-variations/...' does not exist on an install
// without that module, and a static import would break the build there - the
// same rule this module's variations bridge follows on the server.

import type { VariantOptionValue } from '@/modules/advanced-shipping-for-shop/lib/variations-bridge'

// One option that would have to change, and the values of it that carry the
// service. `contiguous` says the values are an unbroken run of that option's own
// order, which is what lets three or more of them read as a range.
export type AvailableWithGroup = {
  optionName: string
  labels: string[]
  contiguous: boolean
}

// The groups plus how they relate to each other, which is not the same question
// twice over. Where the shopper still has options to pick, every group has to
// hold at once - "in 160cm and Oak" means both. Where one of their own picks is
// in the way, each group is a way OUT on its own - changing the arms would do
// it, and so would changing the adjustments - and joining those with "and" would
// tell them to do twice the work.
export type AvailableWith = {
  groups: AvailableWithGroup[]
  join: 'and' | 'or'
}

// Distinct labels in the order the option itself lists them, deduped - two
// variations of the same width are one width to a shopper.
function labelsInOrder(values: VariantOptionValue[]): string[] {
  const seen = new Map<string, number>()
  for (const v of values) {
    const at = seen.get(v.valueLabel)
    if (at == null || v.valuePosition < at) seen.set(v.valueLabel, v.valuePosition)
  }
  return [...seen.entries()].sort((a, b) => a[1] - b[1]).map(([label]) => label)
}

// The shopper's picks as option -> value, over the values this listing knows. A
// value id it does not (a stale pick, another product's page) is ignored rather
// than filtering everything out.
function picksOf(all: VariantOptionValue[], chosenValueIds?: string[] | null): Map<string, string> {
  const optionOfValue = new Map(all.map((v) => [v.valueId, v.optionId]))
  const picks = new Map<string, string>()
  for (const valueId of chosenValueIds ?? []) {
    const optionId = optionOfValue.get(valueId)
    if (optionId) picks.set(optionId, valueId)
  }
  return picks
}

// Which of a listing's variations are still in play, given what the shopper has
// picked so far. The listing's delivery preview is built out of exactly these:
// a service one of them still carries is a service the shopper can still have,
// so it is shown as a service like any other, and only once a pick has put the
// last variation carrying it out of play has it actually been lost - which is
// when it earns the unavailable chip and the "available in" line.
//
// Nothing picked means everything in play, which is the whole point: a shopper
// who has chosen nothing has ruled nothing out, and crossing services out before
// they have touched a control tells them the shop cannot do something it plainly
// can. Picks matching no variation at all (a stale selection, a listing rebuilt
// underneath it) fall back to the same answer rather than emptying the page.
export function childIdsInPlay(
  optionValuesByChild: Map<string, VariantOptionValue[]>,
  childIds: string[],
  chosenValueIds?: string[] | null,
): string[] {
  const picks = picksOf(childIds.flatMap((id) => optionValuesByChild.get(id) ?? []), chosenValueIds)
  if (picks.size === 0) return childIds
  const matching = childIds.filter((id) => {
    const values = optionValuesByChild.get(id) ?? []
    for (const [optionId, valueId] of picks) {
      if (!values.some((v) => v.optionId === optionId && v.valueId === valueId)) return false
    }
    return true
  })
  return matching.length > 0 ? matching : childIds
}

// Compares two option-value sets and reports where the first narrows the second,
// option by option. The shared half of every answer below.
function narrowingGroups(
  optionIds: string[],
  reachable: VariantOptionValue[],
  everything: VariantOptionValue[],
  skipOptionIds?: Set<string>,
): AvailableWithGroup[] {
  const groups: AvailableWithGroup[] = []
  for (const optionId of optionIds) {
    if (skipOptionIds?.has(optionId)) continue
    const allHere = everything.filter((v) => v.optionId === optionId)
    const reachableHere = reachable.filter((v) => v.optionId === optionId)
    if (reachableHere.length === 0 || allHere.length === 0) continue
    const allLabels = labelsInOrder(allHere)
    const labels = labelsInOrder(reachableHere)
    // Every value of this option leads to the service, so it is not what is
    // holding it back and naming it would only mislead.
    if (labels.length >= allLabels.length) continue
    const indices = labels.map((l) => allLabels.indexOf(l))
    const first = indices[0] ?? 0
    groups.push({
      optionName: allHere[0]!.optionName,
      labels,
      contiguous: indices.every((n, k) => n === first + k),
    })
  }
  return groups
}

// Which of the listing's options a shopper would have to choose (or change) to
// get this service, and what they would have to choose.
//
// The answer is held against what they have picked ALREADY, which is the whole
// difference between a useful line and a misleading one. A chair listing may
// offer express delivery on fourteen of its twenty-four colours across the range
// as a whole, but on the arms and adjustments this shopper has settled on, only
// three of those colours have it. Answering from the listing rather than from
// their half-built combination lists eleven colours that would not actually
// bring the service back.
//
// So, in order:
//  1. Can they still reach it without undoing anything? Then the only thing left
//     to say is which of the options they have NOT yet picked would take them
//     there - measured among the variations that match their picks.
//  2. If not, one of their own picks is in the way: each is relaxed in turn to
//     find which, and what it would have to become.
//  3. With nothing picked at all (or nothing that explains it), it falls back to
//     the plain listing-wide answer, which is all there is to give.
export function availableWithGroups(
  optionValuesByChild: Map<string, VariantOptionValue[]>,
  allChildIds: string[],
  offeringChildIds: string[],
  chosenValueIds?: string[] | null,
): AvailableWith {
  const nothing: AvailableWith = { groups: [], join: 'and' }
  if (offeringChildIds.length === 0) return nothing
  const valuesOf = (ids: string[]) => ids.flatMap((id) => optionValuesByChild.get(id) ?? [])
  const all = valuesOf(allChildIds)
  const offering = valuesOf(offeringChildIds)
  if (offering.length === 0) return nothing

  // Option order is the order the product page shows its controls in, so the
  // sentence names them the way the shopper reads down the page.
  const optionIds = [...new Map(all.map((v) => [v.optionId, v])).values()]
    .sort((a, b) => a.optionPosition - b.optionPosition)
    .map((v) => v.optionId)

  const picks = picksOf(all, chosenValueIds)
  const globalAnswer = (): AvailableWith => ({ groups: narrowingGroups(optionIds, offering, all), join: 'and' })
  if (picks.size === 0) return globalAnswer()

  // Children matching the picks, optionally with one option's pick set aside.
  const matching = (ids: string[], relaxOptionId?: string) => ids.filter((id) => {
    const values = optionValuesByChild.get(id) ?? []
    for (const [optionId, valueId] of picks) {
      if (optionId === relaxOptionId) continue
      if (!values.some((v) => v.optionId === optionId && v.valueId === valueId)) return false
    }
    return true
  })

  // 1. Still reachable on what they have chosen: the unpicked options are the
  //    whole story, and they are measured among the variations that match.
  const reachable = matching(offeringChildIds)
  if (reachable.length > 0) {
    return {
      groups: narrowingGroups(optionIds, valuesOf(reachable), valuesOf(matching(allChildIds)), new Set(picks.keys())),
      join: 'and',
    }
  }

  // 2. A pick is in the way. Relax them one at a time to find which one, and
  //    what it would have to become - held against the other picks, so what is
  //    offered is a combination that really exists.
  const groups: AvailableWithGroup[] = []
  for (const optionId of optionIds) {
    if (!picks.has(optionId)) continue
    const freed = matching(offeringChildIds, optionId)
    if (freed.length === 0) continue
    groups.push(...narrowingGroups(
      [optionId],
      valuesOf(freed),
      valuesOf(matching(allChildIds, optionId)),
    ))
  }
  // 3. No single change explains it (several would have to move at once), so the
  //    listing-wide answer is the only honest thing left.
  return groups.length > 0 ? { groups, join: 'or' } : globalAnswer()
}

// Two labels ending in a number and the same unit ("160cm", "180cm") read as a
// range with the unit said once. Null for anything that is not a pair of
// measurements - "Oak to Walnut" is two woods with a word between them, not a
// range, so those get listed out instead.
function rangeStart(first: string, last: string): string | null {
  const a = /^(.*[0-9])([^0-9]*)$/.exec(first)
  const b = /^(.*[0-9])([^0-9]*)$/.exec(last)
  if (a && b && a[1] && a[2] === b[2]) return a[1]
  return null
}

// One phrase per group, before any preposition goes in front of it: "160 to
// 180cm" for an unbroken run of three or more, otherwise the labels listed out.
function groupPhrases(groups: AvailableWithGroup[]): string[] {
  return groups.map((group) => {
    const labels = group.labels
    const first = labels[0]
    const last = labels[labels.length - 1]
    if (!first || !last) return ''
    if (labels.length === 1) return first
    if (labels.length >= 3 && group.contiguous) {
      const start = rangeStart(first, last)
      if (start) return `${start} to ${last}`
    }
    return `${labels.slice(0, -1).join(', ')} or ${last}`
  }).filter(Boolean)
}

// A value whose own label is already a preposition phrase - "With Headrest",
// "Without Arms" - carries its own grammar, and "available in With Headrest" is
// not English. Those take no "in"; everything else does.
function carriesOwnPreposition(phrase: string): boolean {
  return /^with(out)?\b/i.test(phrase)
}

// The whole line printed under an unavailable service: "Available in 160 to
// 180cm", or "Available With Headrest" where the value says its own preposition.
// Where two options both have to move, only the FIRST plain phrase takes the
// "in" - "available in 160 to 180cm and Oak", not "…and in Oak" - since one
// preposition already governs the list. Whether that list joins on "and" or "or"
// is the caller's to say (see AvailableWith): one is a combination to build, the
// other a set of ways out.
//
// Falls back to a plain "Not available on this choice" when no option narrows it
// down, which is the honest answer: the service is not on offer here and there
// is no single change that would bring it back.
export function availableWithPhrase(result: AvailableWith): string {
  let inSpent = false
  const parts = groupPhrases(result.groups).map((phrase) => {
    if (carriesOwnPreposition(phrase)) return phrase
    if (inSpent) return phrase
    inSpent = true
    return `in ${phrase}`
  })
  return parts.length === 0 ? 'Not available on this choice' : `Available ${parts.join(` ${result.join} `)}`
}
