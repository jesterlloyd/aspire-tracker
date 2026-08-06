// api/student-file-access.js
//
// WAVE F-2: the server-mediated read path for student resumes and headshots. THIS
// ENDPOINT is the authorization boundary, not a storage policy. It authorizes the
// caller per the approved access matrix, resolves the stored reference (legacy
// public URL OR canonical path) to an object path, and returns a SHORT-LIVED
// signed URL. Signed URLs work on the current public bucket and, unchanged, after
// the Pass 3 privatization, so the frontend never changes again.
//
// Access matrix (server-mediated; no broad is_staff storage policy):
//   Owner / Admin : resume AND headshot, any student
//   Viewer        : headshot only, for the students a Viewer already sees (Viewers
//                   are global read-only staff, so this is their visible set; no
//                   resume, no cohort-wide expansion beyond photos).
//   Interviewer   : resume AND headshot, but ONLY for students in a cohort for
//                   which the interviewer holds an ACTIVE entitlement
//                   (interviewer_cohort_entitlements, keyed on user_profiles.id).
//                   No entitlement -> null url (never an error, no existence leak).
//   anything else : no access (403)
// Inactive callers are rejected by verifyPortalCaller before authorization runs, so
// a deactivated Viewer or interviewer is denied immediately.
//
// Single mode:  { student_id, kind }              -> { signed_url }
// Batch mode:   { items: [{ student_id, kind }] } -> { results: [{ student_id, kind, signed_url }] }
// A missing/empty/unauthorized reference yields signed_url: null (not an error), so
// a list of students simply renders placeholders. Paths and bucket names are never
// returned in errors.

import supabaseAdmin from '../lib/server/evaluation/supabase_admin.js'
import { verifyPortalCaller } from './lib/portalAuth.js'
import { activeEntitledCohortIds } from '../lib/server/interviewerEntitlements.js'
import { STUDENT_FILES_BUCKET, isUuid, parseStoredFileRef } from '../lib/server/studentFiles.js'
import { normalizeStaffRole } from '../src/lib/permissions.js'

const SIGNED_URL_TTL_SECONDS = 300
const MAX_BATCH = 100
const FILE_KINDS = new Set(['resume', 'headshot'])
const COLUMN = { resume: 'resume_url', headshot: 'headshot_url' }

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })

  // Active caller (verifyPortalCaller rejects inactive/deactivated accounts).
  const caller = await verifyPortalCaller(req)
  if (!caller.authenticated) {
    return res.status(caller.status || 401).json({ error: caller.reason || 'unauthenticated' })
  }
  // co_lead and co-lead are the same persisted role; normalize before deciding.
  const role = normalizeStaffRole(String(caller.profile.role || '').toLowerCase())
  // APPROVED 2026-08-05: a Co-Lead is near-Owner for student-ACCESS operations and
  // reads student files across ALL cohorts, with no entitlement requirement. This
  // is read access only - upload, replace, delete and badge generation remain
  // Owner/Admin (see api/student-file-sign.js and api/student-file-cleanup.js,
  // both unchanged). Owner-only governance is untouched.
  const isUnrestricted = role === 'owner' || role === 'admin' || role === 'co-lead'
  const isViewer = role === 'viewer'
  const isInterviewer = role === 'interviewer'
  // Only these staff roles use this endpoint; everything else is denied.
  if (!isUnrestricted && !isViewer && !isInterviewer) {
    return res.status(403).json({ error: 'staff_role_required' })
  }

  // Kinds allowed by role: Owner/Admin/Co-Lead both; Viewer headshot only;
  // interviewer both (cohort-gated below). A disallowed kind yields a null url,
  // never an error.
  const roleKinds = isUnrestricted
    ? FILE_KINDS
    : isViewer
      ? new Set(['headshot'])
      : new Set(['resume', 'headshot'])

  // Interviewer: resolve the cohorts they are entitled to (identity-based, active
  // only). Fail closed on a lookup error. Owner/Admin/Co-Lead and Viewer have no
  // cohort restriction beyond the students they already see.
  let entitledCohorts = null // null = unrestricted (owner/admin, viewer)
  if (isInterviewer) {
    try {
      entitledCohorts = await activeEntitledCohortIds(supabaseAdmin, caller.profile.id)
    } catch {
      return res.status(500).json({ error: 'internal_error' })
    }
  }

  const body = (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) ? req.body : {}
  const batch = Array.isArray(body.items)
  const items = batch ? body.items : [{ student_id: body.student_id, kind: body.kind }]

  if (!items.length) return res.status(400).json({ error: 'no_items' })
  if (items.length > MAX_BATCH) return res.status(413).json({ error: 'too_many_items' })

  // Normalize; a valid item is a uuid student id + a known file kind. Cohort-level
  // authorization for interviewers is applied after the student rows are fetched.
  const normalized = items.map((it) => {
    const student_id = typeof it?.student_id === 'string' ? it.student_id : ''
    const kind = FILE_KINDS.has(it?.kind) ? it.kind : null
    return { student_id, kind, valid: kind !== null && isUuid(student_id) }
  })

  // Fetch id, cohort_id, and the stored references for the valid ids in one query.
  const ids = [...new Set(normalized.filter((n) => n.valid).map((n) => n.student_id))]
  const byId = new Map()
  if (ids.length) {
    const { data, error } = await supabaseAdmin
      .from('students').select('id, cohort_id, resume_url, headshot_url').in('id', ids)
    if (error) return res.status(500).json({ error: 'internal_error' })
    for (const row of data || []) byId.set(row.id, row)
  }

  // Resolve each authorized item to an object path.
  const toSign = [] // { index, path }
  const results = normalized.map((n, index) => {
    const nullResult = { student_id: n.student_id, kind: n.kind, signed_url: null }
    if (!n.valid) return nullResult
    const row = byId.get(n.student_id)
    if (!row) return nullResult
    // Kind must be allowed for the role (Viewer -> headshot only, no resume).
    if (!roleKinds.has(n.kind)) return nullResult
    // Owner/Admin and Viewer: any student they see. Interviewer: entitled cohorts.
    const cohortOk = isUnrestricted || isViewer || entitledCohorts.has(row.cohort_id)
    if (!cohortOk) return nullResult
    const ref = parseStoredFileRef(row[COLUMN[n.kind]])
    if (ref.kind === 'empty' || ref.kind === 'unknown') return nullResult
    toSign.push({ index, path: ref.path })
    return nullResult
  })

  // Mint short-lived signed URLs in one call, then map them back by index.
  if (toSign.length) {
    const { data: signedList, error: signErr } = await supabaseAdmin.storage
      .from(STUDENT_FILES_BUCKET)
      .createSignedUrls(toSign.map((t) => t.path), SIGNED_URL_TTL_SECONDS)
    if (signErr) return res.status(502).json({ error: 'access_unavailable' })
    toSign.forEach((t, i) => {
      const signed = signedList?.[i]
      if (signed && !signed.error && signed.signedUrl) results[t.index].signed_url = signed.signedUrl
    })
  }

  if (batch) return res.status(200).json({ results })
  return res.status(200).json({ signed_url: results[0]?.signed_url ?? null })
}
