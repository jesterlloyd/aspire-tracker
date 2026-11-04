// lib/server/ngrpHireHistory.js
//
// HIRE-HISTORY-1 (Owner, 2026-11-04): the two server-side pieces of a hire record's history.
//   licensedAtApplicationFor  what the alumnus said on their Transition Form about their
//                             California RN license, reduced to yes or no (null when there is
//                             no submitted form). Staff can overwrite it on the Hiring sheet.
//   recordTitleChange         one row in ngrp_resident_titles, dated, with the audit line.
//                             Before 20261124000000 the table does not exist; the caller's
//                             position_title still saved, and this says `provisioned: false`.
// Reads and writes go through the caller's db (demo or real); every row is tied to a candidate.
import { liveAssignmentForCandidate } from './ngrpTransition.js'
import { isMissingNgrpTable, isMissingNgrpColumn, isMissingNgrpSchema } from './ngrpApplicants.js'
import { recordNgrpAudit } from './ngrpAudit.js'
import { enrollStudents } from './ngrpSupportLog.js'
import { toPacificDateStr } from '../../shared/dateUtils.js'
import { dayOf } from '../../src/lib/ngrp/ngrpResidents.js'

export async function licensedAtApplicationFor(db, candidateId) {
  try {
    const live = await liveAssignmentForCandidate(db, candidateId)
    const a = live?.assignment
    if (!a || a.status === 'pending' || !(a.revision_count > 0)) return null
    const rev = await db.from('ngrp_transition_revisions')
      .select('payload')
      .eq('assignment_id', a.id)
      .eq('revision_number', a.revision_count)
      .maybeSingle()
    const status = rev.data?.payload?.licensure?.ca_rn_status
    if (status === 'active') return true
    if (status === 'pending' || status === 'none') return false
    return null
  } catch {
    return null
  }
}

// The server runs in UTC; a title that takes effect "today" is today in Pacific time.
const todayIso = () => toPacificDateStr(new Date())

export async function recordTitleChange(db, { candidateId, cycleId, studentId, actorId, title, effectiveOn, audit = true }) {
  const effective_on = effectiveOn || todayIso()
  const ins = await db.from('ngrp_resident_titles')
    .insert({ candidate_id: candidateId, title, effective_on, recorded_by_profile_id: actorId })
    .select('id').single()
  if (ins.error) {
    if (isMissingNgrpTable(ins.error)) return { provisioned: false }
    console.error('[ngrpHireHistory] title not recorded:', ins.error.message)
    return { provisioned: true, recorded: false }
  }
  if (audit) {
    await recordNgrpAudit(db, {
      eventType: 'title_changed', cycleId, candidateId, studentId, actorProfileId: actorId,
      metadata: { title, effective_on },
    })
  }
  return { provisioned: true, recorded: true, effective_on }
}

// Every title row for a set of candidates, keyed by candidate id. A missing table reads as no
// history for anyone, so the Residents loader works on both sides of the migration.
export async function titlesFor(db, candidateIds) {
  if (!candidateIds.length) return { provisioned: true, byCandidate: {} }
  const r = await db.from('ngrp_resident_titles')
    .select('candidate_id, title, effective_on, created_at')
    .in('candidate_id', candidateIds)
  if (r.error) {
    if (isMissingNgrpTable(r.error)) return { provisioned: false, byCandidate: {} }
    return { error: r.error }
  }
  const byCandidate = {}
  for (const row of r.data || []) (byCandidate[row.candidate_id] ||= []).push(row)
  return { provisioned: true, byCandidate }
}

// A hire recorded after the fact (hire_backfill, Record past hires). `hire` is
// validateBackfillHire's output. The alumnus is enrolled in the cohort (a candidate row with
// workflow defaults), and the outcome row is written with both offer timestamps equal to the
// hire date and backfilled true. Returns { ok, candidateId } or { status, error }.
export async function backfillHire(db, { cycleId, cycleName, studentId, actorId, hire, nowIso }) {
  const st = await db.from('students').select('id, status').eq('id', studentId).maybeSingle()
  if (st.error) return { status: 500, error: 'internal_error' }
  if (!st.data || st.data.status !== 'Completed') return { status: 404, error: 'not_a_completed_alumnus' }
  const e = await enrollStudents(db, { cycleId, studentIds: [studentId] })
  if (e.error) return isMissingNgrpTable(e.error) ? { status: 200, provisioned: false } : { status: 500, error: 'internal_error' }
  const cand = e.byStudent.get(studentId)
  const existing = await db.from('ngrp_residency_outcomes').select('candidate_id, hired_at').eq('candidate_id', cand.id).maybeSingle()
  if (existing.error) return isMissingNgrpTable(existing.error) ? { status: 200, provisioned: false } : { status: 500, error: 'internal_error' }
  if (existing.data?.hired_at) return { status: 409, error: 'already_hired', candidateId: cand.id }
  if (existing.data) return { status: 409, error: 'outcome_exists', candidateId: cand.id }
  const row = {
    candidate_id: cand.id, student_id: studentId, cycle_id: cycleId,
    offer_extended_at: hire.hired_at, offer_accepted_at: hire.hired_at,
    ...hire, backfilled: true,
    recorded_by_profile_id: actorId, updated_at: nowIso || new Date().toISOString(),
  }
  const ins = await db.from('ngrp_residency_outcomes').insert(row)
  if (ins.error && isMissingNgrpColumn(ins.error)) {
    return { status: 409, error: 'not_enabled', message: 'Past hires can be recorded once migration 20261124000000 is applied.' }
  }
  if (ins.error) return isMissingNgrpSchema(ins.error) ? { status: 200, provisioned: false } : { status: 500, error: 'internal_error' }
  if (hire.position_title) {
    await recordTitleChange(db, { candidateId: cand.id, cycleId, studentId, actorId, title: hire.position_title, effectiveOn: dayOf(hire.hired_at), audit: false })
  }
  await recordNgrpAudit(db, {
    eventType: 'hire_backfilled', cycleId, candidateId: cand.id, studentId, actorProfileId: actorId,
    metadata: { hired_unit: hire.hired_unit, hired_as: hire.hired_as || undefined, cycle_name: cycleName },
  })
  return { ok: true, status: 200, candidateId: cand.id }
}
