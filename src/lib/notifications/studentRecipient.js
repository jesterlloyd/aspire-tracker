// CONNECT-COMMS-1B - shared, pure resolver for student correspondence recipient routing.
//
// Communication canon for ACTIVE/CURRENT ASPIRE student correspondence (e.g. ASPIRE Connect
// direct messages): default to the SCHOOL email. personal_email is used ONLY when school_email
// is missing/invalid (with a visible warning), or via an explicit override, or a future
// post-school-access/alumni workflow. NEVER silently switch to personal_email.
//
// This mirrors the school-first precedence of the clock-out reminder canon and is the OPPOSITE
// of the prior personal-first behavior in api/connect-send-direct-email.js. Pure: no I/O.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
export const ROTATION_SENTINEL = '1900-01-01'

export function isValidEmail(v) {
  return typeof v === 'string' && EMAIL_RE.test(v.trim())
}

/**
 * Resolve the recipient for ASPIRE Connect direct student correspondence.
 * @param {object} student  - student row ({ school_email, personal_email, status, ... })
 * @param {object|null} rotation - linked cohort_school_rotations row (accepted for future
 *        post-rotation policy; NOT used to switch routing in this phase - school-first stays).
 * @param {object} [options] - { overrideEmail?: string }
 * @returns {{ email: string|null, type: 'school'|'personal'|'override'|'missing', reason: string, warning: string|null }}
 */
export function resolveStudentCorrespondenceRecipient(student, rotation, options = {}) {
  const school   = (student?.school_email   || '').trim()
  const personal = (student?.personal_email || '').trim()
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

  // 2. School-first: the canonical default for active/current ASPIRE student correspondence.
  //    Note: rotation/lifecycle (completed, rotation_end_date passed, sentinel 1900-01-01) does
  //    NOT switch routing in this phase - post-school-access/alumni routing is a future workflow.
  if (isValidEmail(school)) {
    return {
      email: school,
      type: 'school',
      reason: 'Active ASPIRE correspondence routes to the school email.',
      warning: null,
    }
  }

  // 3. Personal fallback ONLY when school is missing/invalid - always with a visible warning.
  if (isValidEmail(personal)) {
    return {
      email: personal,
      type: 'personal',
      reason: 'School email is missing or invalid.',
      warning: 'School email missing, using personal email.',
    }
  }

  // 4. Nothing usable - block send.
  return {
    email: null,
    type: 'missing',
    reason: 'No valid email on file for this student.',
    warning: 'No email on file, cannot send.',
  }
}
