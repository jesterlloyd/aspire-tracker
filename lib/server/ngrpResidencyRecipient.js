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
// deliberately different from the general student rule in
// src/lib/notifications/studentRecipient.js, which is school-first because it
// is written for students who are still enrolled.
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
    const cs = valid(outcome?.cs_email)
    if (cs) return { email: cs, source: 'cs_email' }
    if (personal) return { email: personal, source: 'personal_email' }
    return { email: null, reason: 'no_cs_or_personal_email' }
  }
  const preferred = valid(formPreferredEmail)
  if (preferred) return { email: preferred, source: 'form_preferred_email' }
  if (personal) return { email: personal, source: 'personal_email' }
  return { email: null, reason: 'no_preferred_or_personal_email' }
}
