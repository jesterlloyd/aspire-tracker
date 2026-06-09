// api/update-rotation-dates.js
//
// WS1e-B: secure rotation-date administration.
//
// Admin override: update rotation_start_date / rotation_end_date on a
// cohort_school_rotations row (Owner/Admin only). Authorization is
// SERVER-VERIFIED (WS1/WS1b/WS1c/WS1d pattern). The previous "internal-only,
// no token check" comment was incorrect — the route is publicly reachable, so
// a verified Bearer token + role check is now required. Exact-schema enforced:
// only { rotation_id, rotation_start_date, rotation_end_date } are accepted.
//
// POST body: { rotation_id, rotation_start_date, rotation_end_date }
// Returns:   { success, affected_student_count, rotation_id }

import { createClient } from '@supabase/supabase-js'
import { toLocalDateStr } from '../shared/dateUtils.js'

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/
const ALLOWED_BODY_KEYS = ['rotation_id', 'rotation_start_date', 'rotation_end_date']

function findUnexpectedKeys(object, allowedKeys) {
  if (!object || typeof object !== 'object' || Array.isArray(object)) return []
  return Object.keys(object).filter(key => !allowedKeys.includes(key))
}

async function verifyCaller(req) {
  const authHeader = req.headers['authorization'] || req.headers['Authorization'] || ''
  const token = authHeader.replace(/^Bearer\s+/i, '').trim()
  if (!token) return { authenticated: false, status: 401, reason: 'missing_token' }

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

// Placement administration: Owner/Admin only (default deny).
function canChangeRotationDates(role, isOwner) {
  if (isOwner) return true
  return role === 'admin'
}

function getDb() {
  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })

  if (!(process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL) || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: 'internal_error' })
  }

  const requestId = `req_${Math.random().toString(36).slice(2, 10)}`

  // Gate 1 & 2: JWT + caller profile
  const auth = await verifyCaller(req)
  if (!auth.authenticated) {
    console.log('[update-rotation-dates] auth rejected', { reason: auth.reason, request_id: requestId })
    if (auth.reason === 'no_profile') return res.status(403).json({ error: 'forbidden', message: 'Access denied.' })
    return res.status(401).json({ error: 'unauthorized', message: 'Authentication required' })
  }

  // Gate 3: caller authorized (Owner/Admin only)
  if (!canChangeRotationDates(auth.role, auth.isOwner)) {
    console.log('[update-rotation-dates] insufficient authority', { callerRole: auth.role, callerIsOwner: auth.isOwner, request_id: requestId })
    return res.status(403).json({ error: 'forbidden', message: 'You do not have permission to change rotation dates.' })
  }

  // Gate 4: exact-schema enforcement (reject any unexpected/account-authority field)
  const body = (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) ? req.body : {}
  const unexpected = findUnexpectedKeys(body, ALLOWED_BODY_KEYS)
  if (unexpected.length > 0) {
    return res.status(400).json({ error: 'invalid_request', field: unexpected[0], message: 'Unexpected request field.' })
  }

  // Gate 5: input validation
  const rotationId = typeof body.rotation_id === 'string' ? body.rotation_id : null
  const startDate  = typeof body.rotation_start_date === 'string' ? body.rotation_start_date : null
  const endDate    = typeof body.rotation_end_date === 'string' ? body.rotation_end_date : null
  if (!rotationId || !UUID_REGEX.test(rotationId)) {
    return res.status(400).json({ error: 'invalid_request', field: 'rotation_id' })
  }
  if (!startDate || !DATE_REGEX.test(startDate)) {
    return res.status(400).json({ error: 'invalid_request', field: 'rotation_start_date', message: 'Expected YYYY-MM-DD.' })
  }
  if (!endDate || !DATE_REGEX.test(endDate)) {
    return res.status(400).json({ error: 'invalid_request', field: 'rotation_end_date', message: 'Expected YYYY-MM-DD.' })
  }
  if (endDate <= startDate) {
    return res.status(400).json({ error: 'invalid_request', field: 'rotation_end_date', message: 'End date must be after start date.' })
  }
  // Realistic range guard (defensive; ISO lexical compare is valid for YYYY-MM-DD)
  if (startDate < '2020-01-01' || endDate > '2100-01-01') {
    return res.status(400).json({ error: 'invalid_request', field: 'rotation_start_date', message: 'Date out of supported range.' })
  }

  const db = getDb()

  // Gate 6: resolve the rotation row
  const { data: current, error: fetchErr } = await db
    .from('cohort_school_rotations')
    .select('id, school_name, cohort_id, rotation_start_date, rotation_end_date')
    .eq('id', rotationId)
    .maybeSingle()
  if (fetchErr) return res.status(500).json({ error: 'internal_error' })
  if (!current) return res.status(404).json({ error: 'not_found' })

  // Count affected students
  const { count: affected } = await db
    .from('students')
    .select('id', { count: 'exact', head: true })
    .eq('cohort_school_rotation_id', rotationId)
  const affectedCount = affected ?? 0

  // Mutation
  const { error: updateErr } = await db
    .from('cohort_school_rotations')
    .update({ rotation_start_date: startDate, rotation_end_date: endDate, updated_at: new Date().toISOString() })
    .eq('id', rotationId)
  if (updateErr) {
    console.log('[update-rotation-dates] update failed', { request_id: requestId, errorCode: updateErr.code })
    return res.status(500).json({ error: 'internal_error' })
  }

  // Log rotation_updated events for each affected student (actor is server-set
  // 'system'; program_events.created_by is a free-text label, not a UUID FK).
  if (affectedCount > 0) {
    const { data: affectedStudents } = await db
      .from('students')
      .select('id, cohort_id')
      .eq('cohort_school_rotation_id', rotationId)

    const today = toLocalDateStr()
    const notes = `[Auto-logged] Rotation dates updated for ${current.school_name}. ` +
      `Old: ${current.rotation_start_date} to ${current.rotation_end_date}. ` +
      `New: ${startDate} to ${endDate}. ${affectedCount} student(s) affected.`

    const events = (affectedStudents || []).map(s => ({
      student_id: s.id, cohort_id: s.cohort_id, event_type: 'rotation_updated',
      event_date: today, notes, created_by: 'system',
    }))
    if (events.length) {
      try {
        const { error: logErr } = await db.from('program_events').insert(events)
        if (logErr) console.warn('[update-rotation-dates] event log error', { request_id: requestId, errorCode: logErr.code })
      } catch (logEx) {
        console.warn('[update-rotation-dates] event log threw', { request_id: requestId })
      }
    }
  }

  console.log('[update-rotation-dates] updated', { callerRole: auth.role, callerIsOwner: auth.isOwner, rotationId, affectedCount, request_id: requestId })
  return res.status(200).json({ success: true, rotation_id: rotationId, affected_student_count: affectedCount })
}
