// CONNECT-AUTOMATION-MONITOR-V1 — read-only data for the ASPIRE Connect > Automation monitor.
//
// Owner/Admin only. Serves two existing sources:
//   • cron_runs        — RLS-enabled with NO policies, so authenticated clients CANNOT read it
//                        directly; this service-role endpoint is the only safe read path. Counts-
//                        only by design (no PII/tokens).
//   • notification_log  — per-message audit containing recipient PII; gated here to Owner/Admin and
//                        returned with a WHITELIST of safe columns only (no metadata blob, no
//                        tokens, no survey URLs — none are stored on these columns anyway).
//
// Strictly read-only: SELECTs only. No writes, no cron changes, no schema.
import { createClient } from '@supabase/supabase-js';
import supabaseAdmin from '../lib/server/evaluation/supabase_admin.js';

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
  // Two independent queries. Automation Health REQUIRES cron_runs (hard-fail if it errors);
  // Recent Activity degrades gracefully (return runs + empty activity if notification_log errors).
  // PostgREST returns {data,error} rather than throwing, so a failure in one does not kill the other.
  try {
    const [runsRes, activityRes] = await Promise.all([
      supabaseAdmin
        .from('cron_runs')
        .select('id, cron_name, started_at, finished_at, status, details, error_text')
        .order('started_at', { ascending: false })
        .limit(150),
      supabaseAdmin
        .from('notification_log')
        // Whitelisted, production-confirmed columns only — NEVER metadata, tokens, or URLs.
        // NOTE: instrument_id is NOT a column here — it lives inside the metadata jsonb — so it is
        // intentionally excluded (selecting it 42703-fails the whole query; that was the 500 cause).
        .select('id, notification_type, recipient_name, recipient_email, recipient_role, recipient_type, status, subject, sent_at, delivered_at, opened_at, error_message, student_id, contact_id')
        .order('sent_at', { ascending: false })
        .limit(100),
    ]);

    // cron_runs powers Automation Health — fail clearly (safe JSON) if it errored.
    if (runsRes.error) {
      console.error('[automation-runs] cron_runs query failed:', runsRes.error.message);
      return res.status(500).json({ error: 'Automation monitor failed to load' });
    }

    // notification_log is best-effort — degrade to an empty feed rather than failing the whole page.
    let activity = activityRes.data || [];
    let warning;
    if (activityRes.error) {
      console.error('[automation-runs] notification_log query failed (returning empty activity):', activityRes.error.message);
      activity = [];
      warning = 'recent_activity_unavailable';
    }

    return res.status(200).json({
      now: new Date().toISOString(), // server clock — UI derives "stale running" without an impure render-time Date
      runs: runsRes.data || [],
      activity,
      ...(warning ? { warning } : {}),
    });
  } catch (e) {
    console.error('[automation-runs] unexpected failure:', e?.message);
    return res.status(500).json({ error: 'Automation monitor failed to load' });
  }
}
