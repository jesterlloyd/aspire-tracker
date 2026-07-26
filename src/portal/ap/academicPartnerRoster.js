// Pure roster helpers for the Academic Partner Students workspace: cohort option derivation,
// cohort-scope predicates, and summary counts. No React and no data fetching, so they are
// unit-testable and shared between the component and its tests.
//
// "Current" is the canonical cohort status: cohorts.status === 'Active' (src/lib/constants.js
// COHORT_STATUSES). Historical students are never silently discarded: "All Cohorts" always
// includes them, and it is the default only when no cohort is currently Active.

export const AP_ALL_CURRENT = 'all-current'
export const AP_ALL = 'all'

// Newest first: start_date descending (missing dates sort last), then name ascending as a tiebreak.
export function compareCohortNewest(a, b) {
  const ad = a?.start_date || ''
  const bd = b?.start_date || ''
  if (ad !== bd) return ad < bd ? 1 : -1
  return String(a?.name || '').localeCompare(String(b?.name || ''))
}

// The unique cohorts present among a school's students, newest first, plus the Active subset.
export function deriveCohorts(students) {
  const byId = new Map()
  for (const s of students || []) {
    const c = s?.cohort
    if (c?.id && !byId.has(c.id)) byId.set(c.id, c)
  }
  const cohorts = [...byId.values()].sort(compareCohortNewest)
  const current = cohorts.filter(c => c.status === 'Active')
  return { cohorts, current }
}

// The cohort picker options in order, the default option id, and the set of current cohort ids.
//   - "All Current Cohorts" only when more than one cohort is currently Active
//   - each cohort, newest first
//   - "All Cohorts" (includes historical), always last
// Default: the newest Active cohort; if none is Active, "All Cohorts".
export function cohortOptions(students) {
  const { cohorts, current } = deriveCohorts(students)
  const options = []
  if (current.length > 1) options.push({ id: AP_ALL_CURRENT, label: 'All Current Cohorts' })
  for (const c of cohorts) options.push({ id: c.id, label: c.name || 'Cohort' })
  options.push({ id: AP_ALL, label: 'All Cohorts' })
  const defaultId = current.length > 0 ? current[0].id : AP_ALL
  return { options, defaultId, currentIds: new Set(current.map(c => c.id)) }
}

// Whether a student falls in the selected cohort scope.
export function inCohortScope(student, optionId, currentIds) {
  if (optionId === AP_ALL) return true
  if (optionId === AP_ALL_CURRENT) return currentIds.has(student?.cohort?.id)
  return student?.cohort?.id === optionId
}

// Summary counts within a cohort-scoped set. Definitions map to REAL students.status values only
// (Currently Rotating = 'Active Rotation', Completed = 'Completed'); nothing is inferred.
export function summaryCounts(scopedStudents) {
  let rotating = 0
  let completed = 0
  for (const s of scopedStudents) {
    if (s.status === 'Active Rotation') rotating += 1
    else if (s.status === 'Completed') completed += 1
  }
  return { all: scopedStudents.length, rotating, completed }
}

// Apply the active summary filter, client-side (no new request when the rows are already loaded).
export function applyFilter(scopedStudents, filter) {
  if (filter === 'rotating') return scopedStudents.filter(s => s.status === 'Active Rotation')
  if (filter === 'completed') return scopedStudents.filter(s => s.status === 'Completed')
  return scopedStudents
}
