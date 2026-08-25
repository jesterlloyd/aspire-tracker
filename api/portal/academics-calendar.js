// api/portal/academics-calendar.js
//
// NURSING-ACADEMICS-1: school rotation windows for the Nursing Academics
// academic calendar. GET only, view-only.
//
// AUTHORIZATION. Active nursing_academic grant (organization-wide read),
// verified on every request via verifyPortalNursingAcademicCaller.
//
// DATES ARE CANONICAL. Every window comes from cohort_school_rotations
// (structured dates); students.term_dates is never read. The 1900-01-01
// sentinel and missing dates mean UNAVAILABLE: those rotations are returned
// in the same list with has_dates=false so the client renders them in a
// data-quality state instead of silently omitting them.
//
// OUTPUT IS ALLOWLISTED. Rotation rows carry school, cohort, dates, fiscal
// year, and anonymous student counts/program mix only. No coordinator
// emails, no student identities, no free text.

import { verifyPortalNursingAcademicCaller } from '../lib/nursingAcademicScope.js'
import { fetchAllRows } from '../lib/fetchAllRows.js'
import { schoolGroupKey } from '../../src/lib/schoolIdentity.js'
import {
  PLACEMENT_STATUSES,
  ROTATION_SENTINEL,
  fiscalYearOfDate,
  tripleMatchedRotation,
} from '../../lib/server/communityBenefit/compute.js'

export function createAcademicsCalendarHandler({
  verifyCaller = verifyPortalNursingAcademicCaller,
} = {}) {
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store, private')
    if (req.method === 'OPTIONS') return res.status(200).end()
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET')
      return res.status(405).json({ error: 'method_not_allowed' })
    }

    const auth = await verifyCaller(req)
    if (!auth.ok) return res.status(auth.status).json({ error: auth.reason })

    let rotations, cohorts, students
    try {
      const rows = await Promise.all([
        fetchAllRows(
          () => auth.db.from('cohort_school_rotations')
            .select('id, cohort_id, school_name, rotation_start_date, rotation_end_date')
            .order('id', { ascending: true }),
          'rotation_lookup_failed',
        ),
        fetchAllRows(
          () => auth.db.from('cohorts').select('id, name, start_date, created_at')
            .order('id', { ascending: true }),
          'cohort_lookup_failed',
        ),
        fetchAllRows(
          () => auth.db.from('students')
            .select('id, cohort_id, cohort_school_rotation_id, school, program_type, status')
            .in('status', PLACEMENT_STATUSES)
            .order('id', { ascending: true }),
          'student_lookup_failed',
        ),
      ])
      rotations = rows[0]
      cohorts = rows[1]
      students = rows[2]
    } catch {
      return res.status(500).json({ error: 'internal_error' })
    }

    const cohortById = new Map(cohorts.map(c => [c.id, c]))
    const rotationById = new Map(rotations.map(r => [r.id, r]))

    // Anonymous per-rotation counts via the canonical triple match.
    const countsByRotation = new Map()
    for (const s of students) {
      const r = tripleMatchedRotation(s, rotationById)
      if (!r) continue
      let agg = countsByRotation.get(r.id)
      if (!agg) {
        agg = { count: 0, programs: new Set() }
        countsByRotation.set(r.id, agg)
      }
      agg.count += 1
      if (s.program_type) agg.programs.add(s.program_type)
    }

    const realDate = (d) => (d && d !== ROTATION_SENTINEL ? d : null)

    const payload = rotations.map(r => {
      const start = realDate(r.rotation_start_date)
      const end = realDate(r.rotation_end_date)
      const counts = countsByRotation.get(r.id)
      const cohort = cohortById.get(r.cohort_id)
      return {
        id: r.id,
        school: schoolGroupKey(r.school_name),
        school_raw: r.school_name,
        cohort_id: r.cohort_id,
        cohort_name: cohort?.name || '',
        rotation_start: start,
        rotation_end: end,
        has_dates: Boolean(start && end),
        fiscal_year: fiscalYearOfDate(end),
        student_count: counts?.count || 0,
        programs: counts ? [...counts.programs].sort() : [],
      }
    })

    return res.status(200).json({
      rotations: payload,
      cohorts: cohorts.map(c => ({
        id: c.id, name: c.name, start_date: c.start_date || null, created_at: c.created_at || null,
      })),
    })
  }
}

export default createAcademicsCalendarHandler()
