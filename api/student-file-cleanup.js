// api/student-file-cleanup.js
//
// WAVE F-2 (Pass 1): server-mediated cleanup of student storage objects,
// Owner/Admin only, service-role. Two actions:
//
//   'replace'        after a staff re-upload, remove sibling objects for the same
//                    kind whose extension differs from the one just stored (e.g.
//                    delete resume.pdf when resume.docx replaced it). Prevents the
//                    extension-change orphan the current flow leaves behind.
//   'delete_student' when a student is deleted, remove every object under the
//                    student's folder so files do not outlive the record.
//
// The cohort id is resolved server-side from the still-present student row; the
// client never supplies a path. Cleanup is best-effort and never deletes outside
// the one student's folder (uuid-validated prefix).

import supabaseAdmin from '../lib/server/evaluation/supabase_admin.js'
import { verifyStaffCaller } from './lib/messagesAuth.js'
import {
  STUDENT_FILES_BUCKET, FILE_KINDS, isUuid, studentFolderPrefix,
} from '../lib/server/studentFiles.js'

const CLEANUP_ROLES = ['owner', 'admin']

async function listFolder(prefix) {
  const { data, error } = await supabaseAdmin.storage
    .from(STUDENT_FILES_BUCKET).list(prefix, { limit: 100 })
  if (error) return { error }
  return { names: (data || []).map((o) => o.name).filter(Boolean) }
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })

  const caller = await verifyStaffCaller(req)
  if (!caller.ok) return res.status(caller.status).json({ error: caller.reason })
  if (!CLEANUP_ROLES.includes(String(caller.profile.role || '').toLowerCase())) {
    return res.status(403).json({ error: 'forbidden' })
  }

  const body = (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) ? req.body : {}
  const studentId = typeof body.student_id === 'string' ? body.student_id : ''
  if (!isUuid(studentId)) return res.status(422).json({ error: 'invalid_student_id' })
  const action = body.action === 'replace' || body.action === 'delete_student' ? body.action : null
  if (!action) return res.status(400).json({ error: 'invalid_action' })

  // Resolve the cohort server-side from the student row (still present here).
  const { data: student, error: sErr } = await supabaseAdmin
    .from('students').select('id, cohort_id').eq('id', studentId).maybeSingle()
  if (sErr) return res.status(500).json({ error: 'internal_error' })
  if (!student || !isUuid(student.cohort_id)) return res.status(404).json({ error: 'not_found' })

  const fp = studentFolderPrefix(student.cohort_id, student.id)
  if (!fp.ok) return res.status(500).json({ error: 'internal_error' })

  const listed = await listFolder(fp.prefix)
  if (listed.error) return res.status(502).json({ error: 'cleanup_unavailable' })
  if (!listed.names.length) return res.status(200).json({ removed: 0 })

  let toRemove
  if (action === 'delete_student') {
    toRemove = listed.names
  } else {
    // replace: keep only kind.<keep_ext>; remove other extensions of that kind.
    const kind = body.kind === 'resume' || body.kind === 'headshot' ? body.kind : null
    const keepExt = typeof body.keep_ext === 'string' && /^[a-z0-9]+$/.test(body.keep_ext) ? body.keep_ext : null
    if (!kind || !FILE_KINDS.includes(kind) || !keepExt) return res.status(400).json({ error: 'invalid_request' })
    const keepName = `${kind}.${keepExt}`
    toRemove = listed.names.filter((name) => name.startsWith(`${kind}.`) && name !== keepName)
  }

  if (!toRemove.length) return res.status(200).json({ removed: 0 })
  const paths = toRemove.map((name) => `${fp.prefix}/${name}`)
  const { error: rmErr } = await supabaseAdmin.storage.from(STUDENT_FILES_BUCKET).remove(paths)
  if (rmErr) return res.status(502).json({ error: 'cleanup_unavailable' })

  return res.status(200).json({ removed: paths.length })
}
