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
// default): pipeline stage, placement, rotation dates, hours, and
// completion/evaluation DONE-or-NOT status only. No interview scores or
// recommendations, no rubric or evaluation content, no shift-log narratives,
// no support requests, no disposition reasons, no compliance flags (the
// exact compliance field list awaits the Owner's decision item 8).

import { verifyPortalCaller, getServiceDb, hasActiveRoleGrant } from '../lib/portalAuth.js'
import { resolveSchoolAliases } from '../lib/schoolAliases.js'

const STUDENT_COLUMNS = [
  'id', 'cohort_id', 'first_name', 'preferred_first_name', 'last_name',
  'school', 'status', 'unit', 'preceptor_name', 'term_dates',
  'hours_required', 'approved_hours', 'pending_hours',
].join(', ')

// Pipeline stages an academic partner may see (their own students at any
// stage of the current pathway, including declines at the summary level).
const norm = (s) => String(s || '').toLowerCase().replace(/[.,&/-]/g, ' ').replace(/\s+/g, ' ').trim()

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' })

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY || !(process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL)) {
    return res.status(500).json({ error: 'internal_error' })
  }

  const auth = await verifyPortalCaller(req)
  if (!auth.authenticated) {
    return res.status(auth.status === 403 ? 403 : 401).json({ error: auth.status === 403 ? 'forbidden' : 'unauthorized' })
  }

  const db = getServiceDb()

  const isPartner = await hasActiveRoleGrant(db, auth.profile.id, 'academic_partner')
  if (!isPartner) return res.status(403).json({ error: 'forbidden' })

  const { data: scopeRows, error: scErr } = await db
    .from('user_school_scopes')
    .select('school_key, cohort_id, starts_at, expires_at, revoked_at')
    .eq('user_profile_id', auth.profile.id)
  if (scErr) return res.status(500).json({ error: 'internal_error' })

  const nowTs = new Date()
  const scopes = (scopeRows || []).filter(r =>
    r.revoked_at === null &&
    new Date(r.starts_at) <= nowTs &&
    (r.expires_at == null || new Date(r.expires_at) > nowTs)
  )
  if (scopes.length === 0) return res.status(200).json({ schools: [] })

  // Alias-aware school term sets, per scope key.
  const scopeTerms = scopes.map(s => ({
    school_key: s.school_key,
    cohort_id: s.cohort_id,
    terms: new Set([...resolveSchoolAliases(s.school_key), norm(s.school_key)]),
  }))

  // Students are dropdown-constrained to a handful of school strings, so
  // fetch by status breadth and filter by normalized school in code.
  const { data: students, error: sErr } = await db
    .from('students')
    .select(STUDENT_COLUMNS)
    .not('school', 'is', null)
  if (sErr) return res.status(500).json({ error: 'internal_error' })

  const matches = []
  for (const s of students || []) {
    const n = norm(s.school)
    const scope = scopeTerms.find(t =>
      t.terms.has(n) && (t.cohort_id === null || t.cohort_id === s.cohort_id)
    )
    if (scope) matches.push({ student: s, school_key: scope.school_key })
  }

  if (matches.length === 0) {
    return res.status(200).json({ schools: scopeTerms.map(t => ({ school_key: t.school_key, students: [] })) })
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
      unit_name: s.unit || null,
      preceptor_name: assignmentsByStudent[s.id] || s.preceptor_name || null,
      term_dates: s.term_dates || null,
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
  }))

  return res.status(200).json({ schools })
}
