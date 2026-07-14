// api/revoke-portal-access.js
//
// PHASE2-ACCESS: Owner/Admin endpoint to revoke a portal role and, optionally,
// that role's own links/scopes. The counterpart of api/invite-portal-user.js.
//
// Authorization is server-verified (JWT plus the caller's authoritative
// user_profiles row); only owners and admins may revoke. All database work runs
// through the transactional revoke_portal_access() RPC, which sets
// revoked_at/revoked_by and NEVER deletes: history is preserved, and unrelated
// roles or assignments are never touched. It is idempotent (already-revoked is
// a success). This endpoint never deletes the auth user or the user_profiles
// row.
//
// Body:
//   user_profile_id (required)  the portal profile to revoke from
//   role            (required)  'student' | 'unit_leader' | 'academic_partner'
//   student_id      (optional)  narrow a student revocation to one link
//   unit_keys[]     (optional)  narrow a unit revocation to specific units
//   school_keys[]   (optional)  narrow a school revocation to specific schools
//   cohort_id       (optional)  narrow unit/school revocation to one cohort
//   cascade         (optional, default true)  also revoke the role's assignments
//
// PREREQUISITE: the portal access lifecycle migration (20260712000009) must be
// applied so revoke_portal_access exists.

import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'crypto'

const PORTAL_ROLES = ['student', 'unit_leader', 'academic_partner']
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const str = (v) => (typeof v === 'string' ? v.trim() : '')
const strArray = (v) => (Array.isArray(v) ? v.map(str).filter(Boolean) : [])

function getServiceDb() {
  return createClient(
    process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } }
  )
}

async function verifyCaller(req) {
  const authHeader = req.headers['authorization'] || req.headers['Authorization'] || ''
  const token = authHeader.replace(/^Bearer\s+/i, '').trim()
  if (!token) return { authenticated: false, status: 401, reason: 'missing_token' }

  const url     = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY

  let user
  try {
    const userClient = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    })
    const { data, error } = await userClient.auth.getUser()
    if (error || !data?.user) return { authenticated: false, status: 401, reason: 'invalid_token' }
    user = data.user
  } catch {
    return { authenticated: false, status: 401, reason: 'verify_threw' }
  }

  try {
    const admin = getServiceDb()
    const { data: profile, error: pErr } = await admin
      .from('user_profiles')
      .select('id, role, is_owner')
      .eq('auth_user_id', user.id)
      .maybeSingle()
    if (pErr) return { authenticated: false, status: 401, reason: 'profile_lookup_failed' }
    if (!profile) return { authenticated: false, status: 403, reason: 'no_profile' }
    return { authenticated: true, profileId: profile.id, role: profile.role || '', isOwner: profile.is_owner === true }
  } catch {
    return { authenticated: false, status: 401, reason: 'profile_threw' }
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY || !(process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL)) {
    return res.status(500).json({ error: 'internal_error' })
  }

  const requestId = `req_${randomUUID().slice(0, 8)}`

  // ── Gate 1 and 2: JWT plus caller profile ────────────────────────────────
  const auth = await verifyCaller(req)
  if (!auth.authenticated) {
    console.log('[revoke-portal-access] auth rejected', { reason: auth.reason, request_id: requestId })
    return res.status(auth.status === 403 ? 403 : 401).json({ error: auth.status === 403 ? 'forbidden' : 'unauthorized' })
  }

  // ── Gate 3: only owners and admins revoke portal access ───────────────────
  if (!(auth.isOwner || auth.role === 'admin')) {
    console.log('[revoke-portal-access] insufficient caller authority', { callerRole: auth.role, request_id: requestId })
    return res.status(403).json({ error: 'forbidden', message: 'You do not have permission to revoke portal access.' })
  }

  const body = (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) ? req.body : {}

  // ── Gate 4: target validation ─────────────────────────────────────────────
  const userProfileId = str(body.user_profile_id)
  if (!UUID_RE.test(userProfileId)) {
    return res.status(400).json({ error: 'invalid_request', field: 'user_profile_id', message: 'A valid user_profile_id is required.' })
  }
  const portalRole = str(body.role)
  if (!PORTAL_ROLES.includes(portalRole)) {
    return res.status(400).json({ error: 'invalid_request', field: 'role', message: 'Role is not permitted.' })
  }

  const studentId = str(body.student_id)
  if (studentId && !UUID_RE.test(studentId)) {
    return res.status(400).json({ error: 'invalid_request', field: 'student_id', message: 'student_id must be a valid id.' })
  }
  const cohortId = str(body.cohort_id)
  if (cohortId && !UUID_RE.test(cohortId)) {
    return res.status(400).json({ error: 'invalid_request', field: 'cohort_id', message: 'cohort_id must be a valid id.' })
  }
  const unitKeys = strArray(body.unit_keys)
  const schoolKeys = strArray(body.school_keys)
  // Default cascade true; only an explicit false disables it.
  const cascade = body.cascade === false ? false : true

  const db = getServiceDb()

  try {
    const { data: result, error: rpcErr } = await db.rpc('revoke_portal_access', {
      p_user_profile_id: userProfileId,
      p_role: portalRole,
      p_revoked_by: auth.profileId,
      p_student_id: studentId || null,
      p_unit_keys: unitKeys.length ? unitKeys : null,
      p_school_keys: schoolKeys.length ? schoolKeys : null,
      p_cohort_id: cohortId || null,
      p_cascade: cascade,
    })

    if (rpcErr) {
      const code = rpcErr.code || ''
      if (code === 'PT400') {
        return res.status(400).json({ error: 'invalid_request', message: 'The revocation could not be validated.' })
      }
      console.log('[revoke-portal-access] revocation failed', { errorCode: rpcErr.code, request_id: requestId })
      return res.status(500).json({ error: 'internal_error', message: 'The revocation could not be completed.' })
    }

    console.log('[revoke-portal-access] portal access revoked', {
      portalRole, grant: result?.grant?.action, request_id: requestId,
    })
    // Idempotent success whether the grant was active or already revoked.
    return res.status(200).json({
      success: true,
      message: result?.grant?.action === 'already_revoked' ? 'Portal access was already revoked.' : 'Portal access revoked.',
      revoked: {
        role: result?.role,
        grant_action: result?.grant?.action,
        links: result?.links,
        unit_scopes: result?.unit_scopes,
        school_scopes: result?.school_scopes,
      },
    })
  } catch (err) {
    console.log('[revoke-portal-access] unexpected error', { errorCode: err?.code, request_id: requestId })
    return res.status(500).json({ error: 'internal_error' })
  }
}
