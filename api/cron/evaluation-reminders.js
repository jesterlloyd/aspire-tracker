/* global process */
// api/cron/evaluation-reminders.js
//
// EVALUATION-REMINDERS-1 - weekly reminders for incomplete evaluations and surveys.
//
// Reminders go out at 7, 14 and 21 days after the original successful send, and
// stop the moment the assignment is completed. Coverage is by INSTRUMENT
// CLASSIFICATION, not one cron per survey: Casey-Fink, the ASPIRE Post-Rotation
// Evaluation, the student's preceptor/unit feedback, and the preceptor progress
// assessment all flow through this one job, and an instrument that is not in the
// registry is never reminded.
//
// DEFAULT OFF, FAIL CLOSED. Every other automation in this codebase is default-on
// and fails OPEN, because suppressing an existing live reminder is the worse
// outcome there. This one is the opposite: it mints tokens and emails people, so
// a missing settings row or an unreadable settings table must mean "send
// nothing". That is achieved by passing defaultEnabled:false to the shared gate,
// which then returns disabled for a missing row, a read error, and an exception
// alike - no change to the shared helper's behavior for any other cron.
//
// DRY RUN: ?dryRun=1 (CRON_SECRET still required). Read-only, and provably so -
// it returns before the claim call, so it cannot mint a token, send an email, or
// write a single ledger row. It reports the same counts and sanitized reasons a
// live run would, which is what makes it useful before switching the toggle on.
//
// SEND CAP: a deliberately conservative per-run ceiling. If more reminders are
// due than the cap allows, the overflow is REPORTED (capped_count), never
// silently dropped - the next run picks it up because nothing was claimed.

import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import { startCronRun, finishCronRunSuccess, finishCronRunError } from '../lib/cronRuns.js';
import { isAutomationEnabled } from '../lib/automationSettings.js';
import { emailBaseUrl } from '../../lib/server/appUrl.js';
import {
  LIVE_STATUSES, RESPONSE_WINDOW_DAYS, REMINDER_DAY_OFFSETS,
  selectReminderCandidates, tallyReasons, SKIP_REASONS,
} from '../../src/lib/evaluation/reminderSchedule.js';
import { resolveReminderRecipient, RECIPIENT_REASONS } from '../../lib/server/evaluation/reminderRecipient.js';
import { sendClaimedReminders } from '../../lib/server/evaluation/reminderSend.js';

export const AUTOMATION_KEY = 'evaluation_reminders';

// TWO MONITORING IDENTITIES, deliberately. The Automations card watches the
// WEEKLY name, so an hourly sweep succeeding can never make a missed weekly run
// look healthy, and sweep runs (which send almost nothing) cannot dilute the
// weekly send metrics. Recovery is internal: it is not in AUTOMATION_CATALOG, so
// it does not appear as its own card.
export const CRON_NAME = 'evaluation-reminders';
export const RECOVERY_CRON_NAME = 'evaluation-reminders-recovery';

/** Conservative per-run ceiling. Overflow is reported and retried next run. */
export const MAX_SENDS_PER_RUN = 40;

/** Upper bound on assignments examined per run, so the query cannot run away. */
export const MAX_ASSIGNMENTS_SCANNED = 500;

/** How long a claim may sit before another worker may recover it. */
export const CLAIM_STALE_SECONDS = 900;

/** The recipient-resolution reasons that mean "we had no address we were allowed to use". */
const MISSING_EMAIL_REASONS = new Set([
  RECIPIENT_REASONS.MISSING_VERIFIED_CEDARS_EMAIL,
  RECIPIENT_REASONS.MISSING_SCHOOL_EMAIL,
  RECIPIENT_REASONS.MISSING_PERSONAL_EMAIL,
  RECIPIENT_REASONS.MISSING_PRECEPTOR_SNAPSHOT_EMAIL,
]);

const sumBy = (tally, keys) => keys.reduce((n, k) => n + (tally[k] || 0), 0);

/** Load the assignments that could plausibly be due, plus their instruments and students. */
async function loadContext(db, now) {
  const oldest = new Date(now.getTime() - RESPONSE_WINDOW_DAYS * 86400000).toISOString();
  const newest = new Date(now.getTime() - REMINDER_DAY_OFFSETS[0] * 86400000).toISOString();

  const { data: assignments, error } = await db
    .from('evaluation_assignments')
    .select('id, instrument_id, student_id, cohort_id, timepoint, sent_at, expires_at, completed_at, revoked_at, status, respondent_type, respondent_email, respondent_name')
    .in('status', LIVE_STATUSES)
    .is('completed_at', null)
    .is('revoked_at', null)
    .gte('sent_at', oldest)
    .lte('sent_at', newest)
    .gt('expires_at', now.toISOString())
    .order('sent_at', { ascending: true })
    .limit(MAX_ASSIGNMENTS_SCANNED);
  if (error) throw new Error(`assignments query failed: ${error.message}`);

  const rows = assignments || [];
  const instrumentsById = new Map();
  const studentsById = new Map();

  const instrumentIds = [...new Set(rows.map((r) => r.instrument_id).filter(Boolean))];
  if (instrumentIds.length) {
    const { data: instruments, error: iErr } = await db
      .from('evaluation_instruments')
      .select('id, slug, permission_status')
      .in('id', instrumentIds);
    if (iErr) throw new Error(`instruments query failed: ${iErr.message}`);
    for (const i of instruments || []) instrumentsById.set(i.id, i);
  }

  const studentIds = [...new Set(rows.filter((r) => r.respondent_type === 'student').map((r) => r.student_id).filter(Boolean))];
  if (studentIds.length) {
    const { data: students, error: sErr } = await db
      .from('students')
      .select('id, first_name, last_name, school_email, personal_email, status, ngrp_outcome')
      .in('id', studentIds);
    if (sErr) throw new Error(`students query failed: ${sErr.message}`);
    for (const s of students || []) studentsById.set(s.id, s);
  }

  return { assignments: rows, instrumentsById, studentsById };
}

/**
 * The shared run. `sweep` is passed by the caller rather than read from the
 * query string: Vercel invokes cron paths with a plain production GET, and a
 * cron entry whose behaviour depended on a query parameter would silently
 * become a full weekly send if that parameter were ever dropped. The recovery
 * sweep therefore has its OWN endpoint file, and this flag is an argument.
 */
export async function runEvaluationReminders(req, res, { sweep = false } = {}) {
  if (req.headers['authorization'] !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const isDryRun = req.query?.dryRun === '1' || req.query?.dry_run === '1';
  // RECOVERY SWEEP (hourly). Reconciles only attempts that already reached the
  // provider - it selects no new recipients, so reminders stay on the weekly
  // 7/14/21 cadence while ambiguous sends are resolved inside the provider's
  // 24-hour idempotency window.
  const isSweep = sweep === true;
  const supabase = createClient(
    process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  const now = new Date();
  const cronName = isSweep ? RECOVERY_CRON_NAME : CRON_NAME;
  // THE HEARTBEAT IS A WRITE. A dry run is required to mutate nothing at all, and
  // cron_runs is not an exception - so the run row is created only for a live
  // run. Every finish helper no-ops on a null runId, so the dry-run path simply
  // records nothing. Its counts are returned in the response instead.
  const runId = isDryRun ? null : await startCronRun(supabase, cronName);
  console.log(`[${cronName}] run at ${now.toISOString()} mode=${isDryRun ? 'dry_run' : 'live'}`);

  try {
    // ── Gate: default OFF, fail CLOSED. ──
    // A dry run is an operator asking "what would happen", so it is allowed to
    // report while paused - it cannot send. A LIVE run stops here.
    const gate = await isAutomationEnabled({
      supabaseAdmin: supabase, automationKey: AUTOMATION_KEY, defaultEnabled: false,
    });
    if (!gate.enabled && !isDryRun) {
      const reason = gate.warning ? 'automation_settings_unreadable' : 'automation_disabled';
      console.log(`[evaluation-reminders] ${reason}; nothing sent`);
      await finishCronRunSuccess(supabase, runId, { skipped: true, reason, sent_count: 0 });
      return res.status(200).json({ skipped: true, reason, sent_count: 0 });
    }

    const { assignments, instrumentsById, studentsById } = await loadContext(supabase, now);
    const scanTruncated = assignments.length >= MAX_ASSIGNMENTS_SCANNED;
    if (scanTruncated) {
      console.warn(`[evaluation-reminders] scan hit the ${MAX_ASSIGNMENTS_SCANNED}-assignment ceiling; remainder deferred to the next run`);
    }

    const { candidates, skipped } = selectReminderCandidates({ assignments, instrumentsById, now });
    const skipTally = tallyReasons(skipped);

    // Recipient resolution is read-only, so BOTH modes do it: the dry run needs
    // it to report missing_verified_cedars_email honestly, and a live run needs
    // to know before it claims.
    const assignmentsById = new Map(assignments.map((a) => [a.id, a]));
    const recipientTally = {};
    const sendable = [];
    for (const c of candidates) {
      const a = assignmentsById.get(c.assignment_id);
      const r = await resolveReminderRecipient({
        db: supabase,
        authAdmin: supabase.auth?.admin,
        assignment: a,
        student: studentsById.get(a.student_id) || null,
      });
      if (r.ok) sendable.push(c);
      else recipientTally[r.reason] = (recipientTally[r.reason] || 0) + 1;
    }

    const missingEmailCount = sumBy(recipientTally, [...MISSING_EMAIL_REASONS]);
    const baseSummary = {
      dry_run: isDryRun,
      automation_enabled: gate.enabled,
      scanned_count: assignments.length,
      scan_truncated: scanTruncated,
      eligible_count: candidates.length,
      deliverable_count: sendable.length,
      completed_suppressed_count: skipTally[SKIP_REASONS.COMPLETED] || 0,
      expired_suppressed_count: skipTally[SKIP_REASONS.WINDOW_CLOSED] || 0,
      missing_email_count: missingEmailCount,
      skip_reasons: skipTally,
      recipient_reasons: recipientTally,
    };

    // ── DRY RUN ends here: before the claim, so no token, no email, no row. ──
    if (isDryRun) {
      const summary = {
        ...baseSummary,
        would_send_count: Math.min(sendable.length, MAX_SENDS_PER_RUN),
        capped_count: Math.max(0, sendable.length - MAX_SENDS_PER_RUN),
        claimed_count: 0, sent_count: 0, failed_count: 0, duplicate_suppressed_count: 0,
      };
      // No finishCronRunSuccess call: there is no run row, by design.
      console.log(`[evaluation-reminders] DRY RUN SUMMARY: ${JSON.stringify(summary)}`);
      return res.status(200).json({ success: true, ...summary });
    }

    // ── LIVE: claim atomically, then send only what we own. ──
    // A sweep offers no candidates at all: it reconciles only work that already
    // reached the provider, which is what keeps recipient cadence at 7/14/21
    // while ambiguous attempts are resolved hourly.
    const offered = isSweep ? [] : sendable.slice(0, MAX_SENDS_PER_RUN);
    const cappedCount = isSweep ? 0 : Math.max(0, sendable.length - offered.length);
    let claimed = [];
    if (isSweep || offered.length > 0) {
      const { data, error } = await supabase.rpc('claim_evaluation_reminders', {
        p_worker: `${cronName}:${runId || 'unknown'}`,
        p_candidates: offered.map((c) => ({
          assignment_id: c.assignment_id, reminder_number: c.reminder_number,
        })),
        p_limit: MAX_SENDS_PER_RUN,
        p_stale_seconds: CLAIM_STALE_SECONDS,
        p_recover_only: isSweep,
      });
      if (error) throw new Error(`claim failed: ${error.message}`);
      claimed = data || [];
    }

    // Offered minus claimed is precisely the set another run already handled:
    // a sent or suppressed ledger row is terminal and can never be claimed again.
    // A SWEEP OFFERS NOTHING and claims prior work, so that subtraction would go
    // negative and would mean nothing anyway - duplicate suppression is a
    // statement about candidates, and a sweep has none.
    const duplicateSuppressed = isSweep ? 0 : Math.max(0, offered.length - claimed.length);

    // A recovered row's assignment may sit outside the due-window scan (it was
    // claimed days ago, or has since completed), so hydrate anything missing.
    // Without this a sweep would see assignment=null and wrongly suppress work
    // that is already delivered and merely needs tidying.
    const missingIds = [...new Set(claimed.map((c) => c.assignment_id))]
      .filter((id) => !assignmentsById.has(id));
    // EVERY hydration read is error-checked and FAILS THE RUN. A transient read
    // error must never be mistaken for "this assignment no longer exists": that
    // would drive the row to a terminal suppressed/assignment_missing state and
    // permanently cancel a reminder because of a momentary database blip.
    // Throwing leaves the claimed rows exactly as they are, so stale recovery
    // hands them back and the next run finishes the job.
    if (missingIds.length > 0) {
      const { data: extra, error: aErr } = await supabase
        .from('evaluation_assignments')
        .select('id, instrument_id, student_id, cohort_id, timepoint, sent_at, expires_at, completed_at, revoked_at, status, respondent_type, respondent_email, respondent_name')
        .in('id', missingIds);
      if (aErr) throw new Error(`recovery assignment hydration failed: ${aErr.message}`);
      for (const a of extra || []) assignmentsById.set(a.id, a);

      const needInstruments = [...new Set((extra || []).map((a) => a.instrument_id))]
        .filter((id) => id && !instrumentsById.has(id));
      if (needInstruments.length > 0) {
        const { data: inst, error: iErr } = await supabase
          .from('evaluation_instruments').select('id, slug, permission_status').in('id', needInstruments);
        if (iErr) throw new Error(`recovery instrument hydration failed: ${iErr.message}`);
        for (const i of inst || []) instrumentsById.set(i.id, i);
      }
      const needStudents = [...new Set((extra || []).filter((a) => a.respondent_type === 'student').map((a) => a.student_id))]
        .filter((id) => id && !studentsById.has(id));
      if (needStudents.length > 0) {
        const { data: st, error: sErr } = await supabase
          .from('students')
          .select('id, first_name, last_name, school_email, personal_email, status, ngrp_outcome')
          .in('id', needStudents);
        if (sErr) throw new Error(`recovery student hydration failed: ${sErr.message}`);
        for (const s of st || []) studentsById.set(s.id, s);
      }
    }

    const resend = new Resend(process.env.RESEND_API_KEY);
    const { counts, reasons } = await sendClaimedReminders({
      db: supabase,
      resend,
      authAdmin: supabase.auth?.admin,
      claimed,
      assignmentsById,
      instrumentsById,
      studentsById,
      baseUrl: emailBaseUrl(req),
      now,
    });

    const summary = {
      ...baseSummary,
      mode: isSweep ? 'recovery_sweep' : 'reminders',
      claimed_count: claimed.length,
      ambiguous_count: counts.ambiguous,
      needs_reconciliation_count: counts.needs_reconciliation,
      deferred_count: counts.deferred,
      capped_count: cappedCount,
      duplicate_suppressed_count: duplicateSuppressed,
      sent_count: counts.sent,
      failed_count: counts.failed,
      send_suppressed_count: counts.suppressed,
      cleanup_pending_count: counts.cleanup_pending,
      cleanup_completed_count: counts.cleanup_completed,
      send_reasons: reasons,
    };
    console.log(`[evaluation-reminders] SUMMARY: ${JSON.stringify(summary)}`);
    await finishCronRunSuccess(supabase, runId, summary);
    return res.status(200).json({ success: true, ...summary });
  } catch (err) {
    console.error(`[${cronName}] unexpected error:`, err?.message);
    await finishCronRunError(supabase, runId, err?.message);
    return res.status(500).json({ error: 'internal_error' });
  }
}

/** Weekly reminder run. Vercel invokes this path with a production GET. */
export default function handler(req, res) {
  return runEvaluationReminders(req, res, { sweep: false });
}
