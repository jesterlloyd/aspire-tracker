// api/cron/clockout-reminders-resend.js
//
// CLOCKOUT-CORRECTION-SEND-1 — a TIGHTLY SCOPED, OWNER-CONFIRMED, SCHOOL-EMAIL-ONLY correction resend
// for exactly two overdue open shift logs that were reminded BEFORE the school-email routing fix
// (SHIFT-EMAIL-ROUTING-1) and are now permanently blocked by the normal 14-day recent-reminder dedup.
//
// This is NOT a general resend feature and NOT a dedup bypass for the normal cron:
//   • It processes ONLY the two hardcoded APPROVED_SHIFT_LOG_IDS below — no shiftLogId can be passed
//     in; anything else is structurally impossible to target.
//   • It does NOT read, change, or weaken the normal cron's recent-reminder dedup or the 14-day
//     window, and it NEVER mutates existing notification_log rows. It writes a NEW, audited
//     clockout_reminder row per corrected send (which then also satisfies future dedup).
//   • Recipient is school_email ONLY. If school_email is missing/blank → that shift is skipped and
//     reported; there is NO personal-email fallback for this correction.
//   • It re-checks at runtime that each shift is STILL open (lifecycle_state='in_progress') and STILL
//     overdue (shiftStatus.js threshold). A closed/not-overdue shift is skipped and reported.
//   • It reuses the corrected branded clock-out template (CLOCKOUT-EMAIL-BRAND-1) + the established
//     sendNotification send→log path. No detection/threshold/clock-out/normal-cron behavior changes.
//   • No Vercel schedule — manual, Owner-invoked only.
//
// MODES (CRON_SECRET required for all via the 401 gate):
//   • default / anything else                      → DRY-RUN: detect + resolve + checks. No send/log.
//   • ?mode=preview                                → PREVIEW: dry-run PLUS exact subject/body/recipient.
//   • ?mode=live&confirm=clockout_school_correction → LIVE: send to school_email + write audited rows.

import { createClient } from '@supabase/supabase-js';
import {
  isClockoutMaybeOverdue, openShiftMs, formatDuration, shiftTypeOf, shiftBadge,
} from '../../src/lib/shiftStatus.js';
import { sendNotification } from '../../src/lib/notifications/index.js';
import { CLOCKOUT_REMINDER_SUBJECT, clockoutReminderText } from '../../src/lib/notifications/templates/clockoutReminder.js';
import { startCronRun, finishCronRunSuccess, finishCronRunError } from '../lib/cronRuns.js';
import { getStudentPreferredGreetingName } from '../../src/lib/studentNameFormatters.js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// The ONLY shifts this endpoint may ever touch. No request input can add to or change this set.
const APPROVED_SHIFT_LOG_IDS = Object.freeze([
  'c1e62c3a-1c11-4932-924b-971003b9beb4', // Kimberly (Kim) Romero — West Coast University North Hollywood
  '78c9fd5b-ac3b-4605-a455-cbfe5ff6b335', // Michael Angelo Gonzales — Cal State LA
]);

const CONFIRM_TOKEN     = 'clockout_school_correction';
const CORRECTION_TAG    = 'school_email_resend';
const CORRECTION_REASON = 'prior reminder was sent before school-email routing correction';

// Safe, hedged row summary for the CRON_SECRET-gated review response. No tokens/links.
function rowSummary(log, stu, nowMs) {
  return {
    shiftLogId:   log.id,
    studentId:    log.student_id,
    studentName:  stu ? (`${stu.first_name || ''} ${stu.last_name || ''}`.trim() || null) : null,
    school:       stu?.school || null,
    shift:        shiftBadge(shiftTypeOf(log)).label,
    checkedInAt:  log.checked_in_at,
    openDuration: formatDuration(openShiftMs(log, nowMs)),
  };
}

export default async function handler(req, res) {
  if (req.headers['authorization'] !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const isLive    = req.query.mode === 'live' && req.query.confirm === CONFIRM_TOKEN;
  const isPreview = req.query.mode === 'preview';
  const mode      = isLive ? 'live' : (isPreview ? 'preview' : 'dry-run');

  const now = new Date();
  const nowMs = now.getTime();
  console.log(`[clockout-reminders-resend] ${mode.toUpperCase()} at ${now.toISOString()} — scoped to ${APPROVED_SHIFT_LOG_IDS.length} approved shift(s)`);
  const runId = await startCronRun(supabase, 'clockout-reminders-resend');

  try {
    // ── 1. Load ONLY the approved shift logs (hardcoded allowlist; no request input). ──
    const { data: logs, error: logsErr } = await supabase
      .from('student_shift_logs')
      .select('id, student_id, cohort_id, checked_in_at, lifecycle_state, planned_shift_type, shift_type')
      .in('id', APPROVED_SHIFT_LOG_IDS);

    if (logsErr) {
      console.error('[clockout-reminders-resend] shift-log query error:', logsErr);
      await finishCronRunError(supabase, runId, logsErr.message);
      return res.status(500).json({ error: logsErr.message });
    }
    const logById = Object.fromEntries((logs || []).map(l => [l.id, l]));

    // ── 2. Resolve students for the found logs. ──
    const studentIds = [...new Set((logs || []).map(l => l.student_id).filter(Boolean))];
    let studentMap = {};
    if (studentIds.length) {
      const { data: students, error: stuErr } = await supabase
        .from('students')
        .select('id, first_name, last_name, preferred_first_name, school, school_email')
        .in('id', studentIds);
      if (stuErr) {
        console.error('[clockout-reminders-resend] students query error:', stuErr);
        await finishCronRunError(supabase, runId, stuErr.message);
        return res.status(500).json({ error: stuErr.message });
      }
      studentMap = Object.fromEntries((students || []).map(s => [s.id, s]));
    }

    // ── 3. Classify each APPROVED id; runtime still-open + still-overdue + school_email checks. ──
    const eligible = [];   // ready to (or did) send
    const skipped  = [];   // not_found | shift_closed | not_overdue | no_school_email

    for (const id of APPROVED_SHIFT_LOG_IDS) {
      const log = logById[id] || null;
      if (!log) { skipped.push({ shiftLogId: id, reason: 'not_found' }); continue; }

      if (log.lifecycle_state !== 'in_progress') {
        skipped.push({ ...rowSummary(log, studentMap[log.student_id] || null, nowMs), reason: 'shift_closed' });
        continue;
      }
      if (!isClockoutMaybeOverdue(log, nowMs)) {
        skipped.push({ ...rowSummary(log, studentMap[log.student_id] || null, nowMs), reason: 'not_overdue' });
        continue;
      }

      const stu = studentMap[log.student_id] || null;
      const schoolEmail = (stu?.school_email || '').trim();
      if (!schoolEmail) {
        // STOP for this shift — no personal-email fallback for the correction.
        skipped.push({ ...rowSummary(log, stu, nowMs), reason: 'no_school_email' });
        continue;
      }

      const firstName = getStudentPreferredGreetingName(stu);
      const row = {
        ...rowSummary(log, stu, nowMs),
        recipient:     schoolEmail,
        recipientType: 'school_email',
        firstName,
        cohortId:      log.cohort_id,
      };
      if (isPreview || isLive) {
        row.email_preview = {
          subject:       CLOCKOUT_REMINDER_SUBJECT,
          body:          clockoutReminderText(firstName),
          recipient:     schoolEmail,
          recipientType: 'school_email',
        };
      }
      eligible.push(row);
    }

    // ── 4. LIVE send (school_email only) — audited clockout_reminder row per send. ──
    let sentCount = 0;
    let failedCount = 0;
    if (isLive) {
      for (const row of eligible) {
        try {
          const results = await sendNotification('clockout_reminder', {
            studentId:     row.studentId,
            cohortId:      row.cohortId,
            firstName:     row.firstName,
            studentEmail:  row.recipient,      // school_email (resolver uses this as the recipient)
            shiftLogId:    row.shiftLogId,
            // Audit metadata (lands in notification_log.metadata.context via sanitizeContext):
            correction:    CORRECTION_TAG,
            reason:        CORRECTION_REASON,
            recipientType: 'school_email',
            ownerConfirmed: true,
          });
          const ok = Array.isArray(results) && results.some(r => r.success);
          if (ok) { sentCount++; row.sendStatus = 'sent'; }
          else    { failedCount++; row.sendStatus = 'failed'; console.error(`[clockout-reminders-resend] send reported no success for shift ${row.shiftLogId}`); }
        } catch (err) {
          failedCount++;
          row.sendStatus = 'failed';
          console.error(`[clockout-reminders-resend] send failed for shift ${row.shiftLogId}:`, err.message);
        }
      }
    }

    // ── 5. cron_runs heartbeat — COUNTS ONLY (no names/emails/links). ──
    const counts = {
      dry_run: !isLive,
      approved_targets: APPROVED_SHIFT_LOG_IDS.length,
      eligible_count: eligible.length,
      sent_count: sentCount,
      failed_count: failedCount,
      skipped_shift_closed_count:    skipped.filter(s => s.reason === 'shift_closed').length,
      skipped_not_overdue_count:     skipped.filter(s => s.reason === 'not_overdue').length,
      skipped_not_found_count:       skipped.filter(s => s.reason === 'not_found').length,
      skipped_no_school_email_count: skipped.filter(s => s.reason === 'no_school_email').length,
      error_count: 0,
    };
    await finishCronRunSuccess(supabase, runId, counts);

    // ── 6. Report (CRON_SECRET-gated; row detail returned for Owner review, NOT persisted to cron_runs). ──
    return res.status(200).json({
      mode,
      dryRun: !isLive,
      live: isLive,
      sent: sentCount,
      failed: failedCount,
      scope: 'school-email correction resend — approved shiftLogIds only; school_email only; no personal fallback; no dedup bypass for the normal cron',
      note: isLive
        ? 'LIVE: corrected reminders sent to school_email; audited clockout_reminder rows written via sendNotification.'
        : (isPreview
          ? 'PREVIEW: detection + still-open/still-overdue + school_email resolution + exact subject/body. No email sent; no notification_log written.'
          : 'DRY-RUN: detection + still-open/still-overdue + school_email resolution. No email sent; no notification_log written.'),
      approvedShiftLogIds: APPROVED_SHIFT_LOG_IDS,
      confirmRequired: `mode=live&confirm=${CONFIRM_TOKEN}`,
      counts,
      eligible,
      skipped,
    });
  } catch (err) {
    console.error('[clockout-reminders-resend] unexpected error:', err);
    await finishCronRunError(supabase, runId, err.message);
    return res.status(500).json({ error: err.message });
  }
}
