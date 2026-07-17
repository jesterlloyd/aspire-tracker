// api/student-file-access.js
//
// WAVE F-2 (Pass 1): the server-mediated read path for student resumes and
// headshots. THIS ENDPOINT is the authorization boundary, not a storage policy.
// It authorizes the caller per the approved access matrix, resolves the stored
// reference (legacy public URL OR canonical path) to an object path, and returns
// a SHORT-LIVED signed URL. Signed URLs work on the current public bucket and,
// unchanged, after the Pass 3 privatization, so the frontend never changes again.
//
// Access matrix (server-mediated; no broad is_staff storage policy):
//   Owner / Admin : resume AND headshot, any student
//   Viewer        : headshot only (current cohort-wide Viewer visibility); no resume
//   Interviewer   : no access
//   anything else : no access
// Inactive and non-staff callers are rejected by verifyStaffCaller.
//
// Single mode:  { student_id, kind }            -> { signed_url }
// Batch mode:   { items: [{ student_id, kind }] } -> { results: [{ student_id, kind, signed_url }] }
// A missing/empty/unauthorized reference yields signed_url: null (not an error),
// so a list of students simply renders placeholders. Paths and bucket names are
// never returned in errors.

import supabaseAdmin from '../lib/server/evaluation/supabase_admin.js'
import { verifyStaffCaller } from './lib/messagesAuth.js'
import { STUDENT_FILES_BUCKET, isUuid, parseStoredFileRef } from '../lib/server/studentFiles.js'

const SIGNED_URL_TTL_SECONDS = 300
const MAX_BATCH = 100

// Which kinds a staff role may read. Default-deny: a role not listed here
// (including co_lead, which is not an approved file-access role) gets nothing.
function allowedKinds(role) {
  const r = String(role || '').toLowerCase()
  if (r === 'owner' || r === 'admin') return new Set(['resume', 'headshot'])
  if (r === 'viewer') return new Set(['headshot'])
  return new Set() // interviewer and everything else: none
}

const COLUMN = { resume: 'resume_url', headshot: 'headshot_url' }

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })

  const caller = await verifyStaffCaller(req)
  if (!caller.ok) return res.status(caller.status).json({ error: caller.reason })
  const kinds = allowedKinds(caller.profile.role)

  const body = (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) ? req.body : {}
  const batch = Array.isArray(body.items)
  const items = batch
    ? body.items
    : [{ student_id: body.student_id, kind: body.kind }]

  if (!items.length) return res.status(400).json({ error: 'no_items' })
  if (items.length > MAX_BATCH) return res.status(413).json({ error: 'too_many_items' })

  // Normalize + authorize each item. Unauthorized or malformed items resolve to
  // a null url rather than failing the whole request.
  const normalized = items.map((it) => {
    const student_id = typeof it?.student_id === 'string' ? it.student_id : ''
    const kind = it?.kind === 'resume' || it?.kind === 'headshot' ? it.kind : null
    const authorized = kind !== null && isUuid(student_id) && kinds.has(kind)
    return { student_id, kind, authorized }
  })

  // Fetch the stored references only for authorized items, in one query.
  const ids = [...new Set(normalized.filter((n) => n.authorized).map((n) => n.student_id))]
  const byId = new Map()
  if (ids.length) {
    const { data, error } = await supabaseAdmin
      .from('students').select('id, resume_url, headshot_url').in('id', ids)
    if (error) return res.status(500).json({ error: 'internal_error' })
    for (const row of data || []) byId.set(row.id, row)
  }

  // Resolve each authorized item to an object path.
  const toSign = [] // { index, path }
  const results = normalized.map((n, index) => {
    if (!n.authorized) return { student_id: n.student_id, kind: n.kind, signed_url: null }
    const row = byId.get(n.student_id)
    const stored = row ? row[COLUMN[n.kind]] : null
    const ref = parseStoredFileRef(stored)
    if (ref.kind === 'empty' || ref.kind === 'unknown') {
      return { student_id: n.student_id, kind: n.kind, signed_url: null }
    }
    toSign.push({ index, path: ref.path })
    return { student_id: n.student_id, kind: n.kind, signed_url: null }
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
