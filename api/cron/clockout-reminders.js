// api/cron/clockout-reminders.js
//
// CLOCKOUT-NUDGE-LIVE-1 / SCHEDULE-1 — CRON_SECRET-protected MANUAL clock-out reminder endpoint.
// This is the human-driven endpoint for dry-run / preview / explicit live. It has NO Vercel schedule
// of its own — a normal call (no live signal) is a dry-run and sends nothing. The hourly automatic
// run is a SEPARATE endpoint (api/cron/clockout-reminders-scheduled.js) that hard-codes live mode.
//
// All detection/dedup/template/send logic lives in api/lib/clockoutReminders.js and is SHARED with
// the scheduled endpoint — there is exactly one copy of the thresholds, dedup, and email wiring.
//
// MODES (CRON_SECRET required for all via the 401 gate below):
//   • default / anything else  → DRY-RUN: detect + classify + report. Sends NOTHING. No log write.
//   • ?mode=preview            → PREVIEW: dry-run PLUS exact subject/body/recipientType per row.
//   • ?mode=live&confirm=clockout_reminder → LIVE: send to the CURRENT would-send rows only.

import { createClient } from '@supabase/supabase-js';
import { runClockoutReminders } from '../lib/clockoutReminders.js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (req.headers['authorization'] !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // Mode gate. Live requires BOTH the explicit mode and the confirm token; anything else is dry-run.
  const isLive    = req.query.mode === 'live' && req.query.confirm === 'clockout_reminder';
  const isPreview = req.query.mode === 'preview';
  const mode      = isLive ? 'live' : (isPreview ? 'preview' : 'dry-run');

  const { status, body } = await runClockoutReminders(supabase, { mode, cronName: 'clockout-reminders' });
  return res.status(status).json(body);
}
