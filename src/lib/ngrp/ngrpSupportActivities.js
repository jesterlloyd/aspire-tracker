// RESIDENCY-SUPPORT-1: the support the ASPIRE team gives alumni, before and
// during residency. ONE list, read by the Support tab, the server's
// validation, and the migration's CHECK (which must match it exactly).
//
// Owner decisions, 2026-09-11:
//   - Before residency: Résumé Review, Town Hall, Interview Bootcamp,
//     Placement Advising (guidance on where to apply when the alumnus's
//     precepted unit is not hiring).
//   - During residency: Weekly Email Check-ins (sent through ASPIRE Connect,
//     Send to One, and counted from what Connect records, so they are NOT a
//     recorded activity here) and Mentorship Sessions with the resident's
//     assigned NPD-P.
//   - Only the ASPIRE team records support; Talent Acquisition sees it.
//   - Taking part is always optional and never affects eligibility.

export const SUPPORT_ACTIVITIES = Object.freeze([
  Object.freeze({ key: 'resume_review',      label: 'Résumé Review',      phase: 'before', mode: 'individual' }),
  Object.freeze({ key: 'town_hall',          label: 'Town Hall',          phase: 'before', mode: 'group' }),
  Object.freeze({ key: 'interview_bootcamp', label: 'Interview Bootcamp', phase: 'before', mode: 'group' }),
  Object.freeze({ key: 'placement_advising', label: 'Placement Advising', phase: 'before', mode: 'individual' }),
  Object.freeze({ key: 'mentorship_session', label: 'Mentorship Session', phase: 'during', mode: 'individual' }),
])

export const SUPPORT_ACTIVITY_KEYS = Object.freeze(SUPPORT_ACTIVITIES.map(a => a.key))

export const WEEKLY_CHECKIN_LABEL = 'Weekly Email Check-in'
export const CHECKIN_INTERVAL_DAYS = 7

export const SUPPORT_NOTE_MAX = 1000
export const MENTOR_NAME_MAX = 120

export function supportActivity(key) {
  return SUPPORT_ACTIVITIES.find(a => a.key === key) || null
}

export function activitiesFor(phase) {
  return SUPPORT_ACTIVITIES.filter(a => a.phase === phase)
}
