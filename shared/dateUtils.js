// shared/dateUtils.js
//
// Shared date utilities importable by BOTH src/ (Vite frontend) and api/
// (Vercel serverless functions). Lives at the repo root so neither deployment
// context needs to reach into the other's directory.
//
// Rule: use these helpers for YYYY-MM-DD date strings. Continue using
// new Date().toISOString() for full ISO timestamps (sent_at, created_at, etc.).

/**
 * Returns the current date (or a given date) as a YYYY-MM-DD string using
 * the runtime's LOCAL timezone -- not UTC.
 *
 * Motivation: toISOString().split('T')[0] returns the UTC date, which can
 * differ from the Pacific date near midnight and produce off-by-one bugs in
 * event_date, issue_date, and any other calendar-date column.
 *
 * @param {Date} [date=new Date()]
 * @returns {string} e.g. "2026-05-22"
 */
export function toLocalDateStr(date = new Date()) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}
