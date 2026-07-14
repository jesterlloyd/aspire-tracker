// ASPIRE-STUDENT-PORTAL: pure, null-safe date helpers for the Student Portal.
// They NEVER return "Invalid Date": missing, blank, malformed, sentinel, or
// partial ranges collapse to a clear "To be confirmed" (or a single-sided
// label). No React, no I/O, so the portal and the tests share one source.

// The rotation sentinel ('1900-01-01') means "pending admin review"; treat it as
// unavailable, matching src/lib/rotationWindow.js.
export const ROTATION_SENTINEL = '1900-01-01'
export const TBC = 'To be confirmed'

// Format one date value ('YYYY-MM-DD', an ISO datetime, or a Date) to
// "Mon D, YYYY". Returns null (never "Invalid Date") for anything unusable.
export function fmtDate(value) {
  if (value == null) return null
  const s = String(value).trim()
  if (!s) return null
  const datePart = s.slice(0, 10)
  let dt
  if (/^\d{4}-\d{2}-\d{2}$/.test(datePart)) {
    const [y, m, d] = datePart.split('-').map(Number)
    if (!y || !m || !d || m > 12 || d > 31) return null
    dt = new Date(y, m - 1, d)
    // Reject overflow (e.g. 2026-02-31 rolling into March).
    if (dt.getMonth() !== m - 1 || dt.getDate() !== d) return null
  } else {
    dt = new Date(s)
  }
  if (!(dt instanceof Date) || Number.isNaN(dt.getTime())) return null
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

const isRealDate = (v) => {
  if (v == null) return false
  const s = String(v).slice(0, 10)
  return !!s && s !== ROTATION_SENTINEL && fmtDate(v) != null
}

// Format a start/end pair. Both valid -> "A to B"; only one valid -> "From A" /
// "Until B"; neither -> "To be confirmed". Handles null, blank, malformed,
// partial, and the sentinel.
export function formatDateRange(start, end) {
  const a = isRealDate(start) ? fmtDate(start) : null
  const b = isRealDate(end) ? fmtDate(end) : null
  if (a && b) return `${a} to ${b}`
  if (a) return `From ${a}`
  if (b) return `Until ${b}`
  return TBC
}

// Placement rotation window for the portal: prefer the cohort start/end range;
// fall back to a meaningful free-text term_dates string; else "To be confirmed".
export function placementWindow(cohort, termDates) {
  const range = formatDateRange(cohort?.start_date, cohort?.end_date)
  if (range !== TBC) return range
  const t = String(termDates || '').trim()
  if (t && !/invalid/i.test(t)) return t
  return TBC
}
