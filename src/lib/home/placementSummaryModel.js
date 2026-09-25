// HOME-1 (2026-09-24): Placement, demoted to one line and a collapsed panel.
//
// The five Placement Snapshot tiles are replaced by one summary line: "28 of 29 slots
// filled · 1 open slot (Medical) · Every proceeding student placed · 26 unit leaders
// notified". Every figure is built from data and a clause whose value is not available
// is left out. Below the line, capacity by service line (DataSheet inline rows) and
// requests by school (DataSheet plain sheet). Pure.

import { EXITED_STATUSES } from '../placementCoverage.js'

const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0)
const plural = (count, one, many = `${one}s`) => `${count} ${count === 1 ? one : many}`

/**
 * @param students the cohort's students
 * @param units the cohort's units (is_participating, total_slots, division, unit_name)
 * @param matches the cohort's matches (student_id, unit_id, notification_sent), or null when not loaded
 * @param divisionOf (unit) => service line name
 */
export function placementSummary({ students = [], units = [], matches = null, divisionOf = (u) => u?.division || 'Other' } = {}) {
  const participating = (units || []).filter(u => u?.is_participating)
  const totalSlots = participating.reduce((s, u) => s + n(u.total_slots), 0)
  const filledByUnit = {}
  for (const s of students || []) if (s?.matched_unit_id) filledByUnit[s.matched_unit_id] = (filledByUnit[s.matched_unit_id] || 0) + 1
  const filled = Object.values(filledByUnit).reduce((a, b) => a + b, 0)
  const open = Math.max(0, totalSlots - filled)
  const openDivisions = [...new Set(participating.filter(u => n(u.total_slots) > (filledByUnit[u.id] || 0)).map(divisionOf).filter(Boolean))]

  const proceeding = (students || []).filter(s => s && !EXITED_STATUSES.has(s.status))
  const unplaced = proceeding.filter(s => !s.matched_unit_id).length

  const clauses = []
  if (totalSlots > 0) clauses.push({ key: 'filled', text: `${filled} of ${totalSlots} slots filled`, strong: `${filled} of ${totalSlots}` })
  if (totalSlots > 0) {
    clauses.push(open
      ? { key: 'open', text: `${plural(open, 'open slot')}${openDivisions.length ? ` (${openDivisions.join(', ')})` : ''}`, strong: String(open), tone: 'amber' }
      : { key: 'open', text: 'No open slots' })
  }
  if (proceeding.length > 0) {
    clauses.push(unplaced
      ? { key: 'coverage', text: `${plural(unplaced, 'proceeding student')} not yet placed`, strong: String(unplaced), tone: 'amber' }
      : { key: 'coverage', text: 'Every proceeding student placed' })
  }
  if (Array.isArray(matches)) {
    const placedIds = new Set(proceeding.filter(s => s.matched_unit_id).map(s => s.id))
    const notified = new Set(matches.filter(m => m?.notification_sent && placedIds.has(m.student_id)).map(m => m.unit_id)).size
    if (placedIds.size > 0) clauses.push({ key: 'notified', text: `${plural(notified, 'unit leader')} notified`, strong: String(notified) })
  }
  return { totalSlots, filled, open, openDivisions, unplaced, clauses, hostingUnits: participating.length }
}

/** Capacity by service line: filled and slots per division, in the catalog's order. */
export function capacityByServiceLine({ units = [], students = [], divisionOf = (u) => u?.division || 'Other', order = [] } = {}) {
  const filledByUnit = {}
  for (const s of students || []) if (s?.matched_unit_id) filledByUnit[s.matched_unit_id] = (filledByUnit[s.matched_unit_id] || 0) + 1
  const rows = new Map()
  for (const u of (units || []).filter(u => u?.is_participating)) {
    const d = divisionOf(u) || 'Other'
    if (!rows.has(d)) rows.set(d, { id: d, serviceLine: d, filled: 0, slots: 0, units: [] })
    const r = rows.get(d)
    r.filled += filledByUnit[u.id] || 0
    r.slots += n(u.total_slots)
    r.units.push(u)
  }
  const rank = Object.fromEntries((order || []).map((d, i) => [d, i]))
  return [...rows.values()].sort((a, b) => (rank[a.serviceLine] ?? 99) - (rank[b.serviceLine] ?? 99) || a.serviceLine.localeCompare(b.serviceLine))
}

/** Requests by school: placed and students per school group. */
export function requestsBySchool({ students = [], schoolKey = (s) => s } = {}) {
  const rows = new Map()
  for (const s of students || []) {
    const k = schoolKey(s?.school) || 'Unknown School'
    if (!rows.has(k)) rows.set(k, { id: k, school: k, placed: 0, students: 0, list: [] })
    const r = rows.get(k)
    r.students += 1
    if (s.matched_unit_id) r.placed += 1
    r.list.push(s)
  }
  return [...rows.values()].sort((a, b) => a.school.localeCompare(b.school))
}

// ── Requests by school filters (Owner, 2026-09-25: counts are STUDENTS) ──────────────
// All is every student request, Placed the students with a unit, and Needs outreach the
// students still in Pending Outreach, whose student form has not gone out yet (the Owner's
// definition: "we need to send form to them"). NB the Academic Partner Portal's own "Needs
// Outreach" card also counts Form Sent; this one does not, on purpose.
export const REQUEST_FILTERS = Object.freeze([
  { key: 'all', label: 'All', test: () => true },
  { key: 'placed', label: 'Placed', test: (s) => !!s?.matched_unit_id },
  { key: 'needs_outreach', label: 'Needs outreach', test: (s) => s?.status === 'Pending Outreach' },
])

export function requestCounts(students = []) {
  const list = (students || []).filter(Boolean)
  return Object.fromEntries(REQUEST_FILTERS.map(f => [f.key, list.filter(f.test).length]))
}

/** The school rows that hold at least one student matching the filter; each row keeps its own totals. */
export function filterRequestRows(rows = [], filter = 'all') {
  const f = REQUEST_FILTERS.find(x => x.key === filter)
  if (!f || filter === 'all') return rows
  return rows.filter(r => (r.list || []).some(f.test))
}
