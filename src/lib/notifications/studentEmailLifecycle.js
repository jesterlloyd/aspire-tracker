// STUDENT-EMAIL-LIFECYCLE-1: school until BOTH Completed and rotation end has passed.
// A durable current residency hire takes precedence: Cedars-Sinai, then personal.
// Dates come from the linked coordinator-owned rotation, never legacy term_dates.
import { currentResidencyOutcome, hiredResidencyEmail } from './residencyEmail.js'
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
export const validStudentEmail = value => typeof value === 'string' && EMAIL_RE.test(value.trim())

export function rotationHasEnded(rotation, now = new Date()) {
  const row = Array.isArray(rotation) ? rotation[0] : rotation
  const end = row?.rotation_end_date
  if (typeof end !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(end) || end === '1900-01-01') return false
  const endDate = new Date(`${end}T00:00:00Z`)
  if (!Number.isFinite(endDate.getTime()) || endDate.toISOString() !== `${end}T00:00:00.000Z`) return false
  const date = new Date(now)
  if (!Number.isFinite(date.getTime())) return false
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date)
  const part = type => parts.find(p => p.type === type)?.value
  return end < `${part('year')}-${part('month')}-${part('day')}`
}

export function resolveStudentEmail(student, rotation, options = {}) {
  if (options.emailSource === 'school' || options.emailSource === 'personal') {
    const value = student?.[`${options.emailSource}_email`]
    const email = validStudentEmail(value) ? value.trim() : null
    return { email, type: email ? options.emailSource : 'missing', preferredType: options.emailSource,
      fallbackUsed: false, warning: email ? null : `No valid ${options.emailSource} email on file.`,
      reason: `Explicit ${options.emailSource} email selection.` }
  }
  if (student?.email_context_loaded === false) return {
    email: null, type: 'missing', fallbackUsed: false,
    reason: 'Student email routing could not be loaded.',
    warning: 'Student email routing unavailable. Refresh and try again.',
  }
  const resident = hiredResidencyEmail(currentResidencyOutcome(student?.residency_outcomes), student)
  if (resident) return resident
  const personalFirst = student?.status === 'Completed'
    && rotationHasEnded(rotation ?? student?.rotation, options.now)
  const preferredType = personalFirst ? 'personal' : 'school'
  const otherType = personalFirst ? 'school' : 'personal'
  for (const type of [preferredType, otherType]) {
    const email = student?.[`${type}_email`]
    if (!validStudentEmail(email)) continue
    const fallbackUsed = type !== preferredType
    const warning = fallbackUsed
      ? `${preferredType === 'school' ? 'School' : 'Personal'} email missing or invalid, using ${type} email.`
      : null
    return {
      email: email.trim(), type, preferredType, fallbackUsed, warning,
      reason: warning || (personalFirst
        ? 'Completed and rotation end date has passed; personal email preferred.'
        : 'School email preferred until Completed and the rotation end date has passed.'),
    }
  }
  return {
    email: null, type: 'missing', preferredType, fallbackUsed: false,
    reason: 'No valid email on file for this student.', warning: 'No email on file, cannot send.',
  }
}

// Routing details for send history and operator results, without additional PII.
export function studentEmailRoutingMetadata(student, options = {}) {
  const route = resolveStudentEmail(student, undefined, options)
  return { recipient_source: route.type, recipient_warning: route.warning, recipient_fallback: route.fallbackUsed }
}
