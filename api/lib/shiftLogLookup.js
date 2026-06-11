// api/lib/shiftLogLookup.js
//
// Shared server-side helper for Shift Log student lookup + open-shift resolution.
// Used by /api/shift-log/lookup-student (Phase S.2.B1); will be reused by
// check-in (B2), check-out (B3), and past-shift (B4).
//
// Contract (Owner-corrected, B1):
//   - Identity = registered school_email, matched EXACT + case-insensitively
//     (trimmed; NO % / _ wildcard broadening; duplicates are an error, never
//     silently resolved to "most recent").
//   - eligible:true means the student may use the check-in/check-out/past-shift
//     workflow: a match exists, cohort is NOT 'Archived', AND status is either
//     'Placed' (logging their first shift) or 'Active Rotation' (continuing). A
//     student's first successfully-logged shift promotes Placed → Active Rotation
//     (handled at submit-past-shift / check-out, not here).
//   - Ineligible students return only minimal safe fields and NO open-shift query.
//
// Read-only. No writes. No PII returned beyond the student's own safe fields.

import supabaseAdmin from '../../lib/server/evaluation/supabase_admin.js'
import { normalizeEmailForLookup, escapeLikePattern } from '../../src/lib/emailUtils.js'

// Statuses eligible to access/log shifts. 'Placed' covers the first shift (which
// then promotes to 'Active Rotation'); 'Active Rotation' covers all subsequent
// shifts. Every other status (Completed, Not Proceeding, etc.) is ineligible.
const SHIFT_LOG_ELIGIBLE_STATUSES = ['Placed', 'Active Rotation']

/**
 * Look up a student by school email, evaluate eligibility, and (only when
 * eligible) fetch any open in_progress shift.
 *
 * Return shapes:
 *   { found:false }
 *   { found:false, error:'invalid_email' }
 *   { found:false, error:'ambiguous_student_email' }
 *   { found:true, eligible:false, ineligible_reason:'cohort_archived'|'not_active_rotation', student:{id,full_name,school_email} }
 *   { found:true, eligible:true, student:{...safe...}, open_shift:{...}|null }
 */
export async function lookupStudentByEmail(schoolEmail) {
  // Forgiving normalization: case-insensitive, trimmed, zero-width-tolerant.
  const norm = normalizeEmailForLookup(schoolEmail)
  if (!norm) return { found: false, error: 'invalid_email' }

  // Case-insensitive EXACT match (wildcards escaped). Fetch a few to detect
  // duplicate-email anomalies; JS re-checks normalized equality as a safety net.
  const { data: candidates, error: studentError } = await supabaseAdmin
    .from('students')
    .select(`
      id,
      first_name,
      last_name,
      school,
      school_email,
      status,
      cohort_id,
      matched_unit_id,
      matched_preceptor,
      hours_required,
      approved_hours,
      pending_hours,
      cohorts:cohort_id ( id, name, status )
    `)
    .ilike('school_email', escapeLikePattern(norm))
    .limit(5)

  if (studentError) {
    throw new Error(`Student lookup failed: ${studentError.message}`)
  }

  const matches = (candidates || []).filter(
    s => normalizeEmailForLookup(s.school_email) === norm
  )

  if (matches.length === 0) return { found: false }
  if (matches.length > 1) {
    // Duplicate registered emails are a data anomaly. Never resolve to one.
    // Caller logs the anomaly WITHOUT the plain email.
    return { found: false, error: 'ambiguous_student_email' }
  }

  const student = matches[0]
  const fullName = `${student.first_name || ''} ${student.last_name || ''}`.trim()
  const cohort = student.cohorts || null

  // ── Eligibility: cohort not archived AND status Placed OR Active Rotation ───
  if (cohort?.status === 'Archived') {
    return {
      found: true,
      eligible: false,
      ineligible_reason: 'cohort_archived',
      student: { id: student.id, full_name: fullName, school_email: student.school_email },
    }
  }
  if (!SHIFT_LOG_ELIGIBLE_STATUSES.includes(student.status)) {
    return {
      found: true,
      eligible: false,
      ineligible_reason: 'not_active_rotation',
      student: { id: student.id, full_name: fullName, school_email: student.school_email },
    }
  }

  // ── Eligible: resolve assigned unit name, then any open shift ───────────────
  let assignedUnitName = null
  if (student.matched_unit_id) {
    const { data: unit } = await supabaseAdmin
      .from('units')
      .select('unit_name')
      .eq('id', student.matched_unit_id)
      .maybeSingle()
    assignedUnitName = unit?.unit_name || null
  }

  const { data: openShifts, error: shiftError } = await supabaseAdmin
    .from('student_shift_logs')
    .select('id, shift_date, checked_in_at, expected_hours, planned_unit_name, planned_preceptor_name, planned_shift_type')
    .eq('student_id', student.id)
    .eq('lifecycle_state', 'in_progress')
    .limit(1)

  if (shiftError) {
    throw new Error(`Open shift lookup failed: ${shiftError.message}`)
  }

  const openShift = openShifts && openShifts.length > 0 ? openShifts[0] : null

  return {
    found: true,
    eligible: true,
    student: {
      id: student.id,
      full_name: fullName,
      school: student.school || null,
      school_email: student.school_email,   // canonical stored form
      status: student.status,
      cohort_id: student.cohort_id,
      cohort_name: cohort?.name || null,
      assigned_unit_name: assignedUnitName,
      matched_preceptor: student.matched_preceptor || null,
      hours_required: student.hours_required,
      approved_hours: student.approved_hours,
      pending_hours: student.pending_hours,
    },
    open_shift: openShift,
  }
}
