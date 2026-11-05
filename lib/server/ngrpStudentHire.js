// lib/server/ngrpStudentHire.js
//
// STUDENT-HIRE-READ-1 (Owner, 2026-11-05): one student's residency hire, for the read-only
// Residency section on Student Profiles > Placement. The record is kept on the Residency
// binder's Hiring sheet; this only reads it, so the two screens cannot disagree.
//
// Returns { state: 'ok', provisioned, hires } | { state: 'error', error }. A hire is
// { candidate_id, cycle_id, cohort_name, hired_at, unit, hired_as_label, current_title,
//   residency_start_date, separated_at, affiliated }, most recent first. Nothing else leaves:
// no phone, email, preceptor or separation reason.
import { isMissingNgrpTable, isMissingNgrpColumn } from './ngrpApplicants.js'
import { composeResidents } from '../../src/lib/ngrp/ngrpResidents.js'
import { titlesFor } from './ngrpHireHistory.js'

const BASE = 'candidate_id, cycle_id, student_id, hired_at, hired_unit, residency_start_date, separated_at'
const WIDE = `${BASE}, position_title, hired_as, hired_as_other`

export async function loadStudentHires(db, studentId) {
  const read = cols => db.from('ngrp_residency_outcomes').select(cols)
    .eq('student_id', studentId).not('hired_at', 'is', null)
  let out = await read(WIDE)
  if (out.error && isMissingNgrpColumn(out.error)) out = await read(BASE)
  if (out.error) {
    return isMissingNgrpTable(out.error) || isMissingNgrpColumn(out.error)
      ? { state: 'ok', provisioned: false, hires: [] }
      : { state: 'error', error: out.error }
  }
  const outcomes = out.data || []
  if (!outcomes.length) return { state: 'ok', provisioned: true, hires: [] }

  const cycleIds = [...new Set(outcomes.map(o => o.cycle_id).filter(Boolean))]
  const [titles, cycles] = await Promise.all([
    titlesFor(db, outcomes.map(o => o.candidate_id)),
    db.from('ngrp_cycles').select('id, name').in('id', cycleIds),
  ])
  if (titles.error) return { state: 'error', error: titles.error }
  if (cycles.error) return { state: 'error', error: cycles.error }

  const hires = composeResidents({ outcomes, cycles: cycles.data || [], titles: titles.byCandidate })
    .map(r => ({
      candidate_id: r.candidate_id,
      cycle_id: r.cycle_id,
      cohort_name: r.cohort_name,
      hired_at: r.hired_at,
      unit: r.unit,
      hired_as_label: r.hired_as_label,
      current_title: r.current_title,
      residency_start_date: r.residency_start_date,
      separated_at: r.separated_at,
      affiliated: r.affiliated,
    }))
    .sort((a, b) => String(b.hired_at).localeCompare(String(a.hired_at)))
  return { state: 'ok', provisioned: true, hires }
}
