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
//   - Returns ONLY opaque identifiers ({ student_id, cohort_id }); never any
//     student field. The client needs the IDs solely to build the resume and
//     headshot upload paths before calling student-intake-submit.
//   - Error semantics mirror student-intake-submit so the form shows the same
//     messages at lookup time as it would at submit time.

import { createClient } from '@supabase/supabase-js'
import { resolveAcceptingCohort, resolveStudentByEmail } from './lib/intakeStudentLookup.js'

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
  if (!schoolEmail || !schoolEmail.includes('@') || !schoolEmail.includes('.')) {
    return res.status(400).json({ error: 'invalid_request', field: 'school_email', message: 'A valid school email is required.' })
  }

  const db = getDb()

  const cohortResult = await resolveAcceptingCohort(db)
  if (cohortResult.failure) {
    const { status, ...rest } = cohortResult.failure
    return res.status(status).json(rest)
  }

  const studentResult = await resolveStudentByEmail(db, cohortResult.cohortId, schoolEmail, 'id, cohort_id')
  if (studentResult.failure) {
    const { status, ...rest } = studentResult.failure
    return res.status(status).json(rest)
  }

  return res.status(200).json({
    found: true,
    student_id: studentResult.student.id,
    cohort_id: studentResult.student.cohort_id,
  })
}
