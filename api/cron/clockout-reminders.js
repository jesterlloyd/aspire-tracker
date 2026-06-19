// api/cron/clockout-reminders.js
//
// CLOCKOUT-NUDGE-1 (DRY-RUN-FIRST) — CRON_SECRET-protected detection/report cron for open shifts
// whose clock-out MAY be overdue. It detects (reusing src/lib/shiftStatus.js — no duplicated
// thresholds), resolves the would-be recipient (read-only), checks dedup read-only, and REPORTS
// who WOULD be reminded and why. It sends NOTHING.
//
// THERE IS NO SEND PATH IN THIS PHASE — Resend is not imported, no email is sent or drafted, and
// notification_log is NEVER written (it is only READ for dedup). Live-send is a separate later
// phase that ADDS the send + the notification_log write under its own review. Hedged wording
// throughout; "clock out" (not "logout"); "still appears open" (not "you forgot").

import { createClient } from '@supabase/supabase-js';
import {
  isClockoutMaybeOverdue, openShiftMs, formatDuration, shiftTypeOf, shiftBadge,
} from '../../src/lib/shiftStatus.js';
import { startCronRun, finishCronRunSuccess, finishCronRunError } from '../lib/cronRuns.js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// PROPOSED notification_type for the LATER live-send phase. No clock-out reminder type exists
// today, so the dedup read below currently matches nothing (every overdue+email shift is
// would-send). The live-send phase will WRITE notification_log rows with this type — at which
// point the same read-only dedup here classifies already-reminded shifts. Reported for review.
const CLOCKOUT_REMINDER_NOTIFICATION_TYPE = 'clockout_reminder';

// Broadened statuses count as "already reminded" (mirrors the midpoint cron hotfix 6df905f), so a
// webhook-advanced row (delivered/opened/clicked/...) still dedupes. Used READ-ONLY here.
const ALREADY_SENT_STATUSES = ['sent', 'delivered', 'opened', 'clicked', 'delayed', 'bounced', 'complained'];

// Approved student-facing copy, defined here so it is reviewed now — but NOT sent this phase.
// Supportive/operational, never disciplinary.
export const CLOCKOUT_REMINDER_COPY = {
  subject: 'ASPIRE: Your shift still appears open',
  body:
    'Your ASPIRE shift still appears open in the tracker. If your shift has ended, please clock ' +
    'out as soon as possible. If you are still on shift, no action is needed at this time.',
};

// Safe, hedged row summary for the CRON_SECRET-gated review response. No tokens/links/payload.
function rowSummary(log, stu, nowMs) {
  return {
    shiftLogId:   log.id,
    studentId:    log.student_id,
    studentName:  stu ? (`${stu.first_name || ''} ${stu.last_name || ''}`.trim() || null) : null,
    school:       stu?.school || null,
    program:      stu?.program_type || null,
    shift:        shiftBadge(shiftTypeOf(log)).label,
    checkedInAt:  log.checked_in_at,
    openDuration: formatDuration(openShiftMs(log, nowMs)),
    status:       'Clock-out may be overdue',
  };
}

export default async function handler(req, res) {
  if (req.headers['authorization'] !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const now = new Date();
  const nowMs = now.getTime();
  console.log(`[clockout-reminders] DRY-RUN at ${now.toISOString()} — detection/report only, sends nothing`);
  const runId = await startCronRun(supabase, 'clockout-reminders');

  try {
    // ── 1. Open shifts (program-wide): lifecycle_state in_progress = clock-in present, clock-out null
    const { data: openLogs, error: logsErr } = await supabase
      .from('student_shift_logs')
      .select('id, student_id, cohort_id, checked_in_at, lifecycle_state, planned_shift_type, shift_type')
      .eq('lifecycle_state', 'in_progress');

    if (logsErr) {
      console.error('[clockout-reminders] open-shift query error:', logsErr);
      await finishCronRunError(supabase, runId, logsErr.message);
      return res.status(500).json({ error: logsErr.message });
    }

    const open = openLogs || [];

    // ── 2. Overdue subset — reuse shiftStatus.js thresholds (Day 14h, others 16h). No duplication.
    const overdue = open.filter(log => isClockoutMaybeOverdue(log, nowMs));

    // ── 3. Recipient resolution (read-only): personal_email then school_email
    const studentIds = [...new Set(overdue.map(l => l.student_id).filter(Boolean))];
    let studentMap = {};
    if (studentIds.length) {
      const { data: students, error: stuErr } = await supabase
        .from('students')
        .select('id, first_name, last_name, school, program_type, personal_email, school_email')
        .in('id', studentIds);
      if (stuErr) {
        console.error('[clockout-reminders] students query error:', stuErr);
        await finishCronRunError(supabase, runId, stuErr.message);
        return res.status(500).json({ error: stuErr.message });
      }
      studentMap = Object.fromEntries((students || []).map(s => [s.id, s]));
    }

    // ── 4. Read-only dedup: which OPEN-SHIFT ids have already been reminded? Keyed per open shift
    //      via metadata.context.shiftLogId (proposed; mirrors interview-reminders' interviewSessionId).
    //      Empty until the live-send phase writes these rows — so dry-run skipped-recent is 0 today.
    const dedupCutoff = new Date(nowMs - 14 * 24 * 3600 * 1000).toISOString();
    const { data: sentLog } = await supabase
      .from('notification_log')
      .select('metadata')
      .eq('notification_type', CLOCKOUT_REMINDER_NOTIFICATION_TYPE)
      .in('status', ALREADY_SENT_STATUSES)
      .gte('sent_at', dedupCutoff);

    const remindedShiftIds = new Set(
      (sentLog || []).map(r => r.metadata?.context?.shiftLogId).filter(Boolean)
    );

    // ── 5. Classify each overdue open shift: would-send / skipped-no-email / skipped-recently-reminded
    const wouldSend = [];
    const skippedNoEmail = [];
    const skippedRecent = [];

    for (const log of overdue) {
      const stu = studentMap[log.student_id] || null;

      if (remindedShiftIds.has(log.id)) {
        skippedRecent.push(rowSummary(log, stu, nowMs));
        continue;
      }
      const recipient = stu ? (stu.personal_email || stu.school_email || '') : '';
      if (!recipient) {
        skippedNoEmail.push(rowSummary(log, stu, nowMs));
        continue;
      }
      wouldSend.push({ ...rowSummary(log, stu, nowMs), recipient });
    }

    // ── 6. cron_runs heartbeat — COUNTS ONLY (no names/emails/links/tokens)
    const counts = {
      dry_run: true,
      open_checked: open.length,
      overdue_count: overdue.length,
      would_send_count: wouldSend.length,
      skipped_no_email_count: skippedNoEmail.length,
      skipped_recently_reminded_count: skippedRecent.length,
      error_count: 0,
    };
    await finishCronRunSuccess(supabase, runId, counts);

    // ── 7. Report. Row details (names + resolved recipient) are returned ONLY in this CRON_SECRET-
    //      gated response for Owner/Admin review — they are NOT persisted to cron_runs.
    return res.status(200).json({
      dryRun: true,
      sent: 0,
      note: 'DRY-RUN: detection + recipient resolution + read-only dedup. No email sent; no notification_log written.',
      proposedNotificationType: CLOCKOUT_REMINDER_NOTIFICATION_TYPE,
      proposedDedupKey: 'notification_log.metadata.context.shiftLogId === student_shift_logs.id (one reminder per open shift)',
      counts,
      wouldSend,
      skippedNoEmail,
      skippedRecentlyReminded: skippedRecent,
    });
  } catch (err) {
    console.error('[clockout-reminders] unexpected error:', err);
    await finishCronRunError(supabase, runId, err.message);
    return res.status(500).json({ error: err.message });
  }
}
