// lib/server/shiftOrdinals.js
//
// The single, pure utility for chronological "logged shift" ordinals, used server-side so the
// ordinal can be computed from a student's FULL shift history without widening the caller's
// visible 90-day window (only the resulting ordinal is attached to the display rows).
//
// The ordinal counts every ACTUAL logged shift for a student, chronologically, across all of
// their history: it never resets by month or by unit. ASPIRE holds no forward schedule (a
// shift-log row exists only once a student checks in) and has no canceled/deleted rows, so
// every row is an actual logged shift; in_progress and completed both count. The only rows
// excluded are any with an unexpected lifecycle_state (defensive).

/**
 * Chronological comparator for two shift-log rows of the SAME student.
 *  1. shift_date ascending (TEXT 'YYYY-MM-DD' sorts lexicographically == chronologically)
 *  2. same-day tie-break: checked_in_at ascending (a row with a check-in time before one
 *     without), then
 *  3. id ascending (immutable, so ties are fully deterministic and stable across requests).
 */
export function compareShiftChronological(a, b) {
  const ad = a.shift_date || '', bd = b.shift_date || ''
  if (ad !== bd) return ad < bd ? -1 : 1
  const at = a.checked_in_at ? Date.parse(a.checked_in_at) : NaN
  const bt = b.checked_in_at ? Date.parse(b.checked_in_at) : NaN
  const aHas = !Number.isNaN(at), bHas = !Number.isNaN(bt)
  if (aHas && bHas && at !== bt) return at < bt ? -1 : 1
  if (aHas !== bHas) return aHas ? -1 : 1
  const ai = String(a.id), bi = String(b.id)
  return ai < bi ? -1 : ai > bi ? 1 : 0
}

/**
 * Given shift-log rows for one or more students (each { id, student_id, shift_date,
 * checked_in_at, lifecycle_state }), return a Map of shift-log id -> 1-based chronological
 * ordinal within that student's full history. Rows for different students are ordered
 * independently; the ordinal is per student and never reset by month or unit.
 */
export function buildStudentShiftOrdinals(logs) {
  const byStudent = new Map()
  for (const log of logs || []) {
    if (!log || log.id == null || log.student_id == null) continue
    const ls = log.lifecycle_state
    // Defensive: only actual logged shifts. In practice every row is 'completed' or
    // 'in_progress'; a null state (older rows) is treated as a real, completed shift.
    if (ls != null && ls !== 'completed' && ls !== 'in_progress') continue
    if (!byStudent.has(log.student_id)) byStudent.set(log.student_id, [])
    byStudent.get(log.student_id).push(log)
  }
  const ordinalById = new Map()
  for (const list of byStudent.values()) {
    list.sort(compareShiftChronological)
    list.forEach((log, i) => ordinalById.set(log.id, i + 1))
  }
  return ordinalById
}
