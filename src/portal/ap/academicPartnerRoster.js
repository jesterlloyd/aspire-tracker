// Pure roster helpers for the Academic Partner Students workspace: cohort option derivation,
// cohort-scope predicates, and summary counts. No React and no data fetching, so they are
// unit-testable and shared between the component and its tests.
//
// "Current" is the canonical cohort status: cohorts.status === 'Active' (src/lib/constants.js
// COHORT_STATUSES). Historical students are never silently discarded: "All Cohorts" always
// includes them, and it is the default only when no cohort is currently Active.

import { ASPIRE_STATUSES } from '../../lib/constants.js'

export const AP_ALL_CURRENT = 'all-current'
export const AP_ALL = 'all'

// Newest first: start_date descending (missing dates sort last), then name ascending as a tiebreak.
export function compareCohortNewest(a, b) {
  const ad = a?.start_date || ''
  const bd = b?.start_date || ''
  if (ad !== bd) return ad < bd ? 1 : -1
  return String(a?.name || '').localeCompare(String(b?.name || ''))
}

// Split the CANONICAL, server-provided cohorts (school-scoped, independent of the roster; endpoint
// returns them newest-first) into the Active subset. This replaces the old roster-only inference that
// hid open-but-empty cohorts, so a Planning + Accepting cohort with zero students still appears.
export function splitCohorts(cohorts) {
  const list = Array.isArray(cohorts) ? cohorts : []
  return { cohorts: list, current: list.filter(c => c.status === 'Active') }
}

// The Students cohort picker: options in order, the default option id, and the set of current cohort
// ids. Consumes the canonical cohort list (school.cohorts from the endpoint), NOT the students.
//   - "All Current Cohorts" only when more than one cohort is currently Active
//   - each cohort, newest first
//   - "All Cohorts" (includes historical), always last
// Default: the newest Active cohort; if none is Active, "All Cohorts".
export function cohortOptions(cohorts) {
  const { cohorts: list, current } = splitCohorts(cohorts)
  const options = []
  if (current.length > 1) options.push({ id: AP_ALL_CURRENT, label: 'All Current Cohorts' })
  for (const c of list) options.push({ id: c.id, label: c.name || 'Cohort' })
  options.push({ id: AP_ALL, label: 'All Cohorts' })
  const defaultId = current.length > 0 ? current[0].id : AP_ALL
  return { options, defaultId, currentIds: new Set(current.map(c => c.id)) }
}

// The Placement Requests SUBMISSION cohort picker: only cohorts currently accepting_submissions are
// valid targets (no "All" pseudo-option). The default is the nearest upcoming accepting cohort, i.e.
// the newest accepting cohort (endpoint order is newest-first), so when the active cohort is closed
// and a later cohort is accepting, the later one is selected.
export function submissionCohortOptions(cohorts) {
  const accepting = (Array.isArray(cohorts) ? cohorts : []).filter(c => c.accepting_submissions)
  const options = accepting.map(c => ({ id: c.id, label: c.name || 'Cohort' }))
  return { options, accepting, defaultId: accepting[0]?.id || null }
}

// Whether a student falls in the selected cohort scope.
export function inCohortScope(student, optionId, currentIds) {
  if (optionId === AP_ALL) return true
  if (optionId === AP_ALL_CURRENT) return currentIds.has(student?.cohort?.id)
  return student?.cohort?.id === optionId
}

// Summary counts within a cohort-scoped set. Definitions map to REAL students.status values only
// The pathway KPI counts + filtering come from the canonical shared grouping
// (src/lib/derivations/cohortStatus.computeStatusCounts), consumed directly by the workspace; the
// former AP-only summaryCounts/applyFilter (a parallel 3-bucket grouping) were removed so the AP band
// cannot drift from the main-app Student Profiles band.

// ── Sorting (client-side, from the already-scoped rows) ───────────────────────
// Reuses the canonical pathway order (ASPIRE_STATUSES) for status, so status sorting follows the
// ASPIRE pathway, not the alphabet. No second status-rank map is invented.
const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true })
export const displayNameOf = (s) =>
  `${s?.preferred_first_name || s?.first_name || ''} ${s?.last_name || ''}`.trim()
// Canonical rank; an unknown status sorts safely at the end. Terminal statuses (Declined,
// Not Proceeding) keep their canonical order because they are the last entries of ASPIRE_STATUSES.
export const statusRank = (status) => {
  const i = ASPIRE_STATUSES.indexOf(status)
  return i === -1 ? ASPIRE_STATUSES.length : i
}
const approvedOf = (s) => { const n = Number(s?.hours?.approved); return Number.isFinite(n) ? n : 0 }
const requiredOf = (s) => { const n = Number(s?.hours?.required); return Number.isFinite(n) ? n : 0 }

// Compare two students by a sortable column. Ties break by name for a stable, predictable order.
function compareByColumn(column, a, b) {
  if (column === 'student') return collator.compare(displayNameOf(a), displayNameOf(b))
  if (column === 'status') {
    const d = statusRank(a.status) - statusRank(b.status)
    return d !== 0 ? d : collator.compare(displayNameOf(a), displayNameOf(b))
  }
  if (column === 'hours') {
    // Approved hours numerically; required as a stable secondary; pending is never treated as approved.
    const d = approvedOf(a) - approvedOf(b)
    if (d !== 0) return d
    const r = requiredOf(a) - requiredOf(b)
    return r !== 0 ? r : collator.compare(displayNameOf(a), displayNameOf(b))
  }
  return 0
}

export const SORTABLE_COLUMNS = new Set(['student', 'status', 'hours'])

// Return a sorted copy (never mutates). column null => original order preserved. Array.sort is
// stable in modern engines, so equal rows keep their incoming order.
export function sortRoster(students, column, direction) {
  if (!SORTABLE_COLUMNS.has(column)) return students
  const sign = direction === 'desc' ? -1 : 1
  return [...students].sort((a, b) => sign * compareByColumn(column, a, b))
}
