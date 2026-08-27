// api/lib/naPortalUtilitiesCapability.js
//
// NA-PORTAL-UTILITIES-1: server-owned release gates for the Nursing Education & Leadership portal's
// Messages and Feedback, mirroring apMessagingCapability.js. The client never decides enablement; it
// reads the canonical capability result from GET /api/portal/portal-capabilities, and every write
// re-authorizes independently.
//
// Messages enabled requires BOTH:
//   1. the server env flag NA_MESSAGING_ENABLED === 'true' (default false / fail-closed),
//   2. the database capability: the enable_nursing_academic_portal_utilities migration applied,
//      proved by probing the na_portal_utilities_capability() sentinel.
// Feedback enabled requires the database capability alone (no env flag, matching the other portals'
// always-on feedback) - before the migration, the portal_feedback role CHECK would reject the row,
// so the sentinel is the truthful gate.
//
// Probes are read-only, service-role, and fail closed on any error. Not cached, so they re-detect
// automatically once the migration is applied.

/* global process */

export function naMessagingEnvEnabled() {
  return process.env.NA_MESSAGING_ENABLED === 'true';
}

// The database capability alone: is the NA portal-utilities migration applied?
export async function isNaPortalUtilitiesCapable(db) {
  if (!db) return false;
  try {
    const { data, error } = await db.rpc('na_portal_utilities_capability');
    if (error) return false;
    return data === true;
  } catch {
    return false;
  }
}

// Messages: env flag AND database capability (env first, so a disabled deployment never probes).
export async function resolveNaMessagingCapability(db) {
  if (!naMessagingEnvEnabled()) return false;
  return isNaPortalUtilitiesCapable(db);
}

// Feedback: database capability alone.
export async function resolveNaFeedbackCapability(db) {
  return isNaPortalUtilitiesCapable(db);
}
