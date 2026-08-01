// STUDENT-PORTAL-PROFILE-1: the student-owned profile field set.
//
// One source of truth for WHICH students columns originate from /student-form and may
// therefore be edited by the student in the portal until the profile locks. Shared by
// api/portal/my-profile.js (server allowlist - the browser is never trusted), the
// portal My Profile form prefill, and the tests.
//
// Pure module: no I/O, no React. Importable from api/ (existing src/lib pattern).
//
// DELIBERATE EXCLUSIONS from the editable set (each is still student-SOURCED, but not
// student-EDITABLE after submission):
//   school_email        - the identity binding key for intake and the scheduling page;
//                         changing it is a staff-mediated identity change.
//   resume_url /        - document replacement is staff-mediated after submission; the
//   headshot_url          upload path is the public intake flow, and swapping documents
//                         mid-workflow (badge, interview prep) needs staff awareness.
//   availability_ack,   - completed acknowledgments are records of what was acknowledged,
//   privacy_ack*          not preferences; they display as completed and never re-open.

// Every students column the portal 'save' action may write. name is composed
// server-side from first/last and is not in the list.
export const STUDENT_EDITABLE_FIELDS = [
  'first_name', 'last_name', 'preferred_first_name', 'personal_email', 'phone',
  'date_of_birth', 'ssn_last4', 'gender',
  'cs_affiliation', 'cs_department', 'cs_role',
  'prior_healthcare_experience',
  'unit_preference_1', 'unit_preference_2', 'unit_preference_3',
  'cumulative_gpa', 'shift_availability', 'interest_statement',
  'unavailable_weekdays', 'unavailable_weekdays_reason', 'personal_blackout_dates',
  'weekends_available', 'nights_available', 'preferred_days', 'availability_notes',
]

// Fields that must not be cleared once the profile is submitted (a save providing an
// empty value for one of these is rejected; omitting the key leaves it unchanged).
export const REQUIRED_ON_SAVE = [
  'first_name', 'last_name', 'personal_email', 'phone', 'date_of_birth', 'ssn_last4',
  'cs_affiliation', 'unit_preference_1', 'cumulative_gpa', 'shift_availability',
  'prior_healthcare_experience',
]

// The minimum interest-statement length the intake form has always required.
export const INTEREST_STATEMENT_MIN = 50

// ── Prefill helpers (client) ─────────────────────────────────────────────────────────

// Inverse of the intake page's prior_healthcare_experience composition:
//   'No prior experience'            -> { has: false, roles: [], other: '' }
//   'CNA, EMT, Other (barista)'      -> { has: true, roles: ['CNA','EMT','Other'], other: 'barista' }
//   'Yes (no roles specified)' / ''  -> { has: true/null, roles: [], other: '' }
export function parsePriorExperience(value, knownRoles = []) {
  const v = typeof value === 'string' ? value.trim() : ''
  if (!v) return { has: null, roles: [], other: '' }
  if (v === 'No prior experience') return { has: false, roles: [], other: '' }
  if (v === 'Yes (no roles specified)') return { has: true, roles: [], other: '' }
  const roles = []
  let other = ''
  for (const part of v.split(',').map(p => p.trim()).filter(Boolean)) {
    const m = /^Other \((.*)\)$/.exec(part)
    if (m) { roles.push('Other'); other = m[1] }
    else if (part === 'Other') roles.push('Other')
    else if (knownRoles.length === 0 || knownRoles.includes(part)) roles.push(part)
    else { roles.push('Other'); other = other || part }
  }
  return { has: true, roles: [...new Set(roles)], other }
}

// students row -> the intake form state shape (only the keys the form manages).
// GPA renders as a string; null booleans stay null (the "Select…" state).
export function buildFormValuesFromStudent(student, expRoles = []) {
  const s = student || {}
  const exp = parsePriorExperience(s.prior_healthcare_experience, expRoles)
  return {
    school_email: s.school_email || '',
    first_name: s.first_name || '',
    last_name: s.last_name || '',
    preferred_first_name: s.preferred_first_name || '',
    personal_email: s.personal_email || '',
    phone: s.phone || '',
    date_of_birth: s.date_of_birth || '',
    ssn_last4: s.ssn_last4 || '',
    gender: s.gender || '',
    cumulative_gpa: s.cumulative_gpa === null || s.cumulative_gpa === undefined ? '' : String(s.cumulative_gpa),
    shift_availability: s.shift_availability || '',
    has_prior_experience: exp.has,
    exp_selected_roles: exp.roles,
    exp_other_desc: exp.other,
    cs_affiliation: s.cs_affiliation || '',
    cs_department: s.cs_department || '',
    cs_role: s.cs_role || '',
    unit_preference_1: s.unit_preference_1 || '',
    unit_preference_2: s.unit_preference_2 || '',
    unit_preference_3: s.unit_preference_3 || '',
    interest_statement: s.interest_statement || '',
    unavailable_weekdays: Array.isArray(s.unavailable_weekdays) ? s.unavailable_weekdays : [],
    unavailable_weekdays_reason: s.unavailable_weekdays_reason || '',
    personal_blackout_dates: Array.isArray(s.personal_blackout_dates) ? s.personal_blackout_dates : [],
    weekends_available: typeof s.weekends_available === 'boolean' ? s.weekends_available : null,
    nights_available: typeof s.nights_available === 'boolean' ? s.nights_available : null,
    preferred_days: Array.isArray(s.preferred_days) ? s.preferred_days : [],
    availability_notes: s.availability_notes || '',
    availability_ack: s.availability_ack === true,
    privacy_ack: !!s.student_form_privacy_ack_at,
    privacy_ack_name: s.student_form_privacy_ack_name || '',
  }
}
