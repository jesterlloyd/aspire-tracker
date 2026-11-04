// api/lib/shiftLogPick.js
//
// Pure rules for choosing the student a shift belongs to, shared by the shift-log lookup
// (lookup, check-in, check-out) and submit-past-shift. No database client here, so the
// past-shift handler can import it without loading the lookup's admin client.

// Statuses eligible to access/log shifts. 'Placed' covers the first shift (which
// then promotes to 'Active Rotation'); 'Active Rotation' covers all subsequent
// shifts. Every other status (Completed, Not Proceeding, etc.) is ineligible.
export const SHIFT_LOG_ELIGIBLE_STATUSES = ['Placed', 'Active Rotation']

// SHIFT-LOG-RETURNING-1 (2026-11-03): a student who re-joins a later cohort has a second
// record under the same school email (Juliana Pilla: Fall 2026 Not Proceeding, Winter 2027
// Placed), and "duplicates are an error" locked her out of shift logging entirely. Several
// matches are now narrowed to the records that CAN log a shift (cohort not Archived, status
// Placed or Active Rotation). Exactly one left is the student; none or several left is still
// ambiguous. A record that cannot log a shift can never be the one a shift belongs to, so
// this never picks "the most recent" and never attaches a shift to the wrong person.
// submit-past-shift resolves by email on its own and calls this too, so both paths agree.
export function canLogShifts(student) {
  const cohortStatus = student?.cohorts?.status || student?.cohort?.status || ''
  return cohortStatus !== 'Archived' && SHIFT_LOG_ELIGIBLE_STATUSES.includes(student?.status)
}

// matches: the records whose normalized school email equals the one asked for.
// Returns the one record to use, or { ambiguous: true }, or null for no match.
export function pickShiftLogStudent(matches) {
  const list = Array.isArray(matches) ? matches : []
  if (list.length === 0) return null
  if (list.length === 1) return list[0]
  const loggable = list.filter(canLogShifts)
  return loggable.length === 1 ? loggable[0] : { ambiguous: true }
}
