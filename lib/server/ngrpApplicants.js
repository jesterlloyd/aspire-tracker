// lib/server/ngrpApplicants.js
//
// NGRP-WORKSPACE-1 (correction): the pure core of the NGRP Applicants read
// contract. Node-safe (no import.meta.env), unit-testable with a mocked db,
// and used only by the service-role endpoint - the browser never runs a
// cross-cohort students query.
//
// THE ROSTER CONTRACT
// 1. The selected NGRP cycle is the primary scope.
// 2. Its source ASPIRE cohorts come from ngrp_cycle_source_cohorts (explicit
//    many-to-many; one cycle may combine e.g. Summer 2026 + Fall 2026 +
//    Winter 2027).
// 3. Students are read from ALL mapped cohorts, canonical status exactly
//    'Completed' (src/lib/constants.js ASPIRE_STATUSES vocabulary).
// 4. Identity stays on the students row; candidates carry cycle state only.
// 5. PRIOR-HIRE EXCLUSION: an alumnus already hired through ANOTHER NGRP
//    cycle (ngrp_residency_outcomes.hired_at IS NOT NULL on a different
//    cycle's attempt) is not a prospect again - and a later separation does
//    not bring them back. A prior application, interview, no-offer, or
//    withdrawal WITHOUT a hire never excludes anyone.
// 6. Least privilege: raw emails never leave the server - the payload carries
//    has_email for the bulk-send validator; GPA, phone, and licensure fields
//    are never selected at all.

// Fields fetched from students. Emails are fetched ONLY to derive has_email
// and are stripped before the payload leaves the server.
const STUDENT_FETCH_FIELDS =
  'id, cohort_id, first_name, last_name, preferred_first_name, name, school, ' +
  'program_type, aspire_cohort, status, headshot_url, updated_at, ' +
  'ngrp_cohort_target, ngrp_outcome, school_email, personal_email'

const CANDIDATE_FIELDS =
  'id, cycle_id, student_id, interest, eligibility_calculated, eligibility_effective, ' +
  'eligibility_reasons, eligibility_override_reason, eligibility_overridden_by_name, ' +
  'eligibility_overridden_at, application_status, application_confirmed_at, ' +
  'application_withdrawn_at, notes, created_at, updated_at'

// PostgREST reports a missing relation as PGRST205 (schema cache) or the
// Postgres 42P01 text. This is the ONLY condition treated as "unprovisioned";
// every other error surfaces as an ordinary server error.
export function isMissingNgrpTable(error) {
  if (!error) return false
  return (
    error.code === 'PGRST205' ||
    error.code === '42P01' ||
    /find the table|does not exist/i.test(error.message || '')
  )
}

// Strip emails to a boolean. Exported for tests.
export function sanitizeStudent(row) {
  if (!row) return null
  const { school_email, personal_email, ...safe } = row
  return {
    ...safe,
    has_email: Boolean(
      (school_email && String(school_email).trim()) ||
      (personal_email && String(personal_email).trim())
    ),
  }
}

// Pure exclusion rule. hiredElsewhere is a Set of student_ids with a durable
// hire (hired_at non-null) recorded on an attempt in a DIFFERENT cycle.
export function excludePriorHires(students, hiredElsewhere) {
  if (!hiredElsewhere || hiredElsewhere.size === 0) return students
  return students.filter(s => !hiredElsewhere.has(s.id))
}

// ── Reads (db = service-role client) ─────────────────────────────────────────

export async function fetchCycles(db) {
  const { data, error } = await db
    .from('ngrp_cycles')
    .select('*')
    .order('application_open_date', { ascending: true, nullsFirst: false })
    .order('residency_start_date', { ascending: true, nullsFirst: false })
  if (error) {
    if (isMissingNgrpTable(error)) return { provisioned: false, cycles: [] }
    return { error }
  }
  return { provisioned: true, cycles: data || [] }
}

export async function fetchSourceCohorts(db, cycleId) {
  const { data, error } = await db
    .from('ngrp_cycle_source_cohorts')
    .select('cohort_id, cohorts ( id, name, start_date )')
    .eq('cycle_id', cycleId)
  if (error) {
    if (isMissingNgrpTable(error)) return { provisioned: false, cohorts: [] }
    return { error }
  }
  const cohorts = (data || [])
    .map(r => r.cohorts)
    .filter(Boolean)
    .sort((a, b) => (a.start_date || '').localeCompare(b.start_date || ''))
  return { provisioned: true, cohorts }
}

// student_ids with a durable hire recorded through a DIFFERENT cycle.
export async function fetchPriorHiredStudentIds(db, cycleId) {
  const { data, error } = await db
    .from('ngrp_residency_outcomes')
    .select('student_id, cycle_id')
    .not('hired_at', 'is', null)
    .neq('cycle_id', cycleId)
  if (error) {
    if (isMissingNgrpTable(error)) return { provisioned: false, ids: new Set() }
    return { error }
  }
  return { provisioned: true, ids: new Set((data || []).map(r => r.student_id)) }
}

// The whole Applicants payload for one validated cycle id.
// Returns one of:
//   { state: 'unprovisioned' }
//   { state: 'cycle_not_found' }
//   { state: 'error' }
//   { state: 'ok', cycle, sourceCohorts, students, candidates, excludedPriorHires }
export async function loadApplicantsPayload(db, cycleId) {
  const { data: cycle, error: cycleErr } = await db
    .from('ngrp_cycles')
    .select('*')
    .eq('id', cycleId)
    .maybeSingle()
  if (cycleErr) {
    return isMissingNgrpTable(cycleErr) ? { state: 'unprovisioned' } : { state: 'error' }
  }
  if (!cycle) return { state: 'cycle_not_found' }

  const mapped = await fetchSourceCohorts(db, cycleId)
  if (mapped.error) return { state: 'error' }
  if (mapped.provisioned === false) return { state: 'unprovisioned' }
  const sourceCohorts = mapped.cohorts

  // No mapped cohorts is a REAL, distinct state (Planning has not linked any
  // ASPIRE cohorts yet) - not an error and not "no alumni".
  if (sourceCohorts.length === 0) {
    return { state: 'ok', cycle, sourceCohorts: [], students: [], candidates: [], excludedPriorHires: 0 }
  }

  const cohortIds = sourceCohorts.map(c => c.id)
  const [studentsRes, candidatesRes, hiredRes] = await Promise.all([
    db.from('students')
      .select(STUDENT_FETCH_FIELDS)
      .in('cohort_id', cohortIds)
      .eq('status', 'Completed')
      .order('last_name', { ascending: true }),
    db.from('ngrp_candidates').select(CANDIDATE_FIELDS).eq('cycle_id', cycleId),
    fetchPriorHiredStudentIds(db, cycleId),
  ])

  if (studentsRes.error) return { state: 'error' }
  if (candidatesRes.error) {
    return isMissingNgrpTable(candidatesRes.error) ? { state: 'unprovisioned' } : { state: 'error' }
  }
  if (hiredRes.error) return { state: 'error' }

  const all = (studentsRes.data || []).map(sanitizeStudent)
  const students = excludePriorHires(all, hiredRes.ids)

  return {
    state: 'ok',
    cycle,
    sourceCohorts,
    students,
    candidates: candidatesRes.data || [],
    excludedPriorHires: all.length - students.length,
  }
}
