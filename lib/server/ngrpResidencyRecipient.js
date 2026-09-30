import { hiredResidencyEmail } from '../../src/lib/notifications/residencyEmail.js'
// lib/server/ngrpResidencyRecipient.js
//
// RESIDENCY: where residency correspondence goes. Owner decision, 2026-09-11.
//
//   Hired          -> their Cedars-Sinai address (they are an employee now),
//                     personal email as the backup.
//   Still applying -> the preferred email they gave on the Transition Form,
//                     personal email as the backup.
//
// The SCHOOL address is never used: alumni lose it after graduation. This is
// shared with general ASPIRE correspondence for hired residents. The explicit
// Transition Form preference remains the applicant's chosen address.
//
// Pure and db-free. Returns { email, source } or { email: null, reason }.
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const clean = v => (typeof v === 'string' ? v.trim() : '')
const valid = v => (EMAIL_SHAPE.test(clean(v)) ? clean(v) : null)

export const RESIDENCY_RECIPIENT_SOURCES = Object.freeze(['cs_email', 'form_preferred_email', 'personal_email'])

export function isHired(outcome) {
  return Boolean(outcome?.hired_at) && !outcome?.separated_at
}

export function residencyRecipient({ outcome = null, formPreferredEmail = null, student = null } = {}) {
  const personal = valid(student?.personal_email)
  if (isHired(outcome)) {
    const route = hiredResidencyEmail(outcome, student)
    if (route.email) return { email: route.email, source: route.type === 'cedars' ? 'cs_email' : 'personal_email' }
    return { email: null, reason: 'no_cs_or_personal_email' }
  }
  const preferred = valid(formPreferredEmail)
  if (preferred) return { email: preferred, source: 'form_preferred_email' }
  if (personal) return { email: personal, source: 'personal_email' }
  return { email: null, reason: 'no_preferred_or_personal_email' }
}
