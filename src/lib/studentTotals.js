// src/lib/studentTotals.js
//
// SHIFT-LOG-REVIEW-1: apply a review decision's AUTHORITATIVE totals to the
// canonical students collection - which lives in App useState, NOT in a React
// Query cache. (Invalidating queryKey ['students'] refreshes nothing: no query
// holds that key, so Rotation progress cards and the profile totals would stay
// stale until a manual refresh.) The review RPC returns the recomputed
// approved_hours/pending_hours it just committed, so the update is
// deterministic: no refetch, no Realtime dependency, immediate everywhere the
// students array flows (Rotation -> Activity cards, Student Profile panel,
// pipeline counts).

/**
 * @param students canonical students array (App state)
 * @param result   review_shift_log RPC result: { student_id, approved_hours, pending_hours }
 * @returns a new array with the decided student's totals replaced; the input
 *          array untouched and returned as-is when the result is unusable.
 */
export function applyReviewTotals(students, result) {
  const id = result?.student_id
  if (!Array.isArray(students) || !id) return students
  const approved = parseFloat(result.approved_hours)
  const pending = parseFloat(result.pending_hours)
  if (!Number.isFinite(approved) || !Number.isFinite(pending)) return students
  if (!students.some(s => s.id === id)) return students
  return students.map(s =>
    s.id === id ? { ...s, approved_hours: approved, pending_hours: pending } : s)
}
