// Pure helpers for the Unit Leader cohort picker (Home + Students only). The Unit Leader roster mixes
// cohorts, so a browser cohort choice narrows the already server-authorized set; it never widens it.
// Cohorts are derived from the authorized roster students (each carries s.cohort = { id, name, status,
// start_date, end_date }), ordered by the canonical timeline helper (src/lib/derivations/cohortOrder)
// so the dropdown reads as one start-date timeline, matching the Academic Partner and main-app cohort
// presentation. No React and no data fetching here, so this is unit-testable in isolation.

import { orderCohortsByTimeline, cohortLifecycle, newestByStart } from '../../lib/derivations/cohortOrder.js'

export const UL_ALL = 'all'
export const UL_ALL_CURRENT = 'all-current'

// The distinct cohorts present in the authorized roster, with full metadata, in canonical timeline
// order. Keyed by id, first occurrence wins (rows for the same cohort carry identical cohort objects).
export function rosterCohorts(students) {
  const byId = new Map()
  for (const s of Array.isArray(students) ? students : []) {
    const c = s?.cohort
    if (c?.id && !byId.has(c.id)) byId.set(c.id, c)
  }
  return orderCohortsByTimeline([...byId.values()])
}

// The Unit Leader cohort picker: options (timeline-ordered), the default option id, the current-cohort
// id set, and the count of REAL cohorts present so the caller can hide the control when there is
// nothing to choose between (a single-cohort unit gets no cosmetic picker).
//   - "All Current Cohorts" only when more than one cohort is currently Active
//   - each cohort in canonical start-date order
//   - "All Cohorts" (the whole authorized 90-day window), always last
// Default: the newest Active cohort; if none is Active, "All Cohorts".
export function unitCohortOptions(students) {
  const cohorts = rosterCohorts(students)
  const current = cohorts.filter(c => cohortLifecycle(c) === 'current')
  const options = []
  if (current.length > 1) options.push({ id: UL_ALL_CURRENT, label: 'All Current Cohorts' })
  for (const c of cohorts) options.push({ id: c.id, label: c.name || 'Cohort' })
  options.push({ id: UL_ALL, label: 'All Cohorts' })
  const defaultId = current.length > 0 ? newestByStart(current).id : UL_ALL
  return { options, defaultId, currentIds: new Set(current.map(c => c.id)), cohortCount: cohorts.length }
}

// Whether a student falls in the selected cohort scope. Mirrors the Academic Partner predicate.
export function studentInCohort(student, optionId, currentIds) {
  if (optionId === UL_ALL) return true
  if (optionId === UL_ALL_CURRENT) return currentIds.has(student?.cohort?.id)
  return student?.cohort?.id === optionId
}
