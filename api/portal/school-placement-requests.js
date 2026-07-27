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
// PROVENANCE GATE (POST): recording the authenticated submitting profile requires a students column
// that does not exist yet (students has no submitting_profile_id / submitted_by). Per the approved
// provenance rule, submission must not silently omit that identity, so POST fails closed with 503
// submission_not_enabled until the migration in docs is applied. The GET list is fully live.
//
// Privacy posture: an explicit response allowlist. No interview scores or recommendations, no rubric
// or evaluation content, no shift narratives, no support requests, no disposition reasons, no
// compliance/health flags, no Unit Leader comments, and never another school's students.

import { verifyPortalAcademicPartnerCaller, resolveSchoolScopedStudents } from '../lib/schoolScope.js'

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

  // POST (create a placement request) is GATED on provenance. The auth chain above still runs first,
  // so an unauthorized caller is rejected before ever reaching this gate. No write is performed and
  // no partial provenance is stored. See docs/product/ACADEMIC_PARTNER_PLACEMENT_REQUESTS_HANDOFF.md.
  if (req.method === 'POST') {
    return res.status(503).json({
      error: 'submission_not_enabled',
      reason: 'provenance_pending_migration',
    })
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
