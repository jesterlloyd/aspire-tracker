// STUDENT-PROFILE-CANON-1C — canonical rotation-date-window helpers.
//
// The single source of truth for a student's placement window is the linked coordinator-owned
// cohort_school_rotations row (rotation_start_date / rotation_end_date). The legacy free-text
// students.term_dates column must NOT drive operational date logic anymore. These pure helpers
// (no I/O) are shared by the shift-log endpoints and Keith so the rotation window is interpreted
// identically everywhere, including the '1900-01-01' sentinel that means "pending admin review".

export const ROTATION_SENTINEL = '1900-01-01'

// Parse a YYYY-MM-DD string into a local Date (matches the existing shift-log parseLocalDate
// semantics). Returns null for missing/malformed input.
function parseYmdLocal(s) {
  if (!s) return null
  const [y, m, d] = String(s).split('-').map(Number)
  if (!y || !m || !d) return null
  return new Date(y, m - 1, d)
}

// Canonical {start, end} (YYYY-MM-DD) from a cohort_school_rotations row, or null when the window
// is UNAVAILABLE: no row, missing dates, or the sentinel placeholder. Null never means "inside".
export function canonicalRotationWindow(rotationRow) {
  if (!rotationRow) return null
  const start = rotationRow.rotation_start_date
  const end   = rotationRow.rotation_end_date
  if (!start || !end || start === ROTATION_SENTINEL || end === ROTATION_SENTINEL) return null
  return { start, end }
}

// True when shiftDate (YYYY-MM-DD) is before the window start or after the window end.
// Returns FALSE when the window is unavailable — we never flag, and never fall back to legacy
// term_dates. (Distinguish "unavailable" from "inside" via canonicalRotationWindow() if needed.)
export function isOutsideRotationWindow(shiftDate, rotationRow) {
  const win = canonicalRotationWindow(rotationRow)
  if (!win) return false
  const sd    = parseYmdLocal(shiftDate)?.getTime()
  const start = parseYmdLocal(win.start)?.getTime()
  const end   = parseYmdLocal(win.end)?.getTime()
  if (sd == null || start == null || end == null) return false
  return sd < start || sd > end
}

// Human-readable canonical range, or the pending message when unavailable/sentinel. `dateFmt`
// optionally formats each YYYY-MM-DD value (e.g. to a Pacific "Mon D, YYYY"); defaults to raw.
export function formatRotationRange(rotationRow, dateFmt = (d) => d) {
  const win = canonicalRotationWindow(rotationRow)
  if (!win) return 'Pending coordinator/admin review'
  return `${dateFmt(win.start)} to ${dateFmt(win.end)}`
}
