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
import { composeResidents, hiredAsLabel } from '../../src/lib/ngrp/ngrpResidents.js'
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

// HIRED-TAG-1 (Owner, 2026-11-05): the Student Profiles list and name plate show a Hired tag beside
// the Completed pill. The ASPIRE status stays Completed (residency rosters, alumnus email routing
// and the portal's Residency tab all read it); the tag is read from the hire record. One row per
// student, their most recent hire: { unit, hired_as_label, cohort_name, affiliated }. No titles,
// no contact details.
const TAG_COLS = 'student_id, cycle_id, hired_at, hired_unit, separated_at'
export async function loadHireTags(db, studentIds) {
  const ids = [...new Set(studentIds)]
  const outcomes = []
  let wide = true
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200)
    const read = cols => db.from('ngrp_residency_outcomes').select(cols).in('student_id', chunk).not('hired_at', 'is', null)
    let out = wide ? await read(`${TAG_COLS}, hired_as, hired_as_other`) : await read(TAG_COLS)
    if (out.error && wide && isMissingNgrpColumn(out.error)) { wide = false; out = await read(TAG_COLS) }
    if (out.error) {
      return isMissingNgrpTable(out.error) || isMissingNgrpColumn(out.error)
        ? { state: 'ok', provisioned: false, tags: {} }
        : { state: 'error', error: out.error }
    }
    outcomes.push(...(out.data || []))
  }
  if (!outcomes.length) return { state: 'ok', provisioned: true, tags: {} }
  const cycleIds = [...new Set(outcomes.map(o => o.cycle_id).filter(Boolean))]
  const cycles = await db.from('ngrp_cycles').select('id, name').in('id', cycleIds)
  if (cycles.error) return { state: 'error', error: cycles.error }
  const cycleName = new Map((cycles.data || []).map(c => [c.id, c.name]))
  const tags = {}
  for (const o of outcomes) {
    const prev = tags[o.student_id]
    if (prev && String(prev.hired_at) >= String(o.hired_at)) continue
    tags[o.student_id] = {
      hired_at: o.hired_at,
      unit: o.hired_unit || null,
      hired_as_label: hiredAsLabel(o) || null,
      cohort_name: cycleName.get(o.cycle_id) || null,
      affiliated: !o.separated_at,
    }
  }
  return { state: 'ok', provisioned: true, tags }
}
