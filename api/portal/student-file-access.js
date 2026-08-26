// api/portal/student-file-access.js
//
// WAVE F-2 (Pass 1): the Student Portal reads its OWN headshot through here, so
// the portal keeps working after the Pass 2 backfill converts stored values to
// object paths and after the Pass 3 privatization. Own headshot only; no resume;
// no other student.
//
// The linked student is resolved server-side from the caller's active student
// link (verifyPortalStudentCaller). The request carries no student id, path, or
// kind other than the implicit own-headshot. Returns a short-lived signed URL.

import supabaseAdmin from '../../lib/server/evaluation/supabase_admin.js'
import { verifyPortalStudentCaller } from '../lib/messagesAuth.js'
import { STUDENT_FILES_BUCKET, parseStoredFileRef, refBelongsToStudent, signedUrlTtlSeconds } from '../../lib/server/studentFiles.js'

// STUDENT-PHOTO-PERF-1: headshots share the long per-kind lifetime so the
// student's own photo stays browser-cacheable across the portal session.
const SIGNED_URL_TTL_SECONDS = signedUrlTtlSeconds('headshot')

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' })
  }

  const caller = await verifyPortalStudentCaller(req)
  if (!caller.ok) return res.status(caller.status).json({ error: caller.reason })

  // Version one links exactly one active student; use the first resolved link.
  const studentId = caller.studentIds[0]

  const { data: student, error } = await supabaseAdmin
    .from('students').select('id, headshot_url').eq('id', studentId).maybeSingle()
  if (error) return res.status(500).json({ error: 'internal_error' })

  const ref = parseStoredFileRef(student?.headshot_url)
  if (ref.kind === 'empty' || ref.kind === 'unknown') {
    return res.status(200).json({ signed_url: null })
  }
  // S-03 read-side binding: a stored value naming another student is never signed.
  if (!refBelongsToStudent(ref.path, student.id)) {
    return res.status(200).json({ signed_url: null })
  }

  const { data: signed, error: signErr } = await supabaseAdmin.storage
    .from(STUDENT_FILES_BUCKET).createSignedUrl(ref.path, SIGNED_URL_TTL_SECONDS)
  if (signErr || !signed?.signedUrl) return res.status(200).json({ signed_url: null })

  return res.status(200).json({ signed_url: signed.signedUrl })
}
