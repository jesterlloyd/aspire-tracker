// ROTATION-SORT-2: how Active Rotation Progress orders its cards.
//
// WHAT WAS WRONG WITH THE OLD MENU
//   Needs attention        - default. Ranked by missing preceptor / no recent
//                            log. The Action Center now owns intervention
//                            prioritization, so a second, quietly different
//                            attention ranking here only invited disagreement.
//   Closest to completion  - already percentage-based, just named vaguely.
//   Least hours completed  - sorted by RAW approved hours, so 84/108 (77.8%)
//                            ranked as "less complete" than 96/96 (100%) only
//                            when the raw numbers happened to agree. It was
//                            not the inverse of its own sibling sort.
//
// Every completion sort now runs on the SAME percentage the card displays,
// from the same canonical helper behind the green Complete badge
// (lib/clinicalHours.js). Raw approved hours play NO part in ranking at all,
// not even as a tie-breaker: 96/96 and 132/132 are both finished, and 72/96
// and 99/132 are both three-quarters of the way through their own
// requirement. Ranking one above the other on raw total would re-introduce
// exactly the bias this sort exists to remove - a student on a longer
// rotation is not "more complete" than one on a shorter one. Equal
// percentage means equal progress, and name breaks the tie.
//
// A note on unknown requirements: hoursProgress reports pct 0 / complete false
// when hours_required is 0, null, or unparseable. That is deliberately the
// only interpretation - these sorts do not invent a second one - so such a
// student sorts alongside genuine 0% and is never treated as complete.

/** Menu order is display order; the first entry is the default. */
export const ROTATION_SORT_OPTIONS = Object.freeze([
  { key: 'completed_first', label: 'Completed first' },
  { key: 'most_complete',   label: 'Most complete' },
  { key: 'least_complete',  label: 'Least complete' },
  { key: 'name',            label: 'Name A–Z' },
  { key: 'school',          label: 'School A–Z' },
  { key: 'on_campus_first', label: 'On campus first' },
])

export const DEFAULT_ROTATION_SORT = ROTATION_SORT_OPTIONS[0].key

/**
 * Build the comparator set for the Active Rotation Progress list.
 *
 * Cards are the objects RotationActivity already builds, carrying the values
 * this module needs and never recomputing them:
 *   pct       - completion percentage from hoursProgress (capped at 100)
 *   complete  - the canonical Complete condition, same as the badge
 *   onCampus  - the canonical On Campus Now membership (open shift logs)
 *   school
 * Note that approved hours are deliberately absent: no comparator reads them.
 *
 * @param {(card:object) => string} nameOf - preferred full name accessor
 */
export function buildRotationComparators(nameOf) {
  const byName = (a, b) => nameOf(a).localeCompare(nameOf(b))
  // Percentage is the ONLY progress signal; name makes each comparator total,
  // so the order is stable no matter what order the rows arrived in.
  const byPctDesc = (a, b) => (b.pct - a.pct) || byName(a, b)
  const byPctAsc  = (a, b) => (a.pct - b.pct) || byName(a, b)

  return {
    // Finished students first, alphabetically within that group so the roll of
    // completions reads predictably. Everyone still working follows, ordered
    // by how close they are, so the list stays useful below the fold.
    completed_first: (a, b) => {
      if (a.complete !== b.complete) return a.complete ? -1 : 1
      return a.complete ? byName(a, b) : byPctDesc(a, b)
    },
    most_complete:  byPctDesc,
    least_complete: byPctAsc,
    name:           byName,
    school:         (a, b) => (a.school || '').localeCompare(b.school || '') || byName(a, b),
    // On Campus Now membership, then alphabetical within each group.
    on_campus_first: (a, b) => {
      if (!a.onCampus !== !b.onCampus) return a.onCampus ? -1 : 1
      return byName(a, b)
    },
  }
}

/** The comparator for a mode, falling back to the default for unknown keys. */
export function rotationComparator(mode, nameOf) {
  const set = buildRotationComparators(nameOf)
  return set[mode] || set[DEFAULT_ROTATION_SORT]
}

/**
 * Explain a truthful no-op. Some cohorts, especially at term end, have every
 * active-rotation student at the same completion percentage and nobody on
 * campus. In that state several valid sort modes resolve to the same A-Z
 * tie-break order. Without feedback the control looks broken even though the
 * selected comparator ran.
 */
export function rotationSortFeedback(mode, cards) {
  if (!Array.isArray(cards) || cards.length < 2) return ''

  if (mode === 'completed_first') {
    const completionStates = new Set(cards.map(card => !!card.complete))
    if (completionStates.size === 1) {
      const label = cards[0]?.complete ? 'completed' : 'still in progress'
      return `All students shown are ${label}; ties are listed by name.`
    }
  }

  if (mode === 'most_complete' || mode === 'least_complete') {
    const percentages = new Set(cards.map(card => card.pct))
    if (percentages.size === 1) {
      const pct = Math.round(Number(cards[0]?.pct) || 0)
      return `All students shown are at ${pct}%; ties are listed by name.`
    }
  }

  if (mode === 'on_campus_first') {
    const campusStates = new Set(cards.map(card => !!card.onCampus))
    if (campusStates.size === 1) {
      return cards[0]?.onCampus
        ? 'All students shown are on campus; ties are listed by name.'
        : 'No students shown are on campus; ties are listed by name.'
    }
  }

  return ''
}
