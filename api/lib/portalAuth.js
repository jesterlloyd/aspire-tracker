/* global process */
// api/lib/portalAuth.js
//
// PHASE2-PORTAL: shared server-verified caller identity for the api/portal/*
// family, plus active-grant resolution against the many-to-many authorization
// tables (user_role_grants, user_student_links, user_unit_scopes,
// user_school_scopes).
//
// The caller's identity and authority come ONLY from the verified Supabase
// JWT plus authoritative rows; nothing in a request body ever influences
// authorization. This mirrors api/invite-user.js's verifyCaller and adds the
// portal-grant lookups every portal endpoint needs.

import { createClient } from '@supabase/supabase-js'

export function getServiceDb() {
  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Missing Supabase service role credentials')
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

// Verifies the JWT and resolves the caller's user_profiles row.
// Returns { authenticated, status, reason } on failure, or
// { authenticated: true, authUserId, profile } on success.
export async function verifyPortalCaller(req) {
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
      .select('id, role, is_owner, is_active, full_name, email')
      .eq('auth_user_id', user.id)
      .maybeSingle()
    if (pErr) return { authenticated: false, status: 401, reason: 'profile_lookup_failed' }
    if (!profile) return { authenticated: false, status: 403, reason: 'no_profile' }
    if (profile.is_active === false) return { authenticated: false, status: 403, reason: 'deactivated' }
    return { authenticated: true, authUserId: user.id, profile }
  } catch {
    return { authenticated: false, status: 401, reason: 'profile_threw' }
  }
}

// Verifies the caller is an active Owner or Admin (staff). Reuses verifyPortalCaller,
// which already rejects a missing/invalid token, a missing profile, and a deactivated
// profile. Returns { ok, profile } on success or { ok:false, status, reason }.
export async function verifyOwnerAdminCaller(req) {
  const caller = await verifyPortalCaller(req)
  if (!caller.authenticated) {
    return { ok: false, status: caller.status || 401, reason: caller.reason || 'unauthenticated' }
  }
  const role = caller.profile?.role
  if (role !== 'owner' && role !== 'admin') {
    return { ok: false, status: 403, reason: 'owner_or_admin_required' }
  }
  return { ok: true, profile: caller.profile }
}

const nowActive = (row) =>
  row.revoked_at === null &&
  new Date(row.starts_at ?? row.linked_at ?? 0) <= new Date() &&
  (row.expires_at == null || new Date(row.expires_at) > new Date())

// Does this profile hold an ACTIVE grant for the given portal role?
export async function hasActiveRoleGrant(db, profileId, role) {
  const { data, error } = await db
    .from('user_role_grants')
    .select('starts_at, expires_at, revoked_at')
    .eq('user_profile_id', profileId)
    .eq('role', role)
  if (error || !data) return false
  return data.some(nowActive)
}

// Active student links for this profile (empty array when none).
export async function getActiveStudentLinks(db, profileId) {
  const { data, error } = await db
    .from('user_student_links')
    .select('student_id, linked_at, revoked_at')
    .eq('user_profile_id', profileId)
  if (error || !data) return []
  return data.filter(r => r.revoked_at === null).map(r => r.student_id)
}

// PHASE3-UNIT-PORTAL: active unit scopes for this profile.
// Returns [{ unit_key, cohort_id }] (cohort_id null = all cohorts).
export async function getActiveUnitScopes(db, profileId) {
  const { data, error } = await db
    .from('user_unit_scopes')
    .select('unit_key, cohort_id, starts_at, expires_at, revoked_at')
    .eq('user_profile_id', profileId)
  if (error || !data) return []
  return data.filter(nowActive).map(r => ({ unit_key: r.unit_key, cohort_id: r.cohort_id }))
}
