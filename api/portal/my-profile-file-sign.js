/* global process */
// api/portal/my-profile-file-sign.js
//
// STUDENT-PORTAL-PROFILE-1 (Owner refinement): server-mediated signed upload for the
// AUTHENTICATED portal first submission. The public /student-form keeps its own sign
// endpoint (student-intake-file-sign, email-bound within the accepting cohort); this
// one authorizes by the portal identity chain instead - verified JWT -> active
// 'student' grant -> active user_student_links - so a linked student can complete
// their profile even when public intake acceptance is closed.
//
// Same storage mechanics as the public signer: metadata validated first, the server
// constructs the canonical path, and the returned token authorizes exactly that one
// path (the browser can never choose a path). No database writes here.

import { verifyPortalCaller, getServiceDb, hasActiveRoleGrant, getActiveStudentLinks } from '../lib/portalAuth.js'
import { STUDENT_FILES_BUCKET, validateFileMeta, canonicalPath } from '../../lib/server/studentFiles.js'

const str = (v) => (typeof v === 'string' ? v.trim() : '')

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  res.setHeader('Cache-Control', 'no-store')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY || !(process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL)) {
    return res.status(500).json({ error: 'internal_error' })
  }

  const auth = await verifyPortalCaller(req)
  if (!auth.authenticated) {
    const status = auth.status === 403 ? 403 : 401
    return res.status(status).json({ error: status === 403 ? 'forbidden' : 'unauthorized' })
  }

  const db = getServiceDb()
  const isStudent = await hasActiveRoleGrant(db, auth.profile.id, 'student')
  if (!isStudent) return res.status(403).json({ error: 'forbidden' })
  const studentIds = await getActiveStudentLinks(db, auth.profile.id)
  if (studentIds.length === 0) return res.status(403).json({ error: 'forbidden' })

  const body = (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) ? req.body : {}

  // Target resolution mirrors my-profile: own linked record only.
  let targetId = str(body.student_id)
  if (targetId) {
    if (!studentIds.includes(targetId)) return res.status(403).json({ error: 'forbidden' })
  } else if (studentIds.length === 1) {
    targetId = studentIds[0]
  } else {
    return res.status(400).json({ error: 'invalid_request', field: 'student_id' })
  }

  const kind = body.kind === 'resume' || body.kind === 'headshot' ? body.kind : null
  if (!kind) return res.status(400).json({ error: 'invalid_kind' })

  const meta = validateFileMeta({ kind, filename: body.filename, contentType: body.content_type, size: body.size })
  if (!meta.ok) return res.status(422).json({ error: meta.error })

  // Uploads exist only for the FIRST submission; after it, document replacement is
  // staff-mediated (Owner decision), so a submitted or locked profile signs nothing.
  const { data: student, error: sErr } = await db
    .from('students').select('id, cohort_id, submitted_via').eq('id', targetId).maybeSingle()
  if (sErr) return res.status(500).json({ error: 'internal_error' })
  if (!student) return res.status(404).json({ error: 'not_found' })
  if (student.submitted_via === 'student_form') {
    return res.status(409).json({ error: 'already_submitted', message: 'Document changes are handled by the ASPIRE team after submission.' })
  }
  if (!student.cohort_id) return res.status(409).json({ error: 'no_cohort' })

  const cp = canonicalPath(student.cohort_id, student.id, kind, meta.ext)
  if (!cp.ok) return res.status(500).json({ error: 'internal_error' })

  const { data: signed, error: signErr } = await db.storage
    .from(STUDENT_FILES_BUCKET).createSignedUploadUrl(cp.path, { upsert: true })
  if (signErr || !signed?.token) return res.status(502).json({ error: 'upload_unavailable' })

  return res.status(200).json({ token: signed.token, path: signed.path || cp.path })
}
