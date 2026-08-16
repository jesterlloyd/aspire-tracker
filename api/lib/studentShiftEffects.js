// api/lib/studentShiftEffects.js
//
// STUDENT-SHIFT-LOG-MANAGEMENT-1: the downstream half of a student's own
// correction, in both directions.
//
// UPWARD (an edit turns a Pending Review shift into an Auto-Accepted one):
// exactly the same semantics submission and staff approval already apply -
// rotation_start on the first accepted shift, the Placed -> Active Rotation
// promotion, and rotation_end once approved hours reach the requirement. That
// logic is NOT re-implemented here; applyApprovalDownstream is reused verbatim
// so the three paths cannot drift.
//
// DOWNWARD (an edit or withdrawal drops approved hours back below the
// requirement AFTER rotation_end was already recorded): the recorded events
// are latches that nothing in the system reverses, and deleting one would
// destroy history. Instead a NEW, append-only program_events row states the
// correction, so a reader of the timeline sees "the requirement was met" and
// then "hours were later corrected to X of Y" rather than a threshold claim
// that silently contradicts the current totals. Nothing is rewritten or
// removed.

import { toLocalDateStr } from '../../shared/dateUtils.js'
import { applyApprovalDownstream } from './shiftReviewEffects.js'

export const HOURS_CORRECTION_EVENT = 'rotation_hours_correction'

/**
 * Upward parity. Runs ONLY when an edit newly makes the shift accepted, so a
 * no-op edit (already Auto-Accepted) cannot re-fire anything.
 */
export async function applyEditAcceptanceDownstream(db, student, shift, result) {
  if (result?.status !== 'Auto-Accepted') return
  if (result?.previous_status === 'Auto-Accepted') return
  await applyApprovalDownstream(db, student, shift, { approved_hours: result.approved_hours })
}

/**
 * Downward correction. Appends one event when approved hours are now BELOW the
 * requirement while a rotation_end latch already exists. Idempotent against
 * repeat calls: it does not append when the newest correction already records
 * the same approved/required pair.
 */
export async function recordHoursThresholdCorrection(db, student, totals) {
  try {
    const required = parseFloat(student?.hours_required || 0)
    const approved = parseFloat(totals?.approved_hours ?? NaN)
    if (!(required > 0) || !Number.isFinite(approved)) return
    if (approved >= required) return

    // Only meaningful if the system previously announced the threshold was met.
    const { data: latch, error: latchErr } = await db
      .from('program_events').select('id')
      .eq('student_id', student.id).eq('cohort_id', student.cohort_id)
      .eq('event_type', 'rotation_end').limit(1).maybeSingle()
    if (latchErr || !latch) return

    const notes = `[Auto-logged] Hours corrected after review of the student's own entries: ${approved}/${required} hrs (previously recorded as meeting the requirement).`

    const { data: prior } = await db
      .from('program_events').select('id, notes')
      .eq('student_id', student.id).eq('cohort_id', student.cohort_id)
      .eq('event_type', HOURS_CORRECTION_EVENT)
      .order('created_at', { ascending: false }).limit(1).maybeSingle()
    if (prior?.notes === notes) return // already recorded at these exact numbers

    await db.from('program_events').insert({
      student_id: student.id,
      cohort_id: student.cohort_id,
      event_type: HOURS_CORRECTION_EVENT,
      event_date: toLocalDateStr(),
      notes,
      created_by: 'Student Portal',
    })
  } catch { /* best-effort; the shift row and totals are authoritative */ }
}
