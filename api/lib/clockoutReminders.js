// api/lib/clockoutReminders.js
//
// CLOCKOUT-NUDGE-SCHEDULE-1 — shared core for the clock-out reminder run, used by BOTH the manual
// endpoint (api/cron/clockout-reminders.js: dry-run default / preview / explicit live) and the
// hourly scheduled endpoint (api/cron/clockout-reminders-scheduled.js: live). There is exactly ONE
// copy of the detection thresholds (reused from shiftStatus.js), the dedup logic, and the email
// template wiring — neither endpoint duplicates them.
//
// MODES:
//   • 'dry-run'  → detect + classify + report. Sends NOTHING. No notification_log write.
//   • 'preview'  → dry-run PLUS exact subject/body/recipientType per row. Sends NOTHING.
//   • 'live'     → send to the CURRENT would-send rows only, via the established sendNotification path.
//
// Detection is re-run FRESH every call (never stale): open shifts are re-queried, the overdue subset
// is recomputed via shiftStatus.js, and dedup is re-read — so a live send reflects the state at the
// moment of the call and dedupes on the very next call. This idempotency is what makes the hourly
// schedule safe against Vercel's occasional duplicate cron invocations.
//
// Send/log ordering & residual failure mode: sending reuses sendNotification, which sends via Resend
// THEN writes notification_log (status 'sent'/'failed'). Not a single atomic op — if the email is
// accepted but the log insert fails, that open shift could be reminded again on a later run (no false
// "sent" is recorded for an email that wasn't accepted). Established app pattern (midpoint/interview
// crons); accepted given dedup-verified-on-success.

import {
  isClockoutMaybeOverdue, openShiftMs, formatDuration, shiftTypeOf, shiftBadge,
} from '../../src/lib/shiftStatus.js';
import { sendNotification } from '../../src/lib/notifications/index.js';
import { CLOCKOUT_REMINDER_SUBJECT, clockoutReminderText } from '../../src/lib/notifications/templates/clockoutReminder.js';
import { startCronRun, finishCronRunSuccess, finishCronRunError } from './cronRuns.js';
import { getStudentPreferredGreetingName } from '../../src/lib/studentNameFormatters.js';

// notification_type written by the live send (via sendNotification) and read for dedup. This is a
// VALUE for the existing notification_log.notification_type column — NOT a new column.
export const CLOCKOUT_REMINDER_NOTIFICATION_TYPE = 'clockout_reminder';

// Broadened statuses count as "already reminded" (mirrors the midpoint cron hotfix 6df905f), so a
// webhook-advanced row (delivered/opened/clicked/...) still dedupes. Used READ-ONLY here.
export const ALREADY_SENT_STATUSES = ['sent', 'delivered', 'opened', 'clicked', 'delayed', 'bounced', 'complained'];

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

// Core run. Returns { status, body } for the calling handler to send. Never throws — DB/send errors
// are caught, recorded to cron_runs (counts-only), and surfaced as a 500 body.
//   supabase : a service-role client (created by the calling endpoint)
//   mode     : 'dry-run' | 'preview' | 'live'
//   cronName : cron_runs heartbeat name ('clockout-reminders' manual, 'clockout-reminders-scheduled' hourly)
export async function runClockoutReminders(supabase, { mode = 'dry-run', cronName = 'clockout-reminders' } = {}) {
  const isLive    = mode === 'live';
  const isPreview = mode === 'preview';

  const now = new Date();
  const nowMs = now.getTime();
  console.log(`[${cronName}] ${mode.toUpperCase()} at ${now.toISOString()}`);
  const runId = await startCronRun(supabase, cronName);

  try {
    // ── 1. Open shifts (program-wide): lifecycle_state in_progress = clock-in present, clock-out null
    const { data: openLogs, error: logsErr } = await supabase
      .from('student_shift_logs')
      .select('id, student_id, cohort_id, checked_in_at, lifecycle_state, planned_shift_type, shift_type')
      .eq('lifecycle_state', 'in_progress');

    if (logsErr) {
      console.error(`[${cronName}] open-shift query error:`, logsErr);
      await finishCronRunError(supabase, runId, logsErr.message);
      return { status: 500, body: { error: logsErr.message } };
    }

    const open = openLogs || [];

    // ── 2. Overdue subset — reuse shiftStatus.js thresholds (Day 14h, others 16h). No duplication.
    const overdue = open.filter(log => isClockoutMaybeOverdue(log, nowMs));

    // ── 3. Recipient resolution (read-only): school_email then personal_email
    //      SHIFT-EMAIL-ROUTING-1: clock-out reminders are ACTIVE-SHIFT operational comms and students
    //      log shifts under their school email, so school_email is preferred; personal_email is only a
    //      fallback when school_email is missing/blank (the fallback is flagged + reported).
    const studentIds = [...new Set(overdue.map(l => l.student_id).filter(Boolean))];
    let studentMap = {};
    if (studentIds.length) {
      const { data: students, error: stuErr } = await supabase
        .from('students')
        .select('id, first_name, last_name, preferred_first_name, school, program_type, personal_email, school_email')
        .in('id', studentIds);
      if (stuErr) {
        console.error(`[${cronName}] students query error:`, stuErr);
        await finishCronRunError(supabase, runId, stuErr.message);
        return { status: 500, body: { error: stuErr.message } };
      }
      studentMap = Object.fromEntries((students || []).map(s => [s.id, s]));
    }

    // ── 4. Read-only dedup: which OPEN-SHIFT ids have already been reminded? Keyed per open shift
    //      via metadata.context.shiftLogId (mirrors interview-reminders' interviewSessionId). Re-read
    //      fresh each call so a live send immediately dedupes on the next (hourly) invocation.
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
      const schoolEmail   = (stu?.school_email || '').trim();
      const personalEmail = (stu?.personal_email || '').trim();
      // School-first; personal_email only as fallback when school_email is missing/blank.
      const recipient     = schoolEmail || personalEmail || '';
      if (!recipient) {
        skippedNoEmail.push(rowSummary(log, stu, nowMs));
        continue;
      }
      const fallbackUsed  = !schoolEmail && !!personalEmail;
      const recipientType = fallbackUsed ? 'personal_email_fallback' : 'school_email';
      const firstName     = getStudentPreferredGreetingName(stu);

      const row = {
        ...rowSummary(log, stu, nowMs),
        recipient,
        recipientType,
        fallbackUsed,
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
          fallbackUsed,
          studentName:   row.studentName,
          shift:         row.shift,
          openDuration:  row.openDuration,
        };
      }
      wouldSend.push(row);
    }

    // ── 6. LIVE send loop — only when mode === 'live'. Sends to the CURRENT would-send rows only
    //      (already excludes recently-reminded + no-email). Reuses sendNotification, which writes
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
            console.error(`[${cronName}] send reported no success for shift ${row.shiftLogId}`);
          }
        } catch (err) {
          failedCount++;
          row.sendStatus = 'failed';
          console.error(`[${cronName}] send failed for shift ${row.shiftLogId}:`, err.message);
        }
      }
    }

    // ── 7. cron_runs heartbeat — COUNTS ONLY (no names/emails/links/tokens/preview bodies)
    const counts = {
      dry_run: !isLive,
      open_checked: open.length,
      overdue_count: overdue.length,
      would_send_count: wouldSend.length,
      // SHIFT-EMAIL-ROUTING-1: how many would-send rows fell back to personal_email (school_email
      // missing/blank). Counts-only — no names/emails persisted to cron_runs.
      personal_email_fallback_count: wouldSend.filter(r => r.fallbackUsed).length,
      sent_count: sentCount,
      skipped_no_email_count: skippedNoEmail.length,
      skipped_recently_reminded_count: skippedRecent.length,
      failed_count: failedCount,
      error_count: 0,
    };
    await finishCronRunSuccess(supabase, runId, counts);

    // ── 8. Report. Row details (names + resolved recipient + preview body) are returned ONLY in this
    //      CRON_SECRET-gated response for Owner/Admin review — they are NOT persisted to cron_runs.
    return {
      status: 200,
      body: {
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
      },
    };
  } catch (err) {
    console.error(`[${cronName}] unexpected error:`, err);
    await finishCronRunError(supabase, runId, err.message);
    return { status: 500, body: { error: err.message } };
  }
}
