// CONNECT-AUTOMATION — shared server helper: is a scheduled automation enabled?
//
// Reads the GLOBAL automation_settings row for a key. DEFAULT-ON and FAIL-OPEN for existing crons:
// a missing row OR a read failure NEVER disables a live reminder — the cron keeps sending as today.
//
// Used ONLY by scheduled cron paths to gate AUTOMATIC sends. Manual/admin, dry-run, preview, and
// manual-live flows must NOT call this — operator actions are never suppressed by an automation
// toggle. Counts-only world: returns a boolean + a short source/warning token; no PII, no secrets,
// no raw Supabase error detail is returned to callers (raw error stays in the server log only).
//
// Returns: { enabled: boolean, source: 'row' | 'default' | 'fail_open', warning?: string }
export async function isAutomationEnabled({ supabaseAdmin, automationKey, defaultEnabled = true }) {
  try {
    const { data, error } = await supabaseAdmin
      .from('automation_settings')
      .select('enabled')
      .eq('automation_key', automationKey)
      .eq('scope_type', 'global')
      .is('scope_ref', null)
      .limit(1);

    if (error) {
      // Sanitized: raw message to the server log only; callers/heartbeats get a generic token.
      console.warn(`[automationSettings] read failed for ${automationKey} (failing open):`, error.message);
      return { enabled: defaultEnabled, source: 'fail_open', warning: 'settings_read_failed' };
    }

    const row = data && data[0];
    if (row) return { enabled: row.enabled === true, source: 'row' };
    return { enabled: defaultEnabled, source: 'default' };
  } catch (e) {
    console.warn(`[automationSettings] unexpected error for ${automationKey} (failing open):`, e?.message);
    return { enabled: defaultEnabled, source: 'fail_open', warning: 'settings_read_exception' };
  }
}
