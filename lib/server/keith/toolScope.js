// lib/server/keith/toolScope.js
//
// S-34: the cohort and rubric scope Keith's data tools run under. Before this, the four
// data tools (search_students, get_student_detail, get_unit_details, get_cohort_summary)
// were granted by role alone and read whatever cohort the request body named in
// liveData.activeCohortId, on the service role. An Interviewer could therefore read any
// cohort's roster, contact details and GPA, and every colleague's rubric comments.
//
// The platform's own rule (api/student-update.js, api/student-file-access.js,
// lib/server/access.js `student_read_entitled`) bounds an Interviewer by the ACTIVE rows in
// interviewer_cohort_entitlements keyed on their user_profiles.id, and RLS bounds their
// rubric reads to rubrics carrying their own interviewer_profile_id. This module applies
// exactly that rule to the tools, derived server-side from the verified caller, never from
// the body.
//
// Owner, Admin and Co-Lead hold `student_read` and are UNRESTRICTED: every cohort, every
// rubric, unchanged. Any other caller the tool policy admits is bounded. A failed
// entitlement lookup yields an EMPTY scope (fail closed), never an unrestricted one.

import { can } from '../access.js'
import { activeEntitledCohortIds } from '../interviewerEntitlements.js'

export const COHORT_REFUSED = 'That cohort is not available to you.'
// Identical to the executor's not-found sentence, so an out-of-scope student and a
// non-existent one cannot be told apart (the rule api/student-update.js already follows).
export const STUDENT_REFUSED = 'Student not found'

/**
 * Resolve the scope for a verified caller. `caller` is the auth object Keith's
 * verifyCaller returns ({ role, isOwner, profileId }).
 */
export async function resolveToolScope(db, caller) {
  if (can(caller, 'student_read')) {
    return { unrestricted: true, cohortIds: null, profileId: caller?.profileId || null }
  }
  let cohortIds
  try {
    cohortIds = caller?.profileId ? await activeEntitledCohortIds(db, caller.profileId) : new Set()
  } catch {
    cohortIds = new Set()
  }
  return { unrestricted: false, cohortIds, profileId: caller?.profileId || null }
}

/** True when the scope may read the given cohort. A missing cohort id is never allowed for a bounded scope. */
export function cohortAllowed(scope, cohortId) {
  if (scope?.unrestricted) return true
  if (!cohortId) return false
  return !!scope?.cohortIds?.has(cohortId)
}

/**
 * The rubrics this scope may see for a student. Unrestricted: all of them. Bounded: only
 * rows that carry the caller's own interviewer_profile_id (identity, never a name match).
 */
export function rubricsForScope(scope, rubrics) {
  const rows = Array.isArray(rubrics) ? rubrics : []
  if (scope?.unrestricted) return rows
  if (!scope?.profileId) return []
  return rows.filter(r => r && r.interviewer_profile_id === scope.profileId)
}
