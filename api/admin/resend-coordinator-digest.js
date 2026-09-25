// api/admin/resend-coordinator-digest.js
// Manual trigger and backfill endpoint for the coordinator weekly digest.
// Useful for:
//   - Testing the digest before the Friday cron fires (testMode: one rendered email to
//     the CALLER's own address, never a coordinator's)
//   - Recovering if a Friday cron was missed or errored
//   - Sending a digest for a custom time window
//
// Auth (S-13): an ACTIVE Owner or Admin session, verified server-side from the Bearer
// JWT through verifyOwnerAdminCaller. The shared static x-admin-token this endpoint used
// to accept (ADMIN_NOTIFICATION_TOKEN, compared with !==) is gone: it named no actor,
// could not be revoked per person, and was compared in a way that leaked timing. Every
// send now records who triggered it, in the notification_log row's metadata and in
// activity_logs.
//
// Usage: POST with the signed-in staff session's Authorization: Bearer <access token>.
//   # Default: last 7 days (same window the Friday cron would use right now)
//   -d '{}'
//   # Custom window:
//   -d '{"window_start":"2026-05-13T00:00:00-07:00","window_end":"2026-05-20T00:00:00-07:00"}'
//   # Re-send to coordinators who already received this window's digest:
//   -d '{"force":true}'
//     force bypasses the already-sent check ONLY. A coordinator who opted out of the
//     weekly digest is never sent one, force or not (S-13).
//   # Limit to specific coordinator IDs:
//   -d '{"contact_ids":["uuid1","uuid2"]}'
//   # Test mode: one rendered email to yourself, simulating one coordinator:
//   -d '{"testMode":true,"testRecipientEmail":"<your own account email>"}'
//
// Errors are generic: the response never carries a provider or database message.

import { createClient } from '@supabase/supabase-js';
import { populationDb, demoScopeOf, narrowByEmbed } from '../../lib/server/demoScope.js';
import { createMailer } from '../../lib/server/email/mailer.js';
import { verifyOwnerAdminCaller } from '../lib/portalAuth.js';
import { normalizeEmailForLookup } from '../../src/lib/emailUtils.js';
import { buildCoordinatorWeeklyDigestEmail, formatDateRange } from '../../src/lib/notifications/templates/coordinatorWeeklyDigest.js';
import { archiveSentMessage } from '../lib/messageArchive.js';
import {
  COORDINATOR_DIGEST_EVENT_TYPES,
  COORDINATOR_DIGEST_TEMPLATE_VERSION,
  addCoordinatorDigestEvent,
  createCoordinatorDigestTransitions,
} from '../lib/coordinatorDigestTransitions.js';

const FROM     = 'ASPIRE at Cedars-Sinai <noreply@aspire-program.com>';
const REPLY_TO = 'JesterLloyd.Bautista@cshs.org';
function getServiceClient() {
  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing Supabase service role credentials');
  // DEMO-DATA-2: real rows only. This re-runs the digest cron by hand, so it reads what the cron reads.
  return populationDb(createClient(url, key));
}

// Best-effort audit of who triggered a run (house pattern: warn and continue on failure).
async function emitAudit(db, actor, description, metadata) {
  try {
    const { error } = await db.from('activity_logs').insert({
      user_id: actor.id,
      user_name: actor.full_name || '',
      user_role: actor.role || '',
      action_type: 'coordinator_digest_manual_run',
      entity_type: 'notification',
      entity_id: 'coordinator_weekly_digest',
      cohort_id: null,
      description,
      metadata,
    });
    if (error) console.warn('[resend-coordinator-digest] audit insert error', { errorCode: error.code });
  } catch {
    console.warn('[resend-coordinator-digest] audit insert threw');
  }
}

export function createResendCoordinatorDigestHandler({
  verifyCaller = verifyOwnerAdminCaller,
  getDb = getServiceClient,
  getMailer = createMailer,
  clock = () => new Date(),
} = {}) {
  return async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  // S-13: an active Owner or Admin session is the only credential. The verified profile
  // is the actor on every row this run writes.
  const auth = await verifyCaller(req);
  if (!auth.ok) {
    const status = auth.status === 403 ? 403 : 401;
    return res.status(status).json({ error: status === 403 ? 'Forbidden' : 'Unauthorized' });
  }
  const actor = { id: auth.profile.id, full_name: auth.profile.full_name || '', role: auth.profile.role || '', email: auth.profile.email || '' };
  const actorMeta = { triggered_by_profile_id: actor.id, triggered_by_name: actor.full_name };

  const now = clock();
  const {
    window_start, window_end,
    force = false, contact_ids,
    testMode = false, testRecipientEmail,
    simulateRecipientId, simulateRecipientEmail: simulateRecipientEmailParam,
  } = req.body || {};

  if (testMode && !testRecipientEmail) {
    return res.status(400).json({ error: 'testMode requires testRecipientEmail' });
  }
  // S-13: a test send goes to the caller's OWN account address and nowhere else. The
  // endpoint cannot be used to mail a rendered digest, with real students' events in
  // it, to an arbitrary address.
  if (testMode && normalizeEmailForLookup(testRecipientEmail) !== normalizeEmailForLookup(actor.email)) {
    return res.status(403).json({ error: 'testRecipientEmail must be your own account email' });
  }

  // Resolve window
  const windowEnd   = window_end   ? new Date(window_end)   : getDefaultWindowEnd(now);
  const windowStart = window_start ? new Date(window_start) : new Date(windowEnd.getTime() - 7 * 24 * 3600 * 1000);

  console.log(`[resend-coordinator-digest] window: ${windowStart.toISOString()} → ${windowEnd.toISOString()} force=${force}`);

  try {
    const db     = getDb();
    const resend = getMailer();

    // 1. Events in window
    const { data: eventRows, error: eventsErr } = await db
      .from('program_events')
      .select(`
        id, event_type, event_date, created_at, notes,
        students!inner(id, first_name, preferred_first_name, last_name, school, program_type, status, is_demo)
      `)
      .gte('created_at', windowStart.toISOString())
      .lt('created_at', windowEnd.toISOString())
      .in('event_type', COORDINATOR_DIGEST_EVENT_TYPES);
    // DEMO-DATA-2: program_events has no is_demo, and the client filters only the root
    // table, so the embedded student decides. Real students only, like the rest of this run.
    const events = narrowByEmbed(eventRows, demoScopeOf(db), e => e.students);

    if (eventsErr) {
      console.error('[resend-coordinator-digest] events query failed:', eventsErr.message);
      return res.status(500).json({ error: 'internal_error' });
    }

    if (!events?.length) {
      return res.status(200).json({
        success: true,
        message: 'No qualifying events in the specified window',
        windowStart: windowStart.toISOString(),
        windowEnd:   windowEnd.toISOString(),
        sent: 0,
      });
    }

    // 2. Batch-resolve coordinators (attribute-based, not role-based - matches the cron).
    // Eligibility = is_active AND school_name matches an event school; role is display-only.
    // The contact_ids override NARROWS the active-contact query (it never drops is_active);
    // the resolver still enforces school_name/program_type matching, so a selected contact
    // that doesn't match the event school/program will not resolve.
    const schools = [...new Set(events.map(e => e.students?.school).filter(Boolean))];
    let coordQuery = db.from('contacts').select('*').eq('is_active', true);
    if (contact_ids?.length) {
      coordQuery = coordQuery.in('id', contact_ids);
    } else if (schools.length > 0) {
      coordQuery = coordQuery.in('school_name', schools);
    }

    const { data: allCoordinators } = await coordQuery;

    // 3. Group events by coordinator
    const grouped = {};
    for (const event of events) {
      const student = event.students;
      if (!student?.school) continue;

      // An event may route to multiple eligible contacts (school-wide + matching program-specific).
      const matchedCoordinators = resolveCoordinators(student, allCoordinators || []);
      if (matchedCoordinators.length === 0) continue;

      for (const coordinator of matchedCoordinators) {
        if (contact_ids?.length && !contact_ids.includes(coordinator.id)) continue;

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

    // 4. Dedup (unless force)
    let alreadySentIds = new Set();
    if (!force) {
      const { data: recentLogs } = await db
        .from('notification_log')
        .select('contact_id')
        .eq('notification_type', 'coordinator_weekly_digest')
        .gte('sent_at', windowStart.toISOString());
      alreadySentIds = new Set((recentLogs || []).map(r => r.contact_id).filter(Boolean));
    }

    // ── Test-mode: send ONE rendered email to Owner for review ───────────────
    // Does NOT send to the real coordinator email.
    // Does NOT update contacts CRM fields.
    // Writes notification_type 'coordinator_weekly_digest_test' (not the real type),
    // so the simulated coordinator's dedup state is completely unaffected.
    if (testMode) {
      const entries = Object.entries(grouped);
      if (entries.length === 0) {
        return res.status(200).json({
          testMode: true,
          message:     'No coordinators resolved, nothing to simulate',
          windowStart: windowStart.toISOString(),
          windowEnd:   windowEnd.toISOString(),
        });
      }

      // Pick the coordinator to simulate, by id → email → first available
      let simulatedEntry = null;
      if (simulateRecipientId) {
        simulatedEntry = entries.find(([id]) => id === simulateRecipientId) || null;
      } else if (simulateRecipientEmailParam) {
        simulatedEntry = entries.find(([, { coordinator }]) =>
          coordinator.email === simulateRecipientEmailParam) || null;
      }
      if (!simulatedEntry) simulatedEntry = entries[0];

      const [simulatedId, { coordinator: sim, transitions: simTransitions }] = simulatedEntry;
      const simFirstName    = sim.preferred_name || sim.full_name?.split(' ')[0];
      const simSchoolDisplay = sim.school_name + (sim.program_type ? ` (${sim.program_type})` : '');
      const simTotalItems   = Object.values(simTransitions).reduce((n, a) => n + a.length, 0);

      const { subject: simSubject, html: simHtml } = buildCoordinatorWeeklyDigestEmail({
        coordinatorFirstName: simFirstName,
        schoolDisplayName:    simSchoolDisplay,
        windowStart, windowEnd,
        transitions:          simTransitions,
      });

      const { data: testEmailData, error: testEmailErr } = await resend.emails.send({
        from:     FROM,
        reply_to: REPLY_TO,
        to:       [testRecipientEmail],   // Owner's address - never coordinator's
        subject:  simSubject,             // exact subject, no [TEST] prefix, for accurate review
        html:     simHtml,
        tags: [
          { name: 'type',   value: 'coordinator_weekly_digest_test' },
          { name: 'source', value: 'admin_test' },
        ],
      });

      if (testEmailErr) {
        console.error('[resend-coordinator-digest] test send failed:', testEmailErr.message);
        return res.status(500).json({ error: 'send_failed' });
      }

      // Log with a distinct notification_type so the real dedup query
      // (eq('notification_type', 'coordinator_weekly_digest')) cannot match this row.
      // contact_id intentionally null - this is not a real send to the coordinator.
      let testNotificationLogId = null;
      try {
        const { data: logRow } = await db.from('notification_log').insert({
          notification_type: 'coordinator_weekly_digest_test',
          audience:          'school_coordinator',
          contact_id:        null,
          recipient_type:    null,  // Owner/test email with no real contact_id (per B.2.A recipient-linkage rule)
          recipient_email:   testRecipientEmail,
          recipient_name:    'Owner (Test Mode)',
          recipient_role:    'owner',
          subject:           simSubject,
          resend_email_id:   testEmailData?.id || null,
          status:            'sent',
          metadata: {
            ...actorMeta,
            window_start:                windowStart.toISOString(),
            window_end:                  windowEnd.toISOString(),
            source:                      'admin_test',
            simulated_coordinator_id:    simulatedId,
            simulated_coordinator_name:  sim.full_name,
            simulated_coordinator_school: sim.school_name,
            transition_count:            simTotalItems,
          },
        }).select('id').single();
        testNotificationLogId = logRow?.id || null;
      } catch (logErr) {
        console.warn('[resend-coordinator-digest] test notification_log write failed (non-fatal):', logErr.message);
      }

      if (testNotificationLogId) {
        await archiveSentMessage({
          db,
          notificationLogId: testNotificationLogId,
          contentKind: 'coordinator_weekly_digest',
          html: simHtml,
          bodyFormat: 'html',
          source: 'admin_test',
          templateKey: 'coordinatorWeeklyDigest',
          templateVersion: COORDINATOR_DIGEST_TEMPLATE_VERSION,
        });
      }

      await emitAudit(db, actor, `Sent a test coordinator digest to their own address, simulating ${sim.full_name}`, {
        ...actorMeta, mode: 'test', simulated_coordinator_id: simulatedId,
        window_start: windowStart.toISOString(), window_end: windowEnd.toISOString(),
      });
      console.log(`[resend-coordinator-digest] test mode sent to the caller (simulated coordinator ${simulatedId})`);

      return res.status(200).json({
        testMode:             true,
        deliveredTo:          testRecipientEmail,
        simulatedCoordinator: {
          id:           simulatedId,
          name:         sim.full_name,
          email:        sim.email,
          school_name:  sim.school_name,
          program_type: sim.program_type || null,
          event_count:  simTotalItems,
        },
        messageId:   testEmailData?.id || null,
        windowStart: windowStart.toISOString(),
        windowEnd:   windowEnd.toISOString(),
      });
    }
    // ── end test mode ──────────────────────────────────────────────────────────

    // 5. Send
    const sent = [], skipped = [], failed = [];

    for (const [coordinatorId, { coordinator, transitions }] of Object.entries(grouped)) {
      if (!force && alreadySentIds.has(coordinatorId)) {
        skipped.push({ coordinator: coordinator.full_name, reason: 'already_sent' });
        continue;
      }
      if (!coordinator.email) {
        skipped.push({ coordinator: coordinator.full_name, reason: 'no_email' });
        continue;
      }
      // S-13: an opt-out is absolute. force re-sends past the already-sent check only.
      if (coordinator.notification_preferences?.weekly_digest === false) {
        skipped.push({ coordinator: coordinator.full_name, reason: 'opted_out' });
        continue;
      }

      const firstName   = coordinator.preferred_name || coordinator.full_name?.split(' ')[0];
      const schoolDisplay = coordinator.school_name + (coordinator.program_type ? ` (${coordinator.program_type})` : '');
      const totalItems  = Object.values(transitions).reduce((n, a) => n + a.length, 0);

      try {
        const { subject, html } = buildCoordinatorWeeklyDigestEmail({
          coordinatorFirstName: firstName,
          schoolDisplayName:    schoolDisplay,
          windowStart, windowEnd, transitions,
        });

        const { data: emailData, error: emailErr } = await resend.emails.send({
          from: FROM, reply_to: REPLY_TO, to: [coordinator.email], subject, html,
          tags: [
            { name: 'type',   value: 'coordinator_weekly_digest' },
            { name: 'source', value: 'admin_manual' },
          ],
        });

        if (emailErr) throw new Error(emailErr.message || JSON.stringify(emailErr));

        const { data: logRow, error: logErr2 } = await db.from('notification_log').insert({
          notification_type: 'coordinator_weekly_digest',
          audience:          'school_coordinator',
          contact_id:        coordinatorId,
          recipient_type:    'contact',
          recipient_email:   coordinator.email,
          recipient_name:    coordinator.full_name,
          recipient_role:    'school_coordinator',
          subject,
          resend_email_id:   emailData?.id || null,
          status:            'sent',
          metadata: {
            ...actorMeta,
            window_start: windowStart.toISOString(), window_end: windowEnd.toISOString(),
            source: 'admin_manual', transition_count: totalItems,
          },
        }).select('id').single()
        if (logErr2) console.warn('[resend-coordinator-digest] log write error:', logErr2.message)

        const notificationLogId = logRow?.id || null
        if (notificationLogId) {
          await archiveSentMessage({
            db,
            notificationLogId,
            contentKind: 'coordinator_weekly_digest',
            html,
            bodyFormat: 'html',
            source: 'admin_manual',
            templateKey: 'coordinatorWeeklyDigest',
            templateVersion: COORDINATOR_DIGEST_TEMPLATE_VERSION,
          })
        }

        try {
          const { error: crmErr } = await db.from('contacts').update({
            last_contacted_at:    new Date().toISOString(),
            last_contact_type:    'weekly_digest',
            last_contact_summary: `Weekly digest sent for ${formatDateRange(windowStart, windowEnd)} (${totalItems} item${totalItems !== 1 ? 's' : ''})`,
          }).eq('id', coordinatorId)
          if (crmErr) console.warn('[resend-coordinator-digest] contacts CRM update error:', crmErr.message)
        } catch (crmEx) {
          console.warn('[resend-coordinator-digest] contacts CRM update threw:', crmEx.message)
        }

        sent.push({ coordinator: coordinator.full_name, email: coordinator.email, items: totalItems });
        console.log(`[resend-coordinator-digest] sent to ${coordinator.email} (${totalItems} items)`);
      } catch (err) {
        console.error(`[resend-coordinator-digest] failed for ${coordinator.full_name}:`, err.message);
        failed.push({ coordinator: coordinator.full_name, error: err.message });

        try {
          const { error: failLogErr } = await db.from('notification_log').insert({
            notification_type: 'coordinator_weekly_digest',
            audience:          'school_coordinator',
            contact_id:        coordinatorId,
            recipient_type:    'contact',
            recipient_email:   coordinator.email,
            recipient_name:    coordinator.full_name,
            recipient_role:    'school_coordinator',
            subject:           '(send failed)',
            status:            'failed',
            error_message:     err.message,
            metadata: { ...actorMeta, window_start: windowStart.toISOString(), window_end: windowEnd.toISOString(), source: 'admin_manual' },
          })
          if (failLogErr) console.warn('[resend-coordinator-digest] fail-log error:', failLogErr.message)
        } catch (failLogEx) {
          console.warn('[resend-coordinator-digest] fail-log threw:', failLogEx.message)
        }
      }
    }

    await emitAudit(db, actor, `Ran the coordinator digest by hand: sent ${sent.length}, skipped ${skipped.length}, failed ${failed.length}`, {
      ...actorMeta, mode: 'manual', force: force === true,
      window_start: windowStart.toISOString(), window_end: windowEnd.toISOString(),
      sent: sent.length, skipped: skipped.length, failed: failed.length,
    });
    console.log(`[resend-coordinator-digest] done: sent=${sent.length} skipped=${skipped.length} failed=${failed.length}`);
    return res.status(200).json({
      success: true,
      windowStart: windowStart.toISOString(),
      windowEnd:   windowEnd.toISOString(),
      eventsFound: events.length,
      // Per-recipient failure detail stays in the server log; the response names who and why, not the provider text.
      sent, skipped, failed: failed.map(f => ({ coordinator: f.coordinator, error: 'send_failed' })),
    });

  } catch (err) {
    console.error('[resend-coordinator-digest] unexpected error:', err);
    return res.status(500).json({ error: 'internal_error' });
  }
  };
}

export default createResendCoordinatorDigestHandler();

function getDefaultWindowEnd(now) {
  const todayPacific = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(now);
  const refUtcNoon   = new Date(todayPacific + 'T12:00:00Z');
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles', timeZoneName: 'shortOffset',
  }).formatToParts(refUtcNoon);
  const offsetStr = parts.find(p => p.type === 'timeZoneName')?.value || 'GMT-8';
  const m = offsetStr.match(/GMT([+-]\d{1,2})(?::(\d{2}))?/);
  const offsetH = m ? parseInt(m[1], 10) : -8;
  const sign    = offsetH < 0 ? '-' : '+';
  return new Date(`${todayPacific}T00:00:00${sign}${String(Math.abs(offsetH)).padStart(2,'0')}:00`);
}

// Attribute-based multi-match (mirrors api/cron/coordinator-weekly-digest.js).
// All eligible contacts for the student's school receive: school-wide (program_type NULL)
// always, plus program-specific contacts whose program_type exactly matches a non-null
// student program_type. role is display-only; null school_name can never match (hard skip).
function resolveCoordinators(student, contacts) {
  if (!student.school) return [];
  return contacts.filter(c =>
    c.school_name === student.school && (
      c.program_type == null ||
      (student.program_type != null && c.program_type === student.program_type)
    )
  );
}
