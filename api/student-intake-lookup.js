/* global process */
// api/student-intake-lookup.js
//
// PHASE0B-WAVE-D: PUBLIC pre-submit lookup for /student-form.
//
// Replaces the client's direct anon SELECT * on students (the pre-fill and
// upload-path resolution step), so the anon RLS policy on students can be
// dropped without breaking the intake form.
//
// Security model (public, NO staff auth, mirrors student-intake-submit):
//   - Same exactly-one-cohort and exactly-one-student resolution as submit,
//     via the shared api/lib/intakeStudentLookup.js helpers.
//   - Returns NO student field and no identifier: just { verified: true }. The
//     ids it used to return became vestigial when Wave F-2 moved upload-path
//     construction server-side, and the form already discarded them.
//   - S-11: requires school_email AND last_name, throttled in two buckets, and
//     answers every failure with one identical refusal.

import { createClient } from '@supabase/supabase-js'
import { resolveAcceptingCohort, resolveStudentByEmail } from './lib/intakeStudentLookup.js'
import { consumePublicRateLimit, INTAKE_LOOKUP_LIMITS, TOO_MANY_REQUESTS } from './lib/publicRateLimit.js'
// Generic text normalizer (NFKC, zero-width strip, trim, lowercase) that happens to
// live in emailUtils. Aliased because it is applied to a surname here, not an email.
import { normalizeEmailForLookup as normalizeForMatch } from '../src/lib/emailUtils.js'

// S-11. ONE refusal for every way this lookup can fail to start an application.
//
// It previously answered 404 not_found, 409 ambiguous_student, 409
// ambiguous_cohort, and 403 not_accepting with distinct codes and messages, and
// 200 on success. An anonymous caller could therefore ask "is this address an
// ASPIRE student" and read the answer off the status code, one address at a
// time, forever.
//
// Every failure now returns this, identically. It still tells a real applicant
// exactly what to do, because for them the next step is the same in all four
// cases: check the address, or contact the team.
const CANNOT_START = {
  status: 404,
  body: {
    error: 'not_verified',
    message:
      'We could not verify your details for the current cycle. Please check that your school '
      + 'email and last name match what your school submitted, then try again. If they do, '
      + 'contact the ASPIRE team and we will help.',
  },
}

function getDb() {
  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Missing Supabase service role credentials')
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })

  if (!(process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL) || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: 'internal_error' })
  }

  const body = (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) ? req.body : {}
  const schoolEmail = typeof body.school_email === 'string' ? body.school_email.trim() : ''
  // S-11 SECOND FACTOR. The email alone was the whole credential, which is what
  // made address-walking worth doing. The applicant has already typed their last
  // name by the time this runs (StudentIntakeFormPage requires first and last
  // name before it reaches this call), so requiring it here costs a real person
  // nothing and means a prober now needs the surname too.
  const lastName = typeof body.last_name === 'string' ? body.last_name.trim() : ''
  if (!schoolEmail || !schoolEmail.includes('@') || !schoolEmail.includes('.') || !lastName) {
    // Shape-invalid input is refused the same way as a failed match, so the
    // difference between "malformed" and "unknown" is not readable either.
    return res.status(CANNOT_START.status).json(CANNOT_START.body)
  }

  const db = getDb()

  // Rate limit BEFORE any lookup, so a refused caller learns nothing at all.
  if (!(await consumePublicRateLimit(db, req, INTAKE_LOOKUP_LIMITS))) {
    return res.status(429).json({ error: 'rate_limited', message: TOO_MANY_REQUESTS })
  }

  const cohortResult = await resolveAcceptingCohort(db)
  if (cohortResult.failure) return res.status(CANNOT_START.status).json(CANNOT_START.body)

  const studentResult = await resolveStudentByEmail(db, cohortResult.cohortId, schoolEmail, 'id, cohort_id, last_name')
  if (studentResult.failure) return res.status(CANNOT_START.status).json(CANNOT_START.body)

  // The surname must match the record the email resolved to. Compared with the
  // same forgiving normalization the email uses (case, whitespace, zero-width),
  // so a real applicant is never rejected over capitalisation.
  const storedLast = normalizeForMatch(studentResult.student.last_name || '')
  if (!storedLast || storedLast !== normalizeForMatch(lastName)) {
    return res.status(CANNOT_START.status).json(CANNOT_START.body)
  }

  // WAVE F-2 made student_id and cohort_id vestigial: the signed-upload endpoint
  // re-resolves the student server-side and constructs the object path itself, so
  // StudentIntakeFormPage reads only `ok` and discards this body. They are no
  // longer returned. Nothing consumes them, and an anonymous caller has no reason
  // to hold a student's primary key.
  return res.status(200).json({ verified: true })
}
