// api/student-intake-file-sign.js
//
// WAVE F-2 (Pass 1): server-mediated signed upload for the PUBLIC /student-form
// intake. Replaces the client's direct anonymous storage upload. The browser
// receives only a one-path upload token; it cannot supply a student id, cohort
// id, or object path as authority.
//
// Trust model: identical to student-intake-lookup / student-intake-submit. The
// applicant proves nothing beyond a school email that resolves to EXACTLY ONE
// student in the SINGLE accepting cohort (the same resolution the submit uses).
// No new access is granted. The server resolves the ids and constructs the path.
//
// This endpoint does NOT change the bucket or any policy and does NOT write the
// database. The client uploads via uploadToSignedUrl, derives the (still public)
// URL, and passes it to student-intake-submit exactly as before.

import { createClient } from '@supabase/supabase-js'
import { resolveAcceptingCohort, resolveStudentByEmail } from './lib/intakeStudentLookup.js'
import { STUDENT_FILES_BUCKET, validateFileMeta, canonicalPath } from '../lib/server/studentFiles.js'

function getServiceDb() {
  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  res.setHeader('Cache-Control', 'no-store')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })

  const db = getServiceDb()
  if (!db) return res.status(500).json({ error: 'internal_error' })

  const body = (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) ? req.body : {}
  const schoolEmail = typeof body.school_email === 'string' ? body.school_email.trim() : ''
  if (!schoolEmail || !schoolEmail.includes('@') || !schoolEmail.includes('.')) {
    return res.status(400).json({ error: 'invalid_request', field: 'school_email' })
  }

  const kind = body.kind === 'resume' || body.kind === 'headshot' ? body.kind : null
  if (!kind) return res.status(400).json({ error: 'invalid_kind' })

  // Validate declared file metadata BEFORE resolving the student, so a bad file
  // never triggers a lookup.
  const meta = validateFileMeta({ kind, filename: body.filename, contentType: body.content_type, size: body.size })
  if (!meta.ok) return res.status(422).json({ error: meta.error })

  // Same exactly-one-cohort / exactly-one-student resolution as the submit.
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

  const cohortId = studentResult.student.cohort_id
  const studentId = studentResult.student.id
  const cp = canonicalPath(cohortId, studentId, kind, meta.ext)
  if (!cp.ok) return res.status(500).json({ error: 'internal_error' })

  // upsert:true preserves the current re-submit-overwrites behavior on the fixed
  // path. The token authorizes exactly this one path; the browser cannot widen it.
  const { data: signed, error: signErr } = await db.storage
    .from(STUDENT_FILES_BUCKET).createSignedUploadUrl(cp.path, { upsert: true })
  if (signErr || !signed?.token) return res.status(502).json({ error: 'upload_unavailable' })

  return res.status(200).json({ token: signed.token, path: signed.path || cp.path })
}
