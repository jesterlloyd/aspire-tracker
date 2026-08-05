// lib/server/certificates/certificateFields.js
//
// ASPIRE-CERT-COMPLETION-TEMPLATE-1 - PURE display formatters for the ASPIRE Certificate of
// Completion dynamic fields. No database access, no network I/O, no Date.now(): every function
// maps caller-supplied canonical values to the exact strings drawn on the certificate.
//
// Canonical sources (resolved by the caller, see loadCertificateDisplayFields.js):
//   - rotation window: cohort_school_rotations via students.cohort_school_rotation_id
//     ('1900-01-01' is the "pending admin review" sentinel, never a real date)
//   - hours: evaluation_assignments.approved_hours_at_completion (the approved-hours snapshot
//     taken when the gating survey was completed), falling back to students.approved_hours
//   - issued date: certificates.certificate_unlocked_at (never the rotation end or download date)

// Backfilled cohort_school_rotations rows carry this sentinel until a coordinator
// submits real dates. It must render as "not set", never as Jan 1, 1900.
export const ROTATION_DATE_SENTINEL = '1900-01-01'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// Parse a YYYY-MM-DD date-only string literally (no timezone shifts).
function parseYmd(v) {
  if (typeof v !== 'string') return null
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v.trim())
  if (!m) return null
  const year = Number(m[1])
  const month = Number(m[2])
  const day = Number(m[3])
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  return { year, month, day }
}

// "Jun 8 - Aug 18, 2026" (same year) or "Dec 8, 2026 - Jan 18, 2027" (cross-year).
// Returns null unless BOTH canonical dates are present and real; a half-known
// window is never shown as a range.
export function formatRotationDateRange(startYmd, endYmd) {
  if (startYmd === ROTATION_DATE_SENTINEL || endYmd === ROTATION_DATE_SENTINEL) return null
  const start = parseYmd(startYmd)
  const end = parseYmd(endYmd)
  if (!start || !end) return null
  const startLabel = `${MONTHS[start.month - 1]} ${start.day}`
  const endLabel = `${MONTHS[end.month - 1]} ${end.day}`
  if (start.year === end.year) return `${startLabel} - ${endLabel}, ${end.year}`
  return `${startLabel}, ${start.year} - ${endLabel}, ${end.year}`
}

// Approved (never scheduled or pending) clinical hours. Whole numbers render bare
// ("120"); fractional values keep their decimals up to the NUMERIC(6,2) storage
// precision ("120.5", "120.25"). Zero is a real value; null/negative/NaN are not.
export function formatHoursCompleted(value) {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  if (!Number.isFinite(n) || n < 0) return null
  const rounded = Math.round(n * 100) / 100
  return String(rounded)
}

// "Aug 4, 2026" in the program's timezone, from certificates.certificate_unlocked_at.
export function formatIssuedDate(timestamp) {
  if (!timestamp) return null
  const d = new Date(timestamp)
  if (Number.isNaN(d.getTime())) return null
  return new Intl.DateTimeFormat('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/Los_Angeles',
  }).format(d)
}
