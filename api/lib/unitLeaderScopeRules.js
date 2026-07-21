// api/lib/unitLeaderScopeRules.js
//
// UL-PORTAL: the PURE authorization rules for Unit Leader student access.
//
// Deliberately dependency free so the rules can be exercised directly by tests
// without a database, a network, or a Supabase client. api/lib/unitLeaderScope.js
// wraps these with the IO needed to fetch rows; every rule that decides visibility
// lives here, in one place, so there is exactly one definition of each.

// Days a completed student stays visible to their unit. Locked product decision.
export const COMPLETED_VISIBILITY_DAYS = 90

// students.status values that place a student inside unit oversight at all.
export const UPCOMING_STATUS  = 'Placed'
export const ACTIVE_STATUS    = 'Active Rotation'
export const COMPLETED_STATUS = 'Completed'
export const ROSTER_STATUSES  = [UPCOMING_STATUS, ACTIVE_STATUS, COMPLETED_STATUS]

// Columns a Unit Leader may ever receive about a student. Everything excluded by
// the locked decisions is absent by construction, not filtered later: interview
// rubric, readiness survey answers, certificates, onboarding documents, internal
// staff notes, and private support-request narratives are simply never selected.
// Clearance and health attributes (gpa_verified, bls_current, health_cleared,
// background_check) are excluded too: even as booleans they reveal WHY a student
// is not ready.
export const UL_STUDENT_COLUMNS = [
  'id', 'cohort_id', 'matched_unit_id',
  'first_name', 'preferred_first_name', 'last_name',
  'school', 'status',
  'term_dates', 'rotation_end_date', 'rotation_completed_at',
  'cohort_school_rotation_id', 'shift_availability',
  'hours_required', 'approved_hours', 'pending_hours',
  'preceptor_name', 'preceptor_id',
  'school_email', 'personal_email', 'phone',
  'badge_created', 'cs_link_complete', 'student_form_privacy_ack_at',
  'resume_url', 'headshot_url',
].join(', ')

/**
 * Narrow an authorized scope set to a single requested unit.
 * Returns the scope subset, or null when the caller is not entitled to that unit.
 * A null return must produce a denial, never an unscoped query.
 */
export function narrowScopes(scopes, requestedUnitKey) {
  if (!requestedUnitKey) return scopes
  const narrowed = scopes.filter(s => s.unit_key === requestedUnitKey)
  return narrowed.length > 0 ? narrowed : null
}

/** Is this scope row valid for the given cohort? cohort_id null means all cohorts. */
export function scopeCoversCohort(scope, cohortId) {
  return scope.cohort_id === null || scope.cohort_id === cohortId
}

/**
 * The 90-day completed window.
 * Fail closed: a completed student with NO usable date is NOT visible. Neither
 * term_dates (free text) nor cohorts.start_date/end_date (TEXT) are ever parsed.
 */
export function completedStillVisible(student, now = new Date()) {
  const raw = student.rotation_completed_at || student.rotation_end_date
  if (!raw) return false
  const end = new Date(raw)
  if (Number.isNaN(end.getTime())) return false
  const days = (now.getTime() - end.getTime()) / 86400000
  return days <= COMPLETED_VISIBILITY_DAYS
}

/**
 * Lifecycle bucket for a student already known to be in an authorized unit.
 * Returns 'upcoming' | 'active' | 'completed' | null (null means not visible).
 *
 * 'pending' is deliberately NOT derived from students.status. A student pending
 * placement has no matched unit yet and is therefore invisible to a unit by
 * construction; pending work reaches a Unit Leader as an open placement REQUEST,
 * which is a separate authorized query.
 */
export function lifecycleBucket(student, now = new Date()) {
  switch (student.status) {
    case UPCOMING_STATUS:  return 'upcoming'
    case ACTIVE_STATUS:    return 'active'
    case COMPLETED_STATUS: return completedStillVisible(student, now) ? 'completed' : null
    default:               return null
  }
}

/**
 * Onboarding readiness rollup.
 * Returns a general category and an outstanding-item list ONLY. Underlying
 * onboarding documents are never exposed.
 */
export function onboardingSummary(student) {
  const items = [
    { key: 'badge',          done: student.badge_created === true },
    { key: 'access',         done: student.cs_link_complete === true },
    { key: 'acknowledgment', done: !!student.student_form_privacy_ack_at },
  ]
  const done = items.filter(i => i.done).length
  const outstanding = items.filter(i => !i.done).map(i => i.key)

  let state
  if (done === items.length) state = 'ready'
  else if (done === 0) state = 'not_started'
  else state = 'in_progress'

  return { state, outstanding }
}
