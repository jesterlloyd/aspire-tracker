// api/lib/shiftUnitAssignments.js
//
// MULTI-UNIT-STUDENT-PLACEMENTS-2: does a shift's unit correspond to a unit
// ASPIRE actually assigned the student, ON THAT DATE?
//
// The rules, exactly as decided:
//   • An assignment applies to a shift when the unit NAMES match canonically
//     ('6NE' in a historical log is the canonical '6 NE') AND the SHIFT DATE
//     falls inside the assignment's dated period. A NULL boundary is open:
//     backfilled rows carry no dates and must keep validating exactly as the
//     single matched unit does today.
//   • ENDED assignments still validate shifts INSIDE their window - Emi's
//     6 NE assignment (Jul 8 - Aug 6, 2026) validates her 6 NE shifts from
//     that window even though the assignment is over. Status is liveness for
//     rosters, not a time machine for history.
//   • 'removed' rows validate nothing: removal means the record was wrong.
//   • Nothing here creates, infers, or repairs an assignment. Read-only logic.

import { sameUnitName } from '../../src/lib/unitNameCanon.js';

/** Assignment statuses that can validate a shift (by date). */
export const SHIFT_VALIDATING_STATUSES = Object.freeze(['planned', 'active', 'ended']);

/** 'YYYY-MM-DD' comparison-safe parse; returns null for unusable input. */
function ymd(value) {
  const s = String(value || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

/**
 * Does this one assignment apply to a shift on `shiftDate` in `unitName`?
 * Pure; ISO date strings compare lexicographically.
 */
export function assignmentAppliesToShift(assignment, { shiftDate, unitName }) {
  if (!assignment) return false;
  if (!SHIFT_VALIDATING_STATUSES.includes(assignment.status)) return false;
  if (!sameUnitName(assignment.unit_key, unitName)) return false;

  const day = ymd(shiftDate);
  // An unparseable shift date cannot be validated against a window; only an
  // undated (open) assignment may vouch for it.
  const start = ymd(assignment.start_date);
  const end = ymd(assignment.end_date);
  if (day === null) return start === null && end === null;
  if (start !== null && day < start) return false;
  if (end !== null && day > end) return false;
  return true;
}

/** Does ANY of the student's assignments validate this shift? */
export function shiftMatchesAssignments(assignments, { shiftDate, unitName }) {
  return (assignments || []).some((a) => assignmentAppliesToShift(a, { shiftDate, unitName }));
}

/**
 * Load the student's assignment rows for shift validation. Read-only, every
 * status included (the matcher filters), tolerant of the table being empty.
 */
export async function loadShiftAssignments(db, studentId) {
  const { data, error } = await db
    .from('student_unit_assignments')
    .select('unit_key, status, start_date, end_date')
    .eq('student_id', studentId);
  if (error) {
    // Fail toward the PRE-EXISTING behavior (single matched-unit compare),
    // never toward blocking a shift: the caller falls back when null.
    console.error('[shiftUnitAssignments] load failed:', error.message);
    return null;
  }
  return data || [];
}
