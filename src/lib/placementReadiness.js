// src/lib/placementReadiness.js
//
// PLACEMENT-POOL-READINESS-1: who belongs in the Placement Board Student Pool.
//
// THE DEFECT THIS FIXES. The pool listed every unmatched student whose status
// was not already terminal - Pending Outreach, Form Sent, Form Received,
// Interview Scheduled and Interviewed all appeared - while createMatch() only
// accepts 'Interviewed' (or an already-'Placed' student). So most of the pool
// was clickable but bounced on an "Interview required" toast. The pool now
// defaults to the students the placement guard will actually accept, and the
// broader list stays one deliberate choice away.
//
// READY TO PLACE = unmatched AND canonical status 'Interviewed'. That is
// exactly the guard's condition, so a Ready-to-place student can always be
// placed. It is NOT inferred from a unit preference, an open slot, employment,
// or anything else.
//
// ALL ELIGIBLE = the previous pool contents, for the rare approved exception
// where staff place a student before the interview. Those students are labelled
// and require an explicit exception confirmation before they can be matched.
//
// 'Not Proceeding' is excluded from BOTH modes, along with the other terminal
// or already-placed statuses.
//
// NO unit-side "this unit requested this student" signal exists in ASPIRE, so
// nothing auto-qualifies for Ready to place. (unit_placement_requests points
// the other way - ASPIRE proposes, the unit only responds - and no code path
// ever inserts a row. See the handoff note.)

/** Statuses that never belong in the pool, in either mode. */
export const POOL_INELIGIBLE_STATUSES = Object.freeze([
  'Placed', 'Active Rotation', 'Completed', 'Declined', 'Not Proceeding',
])

/** The canonical status the placement guard requires. */
export const READY_STATUS = 'Interviewed'

export const READINESS_MODES = Object.freeze([
  { value: 'ready', label: 'Ready to place' },
  { value: 'all', label: 'All eligible students' },
])

export const DEFAULT_READINESS_MODE = 'ready'

const ineligible = new Set(POOL_INELIGIBLE_STATUSES)

/**
 * In the pool at all: unmatched, and not terminal/already-placed.
 * Deliberately a blacklist, matching the previous behavior, so a student with
 * an unexpected or missing status is still visible to staff rather than
 * silently disappearing.
 */
export function isPoolEligible(student) {
  if (!student) return false
  if (student.matched_unit_id) return false
  return !ineligible.has(student.status)
}

/** Ready to place: eligible AND interviewed - the placement guard's condition. */
export function isReadyToPlace(student) {
  return isPoolEligible(student) && student?.status === READY_STATUS
}

/**
 * True when placing this student would be an exception to the normal
 * interview-first rule. Only meaningful for a pool-eligible student.
 */
export function needsPlacementException(student) {
  return isPoolEligible(student) && student?.status !== READY_STATUS
}

/** Pool contents for a mode. Unknown modes fail safe to the ready default. */
export function filterPoolByReadiness(students, mode) {
  const list = (students || []).filter(isPoolEligible)
  return mode === 'all' ? list : list.filter(isReadyToPlace)
}

/** How many eligible-but-not-ready students the broader mode would reveal. */
export function exceptionCount(students) {
  return (students || []).filter(needsPlacementException).length
}
