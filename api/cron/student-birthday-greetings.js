// api/cron/student-birthday-greetings.js
//
// STUDENT-BIRTHDAY-GREETING-1 - one birthday note per student per calendar year,
// sent at 9:00 AM Pacific on their birthday while they are on rotation.
//
// ACROSS ALL COHORTS. Unlike midpoint-checkin (which scopes to cohorts with the
// automation enabled), this one deliberately applies no cohort filter: a student
// on rotation has a birthday regardless of which cohort the Owner happens to
// have selected in the UI.
//
// WHY THE SCHEDULE IS THREE HOURS, NOT ONE
// Vercel cron expressions are UTC only, so a single fixed hour drifts across
// DST - which is why "Daily 10:00 AM PT" in the Automations catalog is really
// 17:00 UTC and silently becomes 9:00 AM every winter. Rather than inherit that
// drift for a dated, once-a-year email, this runs at 16:00, 17:00 and 18:00 UTC
// and gates on the LOCAL Pacific hour (>= 9). In PDT the 16:00 run is 9:00 AM
// and sends; in PST it is 8:00 AM and is skipped, and the 17:00 run (9:00 AM
// PST) sends. The later runs exist so a failed send is retried the SAME Pacific
// day; per-year idempotency makes the extra runs no-ops.
//
// IDEMPOTENCY uses the existing notification_log, with no new table: a student
// is skipped when a birthday_greeting row already exists for them with a
// non-retryable status in the current calendar year. This mirrors
// midpoint-checkin's treatment of webhook-advanced statuses exactly.
//
// PRIVACY. date_of_birth is read for the month/day comparison and never leaves
// this handler: it is not passed into the notification context, not written to
// notification_log metadata, and not returned in the response or the run
// summary. Students are identified in logs by id, the same identifier the other
// crons use.

import { createClient } from '@supabase/supabase-js';
import { startCronRun, finishCronRunSuccess, finishCronRunError } from '../lib/cronRuns.js';
import { isAutomationEnabled } from '../lib/automationSettings.js';
import { sendNotification } from '../../src/lib/notifications/index.js';
import {
  selectBirthdayRecipients, withinSendWindow, pacificDateString, pacificHour,
  ACTIVE_ROTATION_STATUS, ALREADY_SENT_STATUSES, parseYmd,
} from '../../src/lib/birthdayEligibility.js';

export const AUTOMATION_KEY = 'student_birthday_greetings';
export const CRON_NAME = 'student-birthday-greetings';
export const NOTIFICATION_TYPE = 'birthday_greeting';

export default async function handler(req, res) {
  if (req.headers['authorization'] !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const supabase = createClient(
    process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  );

  const now = new Date();
  const todayPacific = pacificDateString(now);
  const runId = await startCronRun(supabase, CRON_NAME);
  console.log(`[birthday-greetings] run at ${now.toISOString()} (Pacific ${todayPacific} hour ${pacificHour(now)})`);

  try {
    const gate = await isAutomationEnabled({ supabaseAdmin: supabase, automationKey: AUTOMATION_KEY });
    if (!gate.enabled) {
      console.log('[birthday-greetings] automation disabled; nothing sent');
      await finishCronRunSuccess(supabase, runId, { skipped: true, reason: 'automation_disabled' });
      return res.status(200).json({ skipped: true, reason: 'automation_disabled' });
    }

    // The local-time gate. Runs before the send window are healthy no-ops, not
    // failures: they exist only so one of the day's runs lands on 9:00 AM
    // Pacific in both PST and PDT.
    if (!withinSendWindow(now)) {
      console.log(`[birthday-greetings] before the 9:00 AM Pacific send window (hour ${pacificHour(now)}); no-op`);
      await finishCronRunSuccess(supabase, runId, {
        skipped: true, reason: 'before_send_window', target_date: todayPacific,
      });
      return res.status(200).json({ skipped: true, reason: 'before_send_window', targetDate: todayPacific });
    }

    // EVERY cohort. date_of_birth is selected for the month/day match only.
    const { data: students, error: studentsErr } = await supabase
      .from('students')
      .select('id, first_name, last_name, school_email, personal_email, cohort_id, status, date_of_birth')
      .eq('status', ACTIVE_ROTATION_STATUS);

    if (studentsErr) {
      console.error('[birthday-greetings] students query error:', studentsErr);
      await finishCronRunError(supabase, runId, studentsErr.message);
      return res.status(500).json({ error: studentsErr.message });
    }

    // Greetings already sent this calendar year, for idempotency.
    const yearStart = `${parseYmd(todayPacific).y}-01-01T00:00:00.000Z`;
    const { data: greetedLog, error: logErr } = await supabase
      .from('notification_log')
      .select('student_id, status, sent_at')
      .eq('notification_type', NOTIFICATION_TYPE)
      .in('status', ALREADY_SENT_STATUSES)
      .gte('sent_at', yearStart);

    if (logErr) {
      // Fail CLOSED: without the ledger we cannot tell a first send from a
      // duplicate, and a duplicate birthday email is worse than a late one.
      console.error('[birthday-greetings] notification_log query error:', logErr);
      await finishCronRunError(supabase, runId, logErr.message);
      return res.status(500).json({ error: logErr.message });
    }

    const { eligible, skipped } = selectBirthdayRecipients({
      students: students || [], greetedLog: greetedLog || [], now,
    });

    const sent = [];
    const failed = [];
    for (const student of eligible) {
      try {
        await sendNotification(NOTIFICATION_TYPE, {
          studentId:    student.id,
          cohortId:     student.cohort_id,
          firstName:    student.first_name || 'there',
          studentEmail: student.resolvedEmail,
        });
        sent.push(student.id);
        console.log(`[birthday-greetings] sent to student ${student.id}`);
      } catch (err) {
        failed.push({ id: student.id, error: err.message });
        console.error(`[birthday-greetings] send failed for student ${student.id}:`, err.message);
      }
    }

    const countBy = (reason) => skipped.filter(s => s.reason === reason).length;
    const summary = {
      target_date:            todayPacific,
      evaluated_count:        (students || []).length,
      eligible_count:         eligible.length,
      sent_count:             sent.length,
      already_sent_count:     countBy('already_sent_this_year'),
      no_email_count:         countBy('no_email'),
      not_birthday_count:     countBy('not_birthday'),
      failed_count:           failed.length,
    };
    console.log(`[birthday-greetings] SUMMARY: ${JSON.stringify(summary)}`);

    await finishCronRunSuccess(supabase, runId, summary);
    return res.status(200).json({ success: true, ...summary });
  } catch (err) {
    console.error('[birthday-greetings] unexpected error:', err);
    await finishCronRunError(supabase, runId, err.message);
    return res.status(500).json({ error: 'internal_error' });
  }
}
