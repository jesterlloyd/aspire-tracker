// lib/server/interviewerEntitlements.js
//
// WAVE F-2 (interviewer file access): the single, identity-based predicate for
// interviewer cohort entitlement. Access is granted by a durable row in
// interviewer_cohort_entitlements keyed on user_profiles.id, never by interviewer
// names, emails, roster strings, or request-supplied ids.
//
// An entitlement counts as ACTIVE only when its row is unrevoked AND the linked
// account is still an active interviewer. Account deactivation is enforced by the
// caller verification (verifyPortalCaller rejects inactive) BEFORE this runs, so a
// deactivated interviewer is denied immediately even if the row is unrevoked.

const ENTITLEMENTS_TABLE = 'interviewer_cohort_entitlements'

// Resolve the set of cohort ids for which the given interviewer profile currently
// holds an ACTIVE (unrevoked) entitlement. Returns a Set (empty when none).
// Throws on a database error so the caller can fail closed.
export async function activeEntitledCohortIds(db, interviewerProfileId) {
  const { data, error } = await db
    .from(ENTITLEMENTS_TABLE)
    .select('cohort_id')
    .eq('interviewer_profile_id', interviewerProfileId)
    .is('revoked_at', null)
  if (error) throw new Error('entitlement_lookup_failed')
  return new Set((data || []).map((r) => r.cohort_id).filter(Boolean))
}

export { ENTITLEMENTS_TABLE }
