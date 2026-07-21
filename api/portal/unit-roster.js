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
// UL-PORTAL SCOPE CORRECTION: scoping now runs through the single source of truth
// in api/lib/unitLeaderScope.js, which resolves a student's unit via
// students.matched_unit_id -> units.unit_name.
//
// The previous implementation filtered on students.unit, a legacy column that no
// writer ever populates (it is absent from the api/student-update.js allowlist and
// is only ever initialized to ''), so every scoped unit returned an empty roster.
// That was fail closed but non-functional. matched_unit_id is the canonical
// placement written by the matching workflow.
//
// Support-indicator privacy (Owner decision item 6 default): the response
// carries ONLY a per-student count of recent shift logs with a support note,
// never the note text.

import { resolveAcceptingCohort } from '../lib/intakeStudentLookup.js'
import {
  verifyPortalUnitLeaderCaller,
  resolveUnitScopedStudents,
  onboardingSummary,
} from '../lib/unitLeaderScope.js'
import { parseStoredFileRef } from '../../lib/server/studentFiles.js'

// True when a stored reference resolves to a real object in the private bucket.
// Returns a BOOLEAN only, exactly like unit-student-detail. The path is never sent:
// the browser learns a photo exists, not where it lives, preserving the Wave F-2
// invariant that a Unit Leader never receives a storage path or an unmediated URL.
function hasFile(stored) {
  const ref = parseStoredFileRef(stored)
  return ref.kind !== 'empty' && ref.kind !== 'unknown'
}

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

  const auth = await verifyPortalUnitLeaderCaller(req)
  if (!auth.ok) {
    return res.status(auth.status).json({ error: auth.status === 403 ? 'forbidden' : 'unauthorized' })
  }

  const { db, scopes, unitKeys } = auth
  if (scopes.length === 0) return res.status(200).json({ units: [], accepting_cohort: null })

  // THE authorization query. Resolves students via matched_unit_id -> unit_name,
  // applies the scope's cohort rules, and drops any completed student outside the
  // 90-day window (fail closed when no rotation end date exists).
  let inScope
  try {
    ({ students: inScope } = await resolveUnitScopedStudents(db, scopes))
  } catch {
    return res.status(500).json({ error: 'internal_error' })
  }

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
      .filter(s => s.unit_key === unitKey)
      .map(s => ({
        id: s.id,
        first_name: s.first_name,
        preferred_first_name: s.preferred_first_name,
        last_name: s.last_name,
        school: s.school,
        status: s.status,
        // Lifecycle bucket resolved server side: upcoming | active | completed.
        bucket: s.bucket,
        // General onboarding category and outstanding item keys only. Underlying
        // onboarding documents and clearance/health attributes are never included.
        onboarding: onboardingSummary(s),
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
        // Boolean availability only, so the roster avatar can request a signed URL for
        // students who have one and skip a wasted round trip for those who do not.
        has_photo: hasFile(s.headshot_url),
      })),
  }))

  return res.status(200).json({ units, accepting_cohort: acceptingCohort })
}
