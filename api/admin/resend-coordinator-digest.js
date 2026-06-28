// api/admin/resend-coordinator-digest.js
// Manual trigger and backfill endpoint for the coordinator weekly digest.
// Useful for:
//   - Testing the digest before the Friday cron fires
//   - Recovering if a Friday cron was missed or errored
//   - Sending a digest for a custom time window
//
// Auth: x-admin-token header must match ADMIN_NOTIFICATION_TOKEN env var.
//
// Usage:
//   # Default: last 7 days (same window the Friday cron would use right now)
//   curl -X POST https://aspire-tracker.vercel.app/api/admin/resend-coordinator-digest \
//     -H "x-admin-token: $ADMIN_NOTIFICATION_TOKEN" \
//     -H "Content-Type: application/json" \
//     -d '{}'
//
//   # Custom window:
//   curl ... -d '{"window_start":"2026-05-13T00:00:00-07:00","window_end":"2026-05-20T00:00:00-07:00"}'
//
//   # Force re-send even if already sent for this window:
//   curl ... -d '{"force":true}'
//
//   # Limit to specific coordinator IDs:
//   curl ... -d '{"contact_ids":["uuid1","uuid2"]}'

import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import { buildCoordinatorWeeklyDigestEmail, formatDateRange } from '../../src/lib/notifications/templates/coordinatorWeeklyDigest.js';

const FROM     = 'ASPIRE at Cedars-Sinai <noreply@aspire-program.com>';
const REPLY_TO = 'JesterLloyd.Bautista@cshs.org';
// Must match api/cron/coordinator-weekly-digest.js so manual resends render the same digest.
// rotation_start + status_change_active_rotation collapse into one 'rotation' category below.
const DIGEST_EVENT_TYPES = ['form_received', 'interview_booked', 'interview', 'placement', 'rotation_start', 'status_change_active_rotation'];

function getServiceClient() {
  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing Supabase service role credentials');
  return createClient(url, key);
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-token');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const adminToken = req.headers['x-admin-token'];
  if (!process.env.ADMIN_NOTIFICATION_TOKEN || adminToken !== process.env.ADMIN_NOTIFICATION_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const now = new Date();
  const {
    window_start, window_end,
    force = false, contact_ids,
    testMode = false, testRecipientEmail,
    simulateRecipientId, simulateRecipientEmail: simulateRecipientEmailParam,
  } = req.body || {};

  if (testMode && !testRecipientEmail) {
    return res.status(400).json({ error: 'testMode requires testRecipientEmail' });
  }

  // Resolve window
  const windowEnd   = window_end   ? new Date(window_end)   : getDefaultWindowEnd(now);
  const windowStart = window_start ? new Date(window_start) : new Date(windowEnd.getTime() - 7 * 24 * 3600 * 1000);

  console.log(`[resend-coordinator-digest] window: ${windowStart.toISOString()} → ${windowEnd.toISOString()} force=${force}`);

  try {
    const db     = getServiceClient();
    const resend = new Resend(process.env.RESEND_API_KEY);

    // 1. Events in window
    const { data: events, error: eventsErr } = await db
      .from('program_events')
      .select(`
        id, event_type, event_date, created_at, notes,
        students!inner(id, first_name, last_name, school, program_type)
      `)
      .gte('created_at', windowStart.toISOString())
      .lt('created_at', windowEnd.toISOString())
      .in('event_type', DIGEST_EVENT_TYPES);

    if (eventsErr) return res.status(500).json({ error: eventsErr.message });

    if (!events?.length) {
      return res.status(200).json({
        success: true,
        message: 'No qualifying events in the specified window',
        windowStart: windowStart.toISOString(),
        windowEnd:   windowEnd.toISOString(),
        sent: 0,
      });
    }

    // 2. Batch-resolve coordinators (attribute-based, not role-based — matches the cron).
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

      const studentName = `${student.first_name} ${student.last_name}`;

      for (const coordinator of matchedCoordinators) {
        if (contact_ids?.length && !contact_ids.includes(coordinator.id)) continue;

        if (!grouped[coordinator.id]) {
          grouped[coordinator.id] = {
            coordinator,
            transitions: { form_received: [], interview_booked: [], interview: [], placement: [], rotation: [] },
          };
        }

        const bucket = grouped[coordinator.id].transitions;

        switch (event.event_type) {
          case 'form_received':
            bucket.form_received.push({ line: studentName });
            break;
          case 'interview_booked': {
            const timeMatch = event.notes?.match(/for (\d{4}-\d{2}-\d{2}) at (\d{2}:\d{2}) with (.+?)(?:\s*\(\d+)/);
            const datePart  = timeMatch?.[1] || event.event_date;
            const timePart  = timeMatch?.[2];
            const intName   = timeMatch?.[3]?.trim();
            const when      = [datePart && formatShortDate(datePart), timePart && formatTime(timePart)].filter(Boolean).join(' at ');
            bucket.interview_booked.push({ line: `${studentName}${when ? ' — ' + when : ''}${intName ? ' with ' + intName : ''}` });
            break;
          }
          case 'interview': {
            const scoreMatch = event.notes?.match(/Score:\s*([\d.]+)\/15/);
            bucket.interview.push({ line: `${studentName}${scoreMatch?.[1] ? ` (${scoreMatch[1]}/15)` : ''}` });
            break;
          }
          case 'placement': {
            const unitMatch = event.notes?.match(/Placed in (.+)$/);
            bucket.placement.push({ line: `${studentName}${unitMatch?.[1] ? ` — ${unitMatch[1].trim()}` : ''}` });
            break;
          }
          // rotation_start + status_change_active_rotation collapse into one rotation line;
          // student shown once (dedup by student id). Mirrors the cron handler.
          case 'rotation_start':
          case 'status_change_active_rotation': {
            if (!bucket.rotation.some(r => r.studentId === student.id)) {
              bucket.rotation.push({ line: studentName, studentId: student.id });
            }
            break;
          }
        }
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
          message:     'No coordinators resolved — nothing to simulate',
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
        to:       [testRecipientEmail],   // Owner's address — never coordinator's
        subject:  simSubject,             // exact subject, no [TEST] prefix, for accurate review
        html:     simHtml,
        tags: [
          { name: 'type',   value: 'coordinator_weekly_digest_test' },
          { name: 'source', value: 'admin_test' },
        ],
      });

      if (testEmailErr) {
        console.error('[resend-coordinator-digest] test send failed:', testEmailErr.message);
        return res.status(500).json({ error: testEmailErr.message });
      }

      // Log with a distinct notification_type so the real dedup query
      // (eq('notification_type', 'coordinator_weekly_digest')) cannot match this row.
      // contact_id intentionally null — this is not a real send to the coordinator.
      try {
        await db.from('notification_log').insert({
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
            window_start:                windowStart.toISOString(),
            window_end:                  windowEnd.toISOString(),
            source:                      'admin_test',
            simulated_coordinator_id:    simulatedId,
            simulated_coordinator_name:  sim.full_name,
            simulated_coordinator_school: sim.school_name,
            transition_count:            simTotalItems,
          },
        });
      } catch (logErr) {
        console.warn('[resend-coordinator-digest] test notification_log write failed (non-fatal):', logErr.message);
      }

      console.log(`[resend-coordinator-digest] test mode → ${testRecipientEmail} (simulated: ${sim.full_name})`);

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
      if (!force && coordinator.notification_preferences?.weekly_digest === false) {
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

        const { error: logErr2 } = await db.from('notification_log').insert({
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
            window_start: windowStart.toISOString(), window_end: windowEnd.toISOString(),
            source: 'admin_manual', transition_count: totalItems,
          },
        })
        if (logErr2) console.warn('[resend-coordinator-digest] log write error:', logErr2.message)

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
            metadata: { window_start: windowStart.toISOString(), window_end: windowEnd.toISOString(), source: 'admin_manual' },
          })
          if (failLogErr) console.warn('[resend-coordinator-digest] fail-log error:', failLogErr.message)
        } catch (failLogEx) {
          console.warn('[resend-coordinator-digest] fail-log threw:', failLogEx.message)
        }
      }
    }

    console.log(`[resend-coordinator-digest] done: sent=${sent.length} skipped=${skipped.length} failed=${failed.length}`);
    return res.status(200).json({
      success: true,
      windowStart: windowStart.toISOString(),
      windowEnd:   windowEnd.toISOString(),
      eventsFound: events.length,
      sent, skipped, failed,
    });

  } catch (err) {
    console.error('[resend-coordinator-digest] unexpected error:', err);
    return res.status(500).json({ error: err.message });
  }
}

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

function formatShortDate(dateStr) {
  return new Date(dateStr + 'T12:00:00Z').toLocaleDateString('en-US', {
    timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric',
  });
}

function formatTime(timeStr) {
  if (!timeStr) return '';
  const [h, m] = timeStr.split(':').map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
}
