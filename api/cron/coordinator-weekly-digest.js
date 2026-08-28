// api/cron/coordinator-weekly-digest.js
// Runs every Friday at 16:00 UTC (8 AM PST / 9 AM PDT) via Vercel Cron.
// For each active school coordinator with student activity in the past 7 days,
// sends one digest email summarising what their students have been up to.
//
// Quiet weeks stay quiet: coordinators with zero qualifying events are skipped.
// Dedup: checks notification_log to skip any coordinator already sent a digest
// for this window (safe for re-runs or manual triggers).
//
// Event categories included in the digest:
//   form_received    → "Forms Received"
//   interview_booked → "Interviews Scheduled"
//   interview        → "Interviews Completed"   (rubric submitted)
//   placement        → "Unit Placements"
//   terminal status  → "Not Proceeding"         (current status overrides prior milestones)
//
// Recipient routing is attribute-based on the contacts table (role is display-only):
// a contact is eligible when is_active = true and its school_name matches the student's
// school. Program scope: program_type NULL = school-wide (every student of that school);
// program_type set = only students whose program_type matches exactly. A student/event may
// route to MULTIPLE eligible contacts; school-wide contacts are never suppressed.
//
// Dry-run mode: add ?dryRun=1 (or ?dry_run=1) to preview what would be sent
// without calling Resend, writing notification_log, or updating contacts.
// Auth (CRON_SECRET) is still required in dry-run mode.

import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import { buildCoordinatorWeeklyDigestEmail, formatDateRange } from '../../src/lib/notifications/templates/coordinatorWeeklyDigest.js';
import { startCronRun, finishCronRunSuccess, finishCronRunError } from '../lib/cronRuns.js';
import { isAutomationEnabled } from '../lib/automationSettings.js';
import { archiveSentMessage } from '../lib/messageArchive.js';
import {
  COORDINATOR_DIGEST_EVENT_TYPES,
  COORDINATOR_DIGEST_TEMPLATE_VERSION,
  addCoordinatorDigestEvent,
  createCoordinatorDigestTransitions,
} from '../lib/coordinatorDigestTransitions.js';
import { isAuthorizedCronRequest } from '../lib/cronAuth.js';

const FROM     = 'ASPIRE at Cedars-Sinai <noreply@aspire-program.com>';
const REPLY_TO = 'JesterLloyd.Bautista@cshs.org';

// Alert if more than this share of eligible coordinators fail to receive the digest
const ALERT_THRESHOLD = 0.2;

function getServiceClient() {
  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing Supabase service role credentials');
  return createClient(url, key);
}

export default async function handler(req, res) {
  if (!isAuthorizedCronRequest(req)) {
    // Log auth failure BEFORE the 401 return - this fires even if console output
    // later in the handler would be absent, making auth failures visible in Vercel logs.
    console.warn('[coordinator-digest] auth_failed:', {
      reason: 'authorization_header_mismatch',
      timestamp: new Date().toISOString(),
    });
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // Dry-run mode: runs all queries and resolution logic but skips Resend,
  // notification_log writes, and contacts CRM updates. Auth still required.
  const isDryRun = req.query.dryRun === '1' || req.query.dry_run === '1';

  const handlerStartTime = Date.now();
  const now = new Date();
  console.log(`[coordinator-digest] cron run at ${now.toISOString()}`);

  // CRON-OBS-1: best-effort heartbeat client, separate from the in-try `db` so the catch can
  // record status='error'. getServiceClient() may throw on missing creds - guarded, non-fatal.
  let hbDb = null;
  try { hbDb = getServiceClient(); } catch { /* heartbeat unavailable; non-fatal */ }
  const runId = await startCronRun(hbDb, 'coordinator-weekly-digest');

  try {
    const db     = getServiceClient();
    const resend = new Resend(process.env.RESEND_API_KEY);

    const { windowStart, windowEnd } = getDigestWindow(now);
    console.log(`[coordinator-digest] window: ${windowStart.toISOString()} → ${windowEnd.toISOString()}`);

    // Log 1 - handler_entry: confirms the handler was invoked and passed auth.
    // Appears even before any DB queries, so cron invocation is visible in logs.
    console.log('[coordinator-digest] handler_entry:', {
      timestamp: now.toISOString(),
      mode:      isDryRun ? 'dry_run' : 'live',
      window:    { start: windowStart.toISOString(), end: windowEnd.toISOString() },
      trigger:   'vercel_cron',
    });

    if (isDryRun) {
      console.log('[coordinator-digest] dry_run_start:', {
        timestamp: now.toISOString(),
        window:    { start: windowStart.toISOString(), end: windowEnd.toISOString() },
        note:      'No emails will be sent. No notification_log rows will be written. No contacts will be updated.',
      });
    }

    // Automation gate - LIVE scheduled send ONLY. Dry-run (logged above) bypasses entirely so
    // preview keeps working even when paused. Default-ON / fail-open: a missing row or a read
    // failure keeps sending as today. Disabled live => paused heartbeat (success) + 200, with no
    // events query, no sends, no notification_log rows, and no contact digest-marker updates.
    // The manual admin resend endpoint is intentionally NOT gated.
    if (!isDryRun) {
      const gate = await isAutomationEnabled({ supabaseAdmin: db, automationKey: 'coordinator_weekly_digest' });
      if (!gate.enabled) {
        await finishCronRunSuccess(hbDb, runId, {
          skipped_disabled: true,
          automation_key: 'coordinator_weekly_digest',
          enabled: false,
        });
        return res.status(200).json({ skipped: true, reason: 'automation_disabled' });
      }
    }

    // ── 1. Fetch qualifying events ────────────────────────────────────────────
    const { data: events, error: eventsErr } = await db
      .from('program_events')
      .select(`
        id, event_type, event_date, created_at, notes,
        students!inner(id, first_name, last_name, school, program_type, status)
      `)
      .gte('created_at', windowStart.toISOString())
      .lt('created_at', windowEnd.toISOString())
      .in('event_type', COORDINATOR_DIGEST_EVENT_TYPES);

    if (eventsErr) {
      console.error('[coordinator-digest] events query error:', eventsErr);
      console.error('[coordinator-digest] events_query_error:', { error_message: eventsErr.message });
      await finishCronRunError(hbDb, runId, eventsErr.message);
      return res.status(500).json({ error: eventsErr.message });
    }

    // Log 2 - events_query: logs event counts and school spread before the early
    // no-events return, so this fires regardless of whether events exist.
    // schools computed here (null-safe) and reused for the contacts query below.
    const schools = [...new Set((events || []).map(e => e.students?.school).filter(Boolean))];
    const byType  = (events || []).reduce((acc, e) => {
      acc[e.event_type] = (acc[e.event_type] || 0) + 1;
      return acc;
    }, {});
    console.log('[coordinator-digest] events_query:', {
      total_events:     (events || []).length,
      by_type:          byType,
      schools_detected: schools.length,
      window:           { start: windowStart.toISOString(), end: windowEnd.toISOString() },
    });

    if (!events || events.length === 0) {
      console.log('[coordinator-digest] no qualifying events this week, nothing to send');
      console.log('[coordinator-digest] run_summary:', {
        total_events:               0,
        active_coordinators_loaded: 0,
        coordinators_resolved:      0,
        sent_count:                 0,
        failed_count:               0,
        skipped_count:              0,
        duration_ms:                Date.now() - handlerStartTime,
        status:                     'completed_no_qualifying_events',
      });
      await finishCronRunSuccess(hbDb, runId, { dry_run: isDryRun, event_count: 0, sent_count: 0 });
      if (isDryRun) {
        return res.status(200).json({
          dryRun:                   true,
          success:                  true,
          message:                  'No qualifying events',
          sent:                     0,
          windowStart:              windowStart.toISOString(),
          windowEnd:                windowEnd.toISOString(),
          totalEvents:              0,
          eventsByType:             {},
          schoolsDetected:          0,
          activeCoordinatorsLoaded: 0,
          coordinatorsResolved:     0,
          wouldSendCount:           0,
          skippedCount:             0,
          skippedReasons:           {},
          recipients:               [],
        });
      }
      return res.status(200).json({ success: true, message: 'No qualifying events', sent: 0 });
    }

    // ── 2. Batch-resolve coordinators (attribute-based, not role-based) ────────
    // Academic-partner recipient model: eligibility is by attributes, not title.
    // Eligible = is_active AND school_name matches one of the event schools (which
    // also enforces school_name NOT NULL, since a null can't be in a non-null list).
    // role is display-only and intentionally NOT used to filter. The per-recipient
    // email-present check below still skips contacts with a missing email.
    // (schools was computed above for Log 2)
    const { data: allCoordinators, error: coordinatorsErr } = await db
      .from('contacts')
      .select('*')
      .eq('is_active', true)
      .in('school_name', schools);

    if (coordinatorsErr) {
      console.error('[coordinator-digest] contacts_query_error:', {
        error_message: coordinatorsErr.message,
        error_code:    coordinatorsErr.code    || null,
        error_details: coordinatorsErr.details || null,
      });
      await finishCronRunError(hbDb, runId, coordinatorsErr.message);
      return res.status(500).json({ error: coordinatorsErr.message });
    }

    // ── 3. Group events by coordinator ────────────────────────────────────────
    const grouped = {};  // { [coordinatorId]: { coordinator, transitions } }

    for (const event of events) {
      const student = event.students;
      if (!student?.school) continue;

      // An event may route to MULTIPLE eligible contacts (a school-wide contact plus any
      // program-specific contact whose program_type matches). School-wide contacts are
      // never suppressed by a program-specific match.
      const matchedCoordinators = resolveCoordinators(student, allCoordinators || []);
      if (matchedCoordinators.length === 0) {
        console.warn(`[coordinator-digest] no coordinator for school="${student.school}" program="${student.program_type}"`);
        continue;
      }

      for (const coordinator of matchedCoordinators) {
        if (!grouped[coordinator.id]) {
          grouped[coordinator.id] = {
            coordinator,
            transitions: createCoordinatorDigestTransitions(),
          };
        }

        const bucket = grouped[coordinator.id].transitions;
        addCoordinatorDigestEvent(bucket, event);
      }
    }

    // Log 3 - coordinator_resolution: after grouping, shows how many coordinators
    // were matched and flags schools that had events but no matching coordinator.
    // unmatched_schools identifies school-name mismatch failures at a glance.
    const unmatchedSchools = schools
      .filter(s => !(allCoordinators || []).some(c => c.school_name === s))
      .slice(0, 10);
    console.log('[coordinator-digest] coordinator_resolution:', {
      active_coordinators_loaded:        (allCoordinators || []).length,
      schools_in_events:                 schools.length,
      coordinators_resolved:             Object.keys(grouped).length,
      coordinators_with_missing_email:   (allCoordinators || []).filter(c => !c.email).length,
      unmatched_schools:                 unmatchedSchools,
    });

    const coordinatorEntries = Object.entries(grouped);

    if (coordinatorEntries.length === 0) {
      console.log('[coordinator-digest] events found but no coordinators resolved, nothing to send');
      console.log('[coordinator-digest] run_summary:', {
        total_events:               events.length,
        active_coordinators_loaded: (allCoordinators || []).length,
        coordinators_resolved:      0,
        sent_count:                 0,
        failed_count:               0,
        skipped_count:              0,
        duration_ms:                Date.now() - handlerStartTime,
        status:                     'completed_no_recipients_resolved',
      });
      await finishCronRunSuccess(hbDb, runId, { dry_run: isDryRun, event_count: events.length, coordinators_resolved: 0, sent_count: 0 });
      if (isDryRun) {
        return res.status(200).json({
          dryRun:                   true,
          success:                  true,
          message:                  'No coordinators resolved',
          windowStart:              windowStart.toISOString(),
          windowEnd:                windowEnd.toISOString(),
          totalEvents:              events.length,
          eventsByType:             byType,
          schoolsDetected:          schools.length,
          activeCoordinatorsLoaded: (allCoordinators || []).length,
          coordinatorsResolved:     0,
          wouldSendCount:           0,
          skippedCount:             0,
          skippedReasons:           {},
          recipients:               [],
        });
      }
      return res.status(200).json({ success: true, message: 'No coordinators resolved', sent: 0 });
    }

    // ── 4. Dedup: which coordinators already received a digest for this window? ─
    const { data: recentLogs, error: recentLogsErr } = await db
      .from('notification_log')
      .select('contact_id')
      .eq('notification_type', 'coordinator_weekly_digest')
      .gte('sent_at', windowStart.toISOString());

    if (recentLogsErr) {
      // Fail safe: stop rather than continue with an empty dedup set.
      // Proceeding with alreadySentIds = empty would risk sending duplicate digests
      // to coordinators who already received one this window.
      console.error('[coordinator-digest] recent_logs_query_error:', {
        error_message: recentLogsErr.message,
        error_code:    recentLogsErr.code    || null,
        error_details: recentLogsErr.details || null,
      });
      await finishCronRunError(hbDb, runId, recentLogsErr.message);
      return res.status(500).json({ error: recentLogsErr.message });
    }

    const alreadySentIds = new Set((recentLogs || []).map(r => r.contact_id).filter(Boolean));

    // ── 5. Send (or dry-run preview) ─────────────────────────────────────────
    // dryRunRecipients collects per-coordinator outcomes in dry-run mode.
    // In live mode this array is never populated and the variable is unused.
    const dryRunRecipients = [];
    const summary = { eligible: coordinatorEntries.length, sent: 0, skipped: 0, failed: 0, details: [] };

    for (const [coordinatorId, { coordinator, transitions }] of coordinatorEntries) {

      const eventCount = Object.values(transitions).reduce((n, arr) => n + arr.length, 0);

      if (alreadySentIds.has(coordinatorId)) {
        summary.skipped++;
        summary.details.push({ coordinator: coordinator.full_name, status: 'skipped', reason: 'already_sent_this_window' });
        // Log 4 - dedup skip
        console.log('[coordinator-digest] skip_dedup:', {
          coordinator_id:     coordinatorId,
          dedup_window_start: windowStart.toISOString(),
        });
        if (isDryRun) dryRunRecipients.push({
          coordinator_id: coordinatorId,
          name:           coordinator.full_name,
          school:         coordinator.school_name,
          program_type:   coordinator.program_type || null,
          email_present:  !!coordinator.email,
          event_count:    eventCount,
          status:         'dedup_skipped',
        });
        continue;
      }

      if (!coordinator.email) {
        summary.skipped++;
        summary.details.push({ coordinator: coordinator.full_name, status: 'skipped', reason: 'no_email' });
        // Log 4 - missing email skip
        console.log('[coordinator-digest] skip_missing_email:', {
          coordinator_id: coordinatorId,
          role:           coordinator.role,
          school_name:    coordinator.school_name,
        });
        if (isDryRun) dryRunRecipients.push({
          coordinator_id: coordinatorId,
          name:           coordinator.full_name,
          school:         coordinator.school_name,
          program_type:   coordinator.program_type || null,
          email_present:  false,
          event_count:    eventCount,
          status:         'missing_email',
        });
        continue;
      }

      if (coordinator.notification_preferences?.weekly_digest === false) {
        summary.skipped++;
        summary.details.push({ coordinator: coordinator.full_name, status: 'skipped', reason: 'opted_out' });
        // Log 4 - opted-out skip
        console.log('[coordinator-digest] skip_opted_out:', {
          coordinator_id: coordinatorId,
          school_name:    coordinator.school_name,
        });
        if (isDryRun) dryRunRecipients.push({
          coordinator_id: coordinatorId,
          name:           coordinator.full_name,
          school:         coordinator.school_name,
          program_type:   coordinator.program_type || null,
          email_present:  true,
          event_count:    eventCount,
          status:         'opted_out',
        });
        continue;
      }

      const schoolDisplay = coordinator.school_name +
        (coordinator.program_type ? ` (${coordinator.program_type})` : '');

      const firstName = coordinator.preferred_name ||
        (coordinator.full_name?.split(' ')[0]) || coordinator.full_name;

      const totalItems = eventCount;

      let subject, html;
      try {
        ({ subject, html } = buildCoordinatorWeeklyDigestEmail({
          coordinatorFirstName: firstName,
          schoolDisplayName:    schoolDisplay,
          windowStart,
          windowEnd,
          transitions,
        }));
      } catch (renderErr) {
        console.error(`[coordinator-digest] template render failed for ${coordinator.full_name}:`, renderErr.message);
        summary.failed++;
        summary.details.push({ coordinator: coordinator.full_name, status: 'failed', reason: 'render_error', error: renderErr.message });
        continue;
      }

      // ── Dry-run branch: record what would happen, then skip all side effects ─
      if (isDryRun) {
        dryRunRecipients.push({
          coordinator_id: coordinatorId,
          name:           coordinator.full_name,
          school:         coordinator.school_name,
          program_type:   coordinator.program_type || null,
          email_present:  true,
          event_count:    totalItems,
          status:         'would_send',
        });
        continue;
        // No resend.emails.send(), no notification_log write, no contacts.update()
      }

      let resendId   = null;
      let sendStatus = 'sent';
      let sendError  = null;

      // Log 5 - send_attempt: fired immediately before the Resend call so a crash
      // or timeout inside the send is distinguishable from a skip or pre-send failure.
      console.log('[coordinator-digest] send_attempt:', {
        coordinator_id:        coordinatorId,
        recipient_email:       coordinator.email,
        school_name:           coordinator.school_name,
        event_count_in_digest: totalItems,
      });

      try {
        const { data: emailData, error: emailErr } = await resend.emails.send({
          from:     FROM,
          reply_to: REPLY_TO,
          to:       [coordinator.email],
          subject,
          html,
          tags: [
            { name: 'type',     value: 'coordinator_weekly_digest' },
            { name: 'school',   value: coordinator.school_name.replace(/[^a-zA-Z0-9_\-]/g, '_') },
          ],
        });
        if (emailErr) {
          sendStatus = 'failed';
          sendError  = emailErr.message || JSON.stringify(emailErr);
          console.error(`[coordinator-digest] Resend error for ${coordinator.full_name}:`, emailErr);
          // Log 6 - send failure (Resend API returned an error object)
          console.error('[coordinator-digest] send_failure:', {
            coordinator_id:  coordinatorId,
            recipient_email: coordinator.email,
            error_message:   emailErr.message || JSON.stringify(emailErr),
            error_type:      'resend_api_error',
          });
        } else {
          resendId = emailData?.id || null;
          console.log(`[coordinator-digest] sent to ${coordinator.email} (${coordinator.full_name}), ${totalItems} items | resend: ${resendId}`);
          // Log 6 - send success
          console.log('[coordinator-digest] send_success:', {
            coordinator_id:    coordinatorId,
            recipient_email:   coordinator.email,
            resend_message_id: resendId,
          });
        }
      } catch (sendErr) {
        sendStatus = 'failed';
        sendError  = sendErr.message;
        console.error(`[coordinator-digest] send threw for ${coordinator.full_name}:`, sendErr.message);
        // Log 6 - send failure (exception thrown during send)
        console.error('[coordinator-digest] send_failure:', {
          coordinator_id:  coordinatorId,
          recipient_email: coordinator.email,
          error_message:   sendErr.message,
          error_type:      sendErr.constructor?.name || 'Error',
        });
      }

      // Log to notification_log
      let notificationLogId = null;
      try {
        const { data: logRow } = await db.from('notification_log').insert({
          notification_type: 'coordinator_weekly_digest',
          audience:          'school_coordinator',
          contact_id:        coordinatorId,
          recipient_type:    'contact',
          recipient_email:   coordinator.email,
          recipient_name:    coordinator.full_name,
          recipient_role:    'school_coordinator',
          subject:           subject || '(render failed)',
          resend_email_id:   resendId,
          status:            sendStatus,
          error_message:     sendError,
          metadata: {
            window_start:     windowStart.toISOString(),
            window_end:       windowEnd.toISOString(),
            school:           coordinator.school_name,
            program_type:     coordinator.program_type || null,
            transition_count: totalItems,
          },
        }).select('id').single();
        notificationLogId = logRow?.id || null;
      } catch (logErr) {
        console.error(`[coordinator-digest] log write failed for ${coordinator.full_name}:`, logErr.message);
      }

      // ARCHIVE-SNAPSHOT-1: snapshot THIS coordinator's digest exactly as sent.
      // `subject`/`html` are the same bindings handed to resend.emails.send()
      // above - the builder is not called again and no activity is re-queried,
      // so the row is a record of that send rather than a later reconstruction
      // (which is precisely why historical digests cannot be shown).
      //
      // Three conditions, all required: Resend reported success, the
      // notification_log row was created, and its id came back. A failed or
      // unsent digest therefore leaves no archive at all.
      //
      // Best-effort and isolated: archiveSentMessage never throws, its result is
      // recorded and never acted on, and it sits inside this coordinator's loop
      // iteration - so one coordinator's storage problem cannot resend, block, or
      // alter any other coordinator's digest.
      if (sendStatus === 'sent' && notificationLogId) {
        const archive = await archiveSentMessage({
          db,
          notificationLogId,
          contentKind: 'coordinator_weekly_digest',
          html,
          bodyFormat: 'html',
          source: 'cron_coordinator_weekly_digest',
          templateKey: 'coordinatorWeeklyDigest',
          templateVersion: COORDINATOR_DIGEST_TEMPLATE_VERSION,
        });
        if (archive.status !== 'archived') {
          console.error(`[coordinator-digest] archive_not_stored for ${coordinator.full_name}:`, {
            status: archive.status, reason: archive.reason,
          });
        }
      }

      // Update contact's CRM fields on successful send
      if (sendStatus === 'sent') {
        try {
          const { error: crmErr } = await db.from('contacts').update({
            last_contacted_at:    new Date().toISOString(),
            last_contact_type:    'weekly_digest',
            last_contact_summary: `Weekly digest sent for ${formatDateRange(windowStart, windowEnd)} (${totalItems} item${totalItems !== 1 ? 's' : ''})`,
          }).eq('id', coordinatorId)
          if (crmErr) console.warn('[coordinator-digest] contact CRM update error (non-fatal):', crmErr.message)
        } catch (crmEx) {
          console.warn('[coordinator-digest] contact CRM update threw (non-fatal):', crmEx.message)
        }

        summary.sent++;
        summary.details.push({ coordinator: coordinator.full_name, status: 'sent', items: totalItems });
      } else {
        summary.failed++;
        summary.details.push({ coordinator: coordinator.full_name, status: 'failed', error: sendError });
      }
    }

    // ── Dry-run response - returned before the live summary block ────────────
    if (isDryRun) {
      const wouldSendCount = dryRunRecipients.filter(r => r.status === 'would_send').length;
      const skippedList    = dryRunRecipients.filter(r => r.status !== 'would_send');
      const skippedReasons = skippedList.reduce((acc, r) => {
        acc[r.status] = (acc[r.status] || 0) + 1;
        return acc;
      }, {});
      console.log('[coordinator-digest] dry_run_summary:', {
        total_events:               events.length,
        active_coordinators_loaded: (allCoordinators || []).length,
        coordinators_resolved:      coordinatorEntries.length,
        would_send_count:           wouldSendCount,
        skipped_count:              skippedList.length,
        skipped_reasons:            skippedReasons,
        duration_ms:                Date.now() - handlerStartTime,
      });
      await finishCronRunSuccess(hbDb, runId, {
        dry_run: true,
        event_count: events.length,
        coordinators_resolved: coordinatorEntries.length,
        would_send_count: wouldSendCount,
        skipped_count: skippedList.length,
      });
      return res.status(200).json({
        dryRun:                   true,
        windowStart:              windowStart.toISOString(),
        windowEnd:                windowEnd.toISOString(),
        totalEvents:              events.length,
        eventsByType:             byType,
        schoolsDetected:          schools.length,
        activeCoordinatorsLoaded: (allCoordinators || []).length,
        coordinatorsResolved:     coordinatorEntries.length,
        wouldSendCount,
        skippedCount:             skippedList.length,
        skippedReasons,
        recipients:               dryRunRecipients,
      });
    }

    // ── 6. Summary logging (live mode only) ───────────────────────────────────
    console.log(
      `[coordinator-digest] SUMMARY:` +
      ` eligible=${summary.eligible} sent=${summary.sent}` +
      ` skipped=${summary.skipped} failed=${summary.failed}`
    );

    if (summary.eligible > 0 && summary.failed / summary.eligible > ALERT_THRESHOLD) {
      console.error(
        `[coordinator-digest] ⚠ ALERT: ${summary.failed}/${summary.eligible}` +
        ` digest sends failed. Check logs for error details.`
      );
    }

    // Log 7 - run_summary: structured final summary covering all outcome paths.
    // status field makes grepping for "completed_with_sends" vs "completed_all_skipped" unambiguous.
    const runStatus = summary.sent > 0 && summary.failed === 0 ? 'completed_with_sends'
      : summary.sent > 0 && summary.failed > 0                ? 'completed_partial_failures'
      : summary.failed > 0                                     ? 'completed_partial_failures'
      :                                                          'completed_all_skipped';
    console.log('[coordinator-digest] run_summary:', {
      total_events:               events.length,
      active_coordinators_loaded: (allCoordinators || []).length,
      coordinators_resolved:      coordinatorEntries.length,
      sent_count:                 summary.sent,
      failed_count:               summary.failed,
      skipped_count:              summary.skipped,
      duration_ms:                Date.now() - handlerStartTime,
      status:                     runStatus,
    });

    await finishCronRunSuccess(hbDb, runId, {
      dry_run: false,
      event_count: events.length,
      coordinators_resolved: coordinatorEntries.length,
      sent_count: summary.sent,
      skipped_count: summary.skipped,
      failed_count: summary.failed,
    });
    return res.status(200).json({
      success:        true,
      checkedAt:      now.toISOString(),
      windowStart:    windowStart.toISOString(),
      windowEnd:      windowEnd.toISOString(),
      eventsFound:    events.length,
      ...summary,
    });

  } catch (err) {
    console.error('[coordinator-digest] unexpected error:', err);
    await finishCronRunError(hbDb, runId, err.message);
    return res.status(500).json({ error: err.message });
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// Window: 7 full days ending at the start of today (Pacific midnight).
// Since the cron fires on Friday ~8-9 AM Pacific, this covers the previous 7 days
// of student activity (last Friday midnight → this Friday midnight Pacific).
function getDigestWindow(now) {
  // "Today" in Pacific as YYYY-MM-DD
  const todayPacific = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
  }).format(now);

  const windowEnd   = pacificMidnight(todayPacific);          // today at 00:00 Pacific
  const windowStart = new Date(windowEnd.getTime() - 7 * 24 * 3600 * 1000); // 7 days back
  return { windowStart, windowEnd };
}

// Returns a Date corresponding to midnight Pacific on a given YYYY-MM-DD string.
// Uses noon UTC as the reference point to determine the Pacific offset (avoids
// the DST ambiguity that occurs at midnight itself).
function pacificMidnight(dateStr) {
  const refUtcNoon = new Date(dateStr + 'T12:00:00Z');
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone:     'America/Los_Angeles',
    timeZoneName: 'shortOffset',
  }).formatToParts(refUtcNoon);
  const offsetStr  = parts.find(p => p.type === 'timeZoneName')?.value || 'GMT-8';
  const m          = offsetStr.match(/GMT([+-]\d{1,2})(?::(\d{2}))?/);
  const offsetH    = m ? parseInt(m[1], 10) : -8;
  const offsetM    = m?.[2] ? parseInt(m[2], 10) : 0;
  const sign       = offsetH < 0 ? '-' : '+';
  return new Date(`${dateStr}T00:00:00${sign}${String(Math.abs(offsetH)).padStart(2,'0')}:${String(offsetM).padStart(2,'0')}`);
}

// Resolve ALL eligible academic-partner contacts for a student (attribute-based routing).
// A contact is eligible when its school_name matches the student's school AND either:
//   - school-wide  (program_type IS NULL)  - receives every student of that school; or
//   - program-specific (program_type set)  - receives only students whose program_type
//     exactly matches (and the student's program_type must be non-null).
// Multiple contacts may match; a school-wide contact is never suppressed by a
// program-specific one. role is NOT used. Contacts were already filtered to is_active +
// matching school_name in the query, so a null school_name can never match here (hard skip).
function resolveCoordinators(student, contacts) {
  if (!student.school) return [];
  return contacts.filter(c =>
    c.school_name === student.school && (
      c.program_type == null ||
      (student.program_type != null && c.program_type === student.program_type)
    )
  );
}
