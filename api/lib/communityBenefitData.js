// api/lib/communityBenefitData.js
//
// NURSING-ACADEMICS-1: the IO layer for the community-benefit report. Fetches
// the canonical inputs with explicit column allowlists and hands them to the
// pure compute module (lib/server/communityBenefit/compute.js). Shared by the
// portal report endpoint and the aggregate CSV export so both are always
// computed from identical inputs.
//
// CANONICAL SOURCES (locked):
//   dates      cohort_school_rotations via the triple match (never term_dates)
//   program    students.program_type
//   required   students.hours_required
//   actual     student_shift_logs recomputation (Auto-Accepted/Approved,
//              lifecycle completed); students.approved_hours is only the
//              reconciliation cross-check
//   preceptor  active primary student_preceptor_assignments -> preceptors;
//              students.matched_preceptor only as a labeled legacy fallback
//   rates      community_benefit_rates (all versions; compute selects active)
//   capstone   community_benefit_capstone_hours (unvoided rows)
//
// Every potentially large read is paged so the report is not silently
// truncated at the database API's default row limit.

import {
  REPORT_CANDIDATE_STATUSES,
  summarizeShiftHours,
} from '../../lib/server/communityBenefit/compute.js'
import { fetchAllRows } from './fetchAllRows.js'

const STUDENT_COLUMNS = [
  'id', 'first_name', 'last_name', 'name', 'school', 'program_type',
  'course_type', 'status', 'cohort_id', 'cohort_school_rotation_id',
  'hours_required', 'approved_hours', 'matched_preceptor',
].join(', ')

const ROTATION_COLUMNS = 'id, cohort_id, school_name, rotation_start_date, rotation_end_date'

const chunk = (arr, size) => {
  const out = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

async function fetchShiftHours(db, studentIds) {
  const logs = []
  for (const ids of chunk(studentIds, 100)) {
    const rows = await fetchAllRows(
      () => db
        .from('student_shift_logs')
        .select('id, student_id, total_hours, status, lifecycle_state')
        .in('student_id', ids)
        .order('id', { ascending: true }),
      'shift_log_lookup_failed',
    )
    logs.push(...rows)
  }
  return summarizeShiftHours(logs)
}

async function fetchPrimaryPreceptorNames(db, students) {
  const byStudent = new Map()
  const studentIds = students.map(s => s.id)
  const assignments = []
  for (const ids of chunk(studentIds, 100)) {
    const rows = await fetchAllRows(
      () => db
        .from('student_preceptor_assignments')
        .select('id, student_id, preceptor_id')
        .eq('role', 'primary')
        .eq('status', 'active')
        .in('student_id', ids)
        .order('id', { ascending: true }),
      'preceptor_assignment_lookup_failed',
    )
    assignments.push(...rows)
  }

  const preceptorIds = [...new Set(assignments.map(a => a.preceptor_id).filter(Boolean))]
  const nameById = new Map()
  for (const ids of chunk(preceptorIds, 100)) {
    const rows = await fetchAllRows(
      () => db
        .from('preceptors')
        .select('id, full_name')
        .in('id', ids)
        .order('id', { ascending: true }),
      'preceptor_lookup_failed',
    )
    for (const p of rows) nameById.set(p.id, p.full_name)
  }

  for (const a of assignments) {
    const name = nameById.get(a.preceptor_id)
    if (name) byStudent.set(a.student_id, { name, source: 'assignment' })
  }
  // Legacy free-text fallback, clearly labeled, only when no normalized
  // assignment exists.
  for (const s of students) {
    if (byStudent.has(s.id)) continue
    const legacy = String(s.matched_preceptor || '').trim()
    if (legacy) byStudent.set(s.id, { name: legacy, source: 'legacy' })
  }
  return byStudent
}

/**
 * Fetch every input the compute module needs. Throws Error(reason) on any
 * query failure; callers map that to a 500 without leaking details.
 */
export async function fetchCommunityBenefitInputs(db) {
  const [students, rotations, cohorts, rateRows, capstoneRows] = await Promise.all([
    fetchAllRows(
      () => db.from('students').select(STUDENT_COLUMNS)
        .in('status', REPORT_CANDIDATE_STATUSES).order('id', { ascending: true }),
      'student_lookup_failed',
    ),
    fetchAllRows(
      () => db.from('cohort_school_rotations').select(ROTATION_COLUMNS).order('id', { ascending: true }),
      'rotation_lookup_failed',
    ),
    fetchAllRows(
      () => db.from('cohorts').select('id, name, start_date, created_at').order('id', { ascending: true }),
      'cohort_lookup_failed',
    ),
    fetchAllRows(
      () => db.from('community_benefit_rates')
        .select('id, fiscal_year, category, hourly_rate, superseded_at').order('id', { ascending: true }),
      'rate_lookup_failed',
    ),
    fetchAllRows(
      () => db.from('community_benefit_capstone_hours')
        .select('id, fiscal_year, school_name, cohort_id, hours, voided_at').order('id', { ascending: true }),
      'capstone_lookup_failed',
    ),
  ])
  const [shiftHoursById, preceptorNameById] = await Promise.all([
    fetchShiftHours(db, students.map(s => s.id)),
    fetchPrimaryPreceptorNames(db, students),
  ])

  return {
    students,
    rotations,
    cohorts,
    cohortNamesById: new Map(cohorts.map(c => [c.id, c.name])),
    shiftHoursById,
    preceptorNameById,
    rateRows,
    capstoneRows,
  }
}
