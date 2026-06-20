// api/preceptor-assignments.js
//
// PRECEPTOR-MODEL-3 (Part B): Owner/Admin server-verified write path for ADDITIONAL (secondary /
// coverage) preceptor assignments in student_preceptor_assignments. The table has NO client write
// policy (Owner/Admin SELECT RLS only), so all writes go through this service-role endpoint AFTER a
// server-side Owner/Admin check — req.body never influences authorization.
//
// STRICT GUARDRAILS:
//   • Creates ONLY role='secondary' or 'coverage'. NEVER 'primary' — the primary relationship stays
//     owned by students.preceptor_id and its existing workflow. Primary rows are not writable here.
//   • Relationship-level dedup is enforced by the DB (Part A index
//     uq_spa_one_active_relationship_per_student_cohort_preceptor): a second ACTIVE row for the same
//     (student, cohort, preceptor) — any role — is rejected (23505) and surfaced as a clear 409.
//   • End/remove is a soft status change (active -> ended|removed); rows are never hard-deleted. The
//     endpoint refuses to modify role='primary' rows.
//   • PLANNED/STANDING coverage only. Single-shift substitution is a future shift-log concern — not here.
//
// POST   { studentId, preceptorId, role:'secondary'|'coverage', startDate?, endDate?, notes? }
// PATCH  { assignmentId, status:'ended'|'removed' }
// Authorization: Bearer <session token>  (Owner/Admin)

import { createClient } from '@supabase/supabase-js'

const ROLES_ALLOWED   = new Set(['secondary', 'coverage'])  // never 'primary'
const END_STATUSES    = new Set(['ended', 'removed'])
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const isUuid = v => typeof v === 'string' && UUID_PATTERN.test(v)

// Strict YYYY-MM-DD validator: format AND a real calendar date (rejects e.g. 2026-13-40, which
// would otherwise roll over and slip past a regex). Returns false for anything non-conforming.
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
function isValidDateStr(s) {
  if (!DATE_RE.test(s)) return false
  const d = new Date(`${s}T00:00:00Z`)
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s
}

// Server-verified caller identity (WS1 pattern, mirrors api/student-update.js verifyCaller).
// req.body never influences authorization.
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
      .from('user_profiles').select('id, role, is_owner').eq('auth_user_id', user.id).maybeSingle()
    if (pErr || !profile) return { ok: false, status: 403, error: 'Forbidden' }
    // Effective Owner/Admin rule — honors is_owner, matching the canonical app convention
    // (api/student-update.js: auth.isOwner || role === 'admin'); union with explicit roles here.
    const role = profile.role || ''
    const isOwnerAdmin = profile.is_owner === true || ['owner', 'admin'].includes(role)
    if (!isOwnerAdmin) return { ok: false, status: 403, error: 'Forbidden' }
    return { ok: true, admin, profileId: profile.id }
  } catch {
    return { ok: false, status: 401, error: 'Unauthorized' }
  }
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')

  if (!['POST', 'PATCH'].includes(req.method)) {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const caller = await verifyCaller(req)
    if (!caller.ok) return res.status(caller.status).json({ error: caller.error })
    const admin = caller.admin

    let body
    try {
      body = (req.body && typeof req.body === 'object') ? req.body : JSON.parse(req.body)
    } catch {
      return res.status(400).json({ error: 'Invalid request body' })
    }
    if (!body || typeof body !== 'object') return res.status(400).json({ error: 'Invalid request body' })

    // ── PATCH: end / remove an existing secondary/coverage assignment (soft) ──────
    if (req.method === 'PATCH') {
      const { assignmentId, status } = body
      if (!isUuid(assignmentId)) return res.status(400).json({ error: 'assignmentId must be a valid UUID' })
      if (!END_STATUSES.has(status)) return res.status(400).json({ error: "status must be 'ended' or 'removed'" })

      const { data: existing, error: exErr } = await admin
        .from('student_preceptor_assignments')
        .select('id, role, status')
        .eq('id', assignmentId)
        .maybeSingle()
      if (exErr) return res.status(500).json({ error: 'Failed to load assignment' })
      if (!existing) return res.status(404).json({ error: 'Assignment not found' })
      if (existing.role === 'primary') {
        // Primary is owned by students.preceptor_id and its workflow — never mutated here.
        return res.status(403).json({ error: 'Primary assignments are managed through the primary preceptor workflow.' })
      }

      const patch = { status, updated_at: new Date().toISOString() }
      if (status === 'ended') patch.end_date = new Date().toISOString().slice(0, 10)

      const { data: updated, error: upErr } = await admin
        .from('student_preceptor_assignments')
        .update(patch)
        .eq('id', assignmentId)
        .select('id, student_id, preceptor_id, cohort_id, role, status')
        .single()
      if (upErr || !updated) return res.status(500).json({ error: 'Failed to update assignment' })
      return res.status(200).json({ assignment: updated })
    }

    // ── POST: create a secondary/coverage active assignment ───────────────────────
    const { studentId, preceptorId, role, startDate, endDate, notes } = body
    if (!isUuid(studentId))   return res.status(400).json({ error: 'studentId must be a valid UUID' })
    if (!isUuid(preceptorId)) return res.status(400).json({ error: 'preceptorId must be a valid UUID' })
    if (!ROLES_ALLOWED.has(role)) {
      return res.status(400).json({ error: "role must be 'secondary' or 'coverage' (primary is not created here)" })
    }

    // Optional dates: blank/undefined allowed; if present must be YYYY-MM-DD; start <= end.
    // Validated here so a malformed date returns a clear 400 instead of a generic Supabase 500.
    const sd = (typeof startDate === 'string' && startDate.trim()) ? startDate.trim() : null
    const ed = (typeof endDate === 'string' && endDate.trim()) ? endDate.trim() : null
    if (sd !== null && !isValidDateStr(sd)) return res.status(400).json({ error: 'startDate must be a valid date (YYYY-MM-DD)' })
    if (ed !== null && !isValidDateStr(ed)) return res.status(400).json({ error: 'endDate must be a valid date (YYYY-MM-DD)' })
    if (sd !== null && ed !== null && sd > ed) return res.status(400).json({ error: 'startDate must be on or before endDate' })

    // Resolve cohort_id server-side from the student (never trust the body for it).
    const { data: student, error: sErr } = await admin
      .from('students').select('id, cohort_id').eq('id', studentId).maybeSingle()
    if (sErr) return res.status(500).json({ error: 'Failed to load student' })
    if (!student) return res.status(404).json({ error: 'Student not found' })
    if (!student.cohort_id) return res.status(400).json({ error: 'Student has no cohort' })

    const { data: preceptor, error: pErr } = await admin
      .from('preceptors').select('id').eq('id', preceptorId).maybeSingle()
    if (pErr) return res.status(500).json({ error: 'Failed to load preceptor' })
    if (!preceptor) return res.status(404).json({ error: 'Preceptor not found' })

    const insertRow = {
      student_id:   studentId,
      preceptor_id: preceptorId,
      cohort_id:    student.cohort_id,
      role,
      status:       'active',
      start_date:   sd,
      end_date:     ed,
      notes:        (typeof notes === 'string' && notes.trim()) ? notes.trim().slice(0, 500) : null,
      assigned_by:  caller.profileId,
    }

    const { data: created, error: insErr } = await admin
      .from('student_preceptor_assignments')
      .insert(insertRow)
      .select('id, student_id, preceptor_id, cohort_id, role, status, start_date, end_date, notes')
      .single()

    if (insErr) {
      // 23505 from the relationship-level partial unique index = this preceptor already has an active
      // assignment for this student/cohort (in ANY role, incl. the current primary).
      if (insErr.code === '23505') {
        return res.status(409).json({
          error: 'This preceptor already has an active assignment for this student. End the existing assignment first to change their role.',
          code:  'duplicate_active_relationship',
        })
      }
      console.error('[preceptor-assignments] insert error:', insErr.code, insErr.message)
      return res.status(500).json({ error: 'Failed to create assignment' })
    }

    return res.status(200).json({ assignment: created })
  } catch (err) {
    // Log a minimal server-side message; never expose raw internal exception text to the browser.
    console.error('[preceptor-assignments] unhandled exception:', err?.message || err)
    return res.status(500).json({ error: 'Server error' })
  }
}
