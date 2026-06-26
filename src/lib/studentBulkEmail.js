// src/lib/studentBulkEmail.js
//
// MANUAL-OUTREACH-TEMPLATE-LIBRARY Phase 2A — frontend-only student email routing for the
// Send-to-Many Students audience. Defines the INTENDED recipient email for Phase 2B; it does NOT
// send anything yet. Pure (no network/React/DOM): safe to unit-test in node.
//
// Routing rule (owner-specified):
//   • While the student is in Active Rotation → route to the SCHOOL email first.
//   • After the student is done (any non-Active-Rotation status) → route to the PERSONAL email.
//   • If the preferred route is missing, fall back to the available email and surface which one.
//   • If neither exists → 'missing'.

import { isValidEmail } from './notifications/studentRecipient.js'

// Returns { email, emailType: 'school'|'personal'|'missing', reason }.
export function getStudentBulkEmailRoute(student) {
  const school   = student?.school_email || ''
  const personal = student?.personal_email || ''
  const hasSchool   = isValidEmail(school)
  const hasPersonal = isValidEmail(personal)
  const activeRotation = (student?.status || '') === 'Active Rotation'

  if (activeRotation) {
    if (hasSchool)   return { email: school.trim(),   emailType: 'school',   reason: 'Active Rotation — school email preferred' }
    if (hasPersonal) return { email: personal.trim(), emailType: 'personal', reason: 'Active Rotation — no school email, using personal' }
    return { email: '', emailType: 'missing', reason: 'No email on file' }
  }
  // Not in Active Rotation (Placed / Completed / other) → personal email first.
  if (hasPersonal) return { email: personal.trim(), emailType: 'personal', reason: 'Using personal email' }
  if (hasSchool)   return { email: school.trim(),   emailType: 'school',   reason: 'No personal email, using school' }
  return { email: '', emailType: 'missing', reason: 'No email on file' }
}

// Human label for a route type.
export function emailTypeLabel(emailType) {
  return emailType === 'school' ? 'School email'
    : emailType === 'personal'  ? 'Personal email'
    : 'Missing email'
}

// Simple email-availability filter options (plain language, one consistent set across Send-to-Many).
// This filters by which email a student HAS — the routing helper above still decides which email
// is actually used for Phase 2B and drives the row badge.
export const EMAIL_AVAILABILITY_FILTERS = [
  { value: 'all',      label: 'Email: all' },
  { value: 'personal', label: 'Personal email' },
  { value: 'school',   label: 'School email' },
  { value: 'missing',  label: 'Missing email' },
]

// Predicate for the email-availability filter. Returns true when the student matches `value`.
export function matchesEmailAvailabilityFilter(student, value) {
  if (!value || value === 'all') return true
  const hasSchool   = isValidEmail(student?.school_email)
  const hasPersonal = isValidEmail(student?.personal_email)
  switch (value) {
    case 'personal': return hasPersonal
    case 'school':   return hasSchool
    case 'missing':  return !hasPersonal && !hasSchool
    default:         return true
  }
}
