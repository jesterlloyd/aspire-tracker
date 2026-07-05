// CONNECT-AUTOMATION-SETTINGS - Owner/Admin-gated read/write for Automation Controls toggles.
//
// Backs the four currently-monitor-only crons with real on/off settings in automation_settings.
// Service-role only (the table is RLS-locked with no client policies); auth mirrors automation-runs.
//
//   GET   - normalized list of the four known automations. Absent row => enabled per code default
//           (all four default ON this phase) with source="default". An empty table never disables.
//   PATCH - upsert ONE global setting. Global scope only this phase (cohort/school/contact rejected).
//
// Scope this phase is GLOBAL only. Midpoint is NOT here (it stays on cohorts.midpoint_checkin_
// automation_enabled). The interviewer packet reminder is NOT here (added later, default OFF).
//
// Strictly settings I/O: no cron execution, no notification_log / cron_runs writes, no email,
// no secrets/tokens/metadata returned.
import { createClient } from '@supabase/supabase-js';
import supabaseAdmin from '../lib/server/evaluation/supabase_admin.js';

// Known automations for this phase. The SERVER owns this list (the table intentionally does not
// constrain automation_key), so adding a future automation is a code change, not a schema change.
const KNOWN_AUTOMATIONS = [
  { key: 'teams_invite_reminders', label: 'Teams Invite Reminders',
    description: 'Nudges interviewers and candidates to accept the Microsoft Teams interview invite.',
    defaultEnabled: true },
  { key: 'interview_reminders', label: 'Interview Reminders',
    description: 'Sends candidates a reminder ahead of their scheduled interview.',
    defaultEnabled: true },
  { key: 'coordinator_weekly_digest', label: 'Coordinator Weekly Digest',
    description: 'Weekly student-activity summary emailed to school coordinators.',
    defaultEnabled: true },
  { key: 'clockout_reminders', label: 'Clock-Out Reminders',
    description: 'Hourly nudge for students with an open shift that may be overdue to clock out.',
    defaultEnabled: true },
];
const META_BY_KEY = new Map(KNOWN_AUTOMATIONS.map(a => [a.key, a]));

// Normalize a known automation (+ optional persisted row) into the response shape.
function normalize(meta, row) {
  const base = {
    automation_key:  meta.key,
    label:           meta.label,
    description:     meta.description,
    scope_type:      'global',
    scope_ref:       null,
    default_enabled: meta.defaultEnabled,
  };
  if (row) {
    return {
      ...base,
      enabled:    row.enabled,
      source:     'row',
      updated_at: row.updated_at || null,
      updated_by: row.updated_by || null,
    };
  }
  return {
    ...base,
    enabled:    meta.defaultEnabled, // default-ON when no row exists - an empty table disables nothing
    source:     'default',
    updated_at: null,
    updated_by: null,
  };
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'PATCH') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

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
    .select('id, role, is_owner')
    .eq('auth_user_id', user.id)
    .single();

  const isOwnerAdmin = !!profile && (profile.is_owner === true || ['owner', 'admin'].includes(profile.role));
  if (!isOwnerAdmin) return res.status(403).json({ error: 'Forbidden' });
  const actorId = profile.id; // user_profiles.id - recorded as created_by / updated_by

  // ── GET: normalized list of the four known automations ──────────────────────────
  if (req.method === 'GET') {
    try {
      const { data, error } = await supabaseAdmin
        .from('automation_settings')
        .select('automation_key, scope_type, scope_ref, enabled, updated_at, updated_by')
        .eq('scope_type', 'global')
        .is('scope_ref', null)
        .in('automation_key', KNOWN_AUTOMATIONS.map(a => a.key));
      if (error) {
        console.error('[automation-settings] GET query failed:', error.message);
        return res.status(500).json({ error: 'Failed to load automation settings' });
      }
      const rowByKey = new Map((data || []).map(r => [r.automation_key, r]));
      const settings = KNOWN_AUTOMATIONS.map(meta => normalize(meta, rowByKey.get(meta.key)));
      return res.status(200).json({ settings });
    } catch (e) {
      console.error('[automation-settings] GET failed:', e?.message);
      return res.status(500).json({ error: 'Failed to load automation settings' });
    }
  }

  // ── PATCH: upsert ONE global setting ────────────────────────────────────────────
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'Invalid JSON body' }); }
  }
  if (!body || typeof body !== 'object') return res.status(400).json({ error: 'Missing request body' });

  const { automation_key: key, enabled, scope_type, scope_ref } = body;

  if (!META_BY_KEY.has(key)) {
    return res.status(400).json({ error: 'Unknown automation_key' });
  }
  if (typeof enabled !== 'boolean') {
    return res.status(400).json({ error: 'enabled must be a boolean' });
  }
  // Global scope only this phase - reject cohort/school/contact until UI + cron support it.
  if (scope_type !== undefined && scope_type !== 'global') {
    return res.status(400).json({ error: 'Only global scope is supported in this phase' });
  }
  if (scope_ref !== undefined && scope_ref !== null) {
    return res.status(400).json({ error: 'scope_ref must be null for global scope' });
  }

  const meta = META_BY_KEY.get(key);

  try {
    // Select-first so created_at / created_by are preserved on update (set only on insert).
    const { data: existingRows, error: selErr } = await supabaseAdmin
      .from('automation_settings')
      .select('id')
      .eq('automation_key', key)
      .eq('scope_type', 'global')
      .is('scope_ref', null)
      .limit(1);
    if (selErr) {
      console.error('[automation-settings] PATCH select failed:', selErr.message);
      return res.status(500).json({ error: 'Failed to update automation setting' });
    }

    const nowIso = new Date().toISOString();
    const existing = existingRows && existingRows[0];
    const returning = 'automation_key, scope_type, scope_ref, enabled, updated_at, updated_by';

    let row, opErr;
    if (existing) {
      const { data, error } = await supabaseAdmin
        .from('automation_settings')
        .update({ enabled, updated_by: actorId, updated_at: nowIso }) // created_at / created_by untouched
        .eq('id', existing.id)
        .select(returning)
        .single();
      row = data; opErr = error;
    } else {
      const { data, error } = await supabaseAdmin
        .from('automation_settings')
        .insert({
          automation_key: key, scope_type: 'global', scope_ref: null, enabled,
          created_by: actorId, updated_by: actorId, updated_at: nowIso,
        })
        .select(returning)
        .single();
      row = data; opErr = error;
    }

    if (opErr || !row) {
      console.error('[automation-settings] PATCH upsert failed:', opErr?.message);
      return res.status(500).json({ error: 'Failed to update automation setting' });
    }

    return res.status(200).json({ setting: normalize(meta, row) });
  } catch (e) {
    console.error('[automation-settings] PATCH failed:', e?.message);
    return res.status(500).json({ error: 'Failed to update automation setting' });
  }
}
