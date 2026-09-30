import { isValidEmail, resolveStudentCorrespondenceRecipient } from './notifications/studentRecipient.js'

// Automatic selection only. Explicit email-source choices below remain unchanged.
export function getStudentBulkEmailRoute(student, options = {}) {
  const route = resolveStudentCorrespondenceRecipient(student, undefined, options)
  return { email: route.email || '', emailType: route.type, reason: route.reason,
    warning: route.warning, fallbackUsed: route.fallbackUsed }
}

// Human label for a route type.
export function emailTypeLabel(emailType) {
  return emailType === 'school' ? 'School email'
    : emailType === 'personal'  ? 'Personal email'
    : 'Missing email'
}

// Explicit recipient email-SOURCE options for the Students audience. The owner-chosen source
// (not the routing helper) decides which email is displayed AND selected for Phase 2B.
export const EMAIL_SOURCE_OPTIONS = [
  { value: 'school',   label: 'School email' },
  { value: 'personal', label: 'Personal email' },
]

// The student's email for the explicitly-chosen source ('school' | 'personal'), or '' if invalid/absent.
export function studentEmailForSource(student, source) {
  const v = source === 'personal' ? student?.personal_email : student?.school_email
  return isValidEmail(v) ? String(v).trim() : ''
}

// True when the student has a valid email for the chosen source.
export function studentHasEmailSource(student, source) {
  return !!studentEmailForSource(student, source)
}
