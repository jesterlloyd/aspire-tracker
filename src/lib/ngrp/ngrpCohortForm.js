// NGRP-PLANNING-2: the residency-cohort form vocabulary, shared by every
// surface that reads or writes an ngrp_cycles row.
//
// DATA-ONLY MODULE (no JSX), for the same reason ngrpTabs.js is: the shapers
// and style tokens below are imported by three components, and keeping them
// out of a component file leaves react-refresh with component-only exports.
//
// The shapers are the ONE definition of "what the form thinks this cohort
// currently is". Dirty-checking works by comparing a form state to the shaper
// run over the server row, so a shaper that drifts from its form silently
// makes a card permanently dirty. There is exactly one copy of each.

import { UNIT_CATALOG, DIVISION_ORDER } from '../unitCatalog.js'

export const F = 'DM Sans, sans-serif'

export const inputStyle = {
  height: 34, padding: '0 10px', border: '1px solid rgba(29,37,103,0.14)', borderRadius: 8,
  fontFamily: F, fontSize: 13, background: '#fff', color: '#191919', width: '100%', boxSizing: 'border-box',
}
export const labelStyle = { fontSize: 11.5, fontWeight: 600, color: '#4A5560', display: 'block', marginBottom: 4 }

export const btn = (primary = false, danger = false) => ({
  height: 32, padding: '0 14px', borderRadius: 8, fontFamily: F, fontSize: 12.5, fontWeight: 600,
  cursor: 'pointer', border: primary || danger ? 'none' : '1px solid rgba(29,37,103,0.15)',
  background: danger ? '#B3282D' : primary ? '#1D2567' : '#fff',
  color: primary || danger ? '#fff' : '#1D2567',
  display: 'inline-flex', alignItems: 'center', gap: 6,
})

export const errText = errors => (errors || []).map(e => e.message).join(' ')

export const cycleBasics = c => ({
  name: c?.name || '',
  status: c?.status || 'Planning',
  application_open_date: c?.application_open_date || '',
  application_deadline: c?.application_deadline || '',
  interview_window_start: c?.interview_window_start || '',
  interview_window_end: c?.interview_window_end || '',
  licensure_deadline: c?.licensure_deadline || '',
  residency_start_date: c?.residency_start_date || '',
  notes: c?.notes || '',
})

export const rulesOf = c => {
  const r = c?.qualification_rules || {}
  return {
    gpa_min: r.gpa_min ?? 3.0,
    max_paid_rn_months: r.max_paid_rn_months ?? 9,
    completion_window_months: r.completion_window_months ?? 12,
    require_accreditation: r.require_accreditation === true,
    nclex_exception_enabled: r.nclex_exception_enabled !== false,
    license_deadline_override: r.conditional?.license?.deadline || '',
  }
}

export const checklistOf = c => (Array.isArray(c?.application_checklist) && c.application_checklist.length
  ? c.application_checklist.map(i => ({ key: i.key, label: i.label, required: i.required !== false }))
  : null)

export const benchmarksOf = c => ({
  traditional_pct: c?.retention_benchmarks?.traditional_pct ?? '',
  organization_pct: c?.retention_benchmarks?.organization_pct ?? '',
})

export const unitsOf = data => (data?.units || []).map(u => ({
  unit_name: u.unit_name, is_active: u.is_active, capacity: u.capacity ?? '',
}))

// ── COHORT-ORDER-1: the participating-unit roster ────────────────────────────
//
// Units are TICKED, not typed. Ticking a unit means "this unit is participating
// in this cohort and is hiring", and a hiring unit must say how many it is
// hiring, because that number is the program's supply figure and it is what
// Planning > Seats reports.
//
// Unticking PARKS a unit: is_active goes false, and the row keeps its number and
// its place in the order so next cycle does not start from a blank sheet. Only
// the explicit delete removes a unit. Those are genuinely different acts and
// they keep genuinely different controls.

// Rows the editor shows: EVERY unit, not a filtered suggestion list.
//
// The roster used to be drawn from the units running in this cohort's mapped
// ASPIRE cohorts, which meant a residency cohort could not offer a unit that had
// never hosted an ASPIRE student, and showed nothing at all before cohorts were
// mapped. It reads the canonical catalog instead - the same 29-unit list the
// portal-access and contact scopes use - so "every unit, pick the ones hiring"
// is literally true.
//
// ORDERED BY DIVISION (Owner), in DIVISION_ORDER, then catalog order within each
// division. That is how the units are actually grouped on the org chart, so it
// is where someone looking for one expects to find it, and it doubles as the
// order the Transition Form offers the picked ones in. A unit the catalog does
// not carry keeps its own group at the end rather than being filed under a
// division nobody assigned it.
//
// `persisted` records which rows the cycle already stores: an untouched catalog
// row is not written back, only picked units and units already saved.
export const OFF_CATALOG_DIVISION = 'Other'

const CATALOG_BY_NAME = new Map(UNIT_CATALOG.map(u => [u.name.toLowerCase(), u]))

export function unitRoster(data) {
  const saved = new Map(unitsOf(data).map(u => [u.unit_name.toLowerCase(), u]))
  const emitted = new Set()
  const row = (name, division) => {
    const key = String(name).toLowerCase()
    if (emitted.has(key)) return null
    emitted.add(key)
    const prev = saved.get(key)
    return prev
      ? { ...prev, division, persisted: true }
      : { unit_name: name, is_active: false, capacity: '', division, persisted: false }
  }
  const rows = []
  for (const division of DIVISION_ORDER) {
    for (const u of UNIT_CATALOG) {
      if (u.division !== division) continue
      const r = row(u.name, division)
      if (r) rows.push(r)
    }
  }
  // Anything the catalog does not carry: units already saved on the cycle, then
  // names the DB knows about. Never dropped, never silently reassigned.
  for (const u of unitsOf(data)) {
    const r = row(u.unit_name, OFF_CATALOG_DIVISION)
    if (r) rows.push(r)
  }
  for (const n of data?.unitNameSuggestions || []) {
    if (!n || CATALOG_BY_NAME.has(String(n).toLowerCase())) continue
    const r = row(n, OFF_CATALOG_DIVISION)
    if (r) rows.push(r)
  }
  return rows
}

// The roster as division blocks, for rendering. Empty divisions are omitted, so
// a division with nothing in it never prints a heading over nothing.
export function unitRosterByDivision(rows) {
  const groups = []
  for (const r of rows || []) {
    const last = groups[groups.length - 1]
    if (last && last.division === r.division) last.units.push(r)
    else groups.push({ division: r.division, units: [r] })
  }
  return groups
}

// The catalog's one-line description, for telling "5 SCCT" from "6 SCCT" in a
// list of twenty-nine. Empty for a unit the catalog does not carry.
export function unitDescription(name) {
  return CATALOG_BY_NAME.get(String(name || '').toLowerCase())?.description || ''
}

// What units_set receives. An offered-but-never-ticked unit is not a fact about
// this cohort, so it is not stored; parking a saved unit is, so it is.
export function unitsToSave(rows) {
  return (rows || [])
    .filter(u => u.is_active || u.persisted)
    .map((u, i) => ({
      unit_name: u.unit_name,
      is_active: u.is_active,
      capacity: u.capacity === '' || u.capacity === null ? null : Number(u.capacity),
      display_order: i,
    }))
}

// A ticked unit with no positive number cannot be saved: it would claim the unit
// is hiring while refusing to say how many, and Seats would silently report an
// understated supply. Returns the offending unit names, empty when the list is
// saveable.
export function unitsMissingSpots(rows) {
  return (rows || [])
    .filter(u => u.is_active && !(Number(u.capacity) > 0))
    .map(u => u.unit_name)
}

// ── The application checklist ────────────────────────────────────────────────
//
// The five official requirements are LOCKED (Owner): they are the program's
// published application requirements, they always lead the list, and they cannot
// be reworded or removed from the alumni-facing Transition Form. Anything staff
// add for a particular cohort lives after them and stays fully editable.
//
// The stored column is one flat array, so official-versus-extra is decided by
// KEY, not by position - a cohort saved before this rule still resolves
// correctly, and reordering the array cannot promote an extra into a
// requirement.
export const OFFICIAL_CHECKLIST_KEYS = ['online_application', 'resume', 'personal_statement', 'transcript', 'recommendation_letters']

export function isOfficialChecklistItem(item) {
  return OFFICIAL_CHECKLIST_KEYS.includes(item?.key)
}

// The extras stored on a cycle: everything that is not one of the five. A stored
// [] (the column default) has no extras, which is not the same as having no
// checklist - the five are always in force.
export function checklistExtrasOf(cycle) {
  return (checklistOf(cycle) || []).filter(i => !isOfficialChecklistItem(i))
}

// The full array to persist: the five, in their canonical order and wording,
// then the extras. Blank extras are dropped rather than saved as empty rows.
export function buildChecklist(official, extras) {
  const kept = (extras || [])
    .filter(i => String(i.label || '').trim() && !isOfficialChecklistItem(i))
    .map((i, idx) => ({ key: i.key || `extra_${idx + 1}`, label: String(i.label).trim(), required: i.required !== false }))
  return [...official, ...kept]
}
