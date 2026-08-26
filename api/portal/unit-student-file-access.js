// api/portal/unit-student-file-access.js
//
// UL-PORTAL: Unit Leader access to a scoped student's photo and resume, through the
// Wave F-2 server-mediated architecture.
//
// This is a SEPARATE endpoint from api/student-file-access.js on purpose. That one
// authorizes from the flat user_profiles.role string (owner / admin / viewer /
// interviewer). A Unit Leader is not a user_profiles.role at all: it is a
// user_role_grants row plus user_unit_scopes. Mixing a grant-based scope model into
// a role-string endpoint is where this kind of matrix goes wrong, because the two
// have different failure modes and a later edit can widen one while reasoning about
// the other. Each endpoint keeps exactly one coherent authorization model.
//
// Wave F-2 invariants, all preserved:
//   - the browser NEVER supplies an object path; the path is derived server side
//     from the student record through parseStoredFileRef
//   - no public URL is ever returned or constructed
//   - no signed URL is persisted anywhere
//   - reads run as service_role against the PRIVATE bucket
//   - unauthorized returns signed_url: null, never an error, so the endpoint does
//     not leak whether a student or a file exists
//
// Unit Leaders are READ ONLY: view and download a photo and a resume. There is no
// upload, replace, rename, or delete path here, and onboarding documents are never
// reachable through this endpoint.

import supabaseAdmin from '../../lib/server/evaluation/supabase_admin.js'
import { STUDENT_FILES_BUCKET, parseStoredFileRef, refBelongsToStudent, signedUrlTtlSeconds } from '../../lib/server/studentFiles.js'
import {
  verifyPortalUnitLeaderCaller,
  resolveUnitScopedStudents,
} from '../lib/unitLeaderScope.js'

// STUDENT-PHOTO-PERF-1: lifetimes are per kind (headshots long for
// cacheability, resumes short), resolved at the signing call below.
// The only kinds a Unit Leader may ever request. Onboarding documents and
// certificates are absent by construction.
const ALLOWED_KINDS = new Set(['headshot', 'resume'])
const MAX_BATCH = 100

const nullResult = (studentId, kind) => ({ student_id: studentId, kind, signed_url: null })

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })

  const auth = await verifyPortalUnitLeaderCaller(req)
  if (!auth.ok) return res.status(auth.status).json({ error: auth.reason })

  const { db, scopes } = auth

  // Accept a single { student_id, kind } or a bounded batch of them.
  const body = req.body && typeof req.body === 'object' ? req.body : {}
  const requested = Array.isArray(body.items)
    ? body.items
    : [{ student_id: body.student_id, kind: body.kind }]

  if (requested.length === 0) return res.status(200).json({ results: [] })
  if (requested.length > MAX_BATCH) return res.status(400).json({ error: 'too_many_items' })

  // Resolve the authorized set ONCE. Every requested student is checked against it,
  // so an out-of-scope student is indistinguishable from a missing one.
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
      // Not in an assigned unit, outside the visible lifecycle, or nonexistent.
      results.push(nullResult(studentId, kind))
      continue
    }

    // The stored reference is the ONLY source of the object path. Pass 2 made these
    // canonical; the resolver still accepts a legacy URL and yields the same path.
    const stored = kind === 'resume' ? student.resume_url : student.headshot_url
    const ref = parseStoredFileRef(stored)
    if (ref.kind === 'empty' || ref.kind === 'unknown') {
      results.push(nullResult(studentId, kind))
      continue
    }
    // S-03 read-side binding: never sign a path that names a different student.
    if (!refBelongsToStudent(ref.path, studentId)) {
      results.push(nullResult(studentId, kind))
      continue
    }

    const { data: signed, error: signErr } = await supabaseAdmin.storage
      .from(STUDENT_FILES_BUCKET)
      .createSignedUrl(ref.path, signedUrlTtlSeconds(kind))

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
 * Map of student_id -> authorized student row, for the requested ids only.
 * Built from the single source of truth, so scope, cohort rules, and the 90-day
 * completed window all apply.
 *
 * The authorized set is resolved ONCE and then intersected with the request, rather
 * than authorizing each id separately: a 100-item batch would otherwise run 100 full
 * scope queries. The security property is identical because both paths derive from
 * resolveUnitScopedStudents; only the number of round trips differs.
 */
async function resolveAuthorizedMap(db, scopes, requested) {
  const wanted = new Set(
    requested.map(i => (typeof i?.student_id === 'string' ? i.student_id : null)).filter(Boolean))
  if (wanted.size === 0) return new Map()

  const { students } = await resolveUnitScopedStudents(db, scopes)
  const map = new Map()
  for (const s of students) {
    if (wanted.has(s.id)) map.set(s.id, s)
  }
  return map
}
