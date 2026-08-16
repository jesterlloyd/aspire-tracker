// api/portal/student-summary.js
//
// PHASE2-PORTAL: student portal summary endpoint.
//
// Data-access pattern (amendment 4): JWT-verified serverless endpoint with a
// centralized column allowlist. Chosen for this resource because the summary
// joins students, cohorts, preceptor assignments, and preceptors, and the
// students table mixes portal-visible columns with staff-only ones (interview
// scores, notes, compliance flags, access management). The allowlists below
// are the ONLY columns that can ever leave this endpoint.
//
// Authorization: verified JWT -> user_profiles row -> ACTIVE 'student' role
// grant -> ACTIVE user_student_links rows. The request body and query string
// contribute NOTHING to authorization; there are no parameters.

import { verifyPortalCaller, getServiceDb, hasActiveRoleGrant, getActiveStudentLinks } from '../lib/portalAuth.js'

// The exact student columns a student may see about themselves.
const STUDENT_COLUMNS = [
  'id', 'cohort_id', 'first_name', 'preferred_first_name', 'last_name',
  'school', 'status', 'unit', 'preceptor_name', 'term_dates',
  'hours_required', 'approved_hours', 'pending_hours',
  'headshot_url', 'phone', 'badge_created',
].join(', ')

const COHORT_COLUMNS = 'id, name, status, start_date, end_date'

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
    const status = auth.status === 403 ? 403 : 401
    return res.status(status).json({ error: status === 403 ? 'forbidden' : 'unauthorized' })
  }

  const db = getServiceDb()

  const isStudent = await hasActiveRoleGrant(db, auth.profile.id, 'student')
  if (!isStudent) return res.status(403).json({ error: 'forbidden' })

  const studentIds = await getActiveStudentLinks(db, auth.profile.id)
  if (studentIds.length === 0) return res.status(200).json({ students: [] })

  const { data: students, error: sErr } = await db
    .from('students')
    .select(STUDENT_COLUMNS)
    .in('id', studentIds)
  if (sErr) return res.status(500).json({ error: 'internal_error' })

  const cohortIds = [...new Set((students || []).map(s => s.cohort_id).filter(Boolean))]
  let cohortsById = {}
  if (cohortIds.length > 0) {
    const { data: cohorts, error: cErr } = await db
      .from('cohorts')
      .select(COHORT_COLUMNS)
      .in('id', cohortIds)
    if (cErr) return res.status(500).json({ error: 'internal_error' })
    cohortsById = Object.fromEntries((cohorts || []).map(c => [c.id, c]))
  }

  // Active primary preceptor assignment per student (normalized model), with
  // students.preceptor_name as the legacy fallback inside the mapper below.
  let assignmentsByStudent = {}
  {
    const { data: assignments, error: aErr } = await db
      .from('student_preceptor_assignments')
      .select('student_id, role, status, start_date, preceptor_id, preceptors ( full_name )')
      .in('student_id', studentIds)
      .eq('status', 'active')
    if (!aErr && assignments) {
      for (const a of assignments) {
        const current = assignmentsByStudent[a.student_id]
        // Prefer the primary assignment; keep the first otherwise.
        if (!current || a.role === 'primary') {
          assignmentsByStudent[a.student_id] = {
            role: a.role,
            preceptor_name: a.preceptors?.full_name || null,
          }
        }
      }
    }
  }

  // MULTI-UNIT-STUDENT-PLACEMENTS-2: the student's units come from LIVE
  // student_unit_assignments rows - primary first, additional after. The old
  // source, students.unit, is a legacy column no writer ever populated, which
  // is why every student's portal read "TBC" until now.
  let unitsByStudent = {}
  {
    const { data: unitRows, error: uErr } = await db
      .from('student_unit_assignments')
      .select('student_id, unit_key, role, status')
      .in('student_id', studentIds)
      .in('status', ['planned', 'active'])
    if (!uErr && unitRows) {
      for (const u of unitRows) {
        const list = (unitsByStudent[u.student_id] ||= [])
        if (u.role === 'primary') list.unshift(u.unit_key)
        else list.push(u.unit_key)
      }
    }
  }

  const payload = (students || []).map(s => ({
    id: s.id,
    first_name: s.first_name,
    preferred_first_name: s.preferred_first_name,
    last_name: s.last_name,
    school: s.school,
    status: s.status,
    headshot_url: s.headshot_url || null,
    phone: s.phone || null,
    badge_created: s.badge_created === true,
    unit_name: unitsByStudent[s.id]?.[0] || s.unit || null,
    unit_names: unitsByStudent[s.id] || [],
    preceptor_name: assignmentsByStudent[s.id]?.preceptor_name || s.preceptor_name || null,
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
  }))

  return res.status(200).json({ students: payload })
}
