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

// Which of the listing's options a shopper would have to change to get this
// service, and what they would have to change them to.
//
// An option is only worth naming when it actually narrows things down: one whose
// every value carries the service explains nothing (the service is not withheld
// by that choice), and where the shopper has already settled on a variation, an
// option whose current value is among the ones that carry it is not the culprit
// either. What is left is the honest answer to "so how do I get this?".
export function availableWithGroups(
  optionValuesByChild: Map<string, VariantOptionValue[]>,
  allChildIds: string[],
  offeringChildIds: string[],
  chosenChildId?: string | null,
): AvailableWithGroup[] {
  if (offeringChildIds.length === 0) return []
  const valuesOf = (ids: string[]) => ids.flatMap((id) => optionValuesByChild.get(id) ?? [])
  const all = valuesOf(allChildIds)
  const offering = valuesOf(offeringChildIds)
  if (offering.length === 0) return []

  // Option order is the order the product page shows its controls in, so the
  // sentence names them the way the shopper reads down the page.
  const optionIds = [...new Map(all.map((v) => [v.optionId, v])).values()]
    .sort((a, b) => a.optionPosition - b.optionPosition)
    .map((v) => v.optionId)

  const chosen = chosenChildId ? optionValuesByChild.get(chosenChildId) ?? [] : []
  const groups: AvailableWithGroup[] = []
  for (const optionId of optionIds) {
    const allHere = all.filter((v) => v.optionId === optionId)
    const offeringHere = offering.filter((v) => v.optionId === optionId)
    if (offeringHere.length === 0) continue
    const allLabels = labelsInOrder(allHere)
    const labels = labelsInOrder(offeringHere)
    // Every value of this option carries the service, so it is not what is
    // holding the service back and naming it would only mislead.
    if (labels.length >= allLabels.length) continue
    // The shopper's own pick already carries it: some OTHER option is the one in
    // the way, and this one stays as it is.
    const mine = chosen.find((v) => v.optionId === optionId)?.valueLabel
    if (mine && labels.includes(mine)) continue
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

// The whole line printed under a crossed-out service: "Available in 160 to
// 180cm", or "Available With Headrest" where the value says its own preposition.
// Where two options both have to move, only the FIRST plain phrase takes the
// "in" - "available in 160 to 180cm and Oak", not "…and in Oak" - since one
// preposition already governs the list.
//
// Falls back to a plain "Not available on this choice" when no option narrows it
// down, which is the honest answer: the service is not on offer here and there
// is no single change that would bring it back.
export function availableWithPhrase(groups: AvailableWithGroup[]): string {
  let inSpent = false
  const parts = groupPhrases(groups).map((phrase) => {
    if (carriesOwnPreposition(phrase)) return phrase
    if (inSpent) return phrase
    inSpent = true
    return `in ${phrase}`
  })
  return parts.length === 0 ? 'Not available on this choice' : `Available ${parts.join(' and ')}`
}
