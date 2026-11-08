// AP-STUDENT-PROFILE-1 (Owner, 2026-11-08): what an Academic Partner sees of one of its own students,
// and the three answers a school may correct. Pure: read by the endpoint and the portal alike.
//
// Shown (Owner: "widen for contact and GPA"): names, school and personal email, phone, GPA, prior
// healthcare experience, unit preferences (plain names), availability and the interest statement.
// Never: date of birth, SSN, gender, the résumé, program_type, or anything staff wrote about the
// student. The allowlist is the rule: a new students column is excluded until it is listed here.
import { unitPublicName } from '../unitCatalog.js'

export const PROFILE_COLUMNS = Object.freeze([
  'id', 'cohort_id', 'school', 'status',
  'first_name', 'preferred_first_name', 'last_name',
  'school_email', 'personal_email', 'phone',
  'cumulative_gpa', 'prior_healthcare_experience',
  'unit_preference_1', 'unit_preference_2', 'unit_preference_3',
  'shift_availability', 'weekends_available', 'nights_available', 'preferred_days',
  'unavailable_weekdays', 'unavailable_weekdays_reason', 'personal_blackout_dates', 'availability_notes',
  'interest_statement', 'headshot_url', 'matched_unit_id',
])
// Arrives with 20261203000000_ap_student_records.sql; read only when the column exists.
export const GRADUATION_COLUMN = 'expected_graduation'

// Never sent to a school, whatever the select says.
export const FORBIDDEN_PROFILE_FIELDS = Object.freeze([
  'date_of_birth', 'ssn', 'ssn_last4', 'gender', 'resume_url', 'program_type',
  'admin_notes', 'support_needed', 'learning_highlight', 'interview_notes', 'interview_outcome',
  'rubric', 'disposition', 'review_reason', 'reviewed_by', 'exception_flags', 'headshot_url',
])

export const CORRECTABLE = Object.freeze({
  school_email: { label: 'School email' },
  cumulative_gpa: { label: 'GPA' },
  expected_graduation: { label: 'Expected graduation', cohortWide: true },
})

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** A school's value for a field, cleaned, or { error }. An empty value clears the field. */
export function cleanCorrection(field, raw) {
  if (!Object.prototype.hasOwnProperty.call(CORRECTABLE, field)) return { error: 'field_not_correctable' }
  const text = raw == null ? '' : String(raw).trim()
  if (field === 'school_email') {
    if (!text) return { error: 'school_email_required' }
    const v = text.toLowerCase()
    if (v.length > 200 || !EMAIL_RE.test(v)) return { error: 'invalid_email' }
    return { value: v }
  }
  if (field === 'cumulative_gpa') {
    if (!text) return { value: null }
    if (!/^\d(\.\d{1,2})?$/.test(text)) return { error: 'invalid_gpa' }
    const n = Number(text)
    if (n < 0 || n > 4) return { error: 'invalid_gpa' }
    return { value: n }
  }
  if (!text) return { value: null }
  if (!DATE_RE.test(text) || Number.isNaN(Date.parse(`${text}T00:00:00Z`))) return { error: 'invalid_date' }
  return { value: text }
}

/** Stored text of a value, for the correction log ("" for empty). */
export const logText = v => (v == null ? '' : String(v))

const yesNo = v => (v === true ? 'Yes' : v === false ? 'No' : null)
const list = v => (Array.isArray(v) ? v.filter(Boolean) : v ? String(v).split(/[;,]\s*/).filter(Boolean) : [])

/**
 * The profile a school receives, built field by field from a student row. `corrections` are this
 * student's log rows (oldest first); the earliest row per field holds what the student answered.
 */
export function shapeProfile(s, { cohort = null, unitName = null, graduationEnabled = false, corrections = [] } = {}) {
  const original = {}
  const latest = {}
  for (const c of corrections) {
    if (!(c.field in original)) original[c.field] = c.old_value
    latest[c.field] = { by: c.corrected_by_name || null, at: c.created_at }
  }
  const correctionOf = field => (field in original
    ? { studentAnswer: original[field] || null, correctedBy: latest[field].by, correctedAt: latest[field].at }
    : null)
  return {
    id: s.id,
    first_name: s.first_name,
    preferred_first_name: s.preferred_first_name || null,
    last_name: s.last_name,
    status: s.status || null,
    cohort: cohort ? { id: cohort.id, name: cohort.name } : null,
    assigned_unit: unitName ? unitPublicName(unitName) : null,
    contact: {
      school_email: s.school_email || null,
      personal_email: s.personal_email || null,
      phone: s.phone || null,
    },
    academics: {
      cumulative_gpa: s.cumulative_gpa ?? null,
      expected_graduation: graduationEnabled ? (s.expected_graduation || null) : undefined,
      prior_healthcare_experience: s.prior_healthcare_experience || null,
    },
    preferences: [s.unit_preference_1, s.unit_preference_2, s.unit_preference_3]
      .filter(Boolean).map(unitPublicName),
    availability: {
      shift: s.shift_availability || null,
      weekends: yesNo(s.weekends_available),
      nights: yesNo(s.nights_available),
      preferred_days: list(s.preferred_days),
      unavailable_weekdays: list(s.unavailable_weekdays),
      unavailable_reason: s.unavailable_weekdays_reason || null,
      blackout_dates: list(s.personal_blackout_dates),
      notes: s.availability_notes || null,
    },
    interest_statement: s.interest_statement || null,
    graduationEnabled,
    corrections: Object.fromEntries(Object.keys(CORRECTABLE).map(f => [f, correctionOf(f)]).filter(([, v]) => v)),
  }
}

export const CORRECTION_ERRORS = Object.freeze({
  field_not_correctable: 'That answer cannot be corrected here.',
  school_email_required: 'Enter the school email.',
  invalid_email: 'Enter a valid email address.',
  invalid_gpa: 'Enter a GPA between 0.00 and 4.00.',
  invalid_date: 'Enter a valid date.',
  not_enabled: 'Expected graduation is not set up yet.',
  preview_read_only: 'Staff previews are read-only.',
  not_found: 'This student is not on your roster.',
})
