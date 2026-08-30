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
// 5. PRIOR-HIRE EXCLUSION: an alumnus already hired through an EARLIER NGRP
//    cycle (ngrp_residency_outcomes.hired_at IS NOT NULL on a
//    chronologically earlier cycle's attempt) is not a prospect again - and
//    a later separation does not bring them back. "Earlier" is decided by
//    the cycle CHRONOLOGY (cycleChronoKey below), never by uuid inequality:
//    a hire in a LATER cycle must not erase the person from an earlier
//    cycle's historical roster, and a hire in the SELECTED cycle stays
//    visible in that cycle. A prior application, interview, no-offer, or
//    withdrawal WITHOUT a hire never excludes anyone.
// 6. Least privilege: raw emails never leave the server - the payload carries
//    has_email for the bulk-send validator; GPA, phone, and licensure fields
//    are never selected at all.

// Fields fetched from students - ONLY what the current Applicants UI and its
// drawer render. Emails are fetched solely to derive has_email and are
// stripped before the payload leaves the server. The legacy
// students.ngrp_cohort_target / ngrp_outcome fields are deliberately NOT
// selected: the cycle/candidate/outcome tables are the NGRP source of truth,
// and the legacy fields never reach the browser through this endpoint.
const STUDENT_FETCH_FIELDS =
  'id, cohort_id, first_name, last_name, preferred_first_name, name, school, ' +
  'program_type, aspire_cohort, status, headshot_url, updated_at, ' +
  'school_email, personal_email'

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

// Pure exclusion rule. hiredEarlier is a Set of student_ids with a durable
// hire (hired_at non-null) recorded on an attempt in a chronologically
// EARLIER cycle (see fetchPriorHiredStudentIds).
export function excludePriorHires(students, hiredEarlier) {
  if (!hiredEarlier || hiredEarlier.size === 0) return students
  return students.filter(s => !hiredEarlier.has(s.id))
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

// Batched mapping read for the cycles listing - ONE query for every listed
// cycle, with truthful states: a missing mapping table is 'unprovisioned', an
// ordinary query failure is an error, and only a successful query may report
// an empty mapping. An error is NEVER presented as "no source cohorts".
// Returns { provisioned:false } | { error } | { provisioned:true, byCycle: Map<cycleId, cohort[]> }.
export async function fetchSourceCohortsForCycles(db, cycleIds) {
  if (!cycleIds || cycleIds.length === 0) return { provisioned: true, byCycle: new Map() }
  const { data, error } = await db
    .from('ngrp_cycle_source_cohorts')
    .select('cycle_id, cohorts ( id, name, start_date )')
    .in('cycle_id', cycleIds)
  if (error) {
    if (isMissingNgrpTable(error)) return { provisioned: false }
    return { error }
  }
  const byCycle = new Map(cycleIds.map(id => [id, []]))
  for (const row of data || []) {
    if (!row.cohorts) continue
    if (!byCycle.has(row.cycle_id)) byCycle.set(row.cycle_id, [])
    byCycle.get(row.cycle_id).push(row.cohorts)
  }
  for (const list of byCycle.values()) {
    list.sort((a, b) => (a.start_date || '').localeCompare(b.start_date || ''))
  }
  return { provisioned: true, byCycle }
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

// ── Cycle chronology ─────────────────────────────────────────────────────────
// The authoritative order of NGRP cycles for the exclusion rule (and the
// selector grouping): application_open_date first, then residency_start_date,
// then created_at, then id. NULL dates sort AFTER every real date (a cycle
// whose dates are not configured yet is treated as latest-possible, so it can
// never retroactively exclude anyone from a dated cycle), and the created_at
// + id tie-breaks make the comparison total and deterministic.
const LATEST = '9999-12-31'
export function cycleChronoKey(cycle) {
  return [
    cycle?.application_open_date || LATEST,
    cycle?.residency_start_date || LATEST,
    cycle?.created_at || LATEST,
    cycle?.id || '',
  ].join('|')
}

// Strictly earlier in the authoritative chronology.
export function isEarlierCycle(candidateCycle, selectedCycle) {
  return cycleChronoKey(candidateCycle) < cycleChronoKey(selectedCycle)
}

// student_ids with a durable hire recorded through a cycle STRICTLY EARLIER
// than the selected one. Two batched reads (all hire outcomes + the cycle
// chronology fields), compared in pure code so the rule is unit-testable.
export async function fetchPriorHiredStudentIds(db, selectedCycle) {
  const [outcomesRes, cyclesRes] = await Promise.all([
    db.from('ngrp_residency_outcomes')
      .select('student_id, cycle_id')
      .not('hired_at', 'is', null),
    db.from('ngrp_cycles')
      .select('id, application_open_date, residency_start_date, created_at'),
  ])
  if (outcomesRes.error) {
    if (isMissingNgrpTable(outcomesRes.error)) return { provisioned: false, ids: new Set() }
    return { error: outcomesRes.error }
  }
  if (cyclesRes.error) {
    if (isMissingNgrpTable(cyclesRes.error)) return { provisioned: false, ids: new Set() }
    return { error: cyclesRes.error }
  }
  const cyclesById = new Map((cyclesRes.data || []).map(c => [c.id, c]))
  const ids = new Set(
    (outcomesRes.data || [])
      .filter(o => {
        const hireCycle = cyclesById.get(o.cycle_id)
        return hireCycle && isEarlierCycle(hireCycle, selectedCycle)
      })
      .map(o => o.student_id)
  )
  return { provisioned: true, ids }
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
    fetchPriorHiredStudentIds(db, cycle),
  ])

  if (studentsRes.error) return { state: 'error' }
  if (candidatesRes.error) {
    return isMissingNgrpTable(candidatesRes.error) ? { state: 'unprovisioned' } : { state: 'error' }
  }
  if (hiredRes.error) return { state: 'error' }
  // A missing ngrp_residency_outcomes relation is UNPROVISIONED, full stop.
  // Continuing with an empty hired set would silently skip the approved
  // prior-hire exclusion and present the roster as complete when it is not.
  if (hiredRes.provisioned === false) return { state: 'unprovisioned' }

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
