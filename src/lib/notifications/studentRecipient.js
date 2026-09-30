import { resolveStudentEmail } from './studentEmailLifecycle.js'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
export const ROTATION_SENTINEL = '1900-01-01'

export function isValidEmail(v) {
  return typeof v === 'string' && EMAIL_RE.test(v.trim())
}

/**
 * Resolve the recipient for ASPIRE Connect direct student correspondence.
 * @param {object} student  - student row ({ school_email, personal_email, status, ... })
 * @param {object|null} rotation - linked cohort_school_rotations row (used for
 *        lifecycle routing; defaults to student.rotation when not supplied).
 * @param {object} [options] - { overrideEmail?: string, emailSource?: string, now?: Date|string|number }
 * @returns {{ email: string|null, type: 'school'|'personal'|'cedars'|'override'|'missing', reason: string, warning: string|null }}
 */
export function resolveStudentCorrespondenceRecipient(student, rotation, options = {}) {
  const override = (options?.overrideEmail  || '').trim()

  // 1. Explicit override (rare; future manual-override workflow).
  if (override) {
    return {
      email: override,
      type: 'override',
      reason: 'Manual override recipient was provided.',
      warning: isValidEmail(override) ? null : 'Override email may be invalid, verify before sending.',
    }
  }

  return resolveStudentEmail(student, rotation, options)
}
