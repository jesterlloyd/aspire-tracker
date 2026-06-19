// api/cron/clockout-reminders-scheduled.js
//
// CLOCKOUT-NUDGE-SCHEDULE-1 — the AUTOMATIC hourly clock-out reminder endpoint, called by the Vercel
// cron schedule (0 * * * *). It exists as a dedicated endpoint precisely so the live-send is selected
// by the ROUTE, not by a query string — Vercel cron invokes a bare path and attaches the
// Authorization: Bearer CRON_SECRET header, so we never depend on fragile query-string behavior.
//
// It performs the SAME live-send behavior as the manual endpoint's approved live mode by delegating
// to the shared core (api/lib/clockoutReminders.js, mode='live'). No detection thresholds, dedup
// logic, or email template logic is duplicated here.
//
// Idempotency: the shared core re-detects fresh and dedupes on notification_log
// (notification_type='clockout_reminder' + metadata.context.shiftLogId) before every send, so the
// hourly cadence — and Vercel's occasional duplicate cron invocations — never double-send a shift.
//
// Security: CRON_SECRET is mandatory. An unauthenticated request returns 401. There is no public
// send path.

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

  // Always live — this endpoint is the scheduled automatic sender. Distinct cron_runs name so the
  // hourly run is observable separately from manual runs.
  const { status, body } = await runClockoutReminders(supabase, {
    mode: 'live',
    cronName: 'clockout-reminders-scheduled',
  });
  return res.status(status).json(body);
}
