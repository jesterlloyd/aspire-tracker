// Pure, READ-ONLY status detection for the PRE-rotation Casey-Fink Readiness for Practice
// Survey (slug: casey_fink_readiness_2024, timepoint: baseline). Recipient is the STUDENT.
// REVIEW-RELEASE-1.
//
// This is the baseline half of the Casey-Fink pair. It gates nothing: the Certificate of
// Completion is unlocked by the POST-rotation survey and the database refuses to issue for
// any other timepoint. Nothing downstream waits on it, and it is deliberately NOT a
// prerequisite for the post-rotation release (Owner brief: "show the relationship only").
//
// THE TRIGGER IS ASPIRE STATUS, NOT HOURS. Any student who has been interviewed is a
// candidate whether or not they are placed yet, so the eligible statuses are Interviewed,
// Placed, and Active Rotation. The four pre-interview statuses (Pending Outreach, Form
// Sent, Form Received, Interview Scheduled) are "not yet eligible": nothing to do yet.
// Completed, Declined and Not Proceeding are past the point of a baseline and never appear.
//
// Parallel to caseyFinkPostRotationDueDetection.js, from which it borrows the assignment
// state machine and the reissue rule, so an expired or revoked baseline survey is offered
// again the same way the post-rotation one is. It performs NO I/O and NEVER sends, mints
// tokens, creates assignments, or writes. The caller passes ONLY baseline Casey-Fink
// assignments (slug + timepoint filtered).
//
// Per-student status (highest state wins):
//   readiness_completed   - the baseline assignment has completed_at
//   readiness_released    - the baseline assignment is live (sent/opened/reminder_due)
//   readiness_reissue     - the prior assignment expired or was revoked and may be reused
//   readiness_attention   - another non-completed assignment state needs support review
//   eligible_for_review   - no assignment and ASPIRE status is one of the three
//   not_eligible          - a pre-interview status
//   out_of_scope          - Completed, Declined, Not Proceeding, or an unknown status

import { caseyFinkAssignmentState, isCaseyFinkReissuableAssignment } from './caseyFinkPostRotationDueDetection.js'

export const PRE_ROTATION_TIMEPOINT = 'baseline'

/** The ASPIRE statuses at which the baseline survey is due. */
export const PRE_ROTATION_ELIGIBLE_STATUSES = Object.freeze(['Interviewed', 'Placed', 'Active Rotation'])

/** The statuses that come BEFORE eligibility: the student is on the way, nothing to do yet. */
export const PRE_ROTATION_PENDING_STATUSES = Object.freeze([
  'Pending Outreach', 'Form Sent', 'Form Received', 'Interview Scheduled',
])

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
function isSafeEmail(v) {
  return typeof v === 'string' && EMAIL_PATTERN.test(v.trim())
}

function resolveStudentEmail(student) {
  const personal = (student?.personal_email || '').trim()
  const school = (student?.school_email || '').trim()
  const email = personal || school
  return { email, sendable: isSafeEmail(email) }
}

const STATE_PRECEDENCE = {
  completed: 7, attention: 6, active: 5, expired: 4, non_responder: 3, revoked: 2, draft: 1, unknown: 0,
}

// Classify one cohort. All inputs are already loaded; this function does no I/O.
//   students     - [{ id, first_name, last_name, preferred_first_name, school, program_type,
//                     aspire_status, matched_unit_name, personal_email, school_email }]
//   assignments  - casey_fink_readiness_2024 assignments at timepoint baseline for the cohort
//                  ONLY: [{ id, student_id, status, revoked_at, completed_at, expires_at,
//                  sent_at, created_at, notes }]
//   displayName  - (student) => string
//   nowMs        - current epoch ms
//
// Returns { rows, summary }. rows carry every student except the out-of-scope ones.
export function classifyCaseyFinkPreRotationCohort({
  students = [], assignments = [], displayName, nowMs = 0,
}) {
  const nameOf = typeof displayName === 'function'
    ? displayName
    : (s) => `${s.first_name || ''} ${s.last_name || ''}`.trim() || '(unnamed student)'

  const asgByStudent = new Map()
  for (const a of assignments) {
    const existing = asgByStudent.get(a.student_id)
    if (!existing) { asgByStudent.set(a.student_id, a); continue }
    const pa = STATE_PRECEDENCE[caseyFinkAssignmentState(a, nowMs)] ?? 0
    const pe = STATE_PRECEDENCE[caseyFinkAssignmentState(existing, nowMs)] ?? 0
    if (pa > pe) asgByStudent.set(a.student_id, a)
    else if (pa === pe) {
      const ta = new Date(a.sent_at || a.created_at || 0).getTime()
      const te = new Date(existing.sent_at || existing.created_at || 0).getTime()
      if (ta > te) asgByStudent.set(a.student_id, a)
    }
  }

  const rows = []
  const summary = {
    // The same buckets the other detectors report, so the rail and the summary line
    // add these up the same way.
    due_sendable: 0,
    due_unsendable: 0,
    suppressed_existing: 0,
    ineligible_hours: 0,   // never used here; kept so the shape matches
    not_due: 0,            // pre-interview statuses
    eligible_for_review: 0,
    reissue_required: 0,
    in_flow: 0,
    out_of_scope: 0,
  }

  for (const s of students) {
    const aspireStatus = (s.aspire_status || '').trim()
    const eligibleStatus = PRE_ROTATION_ELIGIBLE_STATUSES.includes(aspireStatus)
    const pendingStatus = PRE_ROTATION_PENDING_STATUSES.includes(aspireStatus)
    const asg = asgByStudent.get(s.id) || null
    const state = asg ? caseyFinkAssignmentState(asg, nowMs) : null

    let status
    if (asg && state === 'completed') status = 'readiness_completed'
    else if (asg && state === 'active') status = 'readiness_released'
    else if (asg && isCaseyFinkReissuableAssignment(asg, nowMs) && eligibleStatus) status = 'readiness_reissue'
    else if (asg && isCaseyFinkReissuableAssignment(asg, nowMs)) status = pendingStatus ? 'not_eligible' : 'out_of_scope'
    else if (asg) status = 'readiness_attention'
    else if (eligibleStatus) status = 'eligible_for_review'
    else if (pendingStatus) status = 'not_eligible'
    else status = 'out_of_scope'

    if (status === 'out_of_scope') { summary.out_of_scope += 1; continue }

    const recipient = resolveStudentEmail(s)

    if (status === 'readiness_completed' || status === 'readiness_released') {
      summary.suppressed_existing += 1
      summary.in_flow += 1
    } else if (status === 'eligible_for_review' || status === 'readiness_reissue') {
      summary.eligible_for_review += 1
      if (status === 'readiness_reissue') summary.reissue_required += 1
      if (recipient.sendable) summary.due_sendable += 1
      else summary.due_unsendable += 1
    } else if (status === 'readiness_attention') {
      summary.due_unsendable += 1
    } else {
      summary.not_due += 1
    }

    const warnings = []
    if (status === 'readiness_reissue') warnings.push(`Prior survey ${state === 'revoked' ? 'was revoked' : 'expired'}`)
    if (status === 'readiness_attention') warnings.push(`Existing survey state needs review: ${state}`)
    if (!recipient.sendable && status !== 'not_eligible') warnings.push('No student email on file')

    rows.push({
      studentId: s.id,
      studentName: nameOf(s),
      school: (s.school || '').trim(),
      programType: (s.program_type || '').trim(),
      unit: (s.matched_unit_name || '').trim(),
      aspireStatus,
      status,
      studentEmail: recipient.email,
      sendable: recipient.sendable,
      warnings,
      assignment: asg,
    })
  }

  rows.sort((a, b) => a.studentName.localeCompare(b.studentName))
  return { rows, summary }
}
