// api/student-unit-assignments-manage.js
//
// MULTI-UNIT-STUDENT-PLACEMENTS-2: Owner/Admin management of a student's unit
// assignments (view is client-side via RLS; every WRITE comes through here).
//
// Actions:
//   set_primary  - ATOMIC primary change via the set_primary_unit_assignment
//                  RPC (20260817000000): end old, promote-or-insert new, and
//                  students.matched_unit_id follows in the same transaction.
//   add          - a new 'additional' assignment, active or planned, with dates.
//   update       - dates/notes on an existing row (never role/status here).
//   end          - status -> 'ended' with ended_at/ended_by (history preserved).
//   remove       - status -> 'removed' (the record was wrong; validates nothing).
//
// EVERY write is gated on sua_sync_ready(): if the sync migration is not
// applied, matched_unit_id would silently drift from the assignment rows, so
// the endpoint refuses with 'migration_required' instead. Fail closed on sync,
// not halfway.
//
// Authorization: verified JWT -> active Owner/Admin user_profiles row. The
// browser never writes assignment rows directly (RLS has no write policy), and
// this endpoint never trusts a client-supplied cohort or actor.
//
// NOTHING here reads shift logs: assignments are staff decisions, entered by
// staff, never inferred.

/* global process */

import { createClient } from '@supabase/supabase-js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const isUuid = (v) => typeof v === 'string' && UUID_RE.test(v)
const YMD_RE = /^\d{4}-\d{2}-\d{2}$/
const ymdOrNull = (v) => (typeof v === 'string' && YMD_RE.test(v) ? v : null)

async function verifyOwnerAdminCaller(req) {
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
    // Owner/Admin only - assignment management is placement authority.
    if (!['owner', 'admin'].includes(profile.role || '')) {
      return { ok: false, status: 403, error: 'forbidden' }
    }
    return { ok: true, db: admin, profile }
  } catch {
    return { ok: false, status: 401, error: 'unauthorized' }
  }
}

/** The sync migration must be applied before ANY write; otherwise refuse. */
async function syncReady(db) {
  const { data, error } = await db.rpc('sua_sync_ready')
  if (error) return false   // PGRST202 (missing function) or anything else: not ready
  return data === true
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })

  const auth = await verifyOwnerAdminCaller(req)
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error })
  const { db, profile } = auth

  const body = (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) ? req.body : {}
  const action = typeof body.action === 'string' ? body.action : ''

  if (!(await syncReady(db))) {
    return res.status(503).json({
      error: 'migration_required',
      detail: 'Apply 20260817000000_student_unit_assignment_sync before managing assignments.',
    })
  }

  try {
    // ── set_primary: the atomic RPC ─────────────────────────────────────────
    if (action === 'set_primary') {
      if (!isUuid(body.student_id) || !isUuid(body.unit_id)) {
        return res.status(400).json({ error: 'student_id_and_unit_id_required' })
      }
      const { data, error } = await db.rpc('set_primary_unit_assignment', {
        p_student_id: body.student_id,
        p_unit_id: body.unit_id,
        p_actor_profile_id: profile.id,
        p_start_date: ymdOrNull(body.start_date),
      })
      if (error) return res.status(500).json({ error: 'set_primary_failed' })
      if (data && data.ok === false) return res.status(400).json({ error: data.error })
      return res.status(200).json({ success: true, result: data })
    }

    // ── add: a new additional (or planned) assignment ───────────────────────
    if (action === 'add') {
      if (!isUuid(body.student_id) || !isUuid(body.unit_id)) {
        return res.status(400).json({ error: 'student_id_and_unit_id_required' })
      }
      const status = body.status === 'planned' ? 'planned' : 'active'
      // Cohort authority is the STUDENT's cohort, never the client's claim.
      const { data: student, error: sErr } = await db
        .from('students').select('id, cohort_id').eq('id', body.student_id).maybeSingle()
      if (sErr || !student) return res.status(404).json({ error: 'student_not_found' })

      const { data: row, error } = await db
        .from('student_unit_assignments')
        .insert({
          student_id: student.id,
          cohort_id: student.cohort_id,
          unit_id: body.unit_id,             // unit_key derived + cohort enforced by the DB
          role: 'additional',
          status,
          start_date: ymdOrNull(body.start_date),
          end_date: ymdOrNull(body.end_date),
          notes: typeof body.notes === 'string' ? body.notes.slice(0, 2000) : null,
          assigned_by: profile.id,
        })
        .select('id')
        .single()
      if (error) {
        // Constraint rejections surface as actionable errors, not 500s.
        const msg = String(error.message || '')
        if (/uq_sua_one_live_row_per_student_unit/.test(msg)) {
          return res.status(409).json({ error: 'unit_already_live_for_student' })
        }
        if (/fk_sua_unit_cohort/.test(msg)) {
          return res.status(400).json({ error: 'unit_not_in_student_cohort' })
        }
        return res.status(400).json({ error: 'add_rejected' })
      }
      return res.status(200).json({ success: true, id: row.id })
    }

    // ── update / end / remove: single-row operations by id ──────────────────
    if (['update', 'end', 'remove'].includes(action)) {
      if (!isUuid(body.assignment_id)) return res.status(400).json({ error: 'assignment_id_required' })

      let patch
      if (action === 'update') {
        patch = {}
        if ('start_date' in body) patch.start_date = ymdOrNull(body.start_date)
        if ('end_date' in body) patch.end_date = ymdOrNull(body.end_date)
        if ('notes' in body) patch.notes = typeof body.notes === 'string' ? body.notes.slice(0, 2000) : null
        if (Object.keys(patch).length === 0) return res.status(400).json({ error: 'nothing_to_update' })
      } else {
        patch = {
          status: action === 'end' ? 'ended' : 'removed',
          ended_at: new Date().toISOString(),
          ended_by: profile.id,
        }
      }

      const { data: rows, error } = await db
        .from('student_unit_assignments')
        .update(patch)
        .eq('id', body.assignment_id)
        .select('id, role, status')
      if (error) {
        const msg = String(error.message || '')
        if (/chk_sua_period/.test(msg)) return res.status(400).json({ error: 'end_date_before_start_date' })
        return res.status(400).json({ error: `${action}_rejected` })
      }
      if (!rows || rows.length === 0) return res.status(404).json({ error: 'assignment_not_found' })
      return res.status(200).json({ success: true, assignment: rows[0] })
    }

    return res.status(400).json({ error: 'unknown_action' })
  } catch (err) {
    console.error('[student-unit-assignments-manage] unexpected error:', err?.message)
    return res.status(500).json({ error: 'internal_error' })
  }
}
