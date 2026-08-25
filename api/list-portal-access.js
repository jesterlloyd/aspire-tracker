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
// ACCOUNTS-ACCESS-DIRECTORY-2: same normalization used for the contacts
// avatar fallback match, so an email that differs only by case, whitespace,
// or a zero-width character still resolves.
import { normalizeEmailForLookup } from '../src/lib/emailUtils.js'

const PORTAL_ROLES = ['student', 'unit_leader', 'academic_partner', 'nursing_academic']
// ACCOUNTS-ACCESS-DIRECTORY-2: 'pending' is a real derived status (a portal
// auth user who has not yet accepted their invitation), not only the legacy
// `pending` array. It overrides 'active'/'scheduled' only, see step 3 below.
const STATUSES = ['active', 'scheduled', 'expired', 'revoked', 'pending']
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
    // ACCOUNTS-PERF-AVATARS-1: the reads below are grouped into dependency
    // WAVES and awaited together instead of one-after-another. Same queries,
    // same error handling, same data - only the waiting overlaps. The serial
    // chain drops from nine sequential roundtrips to five waves, and the
    // slowest independent call (auth.admin.listUsers) now overlaps the whole
    // grants -> profiles -> scopes chain instead of adding to it.

    // Wave 1: grants, plus the two reads that depend on nothing else.
    // 1. All role grants (active + historical), newest first. Bounded fetch:
    //    the pilot scale is tiny; we resolve, filter, then paginate in-endpoint.
    // ACCOUNTS-ACCESS-DIRECTORY-2: portal avatars. A profile with no avatar_url
    // falls back to an exact normalized-email match against contacts.avatar_url.
    // Bounded read (contacts with a photo are a small subset); built once and
    // reused for every record below.
    // 3. Pending invitations: portal auth users invited but not yet accepted.
    //    Computed BEFORE record building so 'pending' can be applied as a real
    //    derived status (not only the legacy `pending` array below). Reliable
    //    via the auth admin API (invited_at / confirmed_at / last_sign_in_at).
    const pendingPromise = (async () => {
      const pendingEmails = new Set()
      const pendingInvitedAtByEmail = new Map()
      try {
        const { data: list, error: luErr } = await db.auth.admin.listUsers({ page: 1, perPage: 200 })
        if (luErr) return { pendingAvailable: false, pendingEmails, pendingInvitedAtByEmail }
        for (const u of (list?.users || [])) {
          const email = (u.email || '').toLowerCase()
          if (!email) continue
          const accepted = !!(u.email_confirmed_at || u.confirmed_at || u.last_sign_in_at)
          if (accepted) continue
          pendingEmails.add(email)
          pendingInvitedAtByEmail.set(email, u.invited_at || u.created_at || null)
        }
        return { pendingAvailable: true, pendingEmails, pendingInvitedAtByEmail }
      } catch { return { pendingAvailable: false, pendingEmails, pendingInvitedAtByEmail } }
    })()
    const contactsPromise = db
      .from('contacts').select('email, avatar_url').not('avatar_url', 'is', null).limit(2000)
    const { data: grants, error: gErr } = await db
      .from('user_role_grants')
      .select('id, user_profile_id, role, granted_at, starts_at, expires_at, revoked_at, contacts_access')
      .order('granted_at', { ascending: false })
      .limit(2000)
    if (gErr) { console.log('[list-portal-access] grant read failed', { errorCode: gErr.code, request_id: requestId }); return res.status(500).json({ error: 'internal_error' }) }

    // Wave 2: profiles (needs the grant profileIds).
    const profileIds = [...new Set((grants || []).map(g => g.user_profile_id))]
    let profilesById = {}
    if (profileIds.length) {
      const { data: profs, error: pErr } = await db
        .from('user_profiles').select('id, full_name, email, role, last_login_at, avatar_url').in('id', profileIds)
      if (pErr) { console.log('[list-portal-access] profile read failed', { errorCode: pErr.code, request_id: requestId }); return res.status(500).json({ error: 'internal_error' }) }
      profilesById = Object.fromEntries((profs || []).map(p => [p.id, p]))
    }

    // Wave 3: the three scope tables, each keyed only by profileIds.
    // 2. Active scope rows per role, resolved to display labels.
    const [{ data: links }, { data: unitScopes }, { data: schoolScopes }] = profileIds.length
      ? await Promise.all([
          db.from('user_student_links').select('user_profile_id, student_id, revoked_at').in('user_profile_id', profileIds),
          db.from('user_unit_scopes').select('user_profile_id, unit_key, cohort_id, revoked_at, expires_at, starts_at').in('user_profile_id', profileIds),
          db.from('user_school_scopes').select('user_profile_id, school_key, cohort_id, revoked_at, expires_at, starts_at').in('user_profile_id', profileIds),
        ])
      : [{ data: [] }, { data: [] }, { data: [] }]

    // Wave 4: students (needs links).
    const studentIds = [...new Set((links || []).filter(l => !l.revoked_at).map(l => l.student_id))]
    let studentsById = {}
    if (studentIds.length) {
      const { data: studs } = await db
        .from('students').select('id, first_name, last_name, preferred_first_name, school, cohort_id').in('id', studentIds)
      studentsById = Object.fromEntries((studs || []).map(s => [s.id, s]))
    }

    // Wave 5: cohorts (needs students + unit/school scopes).
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

    // Join the wave-1 side reads (both settle without throwing by construction:
    // the supabase client returns { data, error }, and pendingPromise catches).
    const { data: avatarContacts } = await contactsPromise
    const contactAvatarByEmail = new Map(
      (avatarContacts || [])
        .filter(c => c.email && c.avatar_url)
        .map(c => [normalizeEmailForLookup(c.email), c.avatar_url])
    )
    const { pendingAvailable, pendingEmails, pendingInvitedAtByEmail } = await pendingPromise

    // 4. Build one sanitized record per grant.
    const records = (grants || []).map(g => {
      const p = profilesById[g.user_profile_id] || {}
      let status = deriveStatus(g, nowMs)
      // 'revoked' and 'expired' always win over 'pending'; only an 'active' or
      // 'scheduled' grant can be reclassified as an unaccepted invitation.
      if ((status === 'active' || status === 'scheduled') && pendingEmails.has((p.email || '').toLowerCase())) {
        status = 'pending'
      }
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
        contacts_access: g.role === 'nursing_academic' && g.contacts_access === 'manage' ? 'manage' : 'view',
        status,
        starts_at: g.starts_at || null,
        expires_at: g.expires_at || null,
        expiring_soon: isExpiringSoon(g, nowMs),
        scope,
        last_login_at: p.last_login_at || null,
        avatar_url: p.avatar_url || contactAvatarByEmail.get(normalizeEmailForLookup(p.email)) || null,
      }
    })

    // 5. Counts across the FULL (unfiltered) set for the summary indicators.
    // ACCOUNTS-KPI-SORT-1 (additive): all_grants + by_role feed the portal KPI cards.
    // Each role count equals the rows that role's filter reveals (all statuses), so a
    // card's number always matches what clicking it shows. portal_users (distinct
    // ACTIVE profiles) is retained unchanged for response compatibility.
    const counts = {
      active: 0, scheduled: 0, expired: 0, revoked: 0, pending: 0, expiring_soon: 0,
      portal_users: 0, all_grants: records.length,
      by_role: { student: 0, unit_leader: 0, academic_partner: 0, nursing_academic: 0 },
    }
    const activeProfiles = new Set()
    for (const r of records) {
      counts[r.status] = (counts[r.status] || 0) + 1
      if (r.expiring_soon) counts.expiring_soon += 1
      if (r.status === 'active') activeProfiles.add(r.user_profile_id)
      if (counts.by_role[r.portal_role] !== undefined) counts.by_role[r.portal_role] += 1
    }
    counts.portal_users = activeProfiles.size

    // 6. Apply filters + search, then paginate.
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

    // 7. Legacy `pending` array, kept for response compatibility: the same
    //    shape as before, now built directly from records already carrying the
    //    derived 'pending' status (computed in step 3/4 above).
    const pending = records
      .filter(r => r.status === 'pending')
      .map(r => ({
        user_profile_id: r.user_profile_id,
        full_name: r.full_name,
        email: r.email,
        portal_role: r.portal_role,
        contacts_access: r.contacts_access,
        scope: r.scope,
        invited_at: pendingInvitedAtByEmail.get((r.email || '').toLowerCase()) || null,
        expires_at: r.expires_at,
      }))

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
