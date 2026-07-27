/* global process */
// api/portal/school-placement-requests.js
//
// AP-PORTAL: the Academic Partner Placement Requests list (GET), plus the authenticated submission
// path (POST) which is currently GATED (see below). A placement request IS a students row (there is
// no separate request table); "At a Glance -> Placement Requests" in the Main App groups students by
// school, so a request written here is automatically visible there.
//
// Authorization is shared with the roster and photo endpoints via api/lib/schoolScope.js
// (verifyPortalAcademicPartnerCaller + resolveSchoolScopedStudents), so a partner sees exactly the
// students they are authorized for, WCU campuses stay isolated, and no request parameter widens
// scope. Fails closed: unauthenticated -> 401, non-partner -> 403.
//
// SUBMISSION (POST): the full server-side chain is verify JWT -> active academic_partner grant ->
// derive school scope -> validate the body -> re-derive and re-validate the school and cohort
// server-side (never trusting the browser) -> independently verify the cohort password on the FINAL
// POST -> gate on provenance readiness -> write via the shared helper. The client-side password gate
// is NOT trusted; the endpoint re-verifies. The password is transient: verified then dropped, never
// logged, echoed, persisted, or copied into any write payload.
//
// PROVENANCE READINESS GATE: the write is fail-closed until the provenance columns exist (the
// migration is applied). Readiness is detected at runtime (isPlacementProvenanceReady), never
// inferred from client state, so the SAME code path enables submission once the migration is applied,
// with no redeploy.
//
// Privacy posture: an explicit response allowlist. No interview scores or recommendations, no rubric
// or evaluation content, no shift narratives, no support requests, no disposition reasons, no
// compliance/health flags, no Unit Leader comments, and never another school's students.

import { verifyPortalAcademicPartnerCaller, resolveSchoolScopedStudents, matchSchoolCohortScope } from '../lib/schoolScope.js'
import { getCallerScopedDb } from '../lib/portalAuth.js'

// Explicit allowlist (allowlist, not denylist). Confirmed unit resolves through the reliable
// normalized matched_unit_id -> units, not the legacy free-text students.unit. created_at is the
// submission timestamp; cohort_school_rotation_id links the coordinator-owned rotation dates.
const STUDENT_COLUMNS = [
  'id', 'cohort_id', 'first_name', 'preferred_first_name', 'last_name',
  'school', 'status', 'matched_unit_id', 'preceptor_name',
  'hours_required', 'approved_hours', 'pending_hours',
  'created_at', 'cohort_school_rotation_id',
].join(', ')

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' })
  }

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY || !(process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL)) {
    return res.status(500).json({ error: 'internal_error' })
  }

  const auth = await verifyPortalAcademicPartnerCaller(req)
  if (!auth.ok) return res.status(auth.status).json({ error: auth.reason })

  const { db, scopes } = auth

  // POST creates a placement request. The auth chain above already ran, so an unauthorized caller is
  // rejected before reaching any of the submission logic.
  if (req.method === 'POST') {
    return submitPlacementRequest(req, res, auth)
  }

  if (scopes.length === 0) return res.status(200).json({ schools: [] })

  let scopeTerms, matches
  try {
    ;({ scopeTerms, matches } = await resolveSchoolScopedStudents(db, scopes, STUDENT_COLUMNS))
  } catch {
    return res.status(500).json({ error: 'internal_error' })
  }

  if (matches.length === 0) {
    return res.status(200).json({ schools: scopeTerms.map(t => ({ school_key: t.school_key, requests: [] })) })
  }

  // Cohort context (name, status, dates) for grouping and labels.
  const cohortIds = [...new Set(matches.map(m => m.student.cohort_id).filter(Boolean))]
  let cohortsById = {}
  if (cohortIds.length > 0) {
    const { data: cohorts, error: cErr } = await db
      .from('cohorts').select('id, name, status, start_date, end_date').in('id', cohortIds)
    if (cErr) return res.status(500).json({ error: 'internal_error' })
    cohortsById = Object.fromEntries((cohorts || []).map(c => [c.id, c]))
  }

  // Requested rotation dates (coordinator-owned) from cohort_school_rotations, linked per student.
  const rotationIds = [...new Set(matches.map(m => m.student.cohort_school_rotation_id).filter(Boolean))]
  let rotationById = {}
  if (rotationIds.length > 0) {
    const { data: rotations, error: rErr } = await db
      .from('cohort_school_rotations')
      .select('id, rotation_start_date, rotation_end_date')
      .in('id', rotationIds)
    if (rErr) return res.status(500).json({ error: 'internal_error' })
    rotationById = Object.fromEntries((rotations || []).map(r => [r.id, r]))
  }

  // Confirmed unit name from the reliable normalized assignment (matched_unit_id -> units.unit_name).
  const unitIds = [...new Set(matches.map(m => m.student.matched_unit_id).filter(Boolean))]
  let unitNameById = {}
  if (unitIds.length > 0) {
    const { data: units, error: uErr } = await db
      .from('units').select('id, unit_name').in('id', unitIds)
    if (uErr) return res.status(500).json({ error: 'internal_error' })
    unitNameById = Object.fromEntries((units || []).map(u => [u.id, u.unit_name]))
  }

  // Active primary preceptor (normalized model; legacy text fallback below).
  const studentIds = matches.map(m => m.student.id)
  const preceptorByStudent = {}
  {
    const { data: assignments } = await db
      .from('student_preceptor_assignments')
      .select('student_id, role, status, preceptors ( full_name )')
      .in('student_id', studentIds)
      .eq('status', 'active')
    for (const a of assignments || []) {
      if (!preceptorByStudent[a.student_id] || a.role === 'primary') {
        preceptorByStudent[a.student_id] = a.preceptors?.full_name || null
      }
    }
  }

  const bySchool = {}
  for (const { student: s, school_key } of matches) {
    const rot = rotationById[s.cohort_school_rotation_id] || null
    const entry = {
      id: s.id,
      first_name: s.first_name,
      preferred_first_name: s.preferred_first_name,
      last_name: s.last_name,
      status: s.status,
      cohort: cohortsById[s.cohort_id]
        ? {
            id: cohortsById[s.cohort_id].id,
            name: cohortsById[s.cohort_id].name,
            status: cohortsById[s.cohort_id].status,
            start_date: cohortsById[s.cohort_id].start_date,
            end_date: cohortsById[s.cohort_id].end_date,
          }
        : null,
      rotation: rot ? { start_date: rot.rotation_start_date || null, end_date: rot.rotation_end_date || null } : null,
      unit_name: unitNameById[s.matched_unit_id] || null,
      preceptor_name: preceptorByStudent[s.id] || s.preceptor_name || null,
      hours: {
        required: s.hours_required ?? null,
        approved: s.approved_hours ?? 0,
        pending: s.pending_hours ?? 0,
      },
      submitted_at: s.created_at || null,
    }
    ;(bySchool[school_key] ||= []).push(entry)
  }

  const schools = scopeTerms.map(t => ({
    school_key: t.school_key,
    requests: bySchool[t.school_key] || [],
  }))

  return res.status(200).json({ schools })
}

// Authenticated placement submission. The caller has already been verified as an active
// academic_partner with resolved school scopes. This validates the body, re-derives and re-validates
// the school and cohort SERVER-SIDE, and independently verifies the cohort password on the FINAL
// POST. The password is transient: verified here and then dropped. It is never copied into a write
// payload, logged, echoed in a response, or persisted.
async function submitPlacementRequest(req, res, auth) {
  const { scopes } = auth
  const db = auth.db

  const body = req.body && typeof req.body === 'object' ? req.body : {}
  const cohortId = typeof body.cohortId === 'string' ? body.cohortId : null
  const coordinator = (body.coordinator && typeof body.coordinator === 'object') ? body.coordinator : {}
  const school = String(coordinator.school || '').trim()
  const coordName = String(coordinator.name || '').trim()
  const coordEmail = String(coordinator.email || '').trim()
  const rotationStartDate = typeof body.rotationStartDate === 'string' ? body.rotationStartDate : ''
  const rotationEndDate = typeof body.rotationEndDate === 'string' ? body.rotationEndDate : ''
  const students = Array.isArray(body.students) ? body.students : []

  // Essential server-side validation (the shared client validation also runs, but the server never
  // trusts it). Generic message; pre-submit field guidance is the client's job.
  if (!cohortId || !school || !coordName || !coordEmail || !rotationStartDate || !rotationEndDate
      || rotationEndDate <= rotationStartDate || students.length === 0) {
    return res.status(400).json({ error: 'invalid_request' })
  }

  // School + cohort authorization: the submitted school/cohort MUST be within the caller's active
  // scopes. The browser-supplied school is NEVER trusted for authorization; it is validated here.
  if (!matchSchoolCohortScope(scopes, school, cohortId)) {
    return res.status(403).json({ error: 'forbidden' })
  }

  // Cohort re-derived + re-validated server-side: it must exist and be accepting submissions.
  const { data: cohort, error: cErr } = await db
    .from('cohorts').select('id, name, accepting_submissions').eq('id', cohortId).single()
  if (cErr || !cohort) return res.status(400).json({ error: 'invalid_cohort' })
  if (!cohort.accepting_submissions) return res.status(400).json({ error: 'cohort_not_accepting' })

  // Independent server-side password verification on the FINAL POST. The password RPCs grant EXECUTE
  // to the `authenticated` role, so they are called through a caller-scoped client (never the service
  // role). This is a real gate: a direct POST cannot bypass it.
  const caller = getCallerScopedDb(req)
  if (!caller) return res.status(401).json({ error: 'unauthorized' })

  let requiresPassword
  try {
    const { data, error } = await caller.rpc('school_form_requires_password', { p_cohort_id: cohortId })
    if (error) throw error
    requiresPassword = data === true
  } catch {
    return res.status(500).json({ error: 'internal_error' })
  }

  if (requiresPassword) {
    const entered = typeof body.password === 'string' ? body.password.trim() : ''
    if (!entered) return res.status(403).json({ error: 'password_required' })
    let ok
    try {
      const { data, error } = await caller.rpc('verify_school_form_password', {
        p_cohort_id: cohortId, p_entered_password: entered,
      })
      if (error) throw error
      ok = data === true
    } catch {
      return res.status(500).json({ error: 'internal_error' })
    }
    if (!ok) return res.status(403).json({ error: 'password_invalid' })
  }
  // The password (if any) has served its only purpose. It is intentionally NOT copied into any write
  // payload, log line, response body, or audit metadata.

  // Provenance-readiness gate + the shared write are wired in the next commit; until then the write
  // is fail-closed even after a valid password.
  return res.status(503).json({ error: 'submission_not_enabled', reason: 'provenance_pending_migration' })
}
