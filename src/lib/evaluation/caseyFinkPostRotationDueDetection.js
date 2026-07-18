// Pure, READ-ONLY status detection for the post-rotation Casey-Fink Readiness for Practice
// Survey (slug: casey_fink_readiness_2024, timepoint: post_rotation). Recipient is the STUDENT.
// This is the certificate-gating workflow: completing it unlocks the Certificate of Participation.
//
// Parallel to postRotationCertDueDetection.js. It performs NO I/O and NEVER sends, mints tokens,
// creates assignments, issues certificates, or writes. The caller passes ONLY the student's
// post-rotation Casey-Fink assignments (slug + timepoint filtered).
//
// Per-student display status (highest state wins):
//   certificate_unlocked  - a certificates row exists for the student
//   readiness_completed   - the post-rotation Casey-Fink assignment has completed_at
//   readiness_released    - the post-rotation Casey-Fink assignment is live (sent/opened/reminder_due)
//   eligible_for_review   - no in-flow record and approved_hours >= hours_required (> 0)
//   not_eligible          - below the hours threshold, or hours_required is 0 or less

function num(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
function isSafeEmail(v) {
  return typeof v === 'string' && EMAIL_PATTERN.test(v.trim())
}

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
//   assignments  - casey_fink_readiness_2024 assignments at timepoint post_rotation for the
//                  cohort ONLY: [{ id, student_id, status, revoked_at, completed_at, expires_at,
//                  sent_at, created_at }]
//   certificates - certificates rows for these students: [{ id, student_id, certificate_number }]
//   shiftMeta    - Map studentId -> { lastShiftDate, supportNeeded } (optional)
//   displayName  - (student) => string
//   nowMs        - current epoch ms
//
// Returns { rows, summary }. rows are queue rows (eligible + in-flow) sorted by name.
export function classifyCaseyFinkPostRotationCohort({
  students = [], assignments = [], certificates = [],
  shiftMeta = new Map(), displayName, nowMs = 0,
}) {
  const nameOf = typeof displayName === 'function'
    ? displayName
    : (s) => `${s.first_name || ''} ${s.last_name || ''}`.trim() || '(unnamed student)'

  const certByStudent = new Map()
  for (const c of certificates) {
    if (c?.student_id && !certByStudent.has(c.student_id)) certByStudent.set(c.student_id, c)
  }

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
    // Certificate gate is live: eligible + resolvable email -> due_sendable; eligible with no
    // email -> due_unsendable. In-flow (released / completed / certificate) -> suppressed_existing,
    // never counted as ready.
    due_sendable: 0,
    due_unsendable: 0,
    suppressed_existing: 0,
    ineligible_hours: 0,
    not_due: 0,
    eligible_for_review: 0,
    in_flow: 0,
  }

  for (const s of students) {
    const approved = num(s.approved_hours)
    const required = num(s.hours_required)
    const pending = num(s.pending_hours)
    const cert = certByStudent.get(s.id) || null
    const asg = asgByStudent.get(s.id) || null
    const state = asg ? assignmentState(asg, nowMs) : null

    let status
    if (cert) status = 'certificate_unlocked'
    else if (asg && state === 'completed') status = 'readiness_completed'
    else if (asg && state === 'active') status = 'readiness_released'
    else if (required > 0 && approved >= required) status = 'eligible_for_review'
    else if (required <= 0) status = 'not_eligible_hours'
    else status = 'not_eligible'

    const recipient = resolveStudentEmail(s)

    if (status === 'certificate_unlocked' || status === 'readiness_completed' || status === 'readiness_released') {
      summary.suppressed_existing += 1
      summary.in_flow += 1
    } else if (status === 'eligible_for_review') {
      summary.eligible_for_review += 1
      if (recipient.sendable) summary.due_sendable += 1
      else summary.due_unsendable += 1
    } else if (status === 'not_eligible_hours') {
      summary.ineligible_hours += 1
    } else {
      summary.not_due += 1
    }

    // ASPIRE-CHART (approved): students NOT yet eligible are no longer
    // silently omitted - they appear as blocked rows with the provable
    // reason, so "why isn't this student here?" is answerable from the
    // table. Summary counts and every status threshold are unchanged; the
    // release action still renders only for eligible_for_review, and the
    // server re-checks eligibility on release regardless.
    const blocked = status === 'not_eligible' || status === 'not_eligible_hours'

    const unit = (s.matched_unit_name || '').trim()
    const meta = shiftMeta.get(s.id) || null

    const warnings = []
    if (blocked) {
      if (required <= 0) warnings.push('Required hours not set')
      else warnings.push(`Required hours not met (${Number.isInteger(approved) ? approved : approved.toFixed(2)} of ${Number.isInteger(required) ? required : required.toFixed(2)})`)
    }
    if (!blocked && approved < required && required > 0) warnings.push('Below required hours')
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
      certificateNumber: cert?.certificate_number || null,
      studentEmail: recipient.email,
      warnings,
      blocked,
    })
  }

  // Actionable and in-flow rows first, blocked rows beneath, names A-Z within.
  rows.sort((a, b) => (a.blocked === b.blocked ? a.studentName.localeCompare(b.studentName) : a.blocked ? 1 : -1))
  return { rows, summary }
}
