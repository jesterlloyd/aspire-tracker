// api/invite-portal-user.js
//
// PHASE2-PORTAL / PHASE2-ACCESS: invitation AND renewal endpoint for external
// portal accounts (students, unit leaders, academic partners), the
// many-to-many counterpart of api/invite-user.js (the staff invitation
// endpoint).
//
// Authorization mirrors invite-user.js: server-verified JWT plus the caller's
// authoritative user_profiles row; only owners and admins may invite portal
// users; nothing in the body influences caller authority.
//
// FAILURE-SAFE LIFECYCLE (ASPIRE-PHASE2-ACCESS):
//   All database-side provisioning (profile resolve/create, role grant, and
//   the role's own links/scopes) happens in ONE transaction via the
//   provision_portal_access() RPC. This endpoint never performs the four
//   authorization-table inserts separately. The RPC creates, RENEWS (expired,
//   reissued, or changed window), or idempotently reuses each row, so
//   re-inviting or renewing a portal user no longer fails on the active-slot
//   partial unique indexes.
//
//   The one remaining cross-system boundary is the auth user vs. the database.
//   When THIS request created the auth user and the RPC then fails, the auth
//   user is deleted (compensation). A pre-existing auth user and any existing
//   user_profiles row are never deleted.
//
// Status codes:
//   201 newly provisioned account (this request created the auth user)
//   200 idempotent reuse or renewal of an existing account
//   409 genuine authorization conflict (e.g. student linked elsewhere)
//   400 invalid input
//   401 / 403 caller authorization failure
//   500 unexpected server failure
//
// PREREQUISITE: the Phase 2 authorization foundation (20260712000007) AND the
// portal access lifecycle (20260712000009, which defines provision_portal_access)
// must be applied before this endpoint can succeed.

import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'
import { randomUUID } from 'crypto'
import { appUrl } from '../lib/server/appUrl.js'
import { UNIT_CATALOG } from '../src/lib/unitCatalog.js'
import { portalInvitationEmail } from '../lib/server/email/portalInvitation.js'

const PORTAL_ROLES = ['student', 'unit_leader', 'academic_partner']
// Verified ASPIRE Resend sender (cshs.org is not a verified Resend domain, so
// aspire@cshs.org is used as the reply-to / support address, not the from).
const EMAIL_FROM = 'ASPIRE at Cedars-Sinai <noreply@aspire-program.com>'
const EMAIL_REPLY_TO = 'aspire@cshs.org'

// Send the branded ASPIRE Student Portal invitation via Resend. The activation
// link is embedded ONLY in the email HTML and is never logged or returned.
async function sendPortalInvitation({ to, firstName, activationLink, expiresAt, requestId }) {
  try {
    if (!process.env.RESEND_API_KEY || !activationLink) return false
    const { subject, html } = portalInvitationEmail({ firstName, activationLink, expiresAt })
    const resend = new Resend(process.env.RESEND_API_KEY)
    const { error } = await resend.emails.send({ from: EMAIL_FROM, to, replyTo: EMAIL_REPLY_TO, subject, html })
    if (error) { console.log('[invite-portal-user] branded invite email failed', { request_id: requestId }); return false }
    return true
  } catch {
    console.log('[invite-portal-user] branded invite email threw', { request_id: requestId })
    return false
  }
}
const CANONICAL_UNIT_KEYS = new Set(UNIT_CATALOG.map(u => u.name))

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
      .select('id, role, is_owner, is_active')
      .eq('auth_user_id', user.id)
      .maybeSingle()
    if (pErr) return { authenticated: false, status: 401, reason: 'profile_lookup_failed' }
    if (!profile) return { authenticated: false, status: 403, reason: 'no_profile' }
    // UL-PORTAL: is_active is REQUIRED here. These endpoints grant and revoke
    // user_unit_scopes, and only an ACTIVE Owner/Admin may manage Unit Leader
    // assignments. A deactivated Owner/Admin previously retained full grant and
    // revoke authority because is_active was never selected. Fail closed.
    if (profile.is_active === false) return { authenticated: false, status: 403, reason: 'inactive' }
    return { authenticated: true, userId: user.id, profileId: profile.id, role: profile.role || '', isOwner: profile.is_owner === true }
  } catch {
    return { authenticated: false, status: 401, reason: 'profile_threw' }
  }
}

// Locate an existing auth user id by email when an invite reports the address
// is already registered but no profile row carries its auth_user_id. Bounded
// paging keeps this cheap; portal-scale deployments have few auth users.
async function findAuthUserIdByEmail(db, email) {
  const target = email.toLowerCase()
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 })
    if (error || !data?.users?.length) return null
    const match = data.users.find(u => (u.email || '').toLowerCase() === target)
    if (match) return match.id
    if (data.users.length < 200) return null
  }
  return null
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

  const db = getServiceDb()

  // ── Gate 7: role-specific scope validation (server-verified) ─────────────
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

  // ── Locate any existing profile for this email BEFORE touching auth. Its id
  //    scopes the conflict pre-check (a student may be re-invited to its OWN
  //    account) and its auth_user_id lets us reuse an existing account for a
  //    renewal instead of failing on a duplicate invite. ────────────────────
  let existingProfile = null
  {
    const { data, error } = await db
      .from('user_profiles').select('id, auth_user_id').eq('email', email).maybeSingle()
    if (error) {
      console.log('[invite-portal-user] profile lookup failed', { errorCode: error.code, request_id: requestId })
      return res.status(500).json({ error: 'internal_error' })
    }
    existingProfile = data || null
  }

  // ── Conflict pre-check (clean 409 before any auth work). A student row may
  //    hold at most one active link; block only when it belongs to a DIFFERENT
  //    profile than the invitee's. ───────────────────────────────────────────
  if (portalRole === 'student') {
    const { data: activeLink, error: linkErr } = await db
      .from('user_student_links').select('user_profile_id').eq('student_id', studentId).is('revoked_at', null).maybeSingle()
    if (linkErr) return res.status(500).json({ error: 'internal_error' })
    if (activeLink && activeLink.user_profile_id !== existingProfile?.id) {
      return res.status(409).json({ error: 'conflict', message: 'That student record is already linked to a portal account.' })
    }
  }

  // ── Resolve or create the auth user. Reuse the existing account for a
  //    renewal; only invite (and flag for compensation) when we create one. ──
  let authUserId = null
  let createdAuthUser = false
  let activationLink = null // Supabase-hosted acceptance link; embedded in the branded email only, never logged/returned.
  try {
    if (existingProfile?.auth_user_id) {
      authUserId = existingProfile.auth_user_id
    } else {
      // generateLink creates the user and returns the activation link WITHOUT
      // sending Supabase's default email, so ASPIRE controls the branded send.
      const { data: linkData, error: linkErr } = await db.auth.admin.generateLink({
        type: 'invite',
        email,
        options: { data: { full_name: fullName, role: 'portal', portal_role: portalRole }, redirectTo: appUrl('/portal') },
      })
      if (linkErr) {
        if (/already|registered|exists/i.test(linkErr.message || '')) {
          // Auth account exists but is not linked to a profile by this email.
          authUserId = await findAuthUserIdByEmail(db, email)
          if (!authUserId) {
            return res.status(409).json({ error: 'conflict', message: 'A user with that email may already exist.' })
          }
        } else {
          console.log('[invite-portal-user] activation link generation failed', { errorCode: linkErr.code, request_id: requestId })
          return res.status(500).json({ error: 'internal_error' })
        }
      } else {
        authUserId = linkData.user.id
        activationLink = linkData.properties?.action_link || null
        createdAuthUser = true
      }
    }
  } catch (err) {
    console.log('[invite-portal-user] auth resolution threw', { errorCode: err?.code, request_id: requestId })
    return res.status(500).json({ error: 'internal_error' })
  }

  // ── Single transactional provisioning call. Any failure rolls back every
  //    database write; we then compensate only a newly created auth user. ────
  try {
    const { data: result, error: rpcErr } = await db.rpc('provision_portal_access', {
      p_auth_user_id: authUserId,
      p_email: email,
      p_full_name: fullName,
      p_role: portalRole,
      p_granted_by: auth.profileId,
      p_expires_at: expiresAt,
      p_student_id: portalRole === 'student' ? studentId : null,
      p_unit_keys: portalRole === 'unit_leader' ? unitKeys : null,
      p_school_keys: portalRole === 'academic_partner' ? schoolKeys : null,
      p_cohort_id: null,
    })

    if (rpcErr) {
      // Compensate: undo ONLY an auth user this request created. Never delete a
      // pre-existing auth user, and never delete a user_profiles row.
      if (createdAuthUser) {
        const { error: delErr } = await db.auth.admin.deleteUser(authUserId)
        if (delErr) {
          console.log('[invite-portal-user] COMPENSATION FAILED: orphan auth user left', { authUserId, errorCode: delErr.code, request_id: requestId })
        } else {
          console.log('[invite-portal-user] compensated: newly created auth user removed', { request_id: requestId })
        }
      }
      const code = rpcErr.code || ''
      if (code === 'PT409') {
        return res.status(409).json({ error: 'conflict', message: 'That assignment conflicts with an existing active portal account.' })
      }
      if (code === 'PT400') {
        return res.status(400).json({ error: 'invalid_request', message: 'The invitation could not be validated.' })
      }
      if (code === 'PT404') {
        return res.status(404).json({ error: 'not_found', message: 'A referenced record was not found.' })
      }
      console.log('[invite-portal-user] provisioning failed', { errorCode: rpcErr.code, request_id: requestId })
      return res.status(500).json({ error: 'internal_error', message: 'The invitation could not be completed.' })
    }

    // Send the branded ASPIRE invitation for a newly created account. The
    // account and grant are already committed, so a mail failure does not roll
    // back or compensate; it is reported (email_sent:false) for a resend.
    let emailSent = false
    if (createdAuthUser && activationLink) {
      emailSent = await sendPortalInvitation({
        to: email,
        firstName: (fullName.split(/\s+/)[0] || ''),
        activationLink,
        expiresAt: result?.grant?.expires_at || expiresAt,
        requestId,
      })
    }

    const status = createdAuthUser ? 201 : 200
    console.log('[invite-portal-user] portal access provisioned', {
      portalRole, created: createdAuthUser, grant: result?.grant?.action, email_sent: emailSent, request_id: requestId,
    })
    return res.status(status).json({
      success: true,
      message: createdAuthUser
        ? (emailSent ? 'Portal invitation sent and access granted.' : 'Portal access granted. The invitation email could not be sent; please resend.')
        : 'Portal access updated.',
      email_sent: createdAuthUser ? emailSent : undefined,
      provisioned: {
        role: result?.role,
        grant_action: result?.grant?.action,
        starts_at: result?.grant?.starts_at,
        expires_at: result?.grant?.expires_at,
      },
    })
  } catch (err) {
    if (createdAuthUser) {
      try { await db.auth.admin.deleteUser(authUserId) } catch { /* logged below */ }
      console.log('[invite-portal-user] unexpected error after auth create; compensated', { request_id: requestId })
    }
    console.log('[invite-portal-user] unexpected error', { errorCode: err?.code, request_id: requestId })
    return res.status(500).json({ error: 'internal_error' })
  }
}
