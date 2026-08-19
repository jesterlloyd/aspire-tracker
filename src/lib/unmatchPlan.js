// src/lib/unmatchPlan.js
//
// UNIT-POOL-REFINEMENT-1 (unmatch correction): what removing ONE placement is
// allowed to do to the student record.
//
// THE DEFECT THIS FIXES. The classic unmatch treated every removal as "the
// student is no longer placed": it nulled students.matched_unit_id, cleared the
// primary preceptor relationship, wiped shift/match-quality, and reverted the
// student's status - unconditionally. That was correct in a one-placement world.
// With multi-unit placements it destroyed state that still belonged to a
// SURVIVING placement: the pointer went null while a valid placement remained,
// downstream readers (Unit Leader portal authorization, Action Center
// predicates, exports, digests) saw an unplaced student who was in fact placed,
// and an Active Rotation student could be "reverted" out of a rotation they
// were still on.
//
// THE RULE. Only the selected match is removed; what ELSE may change depends on
// what survives:
//
//   'additional'             - the removed placement is not the one the pointer
//                              names, and at least one placement survives.
//                              NOTHING student-level changes: not the pointer,
//                              not the status, not the primary preceptor.
//   'primary_with_survivor'  - the pointer named the removed unit and another
//                              placement survives. The pointer moves to the
//                              successor (the earliest surviving placement -
//                              see below), the student-level primary-preceptor
//                              relationship is ended through the canonical
//                              guarded path (it described the REMOVED
//                              placement; it is never transferred), and status
//                              is untouched.
//   'final'                  - nothing survives. The existing disposition- and
//                              rubric-aware revert applies, unchanged.
//
// WHO OWNS THE PROJECTION. students.matched_unit_id is the backward-compatible
// projection of the active-primary student_unit_assignments row
// (20260816/20260817). The applied sync trigger mirrors every pointer write
// atomically - ending the removed unit's primary assignment and promoting or
// inserting the successor's - so the CLIENT's whole job is to write the pointer
// once, exactly as createMatch always has. No client-side copy of the sync rule
// exists here, and none may be added.
//
// THE SUCCESSOR RULE. The classic flow has never had an explicit primary-
// selection rule beyond "the latest match wins" (createMatch repoints on every
// placement). On removal the inverse is used: the EARLIEST surviving placement
// (by created_at when present, else stable match-list order) becomes primary.
// Deterministic, stated, and trivially overridden afterwards by the management
// surface's atomic set_primary_unit_assignment.
//
// COHORT ISOLATION. Survivors are counted within the removed match's cohort
// only; a placement in another cohort neither blocks a revert nor becomes a
// successor.

const timeOf = (m) => {
  const t = m?.created_at ? new Date(m.created_at).getTime() : NaN
  return Number.isNaN(t) ? null : t
}

/**
 * Decide what this unmatch may touch.
 *
 * @param student  the student row (matched_unit_id is read from here)
 * @param match    the match row being removed - the (student, unit) pair's row
 * @param matches  every match row in scope (the board's cohort-scoped list)
 * @returns {{ kind: 'additional'|'primary_with_survivor'|'final', survivors, successor }}
 */
export function planUnmatch({ student, match, matches } = {}) {
  const all = Array.isArray(matches) ? matches : []
  const cohortId = match?.cohort_id ?? student?.cohort_id ?? null

  const survivors = all.filter(m =>
    m
    && String(m.student_id || '') === String(student?.id || '')
    && (!match || String(m.id || '') !== String(match.id || ''))
    && (cohortId == null || String(m.cohort_id || '') === String(cohortId)),
  )

  if (survivors.length === 0) {
    return { kind: 'final', survivors, successor: null }
  }

  // The pointer names the removed unit -> this was the primary placement.
  // (A missing match row means nothing identifiable is being removed: with
  // survivors present the plan degrades to 'additional' - the conservative
  // branch that touches nothing student-level - and with none it is 'final'.
  // The board cannot reach this state, since its rows ARE match rows.)
  const removedUnitId = match?.unit_id ?? null
  const isPrimaryRemoved = removedUnitId != null
    && String(student?.matched_unit_id || '') === String(removedUnitId)

  if (!isPrimaryRemoved) {
    return { kind: 'additional', survivors, successor: null }
  }

  const successor = [...survivors].sort((a, b) => {
    const ta = timeOf(a); const tb = timeOf(b)
    if (ta != null && tb != null && ta !== tb) return ta - tb
    return 0   // stable: keeps the match-list order for ties/missing dates
  })[0]

  return { kind: 'primary_with_survivor', survivors, successor }
}

/**
 * The student-row patch each plan kind permits. 'additional' returns null -
 * the student row must not be written at all. 'final' status/outcome values
 * are supplied by the caller, which owns the existing disposition- and
 * rubric-aware revert rules.
 */
export function unmatchStudentPatch(plan, { revertStatus } = {}) {
  if (!plan) return null
  if (plan.kind === 'additional') return null
  if (plan.kind === 'primary_with_survivor') {
    const s = plan.successor || {}
    return {
      // The successor's own placement values become the projection - its unit,
      // its recorded rank, its shift. Status and interview_outcome are ABSENT:
      // a still-placed student keeps whatever lifecycle state they are in
      // (Placed, Active Rotation, Completed, Not Proceeding alike).
      matched_unit_id: s.unit_id ?? null,
      match_quality: s.match_quality ?? null,
      shift_assigned: s.shift_assigned || '',
    }
  }
  return {
    matched_unit_id: null, shift_assigned: '', match_quality: null,
    interview_outcome: 'Pending Interview', status: revertStatus,
  }
}
