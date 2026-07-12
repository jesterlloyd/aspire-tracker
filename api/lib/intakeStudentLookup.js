// api/lib/intakeStudentLookup.js
//
// PHASE0B-WAVE-D: shared server-side resolution used by BOTH
// api/student-intake-submit.js and api/student-intake-lookup.js so the two
// endpoints can never drift apart on eligibility semantics.
//
// Semantics (unchanged from student-intake-submit's original inline logic):
//   - Exactly one cohort with accepting_submissions = true. 0 -> not_accepting,
//     more than 1 -> ambiguous_cohort (never pick a row).
//   - The email must resolve to EXACTLY ONE student within that cohort across
//     school_email AND personal_email (normalized, escaped ilike = exact
//     case-insensitive match, no wildcard broadening). 0 -> not_found,
//     more than 1 -> ambiguous_student.

import { normalizeEmailForLookup, escapeLikePattern } from '../../src/lib/emailUtils.js'

// Resolves the single accepting cohort.
// Returns { cohortId } or { failure: { status, error, message } }.
export async function resolveAcceptingCohort(db) {
  const { data: acceptingCohorts, error } = await db
    .from('cohorts')
    .select('id')
    .eq('accepting_submissions', true)
  if (error) return { failure: { status: 500, error: 'internal_error' } }
  if (!acceptingCohorts || acceptingCohorts.length === 0) {
    return { failure: { status: 403, error: 'not_accepting', message: 'This form is not currently accepting submissions. Please contact the ASPIRE team.' } }
  }
  if (acceptingCohorts.length > 1) {
    return { failure: { status: 409, error: 'ambiguous_cohort', message: 'Submissions are temporarily unavailable. Please contact the ASPIRE team.' } }
  }
  return { cohortId: acceptingCohorts[0].id }
}

// Resolves the single student matching the email within the cohort.
// `columns` is the exact select list the caller needs (allow-listed by caller).
// Returns { student } or { failure: { status, error, message } }.
export async function resolveStudentByEmail(db, cohortId, email, columns = 'id, cohort_id, status, cs_cedars_status') {
  const cleanEmail = normalizeEmailForLookup(email)
  const likeEmail = escapeLikePattern(cleanEmail)
  const { data: bySchool, error: e1 } = await db
    .from('students').select(columns)
    .eq('cohort_id', cohortId).ilike('school_email', likeEmail)
  const { data: byPersonal, error: e2 } = await db
    .from('students').select(columns)
    .eq('cohort_id', cohortId).ilike('personal_email', likeEmail)
  if (e1 || e2) return { failure: { status: 500, error: 'internal_error' } }

  const matched = new Map()
  ;(bySchool   || []).forEach(s => matched.set(s.id, s))
  ;(byPersonal || []).forEach(s => matched.set(s.id, s))
  const matchedIds = [...matched.keys()]
  if (matchedIds.length === 0) {
    return { failure: { status: 404, error: 'not_found', message: 'We could not find your information for the current cycle. Please contact the ASPIRE team to confirm your school email on file.' } }
  }
  if (matchedIds.length > 1) {
    return { failure: { status: 409, error: 'ambiguous_student', message: 'We could not uniquely identify your record. Please contact the ASPIRE team.' } }
  }
  return { student: matched.get(matchedIds[0]) }
}
