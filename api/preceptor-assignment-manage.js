// Staff Owner/Admin assignment manager endpoint.
//
// This is the main-app counterpart to api/portal/unit-preceptor-manage.js. It
// verifies staff authority server-side, then calls the same audited RPCs used by
// the portal path. The browser never writes assignment tables directly and never
// supplies actor or cohort authority.

/* global process */

import { createClient } from '@supabase/supabase-js'
import { can as canAccess } from '../lib/server/access.js'
import { mapRpcStatus, mapRpcError } from './lib/unitLeaderRpcErrors.js'

async function verifyStaffCaller(req) {
  const authHeader = req.headers['authorization'] || req.headers['Authorization'] || ''
  const token = authHeader.replace(/^Bearer\s+/i, '').trim()
  if (!token) return { ok: false, status: 401, error: 'unauthorized' }
  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  try {
    const userClient = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    })
    const { data, error } = await userClient.auth.getUser()
    if (error || !data?.user) return { ok: false, status: 401, error: 'unauthorized' }
    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
    const { data: profile, error: profileError } = await admin
      .from('user_profiles')
      .select('id, role, is_owner, is_active')
      .eq('auth_user_id', data.user.id)
      .maybeSingle()
    if (profileError || !profile || profile.is_active === false) {
      return { ok: false, status: 403, error: 'forbidden' }
    }
    const role = profile.role || ''
    // ROLE-MODEL-1: placement management is Owner/Admin/Co-Lead (canonical table).
    if (!canAccess(profile, 'placement_manage')) {
      return { ok: false, status: 403, error: 'forbidden' }
    }
    return { ok: true, db: admin, profile }
  } catch {
    return { ok: false, status: 401, error: 'unauthorized' }
  }
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })

  const auth = await verifyStaffCaller(req)
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error })

  const body = (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) ? req.body : {}
  const action = typeof body.action === 'string' ? body.action : ''
  const requestId = typeof body.request_id === 'string' ? body.request_id.trim() : ''
  if (!requestId) return res.status(400).json({ error: 'request_id_required' })

  let rpc, args
  if (action === 'change_primary') {
    rpc = 'assign_primary_preceptor'
    args = {
      p_actor_profile_id: auth.profile.id,
      p_student_id: body.student_id,
      p_preceptor_id: body.preceptor_id,
      p_reason: body.reason || null,
      p_force: body.force === true,
      p_confirm_override: body.confirm_override === true,
      p_request_id: requestId,
    }
  } else if (action === 'clear_primary') {
    // PHASE-2D: end the primary relationship through the canonical RPC. The 2B
    // trigger performs the mirror cleanup; already-clear students no-op.
    rpc = 'clear_primary_preceptor'
    args = {
      p_actor_profile_id: auth.profile.id,
      p_student_id: body.student_id,
      p_reason: body.reason || null,
      p_force: body.force === true,
      p_confirm_override: body.confirm_override === true,
      p_request_id: requestId,
    }
  } else if (action === 'set_secondary') {
    rpc = 'set_secondary_coverage_preceptor'
    args = {
      p_actor_profile_id: auth.profile.id,
      p_student_id: body.student_id,
      p_role: body.role,
      p_action: body.op,
      p_preceptor_id: body.preceptor_id || null,
      p_assignment_id: body.assignment_id || null,
      p_reason: body.reason || null,
      p_notes: body.notes || null,
      p_force: body.force === true,
      p_confirm_override: body.confirm_override === true,
      p_request_id: requestId,
    }
  } else {
    return res.status(400).json({ error: 'unknown_action' })
  }

  const { data, error } = await auth.db.rpc(rpc, args)
  if (error) {
    console.log('[preceptor-assignment-manage] rpc error', { request_id: requestId, action, code: error.code })
    return res.status(mapRpcStatus(error)).json({ error: mapRpcError(error) })
  }
  return res.status(200).json({ result: data })
}
