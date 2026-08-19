// ASPIRE-CHART: one truth for placement capacity and match-rank display.
//
// CAPACITY (approved): displayed availability and the placement guard must
// never disagree. The guard and the unit cards already trusted the live
// match count; the banner and pool labels trusted the drift-prone stored
// slots_remaining field. Every display now derives from live match count vs
// configured total capacity through these helpers. The stored field is NOT
// rewritten and its write-path semantics are unchanged - it is simply no
// longer a display source.
//
// MATCH RANK (approved): the stored match_quality field (written at
// placement time) is the only rank source. Ranks are never re-derived from
// unit-name comparison: renaming a unit must not rewrite history, and a
// missing value renders as an explicit "not recorded" state instead of a
// false "Other". No schema changes.

// UNIT-POOL-REFINEMENT-1 (multi-unit correction): a unit card's rows come from
// the MATCH ROWS for that unit and cohort - the placement records themselves.
//
// THE DEFECT THIS FIXES. The board previously listed a card's students by
// students.matched_unit_id, a single pointer that can only ever name one unit.
// A student placed on two units therefore appeared on one card and was
// invisible on the other: no row, no notification control, no inclusion in the
// consolidated notice, and a filled count that disagreed with the capacity
// guard (which has always counted match rows). Deriving from matches makes the
// rows, the counts, and the guard read the same records.
//
// Cohort isolation is enforced HERE, not assumed from the caller's student
// list: a match row stamped with another cohort never yields a row, whatever
// unit id it claims. Deduped by student per unit (defensively - one match per
// (student, unit) pair is the data model), ordered by the match list so the
// card is stable across renders.
export function studentsMatchedToUnit(unit, matches, studentsById, cohortId) {
  if (!unit?.id) return []
  const byId = studentsById || {}
  const seen = new Set()
  const out = []
  for (const m of Array.isArray(matches) ? matches : []) {
    if (!m || String(m.unit_id || '') !== String(unit.id)) continue
    if (cohortId != null && String(m.cohort_id || '') !== String(cohortId)) continue
    const sid = m.student_id
    if (!sid || seen.has(sid)) continue
    seen.add(sid)
    const student = byId[sid]
    if (student) out.push(student)
  }
  return out
}

export function unitFilledCount(unitId, matches) {
  if (!unitId) return 0
  return (matches || []).filter(m => m.unit_id === unitId).length
}

/** Open slots for one unit: configured total minus live placements, floor 0. */
export function unitOpenSlots(unit, matches) {
  if (!unit) return null
  return Math.max(0, (unit.total_slots || 0) - unitFilledCount(unit.id, matches))
}

/** Open slots across a unit list (the board KPI). */
export function totalOpenSlots(units, matches) {
  return (units || []).reduce((sum, u) => sum + (unitOpenSlots(u, matches) ?? 0), 0)
}

export const MATCH_RANK_CONFIG = {
  top:          { label: '★ 1st choice match',      color: '#065F46', bg: '#D1FAE5', border: '#059669' },
  second:       { label: '2nd choice match',        color: '#7C5A1F', bg: '#FCEFD4', border: '#B5895A' },
  other:        { label: 'Other placement',         color: '#6b7280', bg: '#f9fafb', border: '#e5e7eb' },
  not_recorded: { label: 'Match rank not recorded', color: '#6b7280', bg: '#f3f4f6', border: '#e5e7eb' },
}

/**
 * Resolve a placed student's match rank from stored data only. The match
 * row's value wins (written at placement); the student's denormalized copy
 * is the fallback. Absent or unknown values are truthfully 'not_recorded'.
 */
export function matchRankOf(student, match) {
  const q = match?.match_quality ?? student?.match_quality
  if (q === 'top_choice') return 'top'
  if (q === 'second_choice') return 'second'
  if (q === 'other') return 'other'
  return 'not_recorded'
}

/** Preference-match counts over placed students, from stored ranks only. */
export function derivePrefCounts(matchedStudents, matches) {
  const counts = { top: 0, second: 0, other: 0, notRecorded: 0 }
  for (const s of matchedStudents || []) {
    const match = (matches || []).find(m => m.student_id === s.id)
    const rank = matchRankOf(s, match)
    if (rank === 'top') counts.top++
    else if (rank === 'second') counts.second++
    else if (rank === 'other') counts.other++
    else counts.notRecorded++
  }
  return counts
}
