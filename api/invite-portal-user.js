// api/invite-portal-user.js
//
// PHASE2-PORTAL: invitation endpoint for external portal accounts (students,
// unit leaders, academic partners), the many-to-many counterpart of
// api/invite-user.js (which remains the staff invitation endpoint).
//
// Authorization mirrors invite-user.js: server-verified JWT plus the caller's
// authoritative user_profiles row; only owners and admins may invite portal
// users; nothing in the body influences caller authority.
//
// Created accounts get user_profiles.role = 'portal' (a NON-staff value, so
// is_staff() excludes them and the staff app treats them as portal users),
// is_owner = false, and their actual capabilities come EXCLUSIVELY from
// user_role_grants plus the scope tables:
//   role 'student'          -> requires student_id           -> user_student_links
//     (one active portal account per student row, enforced by a partial unique)
//   role 'unit_leader'      -> requires unit_keys[]          -> user_unit_scopes
//   role 'academic_partner' -> requires school_keys[]        -> user_school_scopes
// Optional expires_at applies to the role grant (auto-deactivation).
//
// PREREQUISITE: the Phase 2 authorization migration must be applied before
// this endpoint can succeed; before that, inserts fail closed with 500 and no
// portal capability exists anywhere.

import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'crypto'
import { appUrl } from '../lib/server/appUrl.js'
import { UNIT_CATALOG } from '../src/lib/unitCatalog.js'

const PORTAL_ROLES = ['student', 'unit_leader', 'academic_partner']
const CANONICAL_UNIT_KEYS = new Set(UNIT_CATALOG.map(u => u.name))

async function verifyCaller(req) {
  const authHeader = req.headers['authorization'] || req.headers['Authorization'] || ''
  const token = authHeader.replace(/^Bearer\s+/i, '').trim()
  if (!token) return { authenticated: false, status: 401, reason: 'missing_token' }

  const url     = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

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
    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
    const { data: profile, error: pErr } = await admin
      .from('user_profiles')
      .select('id, role, is_owner')
      .eq('auth_user_id', user.id)
      .maybeSingle()
    if (pErr) return { authenticated: false, status: 401, reason: 'profile_lookup_failed' }
    if (!profile) return { authenticated: false, status: 403, reason: 'no_profile' }
    return { authenticated: true, userId: user.id, profileId: profile.id, role: profile.role || '', isOwner: profile.is_owner === true }
  } catch {
    return { authenticated: false, status: 401, reason: 'profile_threw' }
  }
}

const str = (v) => (typeof v === 'string' ? v.trim() : '')
const strArray = (v) => (Array.isArray(v) ? v.map(str).filter(Boolean) : [])

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
    console.log('[invite-portal-user] auth rejected', { reason: auth.reason, request_id: requestId })
    return res.status(auth.status === 403 ? 403 : 401).json({ error: auth.status === 403 ? 'forbidden' : 'unauthorized' })
  }

  // ── Gate 3: only owners and admins invite portal users ───────────────────
  if (!(auth.isOwner || auth.role === 'admin')) {
    console.log('[invite-portal-user] insufficient caller authority', { callerRole: auth.role, request_id: requestId })
    return res.status(403).json({ error: 'forbidden', message: 'You do not have permission to invite portal users.' })
  }

  const body = (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) ? req.body : {}

  // ── Gate 4: is_owner and staff roles can never enter through this door ────
  if (Object.prototype.hasOwnProperty.call(body, 'is_owner')) {
    return res.status(400).json({ error: 'invalid_request', field: 'is_owner', message: 'Owner status cannot be set through this endpoint.' })
  }

  // ── Gate 5: portal role allow-list ────────────────────────────────────────
  const portalRole = str(body.role)
  if (!PORTAL_ROLES.includes(portalRole)) {
    return res.status(400).json({ error: 'invalid_request', field: 'role', message: 'Role is not permitted.' })
  }

  // ── Gate 6: identity fields ───────────────────────────────────────────────
  const email = str(body.email)
  if (!email || !email.includes('@') || !email.includes('.')) {
    return res.status(400).json({ error: 'invalid_request', field: 'email', message: 'A valid email is required.' })
  }
  const fullName = str(body.full_name)
  if (!fullName) {
    return res.status(400).json({ error: 'invalid_request', field: 'full_name', message: 'Full name is required.' })
  }

  // Optional grant expiry (ISO timestamp, must be in the future).
  let expiresAt = null
  if (body.expires_at !== undefined && body.expires_at !== null && body.expires_at !== '') {
    const d = new Date(String(body.expires_at))
    if (Number.isNaN(d.getTime()) || d <= new Date()) {
      return res.status(400).json({ error: 'invalid_request', field: 'expires_at', message: 'expires_at must be a future timestamp.' })
    }
    expiresAt = d.toISOString()
  }

  // ── Gate 7: role-specific scope validation (server-verified) ─────────────
  const db = createClient(
    process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } }
  )

  let studentId = null
  let unitKeys = []
  let schoolKeys = []

  if (portalRole === 'student') {
    studentId = str(body.student_id)
    if (!studentId) {
      return res.status(400).json({ error: 'invalid_request', field: 'student_id', message: 'student_id is required for a student invitation.' })
    }
    const { data: studentRow, error: stErr } = await db
      .from('students').select('id').eq('id', studentId).maybeSingle()
    if (stErr) return res.status(500).json({ error: 'internal_error' })
    if (!studentRow) {
      return res.status(404).json({ error: 'not_found', field: 'student_id', message: 'No student record with that id.' })
    }
    const { data: existingLink, error: linkErr } = await db
      .from('user_student_links').select('id').eq('student_id', studentId).is('revoked_at', null).maybeSingle()
    if (linkErr) return res.status(500).json({ error: 'internal_error' })
    if (existingLink) {
      return res.status(409).json({ error: 'conflict', message: 'That student record is already linked to a portal account.' })
    }
  } else if (portalRole === 'unit_leader') {
    unitKeys = strArray(body.unit_keys)
    if (unitKeys.length === 0) {
      return res.status(400).json({ error: 'invalid_request', field: 'unit_keys', message: 'At least one unit is required for a unit leader invitation.' })
    }
    const unknown = unitKeys.filter(k => !CANONICAL_UNIT_KEYS.has(k))
    if (unknown.length > 0) {
      return res.status(400).json({ error: 'invalid_request', field: 'unit_keys', message: `Unknown unit: ${unknown[0]}` })
    }
  } else if (portalRole === 'academic_partner') {
    schoolKeys = strArray(body.school_keys)
    if (schoolKeys.length === 0 || schoolKeys.some(k => k.length > 120)) {
      return res.status(400).json({ error: 'invalid_request', field: 'school_keys', message: 'At least one school is required for an academic partner invitation.' })
    }
  }

  // ── All gates passed: invite, profile, grant, scopes ──────────────────────
  try {
    const { data: invited, error: inviteErr } = await db.auth.admin.inviteUserByEmail(email, {
      data: { full_name: fullName, role: 'portal', portal_role: portalRole },
      redirectTo: appUrl('/portal'),
    })
    if (inviteErr) {
      if ((inviteErr.message || '').toLowerCase().includes('already')) {
        return res.status(409).json({ error: 'conflict', message: 'A user with that email may already exist.' })
      }
      console.log('[invite-portal-user] auth invite failed', { errorCode: inviteErr.code, request_id: requestId })
      return res.status(500).json({ error: 'internal_error' })
    }
    const newAuthUserId = invited.user.id

    // Profile: link an existing email-matched row or insert a new one.
    const { data: existingProfile } = await db
      .from('user_profiles').select('id').eq('email', email).maybeSingle()

    let profileId
    if (existingProfile) {
      const { error: upErr } = await db.from('user_profiles')
        .update({ auth_user_id: newAuthUserId, full_name: fullName, role: 'portal', login_enabled: true, is_active: true })
        .eq('id', existingProfile.id)
      if (upErr) {
        console.log('[invite-portal-user] profile update failed', { errorCode: upErr.code, request_id: requestId })
        return res.status(500).json({ error: 'internal_error', message: 'Invitation partially processed. The ASPIRE team will follow up.' })
      }
      profileId = existingProfile.id
    } else {
      const { data: newProfile, error: insErr } = await db.from('user_profiles')
        .insert({
          auth_user_id: newAuthUserId,
          full_name: fullName,
          email,
          role: 'portal',
          is_owner: false,
          is_active: true,
          login_enabled: true,
        })
        .select('id').single()
      if (insErr || !newProfile) {
        console.log('[invite-portal-user] profile insert failed', { errorCode: insErr?.code, request_id: requestId })
        return res.status(500).json({ error: 'internal_error', message: 'Invitation partially processed. The ASPIRE team will follow up.' })
      }
      profileId = newProfile.id
    }

    // Role grant (with optional expiry) plus role-specific scope rows.
    const { error: grantErr } = await db.from('user_role_grants').insert({
      user_profile_id: profileId,
      role: portalRole,
      granted_by: auth.profileId,
      expires_at: expiresAt,
    })
    if (grantErr) {
      console.log('[invite-portal-user] grant insert failed', { errorCode: grantErr.code, request_id: requestId })
      return res.status(500).json({ error: 'internal_error', message: 'Invitation partially processed. The ASPIRE team will follow up.' })
    }

    let scopeErr = null
    if (portalRole === 'student') {
      ;({ error: scopeErr } = await db.from('user_student_links').insert({
        user_profile_id: profileId, student_id: studentId, linked_by: auth.profileId,
      }))
    } else if (portalRole === 'unit_leader') {
      ;({ error: scopeErr } = await db.from('user_unit_scopes').insert(
        unitKeys.map(k => ({ user_profile_id: profileId, unit_key: k, granted_by: auth.profileId, expires_at: expiresAt }))
      ))
    } else if (portalRole === 'academic_partner') {
      ;({ error: scopeErr } = await db.from('user_school_scopes').insert(
        schoolKeys.map(k => ({ user_profile_id: profileId, school_key: k, granted_by: auth.profileId, expires_at: expiresAt }))
      ))
    }
    if (scopeErr) {
      console.log('[invite-portal-user] scope insert failed', { errorCode: scopeErr.code, request_id: requestId })
      return res.status(500).json({ error: 'internal_error', message: 'Invitation partially processed. The ASPIRE team will follow up.' })
    }

    console.log('[invite-portal-user] portal invitation issued', { portalRole, request_id: requestId })
    return res.status(200).json({ success: true, message: 'Portal invitation sent.' })
  } catch (err) {
    console.log('[invite-portal-user] unexpected error', { errorCode: err?.code, request_id: requestId })
    return res.status(500).json({ error: 'internal_error' })
  }
}
