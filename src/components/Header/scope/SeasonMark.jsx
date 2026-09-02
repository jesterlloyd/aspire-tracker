// COHORT-ORDER-1: the season mark beside a cohort name, shared by both panes.
//
// It was defined inside InternshipCohortList because only ASPIRE cohorts were
// named by season. Residency cohorts are named by season now, and a second copy
// of a five-line component is how two lists start drifting apart, so it moved
// here rather than being pasted.
//
// MONOCHROME, DELIBERATELY. The row already carries a status pill (blue planned /
// green active / gray done) and, on the ASPIRE side, the Accepting badge, and
// those two carry real state. A colored season icon would compete with them for
// attention while saying nothing the cohort's own name does not already say. It
// is reinforcement for scanning, so it gets the weight of punctuation.
//
// The slot is FIXED WIDTH and renders empty for a name that states no single
// season, so a list mixing "Fall 2026" with a differently-named cohort keeps one
// left edge instead of ragging.
import { Sun, Leaf, Snowflake, Flower2 } from 'lucide-react'
import { seasonOf } from '../../../lib/cohortSeason'

const SEASON_ICONS = { summer: Sun, fall: Leaf, winter: Snowflake, spring: Flower2 }

export default function SeasonMark({ name }) {
  const season = seasonOf(name)
  const Icon = season ? SEASON_ICONS[season] : null
  return (
    // aria-hidden: the season is spoken as part of the cohort's own name, so
    // announcing it twice would be noise.
    <span aria-hidden="true" style={{ display: 'inline-flex', width: 15, flexShrink: 0, justifyContent: 'center', color: '#9ca3af' }}>
      {Icon ? <Icon size={13} strokeWidth={2} /> : null}
    </span>
  )
}
