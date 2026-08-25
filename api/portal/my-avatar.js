/* global process, Buffer */
// api/portal/my-avatar.js
//
// PROFILE-MENU-AVATARS-1: SELF-service profile photo for portal users, one
// canonical writer per role so image records never drift.
//
//   - student           -> the canonical student headshot (students.headshot_url,
//                          private student-files storage). Same image every staff
//                          surface, the Accounts & Access directory, Unit Leader /
//                          Academic Partner rosters, and Connect student cards
//                          already resolve through the WAVE F-2 signed-access
//                          endpoints. user_profiles.avatar_url is NOT written for
//                          students, so there is exactly one student image record.
//   - unit_leader /     -> user_profiles.avatar_url (public avatars bucket), the
//     academic_partner     field the portal header, Accounts & Access, and staff
//                          surfaces read. The matching contacts row (exact email
//                          match), when one exists, is MIRRORED to the same public
//                          URL so ASPIRE Connect contact surfaces show the same
//                          image without a second upload; only avatar_url is
//                          touched on the contact.
//
// Authorization is server-verified (verified JWT -> user_profiles -> active role
// grant; students additionally need an active user_student_links row). The caller
// can only ever change their OWN image: no target id is accepted from the body -
// the target is derived entirely from the verified identity. Transport and
// validation mirror api/admin-avatar-upload.js: base64 JSON, fixed content-type ->
// extension map (never a client filename), decoded-size limit, magic-byte sniff.
//
// Unlike the intake/my-profile document flow, the student branch uploads the
// decoded bytes server-side (service role) to the server-derived canonical path
// and persists that same path in one step - the stored reference can never be a
// client-chosen string, and no raw private storage path is returned to the
// browser (the header re-signs through /api/portal/student-file-access).

import { randomUUID } from 'crypto'
import { verifyPortalCaller, getServiceDb, hasActiveRoleGrant, getActiveStudentLinks } from '../lib/portalAuth.js'
import { STUDENT_FILES_BUCKET, canonicalPath } from '../../lib/server/studentFiles.js'
import { normalizeEmailForLookup } from '../../src/lib/emailUtils.js'

const AVATARS_BUCKET = 'avatars'

// Per-branch rules follow the established stores they write to: the avatars
// bucket convention (jpeg/png/webp, 2 MB) and the WAVE F-2 headshot rules
// (jpeg/png, 5 MB - webp is not an accepted headshot type).
const PROFILE_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }
const HEADSHOT_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png' }
const PROFILE_MAX_BYTES = 2 * 1024 * 1024
const HEADSHOT_MAX_BYTES = 5 * 1024 * 1024

function sniffType(buf) {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg'
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
      buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a) return 'image/png'
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp'
  return null
}

function decodeImage(body, typeMap, maxBytes) {
  const contentType = typeof body.content_type === 'string' ? body.content_type.trim().toLowerCase() : ''
  const ext = typeMap[contentType]
  if (!ext) return { ok: false, status: 400, error: 'invalid_request', field: 'content_type' }
  let raw = typeof body.data_base64 === 'string' ? body.data_base64 : ''
  const comma = raw.indexOf(',')
  if (raw.startsWith('data:') && comma !== -1) raw = raw.slice(comma + 1)
  if (!raw) return { ok: false, status: 400, error: 'invalid_request', field: 'data_base64' }
  let buf
  try { buf = Buffer.from(raw, 'base64') } catch { return { ok: false, status: 400, error: 'invalid_request', field: 'data_base64' } }
  if (!buf.length) return { ok: false, status: 400, error: 'invalid_request', field: 'data_base64' }
  if (buf.length > maxBytes) return { ok: false, status: 413, error: 'file_too_large' }
  if (sniffType(buf) !== contentType) return { ok: false, status: 400, error: 'invalid_request', field: 'content_type' }
  return { ok: true, buf, contentType, ext }
}

// Best-effort audit, house pattern: warn and continue on failure.
async function emitAudit(db, profile, actionType, description, requestId) {
  try {
    const { error } = await db.from('activity_logs').insert({
      user_id: profile.id,
      user_name: profile.full_name || '',
      user_role: 'portal',
      action_type: actionType,
      entity_type: 'user_profile',
      entity_id: String(profile.id),
      cohort_id: null,
      description,
      metadata: {},
    })
    if (error) console.warn('[portal-my-avatar] audit insert error', { request_id: requestId, errorCode: error.code })
  } catch {
    console.warn('[portal-my-avatar] audit insert threw', { request_id: requestId })
  }
}

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

  const requestId = `req_${randomUUID().slice(0, 8)}`

  const auth = await verifyPortalCaller(req)
  if (!auth.authenticated) {
    const status = auth.status === 403 ? 403 : 401
    return res.status(status).json({ error: status === 403 ? 'forbidden' : 'unauthorized' })
  }

  const db = getServiceDb()
  const body = (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) ? req.body : {}
  const action = body.action === 'remove' ? 'remove' : 'set'

  // Role resolution mirrors PortalApp's experience precedence: a student link
  // wins, then unit leader, then academic partner. No role -> no avatar surface.
  const isStudent = await hasActiveRoleGrant(db, auth.profile.id, 'student')
  const studentIds = isStudent ? await getActiveStudentLinks(db, auth.profile.id) : []

  // ── Student branch: canonical headshot ─────────────────────────────────────
  if (isStudent && studentIds.length > 0) {
    if (action === 'remove') {
      // The headshot is a required intake document (badges, rosters): it can be
      // replaced, never removed, from the portal.
      return res.status(400).json({ error: 'remove_unsupported', message: 'Your photo can be replaced but not removed.' })
    }
    if (studentIds.length !== 1) {
      return res.status(409).json({ error: 'ambiguous_student', message: 'Your account is linked to more than one student record. Please contact the ASPIRE team.' })
    }
    const img = decodeImage(body, HEADSHOT_TYPES, HEADSHOT_MAX_BYTES)
    if (!img.ok) return res.status(img.status).json({ error: img.error, ...(img.field ? { field: img.field } : {}) })

    const { data: student, error: sErr } = await db
      .from('students').select('id, cohort_id').eq('id', studentIds[0]).maybeSingle()
    if (sErr) { console.log('[portal-my-avatar] student lookup failed', { request_id: requestId, errorCode: sErr.code }); return res.status(500).json({ error: 'internal_error' }) }
    if (!student) return res.status(404).json({ error: 'not_found' })
    if (!student.cohort_id) return res.status(409).json({ error: 'no_cohort' })

    const cp = canonicalPath(student.cohort_id, student.id, 'headshot', img.ext)
    if (!cp.ok) return res.status(500).json({ error: 'internal_error' })

    const { error: uploadError } = await db.storage
      .from(STUDENT_FILES_BUCKET).upload(cp.path, img.buf, { upsert: true, contentType: img.contentType })
    if (uploadError) {
      console.log('[portal-my-avatar] headshot upload failed', { request_id: requestId, message: uploadError.message })
      return res.status(502).json({ error: 'upload_failed', message: 'Could not upload the image. Please try again.' })
    }

    const { error: updateError } = await db
      .from('students').update({ headshot_url: cp.path }).eq('id', student.id)
    if (updateError) {
      console.log('[portal-my-avatar] headshot_url update failed', { request_id: requestId, errorCode: updateError.code })
      return res.status(500).json({ error: 'internal_error' })
    }

    await emitAudit(db, auth.profile, 'portal_headshot_updated', 'Updated their profile photo from the Student Portal', requestId)
    console.log('[portal-my-avatar] headshot updated', { request_id: requestId })
    // No raw private path in the response; the client re-signs via the portal
    // read endpoint.
    return res.status(200).json({ success: true, kind: 'headshot' })
  }

  // ── Unit Leader / Academic Partner / Nursing Academics branch:
  //    user_profiles.avatar_url (the caller's OWN profile image only) ─────────
  const isUnitLeader = await hasActiveRoleGrant(db, auth.profile.id, 'unit_leader')
  const isPartner = isUnitLeader ? false : await hasActiveRoleGrant(db, auth.profile.id, 'academic_partner')
  const isNursingAcademic = (isUnitLeader || isPartner) ? false : await hasActiveRoleGrant(db, auth.profile.id, 'nursing_academic')
  if (!isUnitLeader && !isPartner && !isNursingAcademic) return res.status(403).json({ error: 'forbidden' })

  const mirrorContactAvatar = async (value, { onlyIfCurrently } = {}) => {
    // Mirror to the matching Connect contact (exact case-insensitive email
    // match) so contact surfaces show the account holder's canonical image.
    // ONLY avatar_url is written; every other contact field is untouched.
    const email = normalizeEmailForLookup(auth.profile.email)
    if (!email) return
    try {
      const { data: contacts } = await db.from('contacts').select('id, email, avatar_url').ilike('email', auth.profile.email.trim())
      for (const c of (contacts || [])) {
        if (normalizeEmailForLookup(c.email) !== email) continue
        if (onlyIfCurrently !== undefined && (c.avatar_url || '') !== onlyIfCurrently) continue
        await db.from('contacts').update({ avatar_url: value }).eq('id', c.id)
      }
    } catch {
      console.warn('[portal-my-avatar] contact mirror failed', { request_id: requestId })
    }
  }

  if (action === 'remove') {
    // verifyPortalCaller's profile select does not include avatar_url; read the
    // current value so the contact mirror can be cleared conditionally below.
    const { data: current } = await db
      .from('user_profiles').select('avatar_url').eq('id', auth.profile.id).maybeSingle()
    const previous = current?.avatar_url || null
    const { error: updateError } = await db
      .from('user_profiles').update({ avatar_url: '' }).eq('id', auth.profile.id)
    if (updateError) {
      console.log('[portal-my-avatar] avatar_url clear failed', { request_id: requestId, errorCode: updateError.code })
      return res.status(500).json({ error: 'internal_error' })
    }
    // Clear the mirrored contact copy only when it still equals the removed
    // profile URL - a manually curated contact photo is left alone.
    if (previous) await mirrorContactAvatar('', { onlyIfCurrently: previous })
    await emitAudit(db, auth.profile, 'portal_avatar_removed', 'Removed their profile photo from the portal', requestId)
    return res.status(200).json({ success: true, avatar_url: null })
  }

  const img = decodeImage(body, PROFILE_TYPES, PROFILE_MAX_BYTES)
  if (!img.ok) return res.status(img.status).json({ error: img.error, ...(img.field ? { field: img.field } : {}) })

  const path = `${auth.authUserId}/avatar.${img.ext}`
  const { error: uploadError } = await db.storage
    .from(AVATARS_BUCKET).upload(path, img.buf, { upsert: true, contentType: img.contentType })
  if (uploadError) {
    console.log('[portal-my-avatar] avatar upload failed', { request_id: requestId, message: uploadError.message })
    return res.status(502).json({ error: 'upload_failed', message: 'Could not upload the image. Please try again.' })
  }

  const { data: pub } = db.storage.from(AVATARS_BUCKET).getPublicUrl(path)
  const publicUrl = `${pub.publicUrl}?v=${Date.now()}`

  const { error: updateError } = await db
    .from('user_profiles').update({ avatar_url: publicUrl }).eq('id', auth.profile.id)
  if (updateError) {
    console.log('[portal-my-avatar] avatar_url update failed', { request_id: requestId, errorCode: updateError.code })
    return res.status(500).json({ error: 'internal_error' })
  }

  await mirrorContactAvatar(publicUrl)
  await emitAudit(db, auth.profile, 'portal_avatar_updated', 'Updated their profile photo from the portal', requestId)
  console.log('[portal-my-avatar] avatar updated', { request_id: requestId })
  return res.status(200).json({ success: true, avatar_url: publicUrl })
}
