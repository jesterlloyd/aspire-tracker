// api/portal/school-student-file-access.js
//
// AP-PORTAL: Academic Partner access to a scoped student's approved profile photo, through the
// Wave F-2 server-mediated architecture. Modeled on api/portal/unit-student-file-access.js.
//
// This is a SEPARATE endpoint from the Unit Leader and the role-string file endpoints on purpose.
// An Academic Partner is not a user_profiles.role and is not a unit scope: it is a user_role_grants
// row plus user_school_scopes. Authorization here reuses EXACTLY the roster's school-scope resolver
// (api/lib/schoolScope.js), so a partner can sign a photo only for a student who appears on their
// own roster. The requested student's school is NEVER accepted as an authorization input; the
// authorized set is derived server-side from the caller's active scopes and the request is only ever
// intersected with it.
//
// Wave F-2 invariants, all preserved:
//   - the browser NEVER supplies an object path; the path is derived server side from the student
//     record through parseStoredFileRef
//   - no public URL is ever returned or constructed
//   - no signed URL is persisted anywhere
//   - reads run as service_role against the PRIVATE bucket
//   - unauthorized returns signed_url: null, never an error, so the endpoint does not leak whether a
//     student or a file exists (cross-school, revoked, expired, and nonexistent are indistinguishable)
//
// Academic Partners are READ ONLY, and ONLY the approved profile photo (headshot) is reachable. There
// is no resume, no onboarding document, and no upload, replace, rename, or delete path here.

import supabaseAdmin from '../../lib/server/evaluation/supabase_admin.js'
import { STUDENT_FILES_BUCKET, parseStoredFileRef } from '../../lib/server/studentFiles.js'
import {
  verifyPortalAcademicPartnerCaller,
  resolveSchoolScopedStudents,
} from '../lib/schoolScope.js'

const SIGNED_URL_TTL_SECONDS = 300
// The only kind an Academic Partner may ever request. Resumes and onboarding documents are absent
// by construction, so a request for anything else is a safe null, never a wider read.
const ALLOWED_KINDS = new Set(['headshot'])
const MAX_BATCH = 100
// School matching needs school + cohort_id; the photo needs headshot_url; nothing else is read.
const FILE_COLUMNS = 'id, cohort_id, school, headshot_url'

const nullResult = (studentId, kind) => ({ student_id: studentId, kind, signed_url: null })

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })

  const auth = await verifyPortalAcademicPartnerCaller(req)
  if (!auth.ok) return res.status(auth.status).json({ error: auth.reason })

  const { db, scopes } = auth

  // Accept a single { student_id, kind } or a bounded batch of them.
  const body = req.body && typeof req.body === 'object' ? req.body : {}
  const requested = Array.isArray(body.items)
    ? body.items
    : [{ student_id: body.student_id, kind: body.kind }]

  if (requested.length === 0) return res.status(200).json({ results: [] })
  if (requested.length > MAX_BATCH) return res.status(400).json({ error: 'too_many_items' })

  // Resolve the authorized set ONCE. Every requested student is checked against it, so an
  // out-of-scope (cross-school, revoked, expired) student is indistinguishable from a missing one.
  let authorized
  try {
    authorized = await resolveAuthorizedMap(db, scopes, requested)
  } catch {
    return res.status(500).json({ error: 'internal_error' })
  }

  const results = []
  for (const item of requested) {
    const studentId = typeof item?.student_id === 'string' ? item.student_id : null
    const kind = typeof item?.kind === 'string' ? item.kind.toLowerCase() : null

    if (!studentId || !kind || !ALLOWED_KINDS.has(kind)) {
      results.push(nullResult(studentId, kind))
      continue
    }

    const student = authorized.get(studentId)
    if (!student) {
      // Outside the caller's authorized schools, or nonexistent.
      results.push(nullResult(studentId, kind))
      continue
    }

    // The stored reference is the ONLY source of the object path; the browser never supplies it.
    const ref = parseStoredFileRef(student.headshot_url)
    if (ref.kind === 'empty' || ref.kind === 'unknown') {
      results.push(nullResult(studentId, kind))
      continue
    }

    const { data: signed, error: signErr } = await supabaseAdmin.storage
      .from(STUDENT_FILES_BUCKET)
      .createSignedUrl(ref.path, SIGNED_URL_TTL_SECONDS)

    if (signErr || !signed?.signedUrl) {
      results.push(nullResult(studentId, kind))
      continue
    }
    results.push({ student_id: studentId, kind, signed_url: signed.signedUrl })
  }

  // Single-item requests get the flat shape the photo hook already expects.
  if (!Array.isArray(body.items)) {
    return res.status(200).json({ signed_url: results[0]?.signed_url ?? null })
  }
  return res.status(200).json({ results })
}

/**
 * Map of student_id -> authorized student row, for the requested ids only. Built from the same
 * school-scope resolver the roster uses, so the security property is identical: a photo is signable
 * only for a student on the caller's roster. Resolved ONCE and intersected with the request rather
 * than authorizing each id separately, so a 100-item batch runs one scope query, not 100.
 */
async function resolveAuthorizedMap(db, scopes, requested) {
  const wanted = new Set(
    requested.map(i => (typeof i?.student_id === 'string' ? i.student_id : null)).filter(Boolean))
  if (wanted.size === 0) return new Map()

  const { matches } = await resolveSchoolScopedStudents(db, scopes, FILE_COLUMNS)
  const map = new Map()
  for (const { student } of matches) {
    if (wanted.has(student.id)) map.set(student.id, student)
  }
  return map
}
