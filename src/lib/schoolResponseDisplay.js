// STAFF-SCHOOL-RESPONSE-VISIBILITY-1 - pure display helpers for the staff-side view of the
// coordinator-owned school placement response (cohort_school_rotations + linked students).
//
// No I/O. Shared by the header CohortPicker (derived cohort date spans) and the At a Glance
// Placement Requests panel / SchoolResponseDrawer (response association + legacy additional notes),
// so the derivation and matching rules are testable and identical everywhere. Reuses the canonical
// deriveCohortRange() from rotationWindow.js, which already excludes missing, malformed, and
// 1900-01-01 sentinel rows.

import { deriveCohortRange } from './rotationWindow.js'

// Group the bounded {cohort_id, rotation_start_date, rotation_end_date} rows by cohort so the
// picker can derive each cohort's span with one query. Rows without a cohort_id are dropped.
export function groupRotationRowsByCohort(rows) {
  const byCohort = {}
  for (const r of rows || []) {
    if (!r || !r.cohort_id) continue
    if (!byCohort[r.cohort_id]) byCohort[r.cohort_id] = []
    byCohort[r.cohort_id].push(r)
  }
  return byCohort
}

// The date span the cohort picker should display: the CANONICAL school-response range (earliest
// valid rotation_start_date -> latest valid rotation_end_date) when one exists, otherwise the
// manually entered cohorts.start_date/end_date, otherwise null (caller keeps its blank behavior).
// Never writes anything back; display-time preference only.
export function resolveCohortPickerRange(cohort, rotationRows) {
  const derived = deriveCohortRange(rotationRows || [])
  if (derived) return derived
  const start = cohort?.start_date || null
  const end = cohort?.end_date || null
  if (!start && !end) return null
  return { start, end }
}

const normalizeSchoolName = (s) => String(s || '').trim().toLowerCase()

// Associate one displayed school group with its canonical cohort_school_rotations response row.
// Preference order:
//   1. The students' shared cohort_school_rotation_id (most common non-null id that resolves to a
//      loaded response row) - the canonical link written by the placement upsert.
//   2. Careful school-name matching (trim + case-insensitive exact) as a fallback for legacy
//      students that predate the rotation link.
// Returns the response row or null when no association exists.
export function matchSchoolResponse(schoolName, schoolStudents, responses) {
  const rows = responses || []
  const counts = new Map()
  for (const st of schoolStudents || []) {
    const id = st?.cohort_school_rotation_id
    if (!id) continue
    counts.set(id, (counts.get(id) || 0) + 1)
  }
  let best = null
  for (const [id, count] of counts) {
    const row = rows.find(r => r?.id === id)
    if (row && (!best || count > best.count)) best = { row, count }
  }
  if (best) return best.row

  const key = normalizeSchoolName(schoolName)
  if (!key) return null
  return rows.find(r => normalizeSchoolName(r?.school_name) === key) || null
}

// The school form's final additional-notes answer is stored (legacy) on each student row in
// students.coordinators. Collect the non-empty values, deduplicate IDENTICAL trimmed values, and
// preserve every distinct recorded value (first-seen order) so nothing is silently chosen.
export function collectAdditionalNotes(students) {
  const seen = new Set()
  const out = []
  for (const st of students || []) {
    const v = String(st?.coordinators || '').trim()
    if (!v || seen.has(v)) continue
    seen.add(v)
    out.push(v)
  }
  return out
}
