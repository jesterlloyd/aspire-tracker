// INTERVIEWER-ENTITLEMENTS-UI-1: reading the entitlement ledger on the client.
//
// /api/interviewer-entitlements `list` returns the RAW ledger: every row, for
// every interviewer, including revoked history (a re-grant after a revoke
// inserts a NEW row and the revoked one is never modified, so an interviewer
// with access can easily have several rows for the same cohort). It has no
// interviewer filter at all.
//
// So "which cohorts can this interviewer actually see files for" is a client-side
// derivation, and it is exactly the derivation the SERVER makes when it decides
// access (lib/server/interviewerEntitlements.js: same profile id, revoked_at IS
// NULL). These helpers exist so that derivation is written once and tested,
// rather than inlined into a component where a missed `revoked_at` check would
// silently show revoked access as live.
//
// Nothing here grants anything. The endpoint is the only writer, and it is
// active-Owner/Admin only.

/** Is this ledger row a live grant for this interviewer? */
function isActiveFor(row, interviewerProfileId) {
  return !!row
    && row.interviewer_profile_id === interviewerProfileId
    && (row.revoked_at === null || row.revoked_at === undefined);
}

/**
 * The cohort ids this interviewer currently holds, de-duplicated.
 *
 * @param {Array} rows  the `entitlements` array from the list action
 * @param {string} interviewerProfileId
 * @returns {string[]}
 */
export function activeCohortIds(rows, interviewerProfileId) {
  if (!Array.isArray(rows) || !interviewerProfileId) return [];
  const out = [];
  for (const row of rows) {
    if (!isActiveFor(row, interviewerProfileId)) continue;
    if (row.cohort_id && !out.includes(row.cohort_id)) out.push(row.cohort_id);
  }
  return out;
}

/**
 * The live grants as display rows, newest first, joined to cohort names.
 * A grant whose cohort is missing from the catalogue still appears (named by a
 * fallback) rather than vanishing: hiding access is worse than naming it oddly.
 */
export function activeEntitlements(rows, interviewerProfileId, cohorts) {
  const byId = new Map((Array.isArray(cohorts) ? cohorts : []).map(c => [c.id, c]));
  return (Array.isArray(rows) ? rows : [])
    .filter(r => isActiveFor(r, interviewerProfileId))
    .map(r => ({
      id: r.id,
      cohortId: r.cohort_id,
      cohortName: byId.get(r.cohort_id)?.name || 'Unknown cohort',
      grantedAt: r.granted_at || null,
    }))
    // De-duplicate by cohort: the ledger may hold one live row per cohort, but
    // never show the same cohort twice if history ever produces one.
    .filter((row, i, all) => all.findIndex(o => o.cohortId === row.cohortId) === i)
    .sort((a, b) => String(b.grantedAt || '').localeCompare(String(a.grantedAt || '')));
}

/** Cohorts this interviewer does NOT already hold, in catalogue order. */
export function grantableCohorts(cohorts, heldCohortIds) {
  const held = new Set(Array.isArray(heldCohortIds) ? heldCohortIds : []);
  return (Array.isArray(cohorts) ? cohorts : []).filter(c => c?.id && !held.has(c.id));
}
