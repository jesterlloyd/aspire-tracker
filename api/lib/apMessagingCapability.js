// api/lib/apMessagingCapability.js
//
// Server-owned release gate for Academic Partner <-> ASPIRE Team messaging. The client never decides
// enablement from its own constant or a public env var; it reads one canonical capability result from
// the server (GET /api/portal/portal-capabilities), and every write re-authorizes independently.
//
// Enabled requires BOTH:
//   1. the server env flag AP_MESSAGING_ENABLED === 'true' (default false / fail-closed when missing),
//   2. the database capability being present: the enable_academic_partner_team_messages migration is
//      applied, proved by probing the ap_team_messaging_capability() sentinel.
//
// The probe is read-only (no mutation) and runs as the service-role caller, so it can never be a
// false positive from an anonymous / RLS-limited path. Any probe error (undefined function =>
// migration not applied, or any other failure) keeps the feature fail-closed. Not cached, so it
// re-detects automatically once the migration is applied and the env flag is set.

/* global process */

// The env flag alone. 'true' (exact) enables; anything else (including unset) is disabled.
export function apMessagingEnvEnabled() {
  return process.env.AP_MESSAGING_ENABLED === 'true';
}

// The database capability alone: is the AP messaging migration applied? Probes the sentinel via the
// provided service-role db. Fails closed on any error.
export async function isApTeamMessagingCapable(db) {
  if (!db) return false;
  try {
    const { data, error } = await db.rpc('ap_team_messaging_capability');
    if (error) return false;
    return data === true;
  } catch {
    return false;
  }
}

// The canonical capability result: env flag AND database capability. The env flag is checked first so
// a disabled deployment never probes the database.
export async function resolveApMessagingCapability(db) {
  if (!apMessagingEnvEnabled()) return false;
  return isApTeamMessagingCapable(db);
}
