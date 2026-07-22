// api/preceptor-primary-assign.js
//
// PHASE 2C: Owner/Admin server-verified PRIMARY preceptor change.
//
// After the Phase 2C guard, students.preceptor_id can be changed only by an owner/admin
// (direct staff path) or through an authorized RPC. This endpoint routes the owner/admin
// staff path through the SAME audited RPC (assign_primary_preceptor) so every primary change
// is recorded and notified, instead of a bare client UPDATE. It verifies the caller is an
// active owner/admin (WS1 pattern, mirroring api/preceptor-assignments.js) and calls the RPC
// with the service-role client, passing the actor profile id.
//
// POST { studentId, preceptorId, reason? }
// Authorization: Bearer <session token> (Owner/Admin)

import { createClient } from '@supabase/supabase-js'
import { mapRpcStatus, mapRpcError } from './lib/unitLeaderRpcErrors.js'
import { SHARED_INBOX_EMAIL } from '../lib/server/messages/config.js'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const isUuid = v => typeof v === 'string' && UUID_PATTERN.test(v)
const rid = () => `req_${Math.random().toString(36).slice(2, 10)}`

async function verifyCaller(req) {
  const authHeader = req.headers['authorization'] || req.headers['Authorization'] || ''
  const token = authHeader.replace(/^Bearer\s+/i, '').trim()
  if (!token) return { ok: false, status: 401, error: 'Unauthorized' }
  const url        = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
  const anonKey    = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  let user
  try {
    const userClient = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    })
    const { data, error } = await userClient.auth.getUser()
    if (error || !data?.user) return { ok: false, status: 401, error: 'Unauthorized' }
    user = data.user
  } catch {
    return { ok: false, status: 401, error: 'Unauthorized' }
  }
  try {
    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
    const { data: profile, error: pErr } = await admin
      .from('user_profiles').select('id, role, is_owner, is_active').eq('auth_user_id', user.id).maybeSingle()
    if (pErr || !profile) return { ok: false, status: 403, error: 'Forbidden' }
    if (profile.is_active === false) return { ok: false, status: 403, error: 'Forbidden' }
    const role = profile.role || ''
    const isOwnerAdmin = profile.is_owner === true || ['owner', 'admin'].includes(role)
    if (!isOwnerAdmin) return { ok: false, status: 403, error: 'Forbidden' }
    return { ok: true, admin, profileId: profile.id }
  } catch {
    return { ok: false, status: 401, error: 'Unauthorized' }
  }
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })

  const caller = await verifyCaller(req)
  if (!caller.ok) return res.status(caller.status).json({ error: caller.error })

  const body = (req.body && typeof req.body === 'object') ? req.body : {}
  if (!isUuid(body.studentId) || !isUuid(body.preceptorId)) {
    return res.status(400).json({ error: 'invalid_request' })
  }
  const requestId = rid()
  const { data, error } = await caller.admin.rpc('assign_primary_preceptor', {
    p_actor_profile_id: caller.profileId,
    p_student_id: body.studentId,
    p_preceptor_id: body.preceptorId,
    p_reason: typeof body.reason === 'string' && body.reason.trim() ? body.reason.trim() : null,
    p_notify_email: SHARED_INBOX_EMAIL,
    p_request_id: requestId,
  })
  if (error) {
    console.log('[preceptor-primary-assign] rpc error', { request_id: requestId, code: error.code })
    return res.status(mapRpcStatus(error)).json({ error: mapRpcError(error) })
  }
  return res.status(200).json({ result: data })
}
