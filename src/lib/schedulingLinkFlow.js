// CONNECT-SCHEDULING-LINK-1: the confirm-gated Interview Scheduling Link workflow.
//
// Both scheduling-link actions (Interviews worklist row action, Student Profiles side panel) launch
// ASPIRE Connect with this template preselected and the student as the recipient. Nothing is written
// when the draft opens: the app cannot know whether the email actually went out, so the "link sent"
// record is written only after the Owner confirms on return, and only for students Connect itself
// reported as successfully sent. This mirrors the approved Send Form loop (lib/sendFormFlow.js);
// it is the same send-and-confirm architecture, not a parallel one.
//
// SCHOOL EMAIL ONLY - this is a correctness rule, not a preference. The public scheduling page
// resolves a student by school_email alone (api/interview-lookup.js), so a scheduling link sent to a
// personal address reaches a student who then cannot get in. There is no personal-email fallback.
//
// Pure module: no React, no network, no Date.now() defaults. The components own navigation and the
// writes; everything decidable is decided here so it can be tested directly.

// The Send-to-many template these actions preselect (registry: student_interview_scheduling).
export const SCHEDULING_LINK_TEMPLATE_KEY = 'student_interview_scheduling'

// The communications.type that records a sent scheduling link. This is the canonical "Scheduling Link
// Sent" record (lib/commTypes.js) and the same type the Action Center already writes on mark-done.
export const SCHEDULING_LINK_COMM_TYPE = 'scheduling_link'

const lowEmail = (v) => String(v || '').trim().toLowerCase()

/** The student's scheduling-link recipient address, or '' when there is none. */
export function schedulingLinkEmail(student) {
  return String(student?.school_email || '').trim()
}

/** Has a scheduling link already been recorded as sent for this student? */
export function hasSchedulingLinkSent(communications = [], studentId) {
  if (!studentId) return false
  return communications.some(c => c.student_id === studentId && c.type === SCHEDULING_LINK_COMM_TYPE)
}

/**
 * May this student be sent a scheduling link, and what should the action say?
 * Returns { ok, reason, label, disabledReason }.
 *   ok:false + disabledReason  -> render the control disabled with that inline explanation
 *   alreadySent                -> an intentional resend (the Action Center item stays resolved)
 */
export function canSendSchedulingLink(student, communications = []) {
  const alreadySent = hasSchedulingLinkSent(communications, student?.id)
  const label = alreadySent ? 'Resend Scheduling Link' : 'Send Scheduling Link'
  if (!schedulingLinkEmail(student)) {
    return {
      ok: false,
      alreadySent,
      label,
      reason: 'no_school_email',
      disabledReason: 'No school email on file. The scheduling page only recognizes a school email, so add one before sending.',
    }
  }
  return { ok: true, alreadySent, label, reason: null, disabledReason: null }
}

// The staff workspaces a scheduling-link launch may return to. The Action Center is a global overlay
// that can be opened from anywhere, so its launch returns the Owner to the workspace they were on -
// but only when that is a real workspace. Returning to a Connect route would pop the confirmation
// while the Owner is still in the composer, and Settings/Catalog are not where this work lives.
const SCHEDULING_LINK_RETURN_PATHS = ['/aggregate', '/students', '/interviews']
export const DEFAULT_SCHEDULING_LINK_RETURN_PATH = '/interviews'

/** The workspace a launch from `pathname` should return to (falls back to Interviews). */
export function resolveSchedulingLinkReturnPath(pathname) {
  return SCHEDULING_LINK_RETURN_PATHS.includes(pathname)
    ? pathname
    : DEFAULT_SCHEDULING_LINK_RETURN_PATH
}

/**
 * Build the launch context payload for a single-student scheduling-link send.
 * Returns null when the student cannot be sent to, so a caller can never launch a doomed compose.
 */
export function buildSchedulingLinkLaunch({ student, cohortId, cohortName = '', source, returnPath }) {
  if (!student || !cohortId || !returnPath) return null
  if (!schedulingLinkEmail(student)) return null
  return {
    cohortId,
    cohortName,
    source: source || '',
    templateKey: SCHEDULING_LINK_TEMPLATE_KEY,
    returnPath,
    studentIds: [student.id],
  }
}

/**
 * Which of the launched students did Connect actually report as sent?
 * Matches on SCHOOL email only (see the module note) and is scoped to the launched student ids, so a
 * foreign recipient in the same batch can never mark an unrelated student. Returns [] when the
 * composer reported nothing - the caller must then write nothing.
 */
export function confirmedSchedulingLinkRecipients(ctx, students = []) {
  if (!ctx) return []
  const sent = new Set((ctx.sentEmails || []).map(lowEmail))
  if (sent.size === 0) return []
  const launched = new Set(ctx.studentIds || [])
  return students.filter(s =>
    launched.has(s.id) &&
    schedulingLinkEmail(s) &&
    sent.has(lowEmail(schedulingLinkEmail(s))))
}

/** The confirmation copy for a resolved set of successfully-sent students. */
export function buildSchedulingLinkConfirmPlan(students = []) {
  if (!students.length) return null
  const many = students.length > 1
  return {
    students,
    confirmTitle: many
      ? `Mark ${students.length} scheduling links as sent?`
      : 'Mark the scheduling link as sent?',
    confirmBody: `ASPIRE Connect reported ${many ? 'these emails' : 'this email'} as sent. Confirming records ` +
      `${many ? 'a Scheduling Link Sent entry for each student' : 'a Scheduling Link Sent entry for this student'} ` +
      `and clears the Action Center task. It does not change the student's ASPIRE status - that moves to ` +
      `Interview Scheduled when the student books a slot.`,
  }
}

/**
 * Decide the outcome of the per-student communication writes ([{ student, error }]).
 * Mirrors sendFormFlow.resolveSendResults: all-succeeded clears the confirmation, a partial failure
 * returns a plan carrying only the failed students so the write can be retried for exactly those.
 */
export function resolveSchedulingLinkWrites(plan, results = []) {
  const failed = results.filter(r => r.error).map(r => r.student)
  const succeeded = results.filter(r => !r.error).map(r => r.student)
  if (failed.length === 0) return { status: 'done', succeeded, failed: [] }
  return {
    status: 'retry',
    succeeded,
    failed,
    plan: {
      ...plan,
      students: failed,
      confirmTitle: `Retry: mark ${failed.length} scheduling link${failed.length === 1 ? '' : 's'} as sent?`,
      confirmBody: `${failed.length === 1 ? 'One entry' : `${failed.length} entries`} could not be saved. ` +
        `Retry to record ${failed.length === 1 ? 'it' : 'them'}, or choose Not sent to leave the Action Center task open.`,
    },
  }
}
