// api/portal/update-profile.js
//
// ASPIRE-STUDENT-PORTAL: narrow, authenticated self-service profile update for a
// portal STUDENT. Authorization mirrors student-summary.js: verified JWT ->
// user_profiles row -> ACTIVE 'student' role grant -> ACTIVE user_student_links.
// A student may update ONLY their own linked student record, and ONLY the
// non-authoritative presentation/communication fields in EDITABLE_FIELDS.
//
// Everything else (legal name, school, cohort, status, unit, preceptor, rotation
// dates, hours, student_id, role, grants, links) is NOT accepted here and stays
// coordinator/admin-owned. The allowlist is enforced server-side; the browser is
// never trusted. No service-role credential reaches the client.

import { verifyPortalCaller, getServiceDb, hasActiveRoleGrant, getActiveStudentLinks } from '../lib/portalAuth.js'

// The ONLY columns a student may self-edit. Authoritative fields are absent by
// design.
const EDITABLE_FIELDS = ['preferred_first_name', 'phone']

const str = (v) => (typeof v === 'string' ? v.trim() : '')

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
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

  // Resolve the target student. With a single active link, default to it; if the
  // student has multiple, require an explicit student_id that is one of theirs.
  let targetId = str(body.student_id)
  if (targetId) {
    if (!studentIds.includes(targetId)) return res.status(403).json({ error: 'forbidden' })
  } else if (studentIds.length === 1) {
    targetId = studentIds[0]
  } else {
    return res.status(400).json({ error: 'invalid_request', field: 'student_id', message: 'Please specify which record to update.' })
  }

  // Build the patch from the allowlist ONLY. Any other key in the body is ignored.
  const patch = {}
  if (Object.prototype.hasOwnProperty.call(body, 'preferred_first_name')) {
    const v = str(body.preferred_first_name)
    if (v.length > 60) return res.status(400).json({ error: 'invalid_request', field: 'preferred_first_name', message: 'Preferred name is too long.' })
    patch.preferred_first_name = v || null
  }
  if (Object.prototype.hasOwnProperty.call(body, 'phone')) {
    const v = str(body.phone)
    if (v.length > 40) return res.status(400).json({ error: 'invalid_request', field: 'phone', message: 'Phone number is too long.' })
    patch.phone = v || null
  }

  const keys = Object.keys(patch)
  if (keys.length === 0) {
    return res.status(400).json({ error: 'invalid_request', message: 'No editable fields were provided.' })
  }
  // Defensive: never allow a non-allowlisted column through, even by mistake.
  if (keys.some(k => !EDITABLE_FIELDS.includes(k))) {
    return res.status(400).json({ error: 'invalid_request', message: 'One or more fields cannot be edited.' })
  }

  const { error: upErr } = await db.from('students').update(patch).eq('id', targetId)
  if (upErr) {
    console.log('[portal/update-profile] update failed', { errorCode: upErr.code })
    return res.status(500).json({ error: 'internal_error' })
  }

  return res.status(200).json({ success: true, updated: keys })
}
