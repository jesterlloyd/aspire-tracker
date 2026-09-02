// NGRP-PLACEMENT-BOARD-1: the pure derivations behind the placement board.
//
// Two panels, the way the ASPIRE board has always been laid out: Unit Pool on
// the left, Applicant Pool on the right. The words carry over deliberately.
// Units are units, so "Unit Pool" is unchanged; the right side is "Applicant"
// and NOT "Candidate", because this codebase already spends both words on
// different things - ngrp_candidates and "prospective candidates" mean an
// alumnus who might apply, while "Application confirmed / Official NGRP list"
// is someone actually in play. Only the second group belongs on this board.
//
// A RANKED PREFERENCE IS NOT AN ASSIGNMENT. The plan says so in as many words,
// and everything here keeps them apart: preferences come from the applicant's
// own Transition Form, the assignment is what HR decided, and the board shows
// both side by side rather than letting one stand in for the other.

// Only confirmed applicants are placeable. A submitted form and an eligible
// result are not an application; assigning a unit to someone who never applied
// would record a decision against a person who did not ask for one.
export function placeableRows(rows) {
  return (rows || []).filter(r => r.application_status === 'confirmed')
}

// The applicant's ranked preferences, compacted and de-duplicated, in rank
// order. Blank ranks are dropped rather than rendered as empty slots.
export function preferencesOf(row) {
  const raw = [row?.unit_preference_1, row?.unit_preference_2, row?.unit_preference_3]
  const seen = new Set()
  const out = []
  for (const p of raw) {
    const name = typeof p === 'string' ? p.trim() : ''
    if (!name || seen.has(name.toLowerCase())) continue
    seen.add(name.toLowerCase())
    out.push(name)
  }
  return out
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
    confirmed: placeable.length,
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
