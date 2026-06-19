// api/cron/clockout-reminders.js
//
// CLOCKOUT-NUDGE-LIVE-1 — CRON_SECRET-protected clock-out reminder cron for open shifts whose
// clock-out MAY be overdue. It detects (reusing src/lib/shiftStatus.js — no duplicated thresholds),
// resolves the would-be recipient (personal_email -> school_email), checks dedup read-only, and —
// only under an explicit live signal — sends the reminder via the established sendNotification path.
//
// MODES (CRON_SECRET is required for ALL modes via the 401 gate below):
//   • default / anything else  → DRY-RUN: detect + classify + report. Sends NOTHING. No log write.
//   • ?mode=preview            → PREVIEW: dry-run PLUS exact subject/body/recipientType per row.
//                                Sends NOTHING. No log write.
//   • ?mode=live&confirm=clockout_reminder → LIVE: send to the CURRENT would-send rows only.
//
// There is NO Vercel schedule for this cron — a normal scheduled/cron call (no live signal) is a
// dry-run and sends nothing. Live-send is manual-only and requires BOTH the secret and the explicit
// mode+confirm signal.
//
// Detection is re-run FRESH every invocation (never stale): open shifts are re-queried, the overdue
// subset is recomputed via shiftStatus.js, and dedup is re-read, so the live send reflects the state
// at the moment of the call.
//
// Send/log ordering & residual failure mode: sending reuses sendNotification, which sends via Resend
// THEN writes notification_log (status 'sent'/'failed'). It is not a single atomic op — if the email
// is accepted but the log insert fails, that open shift could be reminded again on a later live call
// (no false "sent" is recorded for an email that wasn't accepted). This is the established app
// pattern (same as midpoint/interview crons); accepted given dry-run default, manual-only live, and
// dedup-verified-on-success. Wording stays supportive: "clock out" (not "logout"), "still appears
// open" (not "you forgot").

import { createClient } from '@supabase/supabase-js';
import {
  isClockoutMaybeOverdue, openShiftMs, formatDuration, shiftTypeOf, shiftBadge,
} from '../../src/lib/shiftStatus.js';
import { sendNotification } from '../../src/lib/notifications/index.js';
import { CLOCKOUT_REMINDER_SUBJECT, clockoutReminderText } from '../../src/lib/notifications/templates/clockoutReminder.js';
import { startCronRun, finishCronRunSuccess, finishCronRunError } from '../lib/cronRuns.js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// notification_type written by the live send (via sendNotification) and read for dedup. This is a
// VALUE for the existing notification_log.notification_type column — NOT a new column.
const CLOCKOUT_REMINDER_NOTIFICATION_TYPE = 'clockout_reminder';

// Broadened statuses count as "already reminded" (mirrors the midpoint cron hotfix 6df905f), so a
// webhook-advanced row (delivered/opened/clicked/...) still dedupes. Used READ-ONLY here.
const ALREADY_SENT_STATUSES = ['sent', 'delivered', 'opened', 'clicked', 'delayed', 'bounced', 'complained'];

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

  // Mode gate. Live requires BOTH the explicit mode and the confirm token; anything else is dry-run.
  const isLive    = req.query.mode === 'live' && req.query.confirm === 'clockout_reminder';
  const isPreview = req.query.mode === 'preview';
  const mode      = isLive ? 'live' : (isPreview ? 'preview' : 'dry-run');

  const now = new Date();
  const nowMs = now.getTime();
  console.log(`[clockout-reminders] ${mode.toUpperCase()} at ${now.toISOString()}`);
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
    //      via metadata.context.shiftLogId (mirrors interview-reminders' interviewSessionId). Re-read
    //      fresh each call so a live send immediately dedupes on the next invocation.
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
      const personalEmail = stu?.personal_email || '';
      const schoolEmail   = stu?.school_email || '';
      const recipient     = personalEmail || schoolEmail || '';
      if (!recipient) {
        skippedNoEmail.push(rowSummary(log, stu, nowMs));
        continue;
      }
      const recipientType = personalEmail ? 'personal_email' : 'school_email';
      const firstName     = stu?.first_name || 'there';

      const row = {
        ...rowSummary(log, stu, nowMs),
        recipient,
        recipientType,
        firstName,
        cohortId: log.cohort_id,
      };

      // Preview/live responses carry the EXACT subject + plaintext body that would be / was sent,
      // plus the recipient type and shift context. Never persisted to cron_runs (counts-only there).
      if (isPreview || isLive) {
        row.email_preview = {
          subject:       CLOCKOUT_REMINDER_SUBJECT,
          body:          clockoutReminderText(firstName),
          recipientType,
          studentName:   row.studentName,
          shift:         row.shift,
          openDuration:  row.openDuration,
        };
      }
      wouldSend.push(row);
    }

    // ── 6. LIVE send loop — only under the explicit live signal. Sends to the CURRENT would-send rows
    //      only (already excludes recently-reminded + no-email). Reuses sendNotification, which writes
    //      notification_log with notification_type='clockout_reminder' and metadata.context.shiftLogId.
    let sentCount = 0;
    let failedCount = 0;
    if (isLive) {
      for (const row of wouldSend) {
        try {
          const results = await sendNotification('clockout_reminder', {
            studentId:    row.studentId,
            cohortId:     row.cohortId,
            firstName:    row.firstName,
            studentEmail: row.recipient,
            shiftLogId:   row.shiftLogId,
          });
          const ok = Array.isArray(results) && results.some(r => r.success);
          if (ok) {
            sentCount++;
            row.sendStatus = 'sent';
          } else {
            failedCount++;
            row.sendStatus = 'failed';
            console.error(`[clockout-reminders] send reported no success for shift ${row.shiftLogId}`);
          }
        } catch (err) {
          failedCount++;
          row.sendStatus = 'failed';
          console.error(`[clockout-reminders] send failed for shift ${row.shiftLogId}:`, err.message);
        }
      }
    }

    // ── 7. cron_runs heartbeat — COUNTS ONLY (no names/emails/links/tokens/preview bodies)
    const counts = {
      dry_run: !isLive,
      open_checked: open.length,
      overdue_count: overdue.length,
      would_send_count: wouldSend.length,
      sent_count: sentCount,
      skipped_no_email_count: skippedNoEmail.length,
      skipped_recently_reminded_count: skippedRecent.length,
      failed_count: failedCount,
      error_count: 0,
    };
    await finishCronRunSuccess(supabase, runId, counts);

    // ── 8. Report. Row details (names + resolved recipient + preview body) are returned ONLY in this
    //      CRON_SECRET-gated response for Owner/Admin review — they are NOT persisted to cron_runs.
    return res.status(200).json({
      mode,
      dryRun: !isLive,
      live: isLive,
      sent: sentCount,
      failed: failedCount,
      note: isLive
        ? 'LIVE: reminders sent to the current would-send students; notification_log written via sendNotification.'
        : (isPreview
          ? 'PREVIEW: detection + recipient resolution + read-only dedup + exact subject/body. No email sent; no notification_log written.'
          : 'DRY-RUN: detection + recipient resolution + read-only dedup. No email sent; no notification_log written.'),
      notificationType: CLOCKOUT_REMINDER_NOTIFICATION_TYPE,
      dedupKey: 'notification_log.metadata.context.shiftLogId === student_shift_logs.id (one reminder per open shift)',
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
