// HOME-1 (Owner, 2026-09-25): the rules behind Unit Setup, pure and tested.
//
// The panel became a compact table (one line per unit, grouped by service line, details behind
// an expander, a search, a Participating only switch, and a pinned summary of units, slots and
// proceeding students). What it SAVES did not change: the same fields, written the same way
// (UnitSetupPanel.handleSave). This module owns the parts worth testing without a browser.

import { SHIFT_OPTIONS } from './constants.js'
import { EXITED_STATUSES } from './placementCoverage.js'

/** The shift a new unit starts with. It used to be 'Either', which the dropdown does not offer. */
export const DEFAULT_SHIFT = 'No Preference'

/** A stored shift the dropdown can show; anything else (legacy 'Either', blank) reads as No Preference. */
export function shiftChoice(value) {
  return SHIFT_OPTIONS.includes(value) ? value : DEFAULT_SHIFT
}

export const MIN_SLOTS = 1
export const MAX_SLOTS = 99
export const clampSlots = (n) => {
  const v = Math.round(Number(n))
  if (!Number.isFinite(v)) return MIN_SLOTS
  return Math.min(MAX_SLOTS, Math.max(MIN_SLOTS, v))
}

/** One setup entry per catalog unit, seeded from this cohort's unit rows. */
export function buildSetup(catalog = [], currentUnits = []) {
  const setup = {}
  for (const { unit_name, patient_population, division } of catalog) {
    const ex = currentUnits.find(u => u.unit_name === unit_name)
    setup[unit_name] = {
      checked:            !!(ex && ex.is_participating !== false),
      slots:              clampSlots(ex?.total_slots ?? 1),
      shift:              shiftChoice(ex?.shift_preference),
      contact:            ex?.contact_person     ?? '',
      preceptors:         ex?.preceptors         ?? '',
      considerations:     ex?.considerations     ?? '',
      patient_population: ex?.patient_population ?? patient_population ?? '',
      existingId:         ex?.id                 ?? null,
      division:           ex?.division ?? division ?? '',
    }
  }
  return setup
}

/** Units, slots and proceeding students, and whether the slots cover the students. */
export function setupTotals(setup = {}, students = []) {
  const on = Object.values(setup).filter(v => v?.checked)
  const units = on.length
  const slots = on.reduce((s, v) => s + clampSlots(v.slots), 0)
  const proceeding = (students || []).filter(s => s && !EXITED_STATUSES.has(s.status)).length
  const gap = proceeding - slots
  return { units, slots, proceeding, short: Math.max(0, gap), spare: Math.max(0, -gap), covered: gap <= 0 }
}

/** Per service line: how many units participate and the slots they hold. */
export function divisionTotals(units = [], setup = {}) {
  const on = units.filter(u => setup[u.unit_name]?.checked)
  return { participating: on.length, total: units.length, slots: on.reduce((s, u) => s + clampSlots(setup[u.unit_name].slots), 0) }
}

const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim()

/** The search matches a unit's name, its patient population, or its service line. */
export function matchesSearch(unit, query) {
  const q = norm(query)
  if (!q) return true
  return [unit?.unit_name, unit?.patient_population, unit?.division].some(v => norm(v).includes(q))
}

/** The catalog grouped by service line, filtered by the search and the Participating only switch. */
export function visibleDivisions(catalog = [], setup = {}, { query = '', participatingOnly = false } = {}) {
  const map = new Map()
  for (const u of catalog) {
    if (!matchesSearch(u, query)) continue
    if (participatingOnly && !setup[u.unit_name]?.checked) continue
    const d = u.division || 'Other'
    if (!map.has(d)) map.set(d, [])
    map.get(d).push(u)
  }
  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b))
}
