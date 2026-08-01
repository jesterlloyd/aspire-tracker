// STUDENT-PORTAL-PROFILE-1: the canonical student-profile lock condition.
//
// One source of truth for "may the STUDENT still change their own submitted profile?",
// shared by the public intake endpoint, the authenticated portal profile endpoint, and
// the portal UI. Pure module: no I/O, no React, importable from api/ and src/ alike
// (the api/ -> src/lib import pattern already exists, e.g. emailUtils, availability).
//
// The lock is TWO conditions, both canonical elsewhere in the app:
//   1. Status: the same intake-eligible set api/student-intake-submit.js has always
//      enforced (its 409 already_processed). Beyond Form Received the record carries
//      staff-managed workflow data a student must not overwrite.
//   2. interview_scheduled_date: the booking marker. api/interview-book.js and the
//      manual scheduling action set it together with status='Interview Scheduled', and
//      cancel_booking clears both, so in practice the two agree; checking both means a
//      record in any inconsistent in-between state FAILS CLOSED (locked).
//
// This constrains the STUDENT only. Owner/Admin staff editing (api/student-update.js)
// is deliberately not lock-gated: staff correction of a locked profile is the approved
// correction path.

export const PROFILE_EDITABLE_STATUSES = ['Pending Outreach', 'Form Sent', 'Form Received']

export function isStudentProfileLocked(student) {
  if (!student) return true // no record -> nothing editable; fail closed
  const status = student.status || 'Pending Outreach'
  if (!PROFILE_EDITABLE_STATUSES.includes(status)) return true
  if (student.interview_scheduled_date) return true
  return false
}

// The approved lock notice, verbatim (Owner copy).
export const PROFILE_LOCKED_MESSAGE =
  'Your profile is now locked because your interview has been scheduled. ' +
  'Contact the ASPIRE team if a correction is needed.'
