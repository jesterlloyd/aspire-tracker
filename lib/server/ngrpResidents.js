// lib/server/ngrpResidents.js
//
// RESIDENTS-1 (Owner, 2026-09-14): the rows behind Residency > Residents, for
// one residency cohort or across all of them (aggregate).
//
// Reads only; every write goes through api/ngrp-manage.js resident_details_set.
// Talent Acquisition sees the same narrowing as every other Residency surface:
// alumni who submitted the Transition Form. A hire requires the Applicant Pool,
// which requires a submitted form, so in practice nobody is dropped; the filter
// is here so the rule is enforced rather than assumed.
//
// The Transition Form revision and the first reflection are read server-side
// and reduced to ONE value each (the phone, the preceptor names). No other
// answer leaves this module.
import { isMissingNgrpTable, isMissingNgrpColumn } from './ngrpApplicants.js'
import { hasSubmittedForm } from './ngrpTalentAcquisition.js'
import {
  composeResidents, phoneFromForm, preceptorFromReflection,
} from '../../src/lib/ngrp/ngrpResidents.js'

const OUTCOME_BASE =
  'candidate_id, cycle_id, student_id, hired_at, hired_unit, residency_start_date, ' +
  'separated_at, separation_reason, cs_email, shift'
export const RESIDENT_DETAIL_COLUMNS = 'position_title, preceptor_name, phone'
const STUDENT_FIELDS =
  'id, first_name, last_name, preferred_first_name, name, headshot_url, personal_email, aspire_cohort, school'

// { state: 'ok', detailsProvisioned, residents } | { state: 'unprovisioned' } | { state: 'error', error }
export async function loadResidents(db, { cycleId = null, talentAcquisition = false } = {}) {
  const read = (cols) => {
    let q = db.from('ngrp_residency_outcomes').select(cols).not('hired_at', 'is', null)
    if (cycleId) q = q.eq('cycle_id', cycleId)
    return q
  }
  // Widest first: before 20260919000000 the three detail columns are absent.
  let detailsProvisioned = true
  let out = await read(`${OUTCOME_BASE}, ${RESIDENT_DETAIL_COLUMNS}`)
  if (out.error && isMissingNgrpColumn(out.error)) {
    detailsProvisioned = false
    out = await read(OUTCOME_BASE)
  }
  if (out.error) {
    return (isMissingNgrpTable(out.error) || isMissingNgrpColumn(out.error))
      ? { state: 'unprovisioned' }
      : { state: 'error', error: out.error }
  }
  let outcomes = out.data || []
  if (!outcomes.length) return { state: 'ok', detailsProvisioned, residents: [] }

  const allIds = outcomes.map(o => o.candidate_id)
  const [cands, asg] = await Promise.all([
    db.from('ngrp_candidates').select('id, cycle_id, student_id, assigned_unit').in('id', allIds),
    db.from('ngrp_transition_assignments')
      .select('id, candidate_id, status, revision_count')
      .in('candidate_id', allIds)
      .is('revoked_at', null),
  ])
  if (cands.error) return { state: 'error', error: cands.error }
  if (asg.error && !isMissingNgrpTable(asg.error)) return { state: 'error', error: asg.error }
  // A pending assignment was prepared but never delivered, so it is no form.
  const liveAssignments = (asg.data || []).filter(a => a.status !== 'pending')

  if (talentAcquisition) {
    const submitted = new Set(liveAssignments.filter(a => hasSubmittedForm(a.status)).map(a => a.candidate_id))
    outcomes = outcomes.filter(o => submitted.has(o.candidate_id))
    if (!outcomes.length) return { state: 'ok', detailsProvisioned, residents: [] }
  }

  const ids = new Set(outcomes.map(o => o.candidate_id))
  const studentIds = [...new Set(outcomes.map(o => o.student_id).filter(Boolean))]
  const cycleIds = [...new Set(outcomes.map(o => o.cycle_id).filter(Boolean))]
  const latest = liveAssignments.filter(a => ids.has(a.candidate_id) && a.revision_count > 0)

  const [students, cycles, revisions, periods] = await Promise.all([
    db.from('students').select(STUDENT_FIELDS).in('id', studentIds),
    db.from('ngrp_cycles').select('id, name').in('id', cycleIds),
    latest.length
      ? db.from('ngrp_transition_revisions').select('assignment_id, revision_number, payload').in('assignment_id', latest.map(a => a.id))
      : Promise.resolve({ data: [] }),
    db.from('ngrp_reflection_periods').select('id, candidate_id').eq('period_number', 1).in('candidate_id', [...ids]),
  ])
  if (students.error) return { state: 'error', error: students.error }
  if (cycles.error) return { state: 'error', error: cycles.error }
  if (revisions.error && !isMissingNgrpTable(revisions.error)) return { state: 'error', error: revisions.error }
  if (periods.error && !isMissingNgrpTable(periods.error)) return { state: 'error', error: periods.error }

  // The phone from each resident's LATEST submitted revision.
  const formPhones = {}
  const wanted = new Map(latest.map(a => [a.id, a]))
  for (const rev of revisions.data || []) {
    const a = wanted.get(rev.assignment_id)
    if (!a || rev.revision_number !== a.revision_count) continue
    const phone = phoneFromForm(rev.payload)
    if (phone) formPhones[a.candidate_id] = phone
  }

  // The preceptor names from each resident's SUBMITTED first reflection.
  const reflectionPreceptors = {}
  const periodRows = periods.data || []
  if (periodRows.length) {
    const subs = await db.from('ngrp_reflection_submissions')
      .select('period_id, candidate_id, payload')
      .in('period_id', periodRows.map(p => p.id))
    if (subs.error && !isMissingNgrpTable(subs.error)) return { state: 'error', error: subs.error }
    for (const s of subs.data || []) {
      const names = preceptorFromReflection(s.payload)
      if (names) reflectionPreceptors[s.candidate_id] = names
    }
  }

  return {
    state: 'ok',
    detailsProvisioned,
    residents: composeResidents({
      outcomes, candidates: cands.data || [], students: students.data || [], cycles: cycles.data || [],
      formPhones, reflectionPreceptors,
    }),
  }
}
