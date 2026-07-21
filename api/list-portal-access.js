// api/list-portal-access.js
//
// ASPIRE-PORTAL-ACCESS-UI: Owner/Admin, read-only listing of scoped portal
// access for the Accounts & Access directory. The browser must never read the
// protected authorization tables directly; this endpoint resolves them with the
// service role and returns SANITIZED summaries only.
//
// GET only. Authorization mirrors the invite/revoke endpoints: verified JWT plus
// the caller's authoritative user_profiles row; owners and admins only. Nothing
// in the query influences caller authority. It performs no mutation.
//
// One row per role grant (active and historical). Status is derived exactly as
// the Phase 2 migrations define "active". Never returns internal auth
// identifiers, revoker ids, service-role credentials, tokens, or raw db errors.

import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'crypto'

const PORTAL_ROLES = ['student', 'unit_leader', 'academic_partner']
const STATUSES = ['active', 'scheduled', 'expired', 'revoked']
const EXPIRING_SOON_DAYS = 30
const DEFAULT_LIMIT = 25
const MAX_LIMIT = 100

const str = (v) => (typeof v === 'string' ? v.trim() : '')

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
      .from('user_profiles').select('id, role, is_owner, is_active').eq('auth_user_id', user.id).maybeSingle()
    if (pErr) return { authenticated: false, status: 401, reason: 'profile_lookup_failed' }
    if (!profile) return { authenticated: false, status: 403, reason: 'no_profile' }
    // UL-PORTAL: is_active is REQUIRED here. These endpoints grant and revoke
    // user_unit_scopes, and only an ACTIVE Owner/Admin may manage Unit Leader
    // assignments. A deactivated Owner/Admin previously retained full grant and
    // revoke authority because is_active was never selected. Fail closed.
    if (profile.is_active === false) return { authenticated: false, status: 403, reason: 'inactive' }
    return { authenticated: true, role: profile.role || '', isOwner: profile.is_owner === true }
  } catch {
    return { authenticated: false, status: 401, reason: 'profile_threw' }
  }
}

// Status derivation, identical to src/lib/portalAccessStatus.js (server copy so
// the endpoint stays self-contained).
function deriveStatus(grant, nowMs) {
  if (grant.revoked_at) return 'revoked'
  const starts = grant.starts_at ? Date.parse(grant.starts_at) : null
  const expires = grant.expires_at ? Date.parse(grant.expires_at) : null
  if (expires != null && expires <= nowMs) return 'expired'
  if (starts != null && starts > nowMs) return 'scheduled'
  return 'active'
}

function isExpiringSoon(grant, nowMs) {
  if (deriveStatus(grant, nowMs) !== 'active' || !grant.expires_at) return false
  const expires = Date.parse(grant.expires_at)
  return expires > nowMs && expires <= nowMs + EXPIRING_SOON_DAYS * 86400000
}

const cohortName = (id, cohortsById) => (id && cohortsById[id]) || null

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' })

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY || !(process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL)) {
    return res.status(500).json({ error: 'internal_error' })
  }

  const requestId = `req_${randomUUID().slice(0, 8)}`

  const auth = await verifyCaller(req)
  if (!auth.authenticated) {
    console.log('[list-portal-access] auth rejected', { reason: auth.reason, request_id: requestId })
    return res.status(auth.status === 403 ? 403 : 401).json({ error: auth.status === 403 ? 'forbidden' : 'unauthorized' })
  }
  if (!(auth.isOwner || auth.role === 'admin')) {
    console.log('[list-portal-access] insufficient caller authority', { callerRole: auth.role, request_id: requestId })
    return res.status(403).json({ error: 'forbidden', message: 'You do not have permission to view portal access.' })
  }

  const q = req.query || {}
  const search = str(q.search).toLowerCase()
  const roleFilter = PORTAL_ROLES.includes(str(q.role)) ? str(q.role) : ''
  const statusFilter = STATUSES.includes(str(q.status)) ? str(q.status) : ''
  const scopeFilter = str(q.scope).toLowerCase()
  let limit = parseInt(q.limit, 10); if (!Number.isFinite(limit) || limit <= 0) limit = DEFAULT_LIMIT
  limit = Math.min(limit, MAX_LIMIT)
  let offset = parseInt(q.offset, 10); if (!Number.isFinite(offset) || offset < 0) offset = 0

  const nowMs = Date.now()
  const db = getServiceDb()

  try {
    // 1. All role grants (active + historical), newest first. Bounded fetch:
    //    the pilot scale is tiny; we resolve, filter, then paginate in-endpoint.
    const { data: grants, error: gErr } = await db
      .from('user_role_grants')
      .select('id, user_profile_id, role, granted_at, starts_at, expires_at, revoked_at')
      .order('granted_at', { ascending: false })
      .limit(2000)
    if (gErr) { console.log('[list-portal-access] grant read failed', { errorCode: gErr.code, request_id: requestId }); return res.status(500).json({ error: 'internal_error' }) }

    const profileIds = [...new Set((grants || []).map(g => g.user_profile_id))]
    let profilesById = {}
    if (profileIds.length) {
      const { data: profs, error: pErr } = await db
        .from('user_profiles').select('id, full_name, email, role, last_login_at').in('id', profileIds)
      if (pErr) { console.log('[list-portal-access] profile read failed', { errorCode: pErr.code, request_id: requestId }); return res.status(500).json({ error: 'internal_error' }) }
      profilesById = Object.fromEntries((profs || []).map(p => [p.id, p]))
    }

    // 2. Active scope rows per role, resolved to display labels.
    const { data: links } = profileIds.length ? await db
      .from('user_student_links').select('user_profile_id, student_id, revoked_at').in('user_profile_id', profileIds) : { data: [] }
    const { data: unitScopes } = profileIds.length ? await db
      .from('user_unit_scopes').select('user_profile_id, unit_key, cohort_id, revoked_at, expires_at, starts_at').in('user_profile_id', profileIds) : { data: [] }
    const { data: schoolScopes } = profileIds.length ? await db
      .from('user_school_scopes').select('user_profile_id, school_key, cohort_id, revoked_at, expires_at, starts_at').in('user_profile_id', profileIds) : { data: [] }

    const studentIds = [...new Set((links || []).filter(l => !l.revoked_at).map(l => l.student_id))]
    let studentsById = {}
    if (studentIds.length) {
      const { data: studs } = await db
        .from('students').select('id, first_name, last_name, preferred_first_name, school, cohort_id').in('id', studentIds)
      studentsById = Object.fromEntries((studs || []).map(s => [s.id, s]))
    }
    const cohortIds = [...new Set([
      ...Object.values(studentsById).map(s => s.cohort_id),
      ...(unitScopes || []).map(u => u.cohort_id),
      ...(schoolScopes || []).map(s => s.cohort_id),
    ].filter(Boolean))]
    let cohortsById = {}
    if (cohortIds.length) {
      const { data: cohorts } = await db.from('cohorts').select('id, name').in('id', cohortIds)
      cohortsById = Object.fromEntries((cohorts || []).map(c => [c.id, c.name]))
    }

    const studentName = (s) => s ? [s.preferred_first_name || s.first_name, s.last_name].filter(Boolean).join(' ') : null

    // 3. Build one sanitized record per grant.
    const records = (grants || []).map(g => {
      const p = profilesById[g.user_profile_id] || {}
      const status = deriveStatus(g, nowMs)
      const scope = { students: [], units: [], schools: [] }
      if (g.role === 'student') {
        scope.students = (links || [])
          .filter(l => l.user_profile_id === g.user_profile_id && !l.revoked_at)
          .map(l => {
            const s = studentsById[l.student_id]
            return { student_id: l.student_id, name: studentName(s), school: s?.school || null, cohort: cohortName(s?.cohort_id, cohortsById) }
          })
      } else if (g.role === 'unit_leader') {
        scope.units = (unitScopes || [])
          .filter(u => u.user_profile_id === g.user_profile_id && !u.revoked_at)
          .map(u => ({ unit_key: u.unit_key, cohort: cohortName(u.cohort_id, cohortsById) }))
      } else if (g.role === 'academic_partner') {
        scope.schools = (schoolScopes || [])
          .filter(s => s.user_profile_id === g.user_profile_id && !s.revoked_at)
          .map(s => ({ school_key: s.school_key, cohort: cohortName(s.cohort_id, cohortsById) }))
      }
      return {
        grant_id: g.id,
        user_profile_id: g.user_profile_id, // required only so the client can submit a revoke
        full_name: p.full_name || null,
        email: p.email || null,
        portal_role: g.role,
        status,
        starts_at: g.starts_at || null,
        expires_at: g.expires_at || null,
        expiring_soon: isExpiringSoon(g, nowMs),
        scope,
      }
    })

    // 4. Counts across the FULL (unfiltered) set for the summary indicators.
    const counts = { active: 0, scheduled: 0, expired: 0, revoked: 0, expiring_soon: 0, portal_users: 0 }
    const activeProfiles = new Set()
    for (const r of records) {
      counts[r.status] = (counts[r.status] || 0) + 1
      if (r.expiring_soon) counts.expiring_soon += 1
      if (r.status === 'active') activeProfiles.add(r.user_profile_id)
    }
    counts.portal_users = activeProfiles.size

    // 5. Apply filters + search, then paginate.
    const matches = (r) => {
      if (roleFilter && r.portal_role !== roleFilter) return false
      if (statusFilter && r.status !== statusFilter) return false
      if (search) {
        const hay = `${r.full_name || ''} ${r.email || ''}`.toLowerCase()
        if (!hay.includes(search)) return false
      }
      if (scopeFilter) {
        const scopeHay = [
          ...r.scope.students.map(s => `${s.name || ''} ${s.school || ''}`),
          ...r.scope.units.map(u => u.unit_key || ''),
          ...r.scope.schools.map(s => s.school_key || ''),
        ].join(' ').toLowerCase()
        if (!scopeHay.includes(scopeFilter)) return false
      }
      return true
    }
    const filtered = records.filter(matches)
    const total = filtered.length
    const page = filtered.slice(offset, offset + limit)

    // 6. Pending invitations: portal auth users invited but not yet accepted,
    //    cross-referenced by email against portal grants. Reliable via the auth
    //    admin API (invited_at / confirmed_at / last_sign_in_at).
    const pending = []
    let pendingAvailable = true
    try {
      const emailsWithGrant = new Set(records.map(r => (r.email || '').toLowerCase()).filter(Boolean))
      const { data: list, error: luErr } = await db.auth.admin.listUsers({ page: 1, perPage: 200 })
      if (luErr) { pendingAvailable = false }
      else {
        for (const u of (list?.users || [])) {
          const email = (u.email || '').toLowerCase()
          if (!emailsWithGrant.has(email)) continue
          const accepted = !!(u.email_confirmed_at || u.confirmed_at || u.last_sign_in_at)
          if (accepted) continue
          const rec = records.find(r => (r.email || '').toLowerCase() === email && r.status !== 'revoked')
          if (!rec) continue
          pending.push({
            user_profile_id: rec.user_profile_id,
            full_name: rec.full_name,
            email: rec.email,
            portal_role: rec.portal_role,
            scope: rec.scope,
            invited_at: u.invited_at || u.created_at || null,
            expires_at: rec.expires_at,
          })
        }
      }
    } catch { pendingAvailable = false }

    console.log('[list-portal-access] served', { total, returned: page.length, request_id: requestId })
    return res.status(200).json({
      accounts: page,
      total,
      limit,
      offset,
      counts,
      pending,
      pending_available: pendingAvailable,
    })
  } catch (err) {
    console.log('[list-portal-access] unexpected error', { errorCode: err?.code, request_id: requestId })
    return res.status(500).json({ error: 'internal_error' })
  }
}
