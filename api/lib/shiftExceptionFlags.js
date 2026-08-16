// api/lib/shiftExceptionFlags.js
//
// STUDENT-SHIFT-LOG-MANAGEMENT-1: the canonical server-side exception
// classification, extracted VERBATIM from api/shift-log/submit-past-shift.js
// so a student EDIT re-classifies by exactly the same rules a submission does.
// Flag order is load-bearing: it becomes review_reason via join('; ').
//
// ONE deliberate addition: `excludeShiftId`. The daily_hours_exceed_24 sum is
// correct for an INSERT (the row does not exist yet) but would double-count
// the row being edited, so an edit passes its own id and the sum skips it.
// Every other rule is unchanged, character for character.

import { isOutsideRotationWindow } from '../../src/lib/rotationWindow.js'
import { shiftMatchesAssignments, loadShiftAssignments } from './shiftUnitAssignments.js'

/**
 * @param db    service-role client
 * @param ctx   { totalHours, preceptorName, unitName, isAssignedUnit, shiftDate,
 *                student, excludeShiftId? }
 * @returns string[] flags, in canonical order
 */
export async function buildExceptionFlags(db, ctx) {
  const { totalHours, preceptorName, unitName, isAssignedUnit, shiftDate, student, excludeShiftId } = ctx
  const flags = []
  if (totalHours > 13) flags.push('hours_over_13')
  if (totalHours < 2) flags.push('hours_under_2')

  // Canonical coordinator-owned rotation window, never legacy term_dates.
  if (isOutsideRotationWindow(shiftDate, student?.rotation)) flags.push('outside_rotation_dates')

  // Same-day already-credited hours (completed Auto-Accepted/Approved) + this
  // shift. On an edit, the shift being edited is excluded so its own previous
  // hours cannot be counted against its new value.
  let sameDayQuery = db
    .from('student_shift_logs')
    .select('total_hours')
    .eq('student_id', student.id)
    .eq('shift_date', shiftDate)
    .eq('lifecycle_state', 'completed')
    .in('status', ['Auto-Accepted', 'Approved'])
  if (excludeShiftId) sameDayQuery = sameDayQuery.neq('id', excludeShiftId)
  const { data: sameDay } = await sameDayQuery
  const dailySum = (sameDay || []).reduce((s, r) => s + (parseFloat(r.total_hours) || 0), 0) + totalHours
  if (dailySum > 24) flags.push('daily_hours_exceed_24')

  if (!String(preceptorName || '').trim()) flags.push('missing_preceptor')
  if (!['Placed', 'Active Rotation'].includes(student?.status)) flags.push('pre_placement_log')

  // unit_and_preceptor_mismatch: unrecognized unit AND different preceptor.
  // "Recognized" means ANY assignment whose dated window covers THIS shift's
  // date, canonically named ('6NE' is '6 NE') - so changing a shift's DATE can
  // legitimately change this answer even with an identical unit name.
  if (!isAssignedUnit) {
    const assignments = await loadShiftAssignments(db, student.id)
    let unitRecognized
    if (Array.isArray(assignments) && assignments.length > 0) {
      unitRecognized = shiftMatchesAssignments(assignments, { shiftDate, unitName })
    } else {
      let assignedUnitName = ''
      if (student.matched_unit_id) {
        const { data: unit } = await db.from('units').select('unit_name').eq('id', student.matched_unit_id).maybeSingle()
        assignedUnitName = unit?.unit_name || ''
      }
      unitRecognized = String(unitName || '').trim() === String(assignedUnitName || '').trim()
    }
    const preceptorDiffers = String(preceptorName || '').trim() !== String(student.matched_preceptor || '').trim()
    if (!unitRecognized && preceptorDiffers) flags.push('unit_and_preceptor_mismatch')
  }
  return flags
}

/** The canonical status that follows from a flag set. */
export function statusFromFlags(flags) {
  return (flags || []).length > 0 ? 'Pending Review' : 'Auto-Accepted'
}

/** The canonical review_reason that follows from a flag set. */
export function reviewReasonFromFlags(flags) {
  return (flags || []).length > 0 ? flags.join('; ') : null
}
