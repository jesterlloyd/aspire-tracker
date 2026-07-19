// ASPIRE-CHART: the confirm-gated Send Form workflow (approved semantics).
//
// Opening an email draft must NEVER change a student's status: the app
// cannot detect whether Outlook actually sent anything, so the old
// write-on-compose behavior could mark students 'Form Sent' when the draft
// was closed unsent. The flow is now two explicit steps:
//   1. prepare: open the compose draft (no writes of any kind)
//   2. confirm: the staff member states the email was sent; only then does
//      each pending student's status change to 'Form Sent'
// Canceling ("Not sent") discards the pending confirmation with no writes.
// A partial failure keeps the failed students listed so the confirmation can
// be retried for exactly those records.
//
// Pure module: the component owns the compose-opening and the actual writes;
// everything decidable is decided here so it can be tested directly.

/** Students still awaiting outreach - the only ones a send may affect. */
export function pendingOutreachStudents(students = []) {
  return students.filter(s => s.status === 'Pending Outreach')
}

/**
 * Build the pending confirmation for a school-level send.
 * Returns null when there is nothing to send (no pending students).
 */
export function buildSchoolSendPlan(school, schoolStudents = []) {
  const pending = pendingOutreachStudents(schoolStudents)
  if (pending.length === 0) return null
  return {
    kind: 'school',
    school,
    students: pending,
    emails: pending.map(s => s.school_email).filter(Boolean),
    confirmTitle: `Mark ${pending.length} student${pending.length === 1 ? '' : 's'} as Form Sent?`,
    confirmBody: `Confirm only if the form email to ${school} was actually sent. ` +
      `Confirming changes ${pending.length === 1 ? 'this student’s' : 'these students’'} ` +
      `ASPIRE status from Pending Outreach to Form Sent. Closing the draft without sending? Choose Not sent.`,
  }
}

/** Build the pending confirmation for a single-student send. */
export function buildStudentSendPlan(student) {
  if (!student) return null
  return {
    kind: 'student',
    students: [student],
    emails: [student.school_email].filter(Boolean),
    confirmTitle: 'Mark as Form Sent?',
    confirmBody: `Confirm only if the form email was actually sent. Confirming changes ` +
      `this student’s ASPIRE status from ${student.status || 'Pending Outreach'} to Form Sent. ` +
      `Closing the draft without sending? Choose Not sent.`,
  }
}

/**
 * Given per-student write results ([{ student, error }]), decide the outcome:
 * - done: every write succeeded -> clear the confirmation
 * - retry: some failed -> a NEW plan containing only the failed students, so
 *   Mark as sent can be retried for exactly those records
 */
export function resolveSendResults(plan, results) {
  const failed = results.filter(r => r.error).map(r => r.student)
  const succeeded = results.filter(r => !r.error).map(r => r.student)
  if (failed.length === 0) {
    return { status: 'done', succeeded, failed: [] }
  }
  return {
    status: 'retry',
    succeeded,
    failed,
    plan: {
      ...plan,
      students: failed,
      confirmTitle: `Retry: mark ${failed.length} student${failed.length === 1 ? '' : 's'} as Form Sent?`,
      confirmBody: `${failed.length === 1 ? 'One status update' : `${failed.length} status updates`} failed and ` +
        `${failed.length === 1 ? 'was' : 'were'} not saved. Retry to mark the remaining ` +
        `student${failed.length === 1 ? '' : 's'} as Form Sent, or choose Not sent to leave ` +
        `${failed.length === 1 ? 'it' : 'them'} at Pending Outreach.`,
    },
  }
}
