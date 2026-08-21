// api/lib/shiftReviewEffects.js
//
// SHIFT-LOG-REVIEW-1: downstream effects of an APPROVED review decision,
// mirroring exactly what api/shift-log/submit-past-shift.js does when a shift
// lands as Auto-Accepted - and nothing more. The canonical semantics being
// preserved (audited against submit-past-shift.js:320-345 and the completion
// doctrine in docs/product/UNIT_LEADER_STATUS_LEGEND_AND_COMPLETION_READINESS.md):
//
//   1. rotation_start   - program event, once per (student, cohort, type),
//                         when the newly counted shift is the student's FIRST
//                         accepted shift.
//   2. Placed -> Active Rotation - status promotion, only on that first shift
//                         and only from exactly 'Placed', with its own deduped
//                         status_change_active_rotation event.
//   3. rotation_end     - program event, once, when approved_hours crosses
//                         hours_required (required > 0). Exceeding the
//                         requirement is expected and never blocks anything.
//
//   This approval effect does NOT itself set status 'Completed'. The canonical
//   database reconciliation owns that transition after both the official end
//   date and approved-hours requirement are satisfied.
//
// All effects are best-effort (like the originals): the review decision itself
// was already committed atomically by the review_shift_log RPC; a failed event
// insert must never surface as a failed review. created_by is 'Shift Review'
// so provenance is honest, while event_type-level dedupe keeps the events
// canonical (a rotation_start logged by 'Shift Log' suppresses ours and vice
// versa - logEventOnce keys on student + cohort + type only).

import { toLocalDateStr } from '../../shared/dateUtils.js'

/** Insert a program_events row once (deduped by student + cohort + type). */
async function logEventOnce(db, studentId, cohortId, eventType, notes) {
  try {
    const { data: existing } = await db
      .from('program_events').select('id')
      .eq('student_id', studentId).eq('cohort_id', cohortId).eq('event_type', eventType)
      .limit(1).maybeSingle()
    if (existing) return
    await db.from('program_events').insert({
      student_id: studentId, cohort_id: cohortId, event_type: eventType,
      event_date: toLocalDateStr(), notes, created_by: 'Shift Review',
    })
  } catch { /* best-effort; the review row is authoritative */ }
}

/**
 * Apply the Auto-Accepted downstream semantics after a review APPROVAL
 * (decision 'approved' or 'adjusted'). Rejections have no downstream effects.
 *
 * @param db       service-role client
 * @param student  { id, cohort_id, status, hours_required } - read BEFORE the
 *                 decision (status promotion checks the pre-decision value,
 *                 same as the submit-past-shift path)
 * @param shift    { unit_name } - the decided shift
 * @param totals   { approved_hours } - authoritative totals returned by the RPC
 */
export async function applyApprovalDownstream(db, student, shift, totals) {
  try {
    // First-accepted-shift detection AFTER the decision: the approved shift is
    // already in the bucket, so exactly 1 accepted shift means this approval
    // created the first one (submit-past-shift counts the same way, post-insert).
    const { data: acceptedShifts } = await db
      .from('student_shift_logs').select('id')
      .eq('student_id', student.id).eq('lifecycle_state', 'completed')
      .in('status', ['Auto-Accepted', 'Approved']).limit(2)
    const isFirstShift = Array.isArray(acceptedShifts) && acceptedShifts.length === 1

    if (isFirstShift) {
      await logEventOnce(db, student.id, student.cohort_id, 'rotation_start',
        `[Auto-logged] First shift logged: ${shift.unit_name || ''}`)
      if (student.status === 'Placed') {
        await db.from('students').update({ status: 'Active Rotation' }).eq('id', student.id)
        await logEventOnce(db, student.id, student.cohort_id, 'status_change_active_rotation',
          'Status automatically promoted from Placed to Active Rotation on first approved shift.')
      }
    }

    // rotation_end when required hours met. Required hours are a completion
    // threshold, not a maximum - overflow simply still satisfies >=.
    const hoursReq = parseFloat(student.hours_required || 0)
    const approved = parseFloat(totals?.approved_hours || 0)
    if (hoursReq > 0 && approved >= hoursReq) {
      await logEventOnce(db, student.id, student.cohort_id, 'rotation_end',
        `[Auto-logged] Required hours met: ${approved}/${hoursReq} hrs`)
    }
  } catch { /* best-effort by design */ }
}
