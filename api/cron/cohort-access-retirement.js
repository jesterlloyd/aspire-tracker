/* global process */
// api/cron/cohort-access-retirement.js
//
// COHORT-ACCESS-RETIREMENT-1 - when a cohort is marked Completed, tell Nursing
// Academics which students' Hybrid Student Nurse CS-Link accesses are ready to
// be retired.
//
// TIMING. The notice goes out on the FIRST BUSINESS DAY STRICTLY AFTER the day
// the cohort was flipped to Completed (cohorts.completed_at, trigger-stamped),
// at 9:00 AM Pacific. Business day = not a weekend, not a US federal holiday
// (observed). Like student-birthday-greetings, the schedule runs 16/17/18 UTC
// and gates on the local Pacific hour so DST never shifts the send time; a
// cohort whose due day passed unsent (outage, holiday math, failed send) is
// caught on every later day because dueness is "today >= due date".
//
// IDEMPOTENCY. One send per completion, via notification_log with no new
// table: a cohort is skipped when a sent-ish cohort_access_retirement row
// exists with sent_at >= completed_at. Reverting a cohort out of Completed
// clears completed_at (trigger); re-completing restamps it AFTER the old
// send, so a genuine re-completion notifies again.
//
// RECIPIENT. Resolved at send time from the ACTIVE BNI Team contact record
// (never a hardcoded address, so a contact-record email correction takes
// effect immediately), cc to the ASPIRE program lead. An unresolvable
// recipient FAILS the run - automation monitoring must surface it - rather
// than silently skipping forever.
//
// PRIVACY. The email lists student name, school, and ASPIRE status only - no
// student emails, no phone numbers, no identifiers.

import { createClient } from '@supabase/supabase-js';
import { startCronRun, finishCronRunSuccess, finishCronRunError } from '../lib/cronRuns.js';
import { isAutomationEnabled } from '../lib/automationSettings.js';
import { sendNotification } from '../../src/lib/notifications/index.js';
import { withinSendWindow, pacificDateString, pacificHour, ALREADY_SENT_STATUSES } from '../../src/lib/birthdayEligibility.js';
import { selectDueCohorts, selectRetirementStudents } from '../../src/lib/accessRetirement.js';
import { isValidEmail } from '../../src/lib/notifications/studentRecipient.js';
import { isAuthorizedCronRequest } from '../lib/cronAuth.js';

export const AUTOMATION_KEY = 'cohort_access_retirement';
export const CRON_NAME = 'cohort-access-retirement';
export const NOTIFICATION_TYPE = 'cohort_access_retirement';

// The contact-record identity the notice goes to, and the standing cc.
const RECIPIENT_CONTACT_MATCH = 'Arturo';
const RECIPIENT_CONTACT_CATEGORY = 'BNI Team';
const CC_EMAILS = [{ name: 'Jester Lloyd Bautista', email: 'JesterLloyd.Bautista@cshs.org' }];

// Resolve the recipient from the active BNI Team contact record. Exactly one
// active match with a usable email is required; anything else is an error the
// run surfaces (never a silent skip).
export async function resolveRecipientContact(supabase) {
  const { data, error } = await supabase
    .from('contacts')
    .select('id, full_name, preferred_name, email, category, is_active')
    .eq('category', RECIPIENT_CONTACT_CATEGORY)
    .ilike('full_name', `%${RECIPIENT_CONTACT_MATCH}%`);
  if (error) return { error: `contact lookup failed: ${error.message}` };
  const matches = (data || []).filter(c => c.is_active !== false);
  if (matches.length === 0) return { error: `no active ${RECIPIENT_CONTACT_CATEGORY} contact matching "${RECIPIENT_CONTACT_MATCH}"` };
  if (matches.length > 1) return { error: `ambiguous recipient: ${matches.length} active contacts match "${RECIPIENT_CONTACT_MATCH}"` };
  const contact = matches[0];
  if (!isValidEmail(contact.email)) return { error: `recipient contact ${contact.id} has no usable email` };
  return { contact };
}

export default async function handler(req, res) {
  if (!isAuthorizedCronRequest(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const supabase = createClient(
    process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  );

  const now = new Date();
  const todayPacific = pacificDateString(now);
  const runId = await startCronRun(supabase, CRON_NAME);
  console.log(`[access-retirement] run at ${now.toISOString()} (Pacific ${todayPacific} hour ${pacificHour(now)})`);

  try {
    const gate = await isAutomationEnabled({ supabaseAdmin: supabase, automationKey: AUTOMATION_KEY });
    if (!gate.enabled) {
      console.log('[access-retirement] automation disabled; nothing sent');
      await finishCronRunSuccess(supabase, runId, { skipped: true, reason: 'automation_disabled' });
      return res.status(200).json({ skipped: true, reason: 'automation_disabled' });
    }

    // The local-time gate: earlier UTC runs are healthy no-ops (see birthday cron).
    if (!withinSendWindow(now)) {
      console.log(`[access-retirement] before the 9:00 AM Pacific send window (hour ${pacificHour(now)}); no-op`);
      await finishCronRunSuccess(supabase, runId, { skipped: true, reason: 'before_send_window', target_date: todayPacific });
      return res.status(200).json({ skipped: true, reason: 'before_send_window', targetDate: todayPacific });
    }

    // Schema readiness: until the 20260827 migration lands, cohorts has no
    // completed_at; the cron is a healthy no-op rather than an error, so this
    // code can deploy before the SQL (the house deploy-before-SQL order).
    const { data: cohorts, error: cohortsErr } = await supabase
      .from('cohorts')
      .select('id, name, status, completed_at');
    if (cohortsErr) {
      const notReady = /completed_at/.test(cohortsErr.message || '');
      if (notReady) {
        console.log('[access-retirement] cohorts.completed_at not present yet; no-op until the migration is applied');
        await finishCronRunSuccess(supabase, runId, { skipped: true, reason: 'schema_not_ready' });
        return res.status(200).json({ skipped: true, reason: 'schema_not_ready' });
      }
      console.error('[access-retirement] cohorts query error:', cohortsErr);
      await finishCronRunError(supabase, runId, cohortsErr.message);
      return res.status(500).json({ error: cohortsErr.message });
    }

    // The sent ledger for this type. Fail CLOSED on a ledger error: without it
    // a duplicate notice is possible, and a duplicate is worse than a late one.
    const { data: ledger, error: ledgerErr } = await supabase
      .from('notification_log')
      .select('cohort_id, status, sent_at')
      .eq('notification_type', NOTIFICATION_TYPE)
      .in('status', ALREADY_SENT_STATUSES);
    if (ledgerErr) {
      console.error('[access-retirement] notification_log query error:', ledgerErr);
      await finishCronRunError(supabase, runId, ledgerErr.message);
      return res.status(500).json({ error: ledgerErr.message });
    }

    const { due, skipped } = selectDueCohorts({ cohorts: cohorts || [], todayPacific, ledger: ledger || [] });

    if (due.length === 0) {
      const summary = { target_date: todayPacific, due_count: 0, sent_count: 0, skipped_count: skipped.length };
      console.log(`[access-retirement] SUMMARY: ${JSON.stringify(summary)}`);
      await finishCronRunSuccess(supabase, runId, summary);
      return res.status(200).json({ success: true, ...summary });
    }

    // A due cohort with no reachable recipient is a FAILURE, not a skip.
    const { contact, error: recipientErr } = await resolveRecipientContact(supabase);
    if (recipientErr) {
      console.error(`[access-retirement] ${recipientErr}`);
      await finishCronRunError(supabase, runId, recipientErr);
      return res.status(500).json({ error: recipientErr });
    }

    const sent = [];
    const failed = [];
    for (const cohort of due) {
      try {
        const { data: students, error: studentsErr } = await supabase
          .from('students')
          .select('id, first_name, last_name, school, status, cs_cedars_status, cs_stage1_submitted, cs_stage1_complete, cs_link_requested, cs_link_complete')
          .eq('cohort_id', cohort.id);
        if (studentsErr) throw new Error(`students query failed: ${studentsErr.message}`);

        const list = selectRetirementStudents(students || []);
        await sendNotification(NOTIFICATION_TYPE, {
          cohortId:      cohort.id,
          cohortName:    cohort.name,
          completedAt:   cohort.completed_at,
          students:      list.map(({ name, school, status }) => ({ name, school, status })),
          recipientEmail: contact.email,
          recipientName:  contact.preferred_name || contact.full_name,
          ccEmails:       CC_EMAILS,
        });
        sent.push({ cohort_id: cohort.id, students: list.length });
        console.log(`[access-retirement] sent for cohort ${cohort.id} (${list.length} students)`);
      } catch (err) {
        failed.push({ cohort_id: cohort.id, error: err.message });
        console.error(`[access-retirement] send failed for cohort ${cohort.id}:`, err.message);
      }
    }

    const summary = {
      target_date:   todayPacific,
      due_count:     due.length,
      sent_count:    sent.length,
      listed_students: sent.reduce((n, s) => n + s.students, 0),
      failed_count:  failed.length,
      skipped_count: skipped.length,
    };
    console.log(`[access-retirement] SUMMARY: ${JSON.stringify(summary)}`);

    if (failed.length > 0) {
      await finishCronRunError(supabase, runId, `send failed for ${failed.length} cohort(s)`);
      return res.status(500).json({ error: 'partial_failure', ...summary });
    }
    await finishCronRunSuccess(supabase, runId, summary);
    return res.status(200).json({ success: true, ...summary });
  } catch (err) {
    console.error('[access-retirement] unexpected error:', err);
    await finishCronRunError(supabase, runId, err.message);
    return res.status(500).json({ error: 'internal_error' });
  }
}
