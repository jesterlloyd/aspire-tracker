/* global process */
// api/portal/school-students.js
//
// PHASE4-SCHOOL-PORTAL: academic partner roster endpoint.
//
// Data-access pattern (amendment 4): JWT-verified endpoint with a column
// allowlist. Chosen because school matching is alias-aware (students.school
// is text with historical variants) and the response derives
// evaluation-completion status, both easier to audit server-side.
//
// Authorization: verified JWT -> profile -> ACTIVE academic_partner grant ->
// ACTIVE user_school_scopes. No request parameter influences scope.
//
// Privacy posture (blueprint plus Owner decision item 8, conservative
// default): pipeline stage, placement, rotation dates, assigned shift type, hours, and
// completion/evaluation DONE-or-NOT status only. No interview scores or
// recommendations, no rubric or evaluation content, no shift-log narratives,
// no support requests, no disposition reasons, no compliance flags (the
// exact compliance field list awaits the Owner's decision item 8).

import { verifyPortalAcademicPartnerCaller, resolveSchoolScopedStudents, resolveSchoolScopedCohorts } from '../lib/schoolScope.js'
import { parseStoredFileRef } from '../../lib/server/studentFiles.js'

// Explicit allowlist (allowlist, not denylist, so a new students column is excluded by default).
// Confirmed unit resolves through the reliable normalized assignment matched_unit_id -> units, NOT
// the legacy free-text students.unit (which no writer populates, so it is unreliable and omitted).
// headshot_url is selected server-side ONLY to compute the has_photo boolean below; it is never
// placed on a response entry, and the photo bytes are served through the separate school-scoped
// file-access endpoint (a signed URL), never as a raw storage path.
const STUDENT_COLUMNS = [
  'id', 'cohort_id', 'first_name', 'preferred_first_name', 'last_name',
  'school', 'status', 'matched_unit_id', 'preceptor_name', 'term_dates',
  'hours_required', 'approved_hours', 'pending_hours', 'headshot_url',
  // UI-CONSISTENCY-5 (Owner decision, 2026-09-03): the assigned shift TYPE (Day / Night / Mid /
  // Variable), so a coordinator knows when to round. Shift-log content stays out.
  'shift_assigned',
].join(', ')

// A stored file reference resolves to a real object (not empty, not an unparseable value).
function hasFile(stored) {
  const ref = parseStoredFileRef(stored)
  return ref.kind !== 'empty' && ref.kind !== 'unknown'
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' })

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY || !(process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL)) {
    return res.status(500).json({ error: 'internal_error' })
  }

  // Authorization + school scope resolution are shared with the school-scoped file-access endpoint
  // (api/lib/schoolScope.js), so a photo is authorized on exactly the same rule as the roster it
  // appears in. Fails closed: unauthenticated -> 401, non-partner -> 403.
  const auth = await verifyPortalAcademicPartnerCaller(req)
  if (!auth.ok) return res.status(auth.status).json({ error: auth.reason })

  const { db, scopes } = auth
  if (scopes.length === 0) return res.status(200).json({ schools: [] })

  let scopeTerms, matches, cohortsBySchool
  try {
    ;({ scopeTerms, matches } = await resolveSchoolScopedStudents(db, scopes, STUDENT_COLUMNS))
    // Canonical, school-scoped cohorts (independent of the roster), so an open-but-empty cohort like
    // Fall still appears in the portal picker.
    cohortsBySchool = await resolveSchoolScopedCohorts(db, scopes, matches)
  } catch {
    return res.status(500).json({ error: 'internal_error' })
  }

  if (matches.length === 0) {
    return res.status(200).json({ schools: scopeTerms.map(t => ({ school_key: t.school_key, students: [], cohorts: cohortsBySchool.get(t.school_key) || [] })) })
  }

  const cohortIds = [...new Set(matches.map(m => m.student.cohort_id).filter(Boolean))]
  let cohortsById = {}
  if (cohortIds.length > 0) {
    const { data: cohorts, error: cErr } = await db
      .from('cohorts')
      .select('id, name, status, start_date, end_date')
      .in('id', cohortIds)
    if (cErr) return res.status(500).json({ error: 'internal_error' })
    cohortsById = Object.fromEntries((cohorts || []).map(c => [c.id, c]))
  }

  // Confirmed unit name from the reliable normalized assignment (matched_unit_id -> units.unit_name).
  const unitIds = [...new Set(matches.map(m => m.student.matched_unit_id).filter(Boolean))]
  let unitNameById = {}
  if (unitIds.length > 0) {
    const { data: units, error: uErr } = await db
      .from('units')
      .select('id, unit_name')
      .in('id', unitIds)
    if (uErr) return res.status(500).json({ error: 'internal_error' })
    unitNameById = Object.fromEntries((units || []).map(u => [u.id, u.unit_name]))
  }

  const studentIds = matches.map(m => m.student.id)

  // Active primary preceptor (normalized model; legacy text fallback below).
  const assignmentsByStudent = {}
  {
    const { data: assignments } = await db
      .from('student_preceptor_assignments')
      .select('student_id, role, status, preceptors ( full_name )')
      .in('student_id', studentIds)
      .eq('status', 'active')
    for (const a of assignments || []) {
      const current = assignmentsByStudent[a.student_id]
      if (!current || a.role === 'primary') {
        assignmentsByStudent[a.student_id] = a.preceptors?.full_name || null
      }
    }
  }

  // Evaluation completion: counts only, status level, never content.
  const evalsByStudent = {}
  {
    const { data: assignments } = await db
      .from('evaluation_assignments')
      .select('student_id, status, respondent_type')
      .in('student_id', studentIds)
      .eq('respondent_type', 'student')
    for (const a of assignments || []) {
      const bucket = evalsByStudent[a.student_id] || { completed: 0, pending: 0 }
      if (a.status === 'completed') bucket.completed += 1
      else if (!['revoked', 'expired', 'non_responder'].includes(a.status)) bucket.pending += 1
      evalsByStudent[a.student_id] = bucket
    }
  }

  const bySchool = {}
  for (const { student: s, school_key } of matches) {
    const entry = {
      id: s.id,
      first_name: s.first_name,
      preferred_first_name: s.preferred_first_name,
      last_name: s.last_name,
      status: s.status,
      // Presence-only signal: the client requests a signed photo URL from the file-access endpoint
      // for these students. The storage path itself never leaves the server.
      has_photo: hasFile(s.headshot_url),
      unit_name: unitNameById[s.matched_unit_id] || null,
      preceptor_name: assignmentsByStudent[s.id] || s.preceptor_name || null,
      term_dates: s.term_dates || null,
      shift_assigned: s.shift_assigned || null,
      cohort: cohortsById[s.cohort_id]
        ? {
            id: cohortsById[s.cohort_id].id,
            name: cohortsById[s.cohort_id].name,
            status: cohortsById[s.cohort_id].status,
            start_date: cohortsById[s.cohort_id].start_date,
            end_date: cohortsById[s.cohort_id].end_date,
          }
        : null,
      hours: {
        required: s.hours_required ?? null,
        approved: s.approved_hours ?? 0,
        pending: s.pending_hours ?? 0,
      },
      evaluations: evalsByStudent[s.id] || { completed: 0, pending: 0 },
    }
    ;(bySchool[school_key] ||= []).push(entry)
  }

  const schools = scopeTerms.map(t => ({
    school_key: t.school_key,
    students: bySchool[t.school_key] || [],
    cohorts: cohortsBySchool.get(t.school_key) || [],
  }))

  return res.status(200).json({ schools })
}
