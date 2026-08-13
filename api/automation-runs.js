// CONNECT-AUTOMATION - read-only data for the ASPIRE Connect > Automation health cards.
//
// Owner/Admin only. Serves cron_runs, which is RLS-enabled with NO policies, so authenticated
// clients CANNOT read it directly; this service-role endpoint is the only safe read path. Counts-
// only by design (no PII/tokens).
//
// Message-level history is intentionally NOT served here - it already lives in Outreach > Sent
// History (notification_log). The midpoint auto-send setting is read/written client-side directly
// against the cohorts row (same path as Rotation > Check-ins), so it is not part of this endpoint.
//
// Strictly read-only: SELECT only. No writes, no cron changes, no schema.
import { createClient } from '@supabase/supabase-js';
import supabaseAdmin from '../lib/server/evaluation/supabase_admin.js';
import { MONITORED_CRON_NAMES } from '../src/lib/automationCatalog.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  // ── Auth: verify the caller's Supabase JWT, then require Owner/Admin via user_profiles ──
  const bearer = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '').trim();
  if (!bearer) return res.status(401).json({ error: 'Unauthorized' });

  const userClient = createClient(
    process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
    process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY,
    { global: { headers: { Authorization: `Bearer ${bearer}` } } },
  );

  let user;
  try {
    const { data: { user: u }, error } = await userClient.auth.getUser();
    if (error || !u) return res.status(401).json({ error: 'Unauthorized' });
    user = u;
  } catch {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { data: profile } = await supabaseAdmin
    .from('user_profiles')
    .select('role, is_owner')
    .eq('auth_user_id', user.id)
    .single();

  const isOwnerAdmin = !!profile && (profile.is_owner === true || ['owner', 'admin'].includes(profile.role));
  if (!isOwnerAdmin) return res.status(403).json({ error: 'Forbidden' });

  // ── Read-only data ──────────────────────────────────────────────────────────
  // cron_runs powers Automation Health. PostgREST returns {data,error} rather than throwing.
  try {
    // AUTOMATION-MONITORING-1: scope to the crons the dashboard actually shows.
    // Unfiltered, this returned the 150 newest rows across every cron, and three
    // */10 delivery workers plus an hourly sweep write ~460 rows a day - so the
    // window was about eight hours and any older automation read "Never run".
    // Filtered, 150 rows spans weeks of card-relevant history.
    const runsRes = await supabaseAdmin
      .from('cron_runs')
      .select('id, cron_name, started_at, finished_at, status, details, error_text')
      .in('cron_name', MONITORED_CRON_NAMES)
      .order('started_at', { ascending: false })
      .limit(150);

    if (runsRes.error) {
      console.error('[automation-runs] cron_runs query failed:', runsRes.error.message);
      return res.status(500).json({ error: 'Automation monitor failed to load' });
    }

    return res.status(200).json({
      now: new Date().toISOString(), // server clock - UI derives "stale running" without an impure render-time Date
      runs: runsRes.data || [],
    });
  } catch (e) {
    console.error('[automation-runs] unexpected failure:', e?.message);
    return res.status(500).json({ error: 'Automation monitor failed to load' });
  }
}
