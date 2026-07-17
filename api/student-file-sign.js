// api/student-file-sign.js
//
// WAVE F-2 (Pass 1): server-mediated signed upload for AUTHENTICATED staff
// (Owner/Admin only, per the approved access matrix). Replaces the direct
// client storage upload in StudentSidePanel and StudentRow.
//
// The browser sends only { student_id, kind, filename, content_type, size } plus
// its bearer JWT. The server verifies Owner/Admin, resolves the student's cohort
// id server-side (never trusting a client-supplied cohort id or path), validates
// the file, constructs the one canonical path, and mints a one-path upload token.
//
// Owner/Admin is stricter than the storage layer would be: Viewer and Interviewer
// cannot upload. No bucket or policy change; no database write here (the caller
// persists the reference through the existing student update path).

import supabaseAdmin from '../lib/server/evaluation/supabase_admin.js'
import { verifyStaffCaller } from './lib/messagesAuth.js'
import { STUDENT_FILES_BUCKET, isUuid, validateFileMeta, canonicalPath } from '../lib/server/studentFiles.js'

const UPLOAD_ROLES = ['owner', 'admin']

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })

  const caller = await verifyStaffCaller(req)
  if (!caller.ok) return res.status(caller.status).json({ error: caller.reason })
  const role = String(caller.profile.role || '').toLowerCase()
  if (!UPLOAD_ROLES.includes(role)) return res.status(403).json({ error: 'forbidden' })

  const body = (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) ? req.body : {}
  const studentId = typeof body.student_id === 'string' ? body.student_id : ''
  if (!isUuid(studentId)) return res.status(422).json({ error: 'invalid_student_id' })

  const kind = body.kind === 'resume' || body.kind === 'headshot' ? body.kind : null
  if (!kind) return res.status(400).json({ error: 'invalid_kind' })

  const meta = validateFileMeta({ kind, filename: body.filename, contentType: body.content_type, size: body.size })
  if (!meta.ok) return res.status(422).json({ error: meta.error })

  // Resolve the cohort server-side; the client never supplies the path.
  const { data: student, error: sErr } = await supabaseAdmin
    .from('students').select('id, cohort_id').eq('id', studentId).maybeSingle()
  if (sErr) return res.status(500).json({ error: 'internal_error' })
  if (!student || !isUuid(student.cohort_id)) return res.status(404).json({ error: 'not_found' })

  const cp = canonicalPath(student.cohort_id, student.id, kind, meta.ext)
  if (!cp.ok) return res.status(500).json({ error: 'internal_error' })

  const { data: signed, error: signErr } = await supabaseAdmin.storage
    .from(STUDENT_FILES_BUCKET).createSignedUploadUrl(cp.path, { upsert: true })
  if (signErr || !signed?.token) return res.status(502).json({ error: 'upload_unavailable' })

  return res.status(200).json({ token: signed.token, path: signed.path || cp.path })
}
