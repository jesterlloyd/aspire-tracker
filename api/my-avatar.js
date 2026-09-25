/* global process */
// api/my-avatar.js
//
// S-16: a staff member's OWN profile photo, written by the server. Until this endpoint the
// staff app uploaded straight into the public avatars bucket from the browser, named the
// object after the client's file extension, and then either called update_my_avatar with
// whatever URL it liked or wrote user_profiles.avatar_url through the column grant. All
// three are gone: the browser sends bytes here, the server validates them the way
// api/portal/my-avatar.js does (fixed type map, decoded-size cap, magic-byte sniff),
// uploads with the service role to a path derived from the verified identity, and writes
// the resulting public URL. The caller can only ever change their own image; no target is
// accepted from the body.
//
// Staff only. Portal users keep api/portal/my-avatar.js, which routes a student to the
// canonical headshot instead of user_profiles.avatar_url. A profile with a portal role
// that reaches this endpoint is refused, so the two writers never overlap.
//
// Transport: base64 JSON, like admin-avatar-upload (no multipart dependency).

import { randomUUID } from 'crypto'
import { verifyPortalCaller, getServiceDb } from './lib/portalAuth.js'
import { decodeImageBody } from './lib/avatarImage.js'

const AVATARS_BUCKET = 'avatars'
const STAFF_ROLES = new Set(['owner', 'admin', 'co_lead', 'co-lead', 'interviewer', 'viewer'])

function isStaffProfile(profile) {
  return profile?.is_owner === true || STAFF_ROLES.has(String(profile?.role || ''))
}

async function emitAudit(db, profile, actionType, description, requestId) {
  try {
    const { error } = await db.from('activity_logs').insert({
      user_id: profile.id,
      user_name: profile.full_name || '',
      user_role: profile.role || '',
      action_type: actionType,
      entity_type: 'user_profile',
      entity_id: String(profile.id),
      cohort_id: null,
      description,
      metadata: {},
    })
    if (error) console.warn('[my-avatar] audit insert error', { request_id: requestId, errorCode: error.code })
  } catch {
    console.warn('[my-avatar] audit insert threw', { request_id: requestId })
  }
}

export function createMyAvatarHandler({ verifyCaller = verifyPortalCaller, getDb = getServiceDb, now = Date.now } = {}) {
  return async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
    res.setHeader('Cache-Control', 'no-store')
    if (req.method === 'OPTIONS') return res.status(200).end()
    if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })

    const requestId = `req_${randomUUID().slice(0, 8)}`

    const auth = await verifyCaller(req)
    if (!auth.authenticated) {
      const status = auth.status === 403 ? 403 : 401
      return res.status(status).json({ error: status === 403 ? 'forbidden' : 'unauthorized' })
    }
    if (!isStaffProfile(auth.profile)) {
      return res.status(403).json({ error: 'forbidden', message: 'Change your photo from your portal profile menu.' })
    }
    if (!auth.authUserId) return res.status(409).json({ error: 'conflict' })

    const db = getDb()
    const body = (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) ? req.body : {}
    const action = body.action === 'remove' ? 'remove' : 'set'

    if (action === 'remove') {
      const { error } = await db.from('user_profiles').update({ avatar_url: '' }).eq('id', auth.profile.id)
      if (error) {
        console.log('[my-avatar] avatar_url clear failed', { request_id: requestId, errorCode: error.code })
        return res.status(500).json({ error: 'internal_error' })
      }
      await emitAudit(db, auth.profile, 'avatar_removed', 'Removed their profile photo', requestId)
      return res.status(200).json({ success: true, avatar_url: null })
    }

    const img = decodeImageBody(body)
    if (!img.ok) return res.status(img.status).json({ error: img.error, ...(img.field ? { field: img.field } : {}) })

    // The path is derived from the VERIFIED identity and the server's extension map;
    // nothing about it comes from the request.
    const path = `${auth.authUserId}/avatar.${img.ext}`
    const { error: uploadError } = await db.storage
      .from(AVATARS_BUCKET).upload(path, img.buf, { upsert: true, contentType: img.contentType })
    if (uploadError) {
      console.log('[my-avatar] upload failed', { request_id: requestId, message: uploadError.message })
      return res.status(502).json({ error: 'upload_failed', message: 'Could not upload the image. Please try again.' })
    }

    const { data: pub } = db.storage.from(AVATARS_BUCKET).getPublicUrl(path)
    const publicUrl = `${pub.publicUrl}?v=${now()}`

    const { error: updateError } = await db.from('user_profiles').update({ avatar_url: publicUrl }).eq('id', auth.profile.id)
    if (updateError) {
      console.log('[my-avatar] avatar_url update failed', { request_id: requestId, errorCode: updateError.code })
      return res.status(500).json({ error: 'internal_error' })
    }

    await emitAudit(db, auth.profile, 'avatar_updated', 'Updated their profile photo', requestId)
    console.log('[my-avatar] avatar updated', { request_id: requestId })
    return res.status(200).json({ success: true, avatar_url: publicUrl })
  }
}

export default async function handler(req, res) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY || !(process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL)) {
    res.setHeader('Cache-Control', 'no-store')
    return res.status(500).json({ error: 'internal_error' })
  }
  return createMyAvatarHandler()(req, res)
}
