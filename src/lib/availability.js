// AVAILABILITY-CANON-1B — shared, pure helpers for rotation-availability capture.
//
// Used by BOTH the public form endpoints (api/school-form-submit.js,
// api/student-intake-submit.js) and the forms themselves, so weekday/date encoding
// and validation are identical everywhere. No I/O. Canonical encodings:
//   - weekdays: the exact strings Mon, Tue, Wed, Thu, Fri, Sat, Sun
//   - dates:    plain ISO 'YYYY-MM-DD' strings (NO JS Date / timezone conversion)

export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const WEEKDAY_ORDER = Object.fromEntries(WEEKDAYS.map((d, i) => [d, i]))
export const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

// Filter an input to the canonical weekday set, de-duplicate, and return in canonical
// Mon→Sun order. Anything not an array, or with no valid entries, becomes [].
export function sanitizeWeekdays(input) {
  if (!Array.isArray(input)) return []
  const seen = new Set()
  for (const v of input) {
    if (typeof v === 'string' && WEEKDAYS.includes(v)) seen.add(v)
  }
  return [...seen].sort((a, b) => WEEKDAY_ORDER[a] - WEEKDAY_ORDER[b])
}

// True only for a syntactically valid ISO date string (does NOT parse to a Date,
// to avoid any timezone shift). Calendar-validity (e.g. month 13) is not enforced
// here; the YYYY-MM-DD shape is sufficient for v1 storage.
export function isValidIsoDate(v) {
  return typeof v === 'string' && ISO_DATE_RE.test(v)
}

// Filter an input to valid ISO date strings, de-duplicate, preserve first-seen order.
// Anything not an array, or with no valid entries, becomes [].
export function sanitizeIsoDates(input) {
  if (!Array.isArray(input)) return []
  const seen = new Set()
  const out = []
  for (const v of input) {
    if (isValidIsoDate(v) && !seen.has(v)) { seen.add(v); out.push(v) }
  }
  return out
}

// true/false pass through; everything else (undefined, '', null, strings) → null,
// so an unanswered optional Yes/No is stored as NULL rather than a misleading false.
export function coerceBoolOrNull(v) {
  if (v === true) return true
  if (v === false) return false
  return null
}

// Integer 1..7 → that integer; anything else (null, '', out of range, non-numeric) → null.
export function coerceMinDaysOrNull(v) {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  if (!Number.isInteger(n) || n < 1 || n > 7) return null
  return n
}

// UI helper: toggle a weekday in an array, keeping the result canonical (deduped + ordered).
export function toggleWeekday(arr, day) {
  const set = new Set(Array.isArray(arr) ? arr : [])
  if (set.has(day)) set.delete(day)
  else set.add(day)
  return sanitizeWeekdays([...set])
}
