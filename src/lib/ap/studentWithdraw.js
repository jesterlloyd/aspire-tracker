// AP-STUDENT-WITHDRAW-1 (Owner, 2026-11-19): an Academic Partner removes a student it submitted
// for placement, for good, while the ASPIRE team has not reached out yet. This is NOT the
// Withdrawn / Not Proceeding status: the record is deleted, as if it were never submitted.
//
// One rule, read by the roster (to show Remove) and by the server (to allow the delete). Pure.
// Every input is a fact the server reads; nothing here trusts the browser.

export const WITHDRAW_STATUS = 'Pending Outreach'

// Notification types logged against a student that are NOT outreach to that student: the
// placement request's own confirmation goes to the coordinator and the team, with the student as
// its subject. Anything else logged against the student means the student was contacted.
export const NOT_OUTREACH_TYPES = Object.freeze(['placement_request_received', 'form_received'])

/**
 * Why this student cannot be removed by this caller, or null when they can.
 *
 * @param {object} student  students row: status, submitted_via,
 *   placement_request_last_submitted_by_profile_id, student_form_privacy_ack_at,
 *   resume_url, headshot_url
 * @param {object} facts    { callerId, hasPortalLink, outreachCount, documentCount }
 */
export function withdrawBlocker(student, facts = {}) {
  if (!student) return 'not_found'
  if (!facts.callerId || student.placement_request_last_submitted_by_profile_id !== facts.callerId) return 'not_submitter'
  if (student.status !== WITHDRAW_STATUS) return 'reached_out'
  if (student.submitted_via === 'student_form' || student.student_form_privacy_ack_at) return 'student_filled'
  if (hasText(student.resume_url) || hasText(student.headshot_url)) return 'student_filled'
  if (facts.hasPortalLink) return 'student_filled'
  if ((facts.outreachCount || 0) > 0) return 'reached_out'
  if ((facts.documentCount || 0) > 0) return 'has_documents'
  return null
}

export const canWithdraw = (student, facts) => withdrawBlocker(student, facts) === null

// The sentence a refusal shows. A school only ever sees Remove when it is allowed, so these are
// for the race where something changed between loading the roster and pressing Remove.
export const WITHDRAW_REFUSALS = Object.freeze({
  not_found: 'This student is no longer on your roster.',
  not_submitter: 'Only the person who submitted this student can remove them. Email aspire@cshs.org for help.',
  reached_out: 'The ASPIRE team has already reached out to this student, so they can no longer be removed here. Email aspire@cshs.org to withdraw them.',
  student_filled: 'This student has already started their profile, so they can no longer be removed here. Email aspire@cshs.org to withdraw them.',
  has_documents: 'Documents are on file for this student, so they can no longer be removed here. Email aspire@cshs.org to withdraw them.',
  blocked: 'This student has records the ASPIRE team keeps, so they can no longer be removed here. Email aspire@cshs.org to withdraw them.',
})

export const refusalText = (code) => WITHDRAW_REFUSALS[code] || 'This student could not be removed. Please try again.'

/** The confirmation the school sees before anything is deleted. */
export function withdrawConfirm(name) {
  const who = name || 'this student'
  return {
    message: `Remove ${who} from your placement request? This deletes the student for good and cannot be undone. The ASPIRE team will be told by email.`,
    confirmLabel: 'Remove student',
  }
}

function hasText(v) { return typeof v === 'string' && v.trim() !== '' }
