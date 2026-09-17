// PLACEMENT-BOARD-FELT-1: what the Placement Board shows, as pure functions.
//
// Two different questions live here and must not be confused:
//   PREFERENCE (present tense): which of a student's current top 3 is this unit?
//     Used to ribbon boards and regroup the pool while someone is deciding.
//   STORED RANK (history): what rank was recorded when a placement was made?
//     Pins read matchRankOf in lib/placementDisplay.js, never this file, so a
//     renamed unit or an edited preference cannot rewrite a placement.

import { matchRankOf } from './placementDisplay.js'
import { needsPlacementException } from './placementReadiness.js'

export const RANK_WORD = { 1: '1st', 2: '2nd', 3: '3rd' }
export const RANK_TONE = { 1: 'first', 2: 'second', 3: 'third' }

/** 1, 2 or 3 when unitName is one of the student's current top 3, otherwise null. */
export function preferenceRankOf(student, unitName) {
  if (!student || !unitName) return null
  if (student.unit_preference_1 === unitName) return 1
  if (student.unit_preference_2 === unitName) return 2
  if (student.unit_preference_3 === unitName) return 3
  return null
}

/**
 * Board order while a student is selected: their 1st, 2nd and 3rd choice boards
 * first, in rank order, then every other board in the order it already had.
 * Returns the ordered list and each highlighted board's rank. A choice that is
 * filtered out of the current view is simply absent; nothing is added back.
 */
export function orderUnitsForStudent(units, student) {
  const list = Array.isArray(units) ? units : []
  const highlights = new Map()
  if (!student) return { ordered: list, highlights }
  const lead = []
  for (const rank of [1, 2, 3]) {
    const name = student[`unit_preference_${rank}`]
    if (!name) continue
    const unit = list.find(u => u.unit_name === name)
    if (unit && !highlights.has(unit.id)) {
      highlights.set(unit.id, rank)
      lead.push(unit)
    }
  }
  return { ordered: [...lead, ...list.filter(u => !highlights.has(u.id))], highlights }
}

/**
 * The Student Pool regrouped for a selected unit. The input is already sorted
 * (the pool's own sort), and each group keeps that order. Empty groups are
 * dropped. There is no AI recommendation group: ASPIRE stores no AI placement
 * recommendation (checked 2026-09-17), and the board does not invent one.
 */
export function groupPoolForUnit(pool, unit) {
  const list = Array.isArray(pool) ? pool : []
  if (!unit) return [{ key: 'all', label: null, students: list, dimmed: false }]
  const first = [], lower = [], rest = []
  for (const s of list) {
    const rank = preferenceRankOf(s, unit.unit_name)
    if (rank === 1) first.push(s)
    else if (rank === 2 || rank === 3) lower.push(s)
    else rest.push(s)
  }
  return [
    { key: 'first', label: `Picked ${unit.unit_name} as 1st choice`, students: first, dimmed: false },
    { key: 'lower', label: 'Picked as 2nd or 3rd choice', students: lower, dimmed: false },
    { key: 'rest', label: 'All other students', students: rest, dimmed: true },
  ].filter(g => g.students.length > 0)
}

/**
 * The Student Pool's order (Owner, 2026-09-17). Three keys, in this order:
 *   1. preference for the focused unit, when one is focused (1st, 2nd, 3rd, then the rest)
 *   2. interviewed before not-yet-interviewed
 *   3. last name A-Z
 * So the pool reads alphabetically with the not-yet-interviewed at the bottom, and a
 * student who picked the focused unit outranks an interviewed student who did not -
 * even when that student has not interviewed yet. Ties keep the incoming order.
 */
export function orderPool(pool, focusedUnit) {
  const lastName = (s) => (s?.last_name || s?.name || '').toLowerCase()
  const tier = (s) => (focusedUnit ? (preferenceRankOf(s, focusedUnit.unit_name) || 4) : 4)
  return [...(pool || [])]
    .map((student, index) => ({ student, index }))
    .sort((a, b) => (
      tier(a.student) - tier(b.student)
      || (needsPlacementException(a.student) ? 1 : 0) - (needsPlacementException(b.student) ? 1 : 0)
      || lastName(a.student).localeCompare(lastName(b.student))
      || a.index - b.index
    ))
    .map(({ student }) => student)
}

/** The pin on a placed note: its visible glyph, colour tone and spoken rank. */
export function pinFor(student, match) {
  const rank = matchRankOf(student, match)
  if (rank === 'top')    return { glyph: '1', tone: 'first',  spoken: '1st choice' }
  if (rank === 'second') return { glyph: '2', tone: 'second', spoken: '2nd choice' }
  if (rank === 'third')  return { glyph: '3', tone: 'third',  spoken: '3rd choice' }
  if (rank === 'other')  return { glyph: '•', tone: 'other',  spoken: 'other placement' }
  return { glyph: '•', tone: 'other', spoken: 'match rank not recorded' }
}

/** The words a placement toast uses for a stored match_quality value. */
export function matchPhrase(matchQuality) {
  if (matchQuality === 'top_choice') return '1st choice match'
  if (matchQuality === 'second_choice') return '2nd choice match'
  if (matchQuality === 'third_choice') return '3rd choice match'
  return 'not one of their top 3'
}
