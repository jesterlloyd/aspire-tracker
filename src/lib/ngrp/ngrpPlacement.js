// NGRP-PLACEMENT-BOARD-1: the pure derivations behind the Interview Board.
//
// INTERVIEW-BOARD-1 (Owner, 2026-09-17): this board pairs people with the unit that
// will INTERVIEW them, so it is the Interview Board, and its two columns are
// Interviewees and Hiring Units - in that order, the same way the Placement Board
// puts the people on the left and the boards on the right. "Pool" left the
// vocabulary of both boards.
//
// The word is "interviewee" and NOT "candidate", because this codebase already
// spends both "candidate" and "prospective candidate" on an alumnus who might
// apply. Only someone actually in play belongs on this board.
//
// A RANKED PREFERENCE IS NOT AN ASSIGNMENT. The plan says so in as many words,
// and everything here keeps them apart: preferences come from the applicant's
// own Transition Form, the assignment is what HR decided, and the board shows
// both side by side rather than letting one stand in for the other.

// RESIDENCY-ROSTER-1 (Owner, 2026-09-12): who is placeable is now the
// Applicant Pool rule, not a status somebody set by hand. Confirmation became
// automatic: submitted, eligible or conditionally eligible, and interested puts
// an alumnus on this board without anybody pressing a button. The care the old
// rule was protecting is unchanged, because the rule still refuses to place
// anyone who did not submit, did not say they were interested, or is recorded
// as Not Proceeding. One definition, in lib/server/ngrpPool.js, read by the
// board, the roster, At a Glance and every server write.
import { isInApplicantPool, preferencesOf } from '../../../lib/server/ngrpPool.js'

export { preferencesOf }

export function placeableRows(rows) {
  return (rows || []).filter(isInApplicantPool)
}

// Which rank, if any, the assigned unit matched. 1-based for display; null when
// unassigned, and 0 when HR assigned a unit the applicant did not rank - which
// is a legitimate outcome, not an error, and the board says so plainly rather
// than hiding it.
export function assignedRank(row) {
  if (!row?.assigned_unit) return null
  const i = preferencesOf(row).findIndex(p => p.toLowerCase() === row.assigned_unit.toLowerCase())
  return i === -1 ? 0 : i + 1
}

// One row per participating unit: its seats, who is assigned to it, and how
// many applicants ranked it anywhere. Inactive units are excluded - the form
// never offered them, so nobody could have ranked them and nobody should be
// assigned to them.
export function unitPool(units, rows) {
  const placeable = placeableRows(rows)
  return (units || [])
    .filter(u => u.is_active)
    .map(u => {
      const key = String(u.unit_name).toLowerCase()
      const assigned = placeable.filter(r => String(r.assigned_unit || '').toLowerCase() === key)
      const seats = Number(u.capacity) > 0 ? Number(u.capacity) : null
      return {
        unit_name: u.unit_name,
        seats,
        assigned: assigned.length,
        // null seats means the number was never set, so "remaining" is unknown
        // rather than zero. Seats is required in Edit Cohort, so this is the
        // legacy shape, not the normal one.
        remaining: seats == null ? null : seats - assigned.length,
        over: seats != null && assigned.length > seats,
        requested: placeable.filter(r => preferencesOf(r).some(p => p.toLowerCase() === key)).length,
        rows: assigned,
      }
    })
}

// The board's headline: seats configured, applicants placed, and who is still
// waiting. `unplaced` is the number the board exists to drive to zero.
export function placementSummary(units, rows) {
  const pool = unitPool(units, rows)
  const placeable = placeableRows(rows)
  const exact = pool.length > 0 && pool.every(u => u.seats != null)
  return {
    units: pool.length,
    seats: exact ? pool.reduce((n, u) => n + u.seats, 0) : null,
    // Everyone the pool rule admits. Named for the rule rather than for the
    // retired "Application Confirmed" status it used to count.
    inPool: placeable.length,
    placed: placeable.filter(r => r.assigned_unit).length,
    unplaced: placeable.filter(r => !r.assigned_unit).length,
    overSubscribed: pool.filter(u => u.over).map(u => u.unit_name),
  }
}

// Applicant ordering on the board: unplaced first, because they are the work,
// then by whether they ranked anything, then by name. Placement is not a
// judgement of the person, so nothing here ranks applicants against each other.
export function orderApplicants(rows, nameOf) {
  return [...(rows || [])].sort((a, b) => {
    const placed = (a.assigned_unit ? 1 : 0) - (b.assigned_unit ? 1 : 0)
    if (placed) return placed
    const ranked = (preferencesOf(b).length > 0 ? 1 : 0) - (preferencesOf(a).length > 0 ? 1 : 0)
    if (ranked) return ranked
    return String(nameOf(a) || '').localeCompare(String(nameOf(b) || ''))
  })
}

// ── NGRP-PLACEMENT-BOARD-1b: the "Placement at a Glance" segments ───────────
//
// The ASPIRE board's own preference-match breakdown, over NGRP data. The
// headline percentage is claimed only over assignments whose rank was actually
// RECORDED, so an unranked assignment is shown as unranked rather than dragged
// into the denominator as a failure.
export function preferenceCounts(rows) {
  const placeable = placeableRows(rows)
  const c = { top: 0, second: 0, other: 0, notRecorded: 0 }
  for (const r of placeable) {
    if (!r.assigned_unit) continue
    const rank = assignedRank(r)
    if (rank === 1) c.top += 1
    else if (rank === 2) c.second += 1
    else if (rank >= 3) c.other += 1
    // rank 0 means HR assigned a unit the applicant never ranked. That is a
    // legitimate outcome with NO recorded preference, so it is counted apart
    // rather than as an "other" choice they did not make.
    else c.notRecorded += 1
  }
  return c
}

// The percentage the headline may honestly claim, or null when no assignment
// carries a recorded rank. Never 0% when the truth is "not recorded".
export function topChoicePct(counts) {
  const recorded = counts.top + counts.second + counts.other
  return recorded > 0 ? Math.round((counts.top / recorded) * 100) : null
}

// Which of an applicant's preferences a focused unit is, for the board's
// bidirectional focus: 1, 2, 3, or 4 meaning "did not rank it". 4 sorts last,
// the same convention the ASPIRE board uses.
export function preferenceRankFor(row, unitName) {
  if (!unitName) return 4
  const i = preferencesOf(row).findIndex(p => p.toLowerCase() === unitName.toLowerCase())
  return i === -1 ? 4 : i + 1
}

// Applicants ordered for a focused unit: those who ranked it first, by rank,
// then everyone else. With no unit focused this falls back to the default
// ordering, which puts the unplaced first because they are the work.
export function orderForFocus(rows, unitName, nameOf) {
  if (!unitName) return orderApplicants(rows, nameOf)
  return [...(rows || [])].sort((a, b) => {
    const r = preferenceRankFor(a, unitName) - preferenceRankFor(b, unitName)
    if (r) return r
    const placed = (a.assigned_unit ? 1 : 0) - (b.assigned_unit ? 1 : 0)
    if (placed) return placed
    return String(nameOf(a) || '').localeCompare(String(nameOf(b) || ''))
  })
}

// ── INTERVIEW-BOARD-1 ───────────────────────────────────────────────────────

// Interviewees waiting for a unit, in the order the board shows them: whoever
// ranked the focused unit first (by rank), then alphabetically. Paired people are
// not here - they are notes on their unit's board, the way a placed student is.
export function orderInterviewees(rows, unitName, nameOf) {
  return [...(rows || [])].sort((a, b) => (
    (unitName ? preferenceRankFor(a, unitName) - preferenceRankFor(b, unitName) : 0)
    || String(nameOf(a) || '').localeCompare(String(nameOf(b) || ''))
  ))
}

// The interviewees regrouped for a focused unit, mirroring the Placement Board's
// groups exactly. Empty groups are dropped.
export function groupIntervieweesForUnit(rows, unitName) {
  const list = Array.isArray(rows) ? rows : []
  if (!unitName) return [{ key: 'all', label: null, rows: list, dimmed: false }]
  const first = [], lower = [], rest = []
  for (const r of list) {
    const rank = preferenceRankFor(r, unitName)
    if (rank === 1) first.push(r)
    else if (rank === 2 || rank === 3) lower.push(r)
    else rest.push(r)
  }
  return [
    { key: 'first', label: `Ranked ${unitName} 1st`, rows: first, dimmed: false },
    { key: 'lower', label: 'Ranked it 2nd or 3rd', rows: lower, dimmed: false },
    { key: 'rest', label: 'All other interviewees', rows: rest, dimmed: true },
  ].filter(g => g.rows.length > 0)
}

// The pin on a paired note: the rank HR's assignment matched. assignedRank returns
// 0 when they assigned a unit the interviewee never ranked, which is a legitimate
// outcome the board states plainly rather than hiding.
export function pinForAssignment(row) {
  const rank = assignedRank(row)
  if (rank === 1) return { glyph: '1', tone: 'first',  spoken: 'ranked 1st' }
  if (rank === 2) return { glyph: '2', tone: 'second', spoken: 'ranked 2nd' }
  if (rank === 3) return { glyph: '3', tone: 'third',  spoken: 'ranked 3rd' }
  return { glyph: '•', tone: 'other', spoken: 'not one they ranked' }
}
