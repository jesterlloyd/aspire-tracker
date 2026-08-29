// src/lib/placementResubmission.js
//
// PLACEMENT-RESUBMIT-1: everything a SECOND placement request from a school
// that already has one in the same cohort needs to know. Pure and
// node-testable; shared by the public /school-form page, the Academic Partner
// portal, and the two write endpoints, so no surface can drift.
//
// THE INCIDENT THIS EXISTS FOR (2026-08-27). cohort_school_rotations is keyed
// UNIQUE (cohort_id, school_name), so there is exactly one rotation row per
// school per cohort. A Fall II submission from West Coast University North
// Hollywood therefore did not create a second request: it REPLACED the Fall I
// row. Two things were lost at once.
//   1. The rotation window moved (Aug 17 -> Oct 25), and because students carry
//      no dates of their own - they read the shared row through
//      cohort_school_rotation_id - every student already on rotation started
//      displaying the new school's window.
//   2. Every availability field the second submitter left blank overwrote a
//      populated one, because sanitizeAvailabilityCols always returns all six
//      keys. Blackout dates, academic breaks, and scheduling notes were erased
//      with no history anywhere in the app to recover them from.
//
// Three defences, in the order they engage:
//   WARN   describeExistingRequest() gives the form enough to say "this school
//          already has a submission for this cohort" BEFORE anything is sent.
//   MODE   'add_students' submits a roster only and never touches the rotation
//          row's dates, coordinator, or availability - the path that would have
//          made this submission harmless.
//   MERGE  mergeAvailabilityCols() makes a blank non-destructive even in a full
//          resubmission, so the same mistake cannot erase a populated field.
// The merge is the backstop: it holds even when the warning is dismissed.

// ── Submission modes ────────────────────────────────────────────────────────

// 'full'         - the normal first submission: dates, availability, roster.
// 'add_students' - a roster added to an EXISTING request; the rotation row is
//                  read, never written. Invalid when no request exists yet.
export const PLACEMENT_SUBMIT_MODES = Object.freeze(['full', 'add_students'])

export function sanitizeSubmitMode(value) {
  const v = typeof value === 'string' ? value.trim() : ''
  return PLACEMENT_SUBMIT_MODES.includes(v) ? v : 'full'
}

// ── Non-destructive availability merge ──────────────────────────────────────

// "Empty" is what sanitizeAvailabilityCols produces for a field nobody filled
// in: [] for the two list fields, null for the rest. A submitted empty never
// clears a stored non-empty value; a submitted value always wins.
//
// Deliberate consequence: a coordinator can no longer REMOVE a blackout date by
// resubmitting without it. That is the right trade. Removal is a deliberate
// edit, it belongs to staff in the School Response drawer, and the alternative
// is the silent erasure that caused this incident.
export const AVAILABILITY_COLUMNS = Object.freeze([
  'unavailable_weekdays', 'min_days_per_week', 'weekends_allowed',
  'nights_allowed', 'blackout_dates', 'scheduling_notes',
])

export function isEmptyAvailabilityValue(value) {
  if (value == null) return true
  if (Array.isArray(value)) return value.length === 0
  if (typeof value === 'string') return value.trim() === ''
  return false
}

// `existing` is the stored row (or null on a first submission). Returns the
// columns to write.
export function mergeAvailabilityCols(submitted, existing) {
  const out = {}
  for (const col of AVAILABILITY_COLUMNS) {
    const next = submitted?.[col]
    if (!isEmptyAvailabilityValue(next)) { out[col] = next; continue }
    const prior = existing?.[col]
    // Keep the stored value when the submission has nothing to say about it.
    out[col] = isEmptyAvailabilityValue(prior) ? next : prior
  }
  return out
}

// Which stored fields a full resubmission would have wiped but no longer does.
// The endpoints return this so the confirmation can say what was preserved,
// and so the incident leaves a trail next time instead of vanishing.
export function preservedAvailabilityFields(submitted, existing) {
  return AVAILABILITY_COLUMNS.filter(col =>
    isEmptyAvailabilityValue(submitted?.[col]) && !isEmptyAvailabilityValue(existing?.[col]))
}

// ── The warning the coordinator sees ────────────────────────────────────────

const fmtDate = (iso) => {
  const s = String(iso || '')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return ''
  // Parse as calendar parts, never through Date(), so a rotation date cannot
  // shift a day by timezone the way a bare new Date('2026-08-17') would.
  const [y, m, d] = s.split('-').map(Number)
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
    'August', 'September', 'October', 'November', 'December']
  return `${months[m - 1]} ${d}, ${y}`
}

// The sentinel the schema uses for "pending admin review".
const PENDING_SENTINEL = '1900-01-01'

export function formatRotationWindow(startDate, endDate) {
  if (!startDate || startDate === PENDING_SENTINEL) return 'dates pending review'
  const start = fmtDate(startDate)
  const end = fmtDate(endDate)
  if (!start) return 'dates pending review'
  return end ? `${start} to ${end}` : start
}

// The PUBLIC-SAFE summary of an existing request. Deliberately excludes the
// roster, student names, and the coordinator's email: the lookup that feeds
// this is reachable by anyone holding the cohort password, so it says only
// enough to make the warning meaningful.
export function describeExistingRequest(row, studentCount = 0) {
  if (!row) return { exists: false }
  return {
    exists: true,
    schoolName: String(row.school_name || ''),
    rotationStartDate: row.rotation_start_date || null,
    rotationEndDate: row.rotation_end_date || null,
    rotationWindow: formatRotationWindow(row.rotation_start_date, row.rotation_end_date),
    coordinatorName: String(row.coordinator_name || ''),
    studentCount: Number.isFinite(studentCount) ? studentCount : 0,
    lastUpdatedAt: row.updated_at || null,
  }
}

// The SAME summary, derived from what the Academic Partner portal already
// holds. Its GET returns each submitted request with { cohort: {id}, rotation:
// { start_date, end_date } }, so the portal needs no extra lookup and no new
// endpoint: the answer is already on the page. Coordinator name is absent from
// that payload, which resubmissionWarning handles by omitting the attribution.
export function describeExistingRequestFromPortalRequests(schoolName, requests, cohortId) {
  const inCohort = (Array.isArray(requests) ? requests : [])
    .filter(r => r?.cohort?.id && cohortId && r.cohort.id === cohortId)
  if (inCohort.length === 0) return { exists: false }
  const dated = inCohort.find(r => r?.rotation?.start_date) || null
  return describeExistingRequest({
    school_name: schoolName,
    rotation_start_date: dated?.rotation?.start_date || null,
    rotation_end_date: dated?.rotation?.end_date || null,
    coordinator_name: '',
    updated_at: null,
  }, inCohort.length)
}

// ONE copy module for both forms, so the public page and the Academic Partner
// portal warn in the same words. `summary` is a describeExistingRequest result.
export function resubmissionWarning(summary) {
  if (!summary?.exists) return null
  const who = summary.coordinatorName ? ` by ${summary.coordinatorName}` : ''
  const count = summary.studentCount === 1 ? '1 student' : `${summary.studentCount} students`
  return {
    title: `${summary.schoolName} already has a placement request for this cohort`,
    detail: `That request covers ${count} for ${summary.rotationWindow}, submitted${who}.`,
    addPrompt: 'Adding more students to that same rotation? Choose "Add students to the existing request" and you only need to fill in the new students.',
    overwriteWarning: 'Submitting a new request instead will replace the rotation dates and coordinator details above for every student already in this request, including any student currently on rotation. Please contact the ASPIRE team before you do.',
    acknowledgement: 'I understand this will replace the existing rotation dates for this school, and I have contacted the ASPIRE team.',
  }
}
