// src/lib/ngrp/preceptedUnits.js
//
// PRECEPTED-UNITS-1 (Owner, 2026-11-02): an alumnus can precept on more than one unit. Emi
// Bayaraa rotated in PACU and 6 NE; the form took one unit and the roster read only the primary
// placement, so Talent Acquisition saw her ranking a unit she "had not" precepted on.
//
// Two sources, one shape (a list of unit names, no duplicates by unitNameKey):
//   - the record: every placement in student_unit_assignments that was not removed, primary
//     first (lib/server/ngrpApplicants.js puts it on the student as precepted_units);
//   - the form: aspire.precepted_units since this change, else the single precepted_unit it
//     replaced. 'Other' stands for what they named in precepted_unit_other.
// The record wins where it has anything, as before: it is what the program arranged. Pure.
import { unitNameKey } from '../unitNameCanon.js'

export const MAX_PRECEPTED_UNITS = 4

function addUnique(out, name) {
  const n = String(name || '').trim()
  if (n && !out.some(x => unitNameKey(x) === unitNameKey(n))) out.push(n)
  return out
}

// The raw picks: catalog names and possibly 'Other'. Reads a revision written before the list.
export function formUnitPicks(aspire) {
  const a = aspire || {}
  const list = Array.isArray(a.precepted_units) ? a.precepted_units : [a.precepted_unit]
  return list.reduce((out, u) => addUnique(out, u), [])
}

// What they precepted on, by name: 'Other' becomes the unit they named, or drops out unnamed.
export function formPreceptedUnits(aspire) {
  const other = String(aspire?.precepted_unit_other || '').trim()
  return formUnitPicks(aspire).reduce((out, u) => addUnique(out, u === 'Other' ? other : u), [])
}

// The form's answer as one line for staff: an unnamed Other still shows that it was picked.
export function formPreceptedUnitsText(aspire) {
  const other = String(aspire?.precepted_unit_other || '').trim()
  const words = formUnitPicks(aspire).map(u => (u === 'Other' ? `Other: ${other || 'not named'}` : u))
  return words.length ? words.join(', ') : ''
}

// The record's units for one roster student: the list, else the single unit older payloads carry.
export function recordPreceptedUnits(student) {
  const list = Array.isArray(student?.precepted_units) ? student.precepted_units : [student?.precepted_unit]
  return list.reduce((out, u) => addUnique(out, u), [])
}

// A roster row's units: the record's, else what the form says.
export function preceptedUnitsOfRow(row) {
  const record = recordPreceptedUnits(row?.student)
  if (record.length) return record
  const form = Array.isArray(row?.form_precepted_units) ? row.form_precepted_units : [row?.form_precepted_unit]
  return form.reduce((out, u) => addUnique(out, u), [])
}

// student_unit_assignments rows -> one student's units: not removed, primary first, then by start.
export function assignmentUnits(rows) {
  const live = (rows || []).filter(r => r && r.status !== 'removed' && r.unit_key)
  live.sort((a, b) => (a.role === 'primary' ? 0 : 1) - (b.role === 'primary' ? 0 : 1)
    || String(a.start_date || '').localeCompare(String(b.start_date || '')))
  return live.reduce((out, r) => addUnique(out, r.unit_key), [])
}

const CS_EMPLOYMENT_WORDS = {
  not_employed: 'Not employed at CS', per_diem: 'Per diem', part_time: 'Part time', full_time: 'Full time', other: 'Other',
}

// CS-EMPLOYMENT-OTHER-1 (Owner, 2026-11-02): "Other" now carries what they wrote.
export function csEmploymentText(identity) {
  const s = identity?.cs_employment_status
  if (!s) return ''
  if (s === 'other') {
    const t = String(identity?.cs_employment_other || '').trim()
    return t ? `Other: ${t}` : 'Other'
  }
  return CS_EMPLOYMENT_WORDS[s] || s.replace(/_/g, ' ')
}
