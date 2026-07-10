// Pure, READ-ONLY status detection for the ASPIRE Post-Rotation Evaluation workflow (instrument
// slug: post_rotation_evaluation). Recipient is the STUDENT. This is NON-GATING experience
// feedback: it is fully decoupled from the Certificate of Participation (the Casey-Fink
// post-rotation survey is the certificate gate). This module reads NO certificate data and never
// reports a certificate status. It performs NO I/O and NEVER sends, mints tokens, creates
// assignments, issues certificates, or generates PDFs.
//
// Per-student display status (highest state wins):
//   evaluation_completed - a post_rotation_evaluation assignment has completed_at
//   evaluation_released  - a post_rotation_evaluation assignment is live (sent/opened/reminder_due)
//   eligible_for_review  - no in-flow record and approved_hours >= hours_required (> 0)
//   not_eligible         - below the hours threshold, or hours_required is 0 or less
//
// The queue shows eligible + in-flow students only (not the whole cohort). Warnings are
// non-blocking display text.

function num(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
function isSafeEmail(v) {
  return typeof v === 'string' && EMAIL_PATTERN.test(v.trim())
}

// Conservative live/terminal state of a post_rotation_evaluation assignment.
function assignmentState(a, nowMs) {
  if (a?.revoked_at || a?.status === 'revoked') return 'revoked'
  if (a?.completed_at || a?.status === 'completed') return 'completed'
  const live = a?.status === 'sent' || a?.status === 'opened' || a?.status === 'reminder_due'
  const expired = a?.status === 'expired' ||
    (live && a?.expires_at && new Date(a.expires_at).getTime() < nowMs)
  if (expired) return 'expired'
  if (live) return 'active'
  return a?.status || 'unknown'
}
const STATE_PRECEDENCE = { completed: 4, active: 3, expired: 2, revoked: 1, unknown: 0 }

function resolveStudentEmail(student) {
  const personal = (student?.personal_email || '').trim()
  const school = (student?.school_email || '').trim()
  const email = personal || school
  return { email, sendable: isSafeEmail(email) }
}

// Classify one cohort. All inputs are already loaded; this function does no I/O.
//   students     - [{ id, first_name, last_name, preferred_first_name, school, program_type,
//                     matched_unit_name, approved_hours, hours_required, pending_hours,
//                     personal_email, school_email }]
//                   matched_unit_name is resolved by the caller from units.unit_name via
//                   students.matched_unit_id; '' when the student has no matched unit.
//   assignments  - post_rotation_evaluation assignments for the cohort ONLY:
//                  [{ id, student_id, status, revoked_at, completed_at, expires_at, sent_at, created_at }]
//   shiftMeta    - Map studentId -> { lastShiftDate: string|null, supportNeeded: boolean } (optional)
//   displayName  - (student) => string, injected so the panel controls name formatting
//   nowMs        - current epoch ms (injected for testability)
//
// Returns { rows, summary }. `rows` are queue rows (eligible + in-flow) sorted by name.
export function classifyPostRotationCohort({
  students = [], assignments = [],
  shiftMeta = new Map(), displayName, nowMs = 0,
}) {
  const nameOf = typeof displayName === 'function'
    ? displayName
    : (s) => `${s.first_name || ''} ${s.last_name || ''}`.trim() || '(unnamed student)'

  // Representative post_rotation_evaluation assignment per student (state precedence, then recency).
  const asgByStudent = new Map()
  for (const a of assignments) {
    const existing = asgByStudent.get(a.student_id)
    if (!existing) { asgByStudent.set(a.student_id, a); continue }
    const pa = STATE_PRECEDENCE[assignmentState(a, nowMs)] ?? 0
    const pe = STATE_PRECEDENCE[assignmentState(existing, nowMs)] ?? 0
    if (pa > pe) asgByStudent.set(a.student_id, a)
    else if (pa === pe) {
      const ta = new Date(a.sent_at || a.created_at || 0).getTime()
      const te = new Date(existing.sent_at || existing.created_at || 0).getTime()
      if (ta > te) asgByStudent.set(a.student_id, a)
    }
  }

  const rows = []
  const summary = {
    // The ASPIRE Post-Rotation Evaluation is no longer the certificate gate, and its release is
    // temporarily disabled (the Casey-Fink post-rotation survey is the gate). So nothing here is
    // reported as releasable (due_sendable/due_unsendable stay 0), keeping the shared "Ready to
    // release" band truthful. eligible_for_review is still surfaced inside the panel.
    due_sendable: 0,
    due_unsendable: 0,
    suppressed_existing: 0, // in-flow: released + completed
    ineligible_hours: 0,    // hours_required is 0 or less
    not_due: 0,             // below the required-hours threshold
    // Panel-only extras (ignored by the shared card):
    eligible_for_review: 0,
    in_flow: 0,
  }

  for (const s of students) {
    const approved = num(s.approved_hours)
    const required = num(s.hours_required)
    const pending = num(s.pending_hours)
    const asg = asgByStudent.get(s.id) || null
    const state = asg ? assignmentState(asg, nowMs) : null

    let status
    if (asg && state === 'completed') status = 'evaluation_completed'
    else if (asg && state === 'active') status = 'evaluation_released'
    else if (required > 0 && approved >= required) status = 'eligible_for_review'
    else if (required <= 0) status = 'not_eligible_hours' // required invalid
    else status = 'not_eligible' // below threshold

    // Recipient resolution is used for the row + the missing-email warning.
    const recipient = resolveStudentEmail(s)

    // Count every student for the card buckets.
    if (status === 'evaluation_completed' || status === 'evaluation_released') {
      summary.suppressed_existing += 1
      summary.in_flow += 1
    } else if (status === 'eligible_for_review') {
      // Release is disabled for this workflow now, so eligible students are NOT counted as ready
      // to release. The count is surfaced in the panel only.
      summary.eligible_for_review += 1
    } else if (status === 'not_eligible_hours') {
      summary.ineligible_hours += 1
    } else {
      summary.not_due += 1
    }

    // The queue lists only eligible + in-flow students (not the whole cohort).
    const inQueue = status === 'eligible_for_review' || status === 'evaluation_released' ||
      status === 'evaluation_completed'
    if (!inQueue) continue

    const unit = (s.matched_unit_name || '').trim()
    const meta = shiftMeta.get(s.id) || null

    // Non-blocking warnings.
    const warnings = []
    if (approved < required && required > 0) warnings.push('Below required hours')
    if (pending > 0) warnings.push(`Pending hours: ${Number.isInteger(pending) ? pending : pending.toFixed(2)}`)
    if (meta?.supportNeeded) warnings.push('Support requested in shift logs')
    if (!unit) warnings.push('No unit on file')
    if (meta && !meta.lastShiftDate) warnings.push('No shift dates found')
    if (!recipient.sendable) warnings.push('No student email on file')

    rows.push({
      studentId: s.id,
      studentName: nameOf(s),
      school: (s.school || '').trim(),
      programType: (s.program_type || '').trim(),
      unit,
      approvedHours: approved,
      hoursRequired: required,
      lastShiftDate: meta?.lastShiftDate || null,
      status,
      studentEmail: recipient.email,
      warnings,
    })
  }

  rows.sort((a, b) => a.studentName.localeCompare(b.studentName))
  return { rows, summary }
}
