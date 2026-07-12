// api/portal/unit-roster.js
//
// PHASE3-UNIT-PORTAL: unit leader roster endpoint.
//
// Data-access pattern (amendment 4): JWT-verified endpoint with a column
// allowlist, chosen because the roster joins students, cohorts, preceptor
// assignments, and a shift-log support aggregate, and the students table
// carries staff-only columns that must never reach a unit leader.
//
// Authorization: verified JWT -> profile -> ACTIVE unit_leader grant ->
// ACTIVE user_unit_scopes. No request parameter influences scope.
//
// Support-indicator privacy (Owner decision item 6 default): the response
// carries ONLY a per-student count of recent shift logs with a support note,
// never the note text.

import { verifyPortalCaller, getServiceDb, hasActiveRoleGrant, getActiveUnitScopes } from '../lib/portalAuth.js'
import { resolveAcceptingCohort } from '../lib/intakeStudentLookup.js'

const ROSTER_STATUSES = ['Placed', 'Active Rotation', 'Completed']
const STUDENT_COLUMNS = [
  'id', 'cohort_id', 'first_name', 'preferred_first_name', 'last_name',
  'school', 'status', 'unit', 'preceptor_name', 'term_dates',
  'hours_required', 'approved_hours', 'pending_hours',
].join(', ')

const SUPPORT_WINDOW_DAYS = 30

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

  const isUnitLeader = await hasActiveRoleGrant(db, auth.profile.id, 'unit_leader')
  if (!isUnitLeader) return res.status(403).json({ error: 'forbidden' })

  const scopes = await getActiveUnitScopes(db, auth.profile.id)
  if (scopes.length === 0) return res.status(200).json({ units: [], accepting_cohort: null })

  const unitKeys = [...new Set(scopes.map(s => s.unit_key))]

  // Students placed in the scoped units (status subset appropriate for unit
  // oversight). Cohort-restricted scopes filter after the fetch.
  const { data: students, error: sErr } = await db
    .from('students')
    .select(STUDENT_COLUMNS)
    .in('unit', unitKeys)
    .in('status', ROSTER_STATUSES)
  if (sErr) return res.status(500).json({ error: 'internal_error' })

  const inScope = (students || []).filter(s =>
    scopes.some(sc => sc.unit_key === s.unit && (sc.cohort_id === null || sc.cohort_id === s.cohort_id))
  )

  const cohortIds = [...new Set(inScope.map(s => s.cohort_id).filter(Boolean))]
  let cohortsById = {}
  if (cohortIds.length > 0) {
    const { data: cohorts, error: cErr } = await db
      .from('cohorts')
      .select('id, name, status, start_date, end_date')
      .in('id', cohortIds)
    if (cErr) return res.status(500).json({ error: 'internal_error' })
    cohortsById = Object.fromEntries((cohorts || []).map(c => [c.id, c]))
  }

  const studentIds = inScope.map(s => s.id)

  // Active primary preceptor per student (normalized model; legacy fallback below).
  const assignmentsByStudent = {}
  if (studentIds.length > 0) {
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

  // Support flag: count of recent logs with a non-empty support note. The
  // note text is intentionally never selected.
  const supportCounts = {}
  if (studentIds.length > 0) {
    const cutoff = new Date(Date.now() - SUPPORT_WINDOW_DAYS * 24 * 60 * 60 * 1000)
      .toISOString().slice(0, 10)
    const { data: supportRows } = await db
      .from('student_shift_logs')
      .select('student_id')
      .in('student_id', studentIds)
      .not('support_needed', 'is', null)
      .neq('support_needed', '')
      .gte('shift_date', cutoff)
    for (const r of supportRows || []) {
      supportCounts[r.student_id] = (supportCounts[r.student_id] || 0) + 1
    }
  }

  // Accepting cohort (server-resolved) so the portal participation form can
  // target and pre-fill the right cycle.
  let acceptingCohort = null
  const cohortResult = await resolveAcceptingCohort(db)
  if (cohortResult.cohortId) {
    const { data: ac } = await db
      .from('cohorts').select('id, name').eq('id', cohortResult.cohortId).maybeSingle()
    acceptingCohort = ac || { id: cohortResult.cohortId, name: '' }
  }

  const units = unitKeys.map(unitKey => ({
    unit_key: unitKey,
    students: inScope
      .filter(s => s.unit === unitKey)
      .map(s => ({
        id: s.id,
        first_name: s.first_name,
        preferred_first_name: s.preferred_first_name,
        last_name: s.last_name,
        school: s.school,
        status: s.status,
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
        preceptor_name: assignmentsByStudent[s.id] || s.preceptor_name || null,
        hours: {
          required: s.hours_required ?? null,
          approved: s.approved_hours ?? 0,
          pending: s.pending_hours ?? 0,
        },
        support: {
          open_count: supportCounts[s.id] || 0,
          window_days: SUPPORT_WINDOW_DAYS,
        },
      })),
  }))

  return res.status(200).json({ units, accepting_cohort: acceptingCohort })
}
