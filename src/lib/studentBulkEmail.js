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

// Shared Email-routing filter options (one consistent language across Send-to-Many).
export const EMAIL_ROUTE_FILTERS = [
  { value: 'all',           label: 'Email: all' },
  { value: 'has_routable',  label: 'Has routable email' },
  { value: 'missing',       label: 'Missing routable email' },
  { value: 'route_school',  label: 'Will use school email' },
  { value: 'route_personal', label: 'Will use personal email' },
  { value: 'has_school',    label: 'Has school email' },
  { value: 'has_personal',  label: 'Has personal email' },
]

// Predicate for the Email-routing filter. Returns true when the student matches `value`.
export function matchesEmailRouteFilter(student, value) {
  if (!value || value === 'all') return true
  const route = getStudentBulkEmailRoute(student)
  const hasSchool   = isValidEmail(student?.school_email)
  const hasPersonal = isValidEmail(student?.personal_email)
  switch (value) {
    case 'has_routable':   return route.emailType !== 'missing'
    case 'missing':        return route.emailType === 'missing'
    case 'route_school':   return route.emailType === 'school'
    case 'route_personal': return route.emailType === 'personal'
    case 'has_school':     return hasSchool
    case 'has_personal':   return hasPersonal
    default:               return true
  }
}
