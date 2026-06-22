// src/lib/studentNameFormatters.js
//
// STUDENT-PREFERRED-FIRST-NAME-1A: shared, pure helpers for formatting a student's name with an
// OPTIONAL preferred first name. These never alter the legal first_name/last_name; they only decide
// what to DISPLAY. Pure functions (no React / no I/O) so both client (src/) and server (api/) can import.
//
// Vocabulary:
//   - preferred_first_name: optional, student-owned, FIRST name only (last name unchanged).
//   - "preferred" anywhere below = the cleaned preferred_first_name, falling back to legal first_name.
//
// Rules:
//   - Trim values; blank/whitespace preferred_first_name counts as MISSING.
//   - A preferred name equal to the legal first name (case-insensitive, trimmed) is NOT shown quoted.
//   - Legal display uses curly quotes: First “Preferred” Last.

// Trim a preferred-first-name value; non-strings and blank/whitespace become ''.
export function cleanPreferredFirstName(value) {
  return typeof value === 'string' ? value.trim() : ''
}

const trimStr = (v) => (typeof v === 'string' ? v.trim() : '')

// First word of the legacy composed `name` (or `full_name`), used only as a last-ditch greeting source.
function firstTokenOfName(student) {
  const composed = trimStr(student?.full_name) || trimStr(student?.name)
  if (!composed) return ''
  return composed.split(/\s+/)[0] || ''
}

// The student's preferred first name for display: cleaned preferred_first_name, else legal first_name.
export function getStudentPreferredFirstName(student) {
  return cleanPreferredFirstName(student?.preferred_first_name) || trimStr(student?.first_name) || ''
}

// Greeting name ("Hi {name},"): preferred first → legal first → first token of composed name → 'there'.
export function getStudentPreferredGreetingName(student) {
  return (
    cleanPreferredFirstName(student?.preferred_first_name) ||
    trimStr(student?.first_name) ||
    firstTokenOfName(student) ||
    'there'
  )
}

// Student-facing full name: preferred-or-legal first name + legal last name.
export function getStudentPreferredFullName(student) {
  const first = getStudentPreferredFirstName(student)
  const last = trimStr(student?.last_name)
  return [first, last].filter(Boolean).join(' ')
}

// Legal/admin display that PRESERVES legal identity while surfacing the preferred name:
//   - preferred exists and differs from legal first (case-insensitive): First “Preferred” Last
//   - otherwise: First Last
export function getStudentLegalDisplayName(student) {
  const first = trimStr(student?.first_name)
  const last = trimStr(student?.last_name)
  const preferred = cleanPreferredFirstName(student?.preferred_first_name)
  const legalPlain = [first, last].filter(Boolean).join(' ')
  if (preferred && preferred.toLowerCase() !== first.toLowerCase()) {
    return [first, `“${preferred}”`, last].filter(Boolean).join(' ')
  }
  return legalPlain
}
