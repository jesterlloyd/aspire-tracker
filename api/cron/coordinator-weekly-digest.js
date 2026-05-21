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
//
// Coordinator routing uses the contacts table (role = 'School Coordinator').
// For each student, we first try (school_name, program_type) exact match,
// then fall back to (school_name, program_type IS NULL) as a catch-all.

import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import { buildCoordinatorWeeklyDigestEmail, formatDateRange } from '../../src/lib/notifications/templates/coordinatorWeeklyDigest.js';

const FROM     = 'ASPIRE Intelligence <noreply@aspire-program.com>';
const REPLY_TO = 'JesterLloyd.Bautista@cshs.org';

// Event types to include; maps to digest section keys
const DIGEST_EVENT_TYPES = ['form_received', 'interview_booked', 'interview', 'placement'];

// Alert if more than this share of eligible coordinators fail to receive the digest
const ALERT_THRESHOLD = 0.2;

function getServiceClient() {
  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing Supabase service role credentials');
  return createClient(url, key);
}

export default async function handler(req, res) {
  if (req.headers['authorization'] !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const now = new Date();
  console.log(`[coordinator-digest] cron run at ${now.toISOString()}`);

  try {
    const db     = getServiceClient();
    const resend = new Resend(process.env.RESEND_API_KEY);

    const { windowStart, windowEnd } = getDigestWindow(now);
    console.log(`[coordinator-digest] window: ${windowStart.toISOString()} → ${windowEnd.toISOString()}`);

    // ── 1. Fetch qualifying events ────────────────────────────────────────────
    const { data: events, error: eventsErr } = await db
      .from('program_events')
      .select(`
        id, event_type, event_date, created_at, notes, metadata,
        students!inner(id, first_name, last_name, school, program_type)
      `)
      .gte('created_at', windowStart.toISOString())
      .lt('created_at', windowEnd.toISOString())
      .in('event_type', DIGEST_EVENT_TYPES);

    if (eventsErr) {
      console.error('[coordinator-digest] events query error:', eventsErr);
      return res.status(500).json({ error: eventsErr.message });
    }

    if (!events || events.length === 0) {
      console.log('[coordinator-digest] no qualifying events this week — nothing to send');
      return res.status(200).json({ success: true, message: 'No qualifying events', sent: 0 });
    }

    // ── 2. Batch-resolve coordinators ─────────────────────────────────────────
    const schools = [...new Set(events.map(e => e.students?.school).filter(Boolean))];

    const { data: allCoordinators } = await db
      .from('contacts')
      .select('*')
      .eq('role', 'School Coordinator')
      .eq('is_active', true)
      .in('school_name', schools);

    // ── 3. Group events by coordinator ────────────────────────────────────────
    const grouped = {};  // { [coordinatorId]: { coordinator, transitions } }

    for (const event of events) {
      const student = event.students;
      if (!student?.school) continue;

      const coordinator = resolveCoordinator(student, allCoordinators || []);
      if (!coordinator) {
        console.warn(`[coordinator-digest] no coordinator for school="${student.school}" program="${student.program_type}"`);
        continue;
      }

      if (!grouped[coordinator.id]) {
        grouped[coordinator.id] = {
          coordinator,
          transitions: {
            form_received:    [],
            interview_booked: [],
            interview:        [],
            placement:        [],
          },
        };
      }

      const studentName = `${student.first_name} ${student.last_name}`;
      const bucket = grouped[coordinator.id].transitions;

      switch (event.event_type) {
        case 'form_received':
          bucket.form_received.push({ line: studentName });
          break;

        case 'interview_booked': {
          // notes = "Interview self-scheduled for DATE at TIME with INTERVIEWER"
          const timeMatch = event.notes?.match(/for (\d{4}-\d{2}-\d{2}) at (\d{2}:\d{2}) with (.+?)(?:\s*\(\d+)/);
          const datePart = timeMatch?.[1] || event.event_date;
          const timePart = timeMatch?.[2];
          const intName  = timeMatch?.[3]?.trim();
          const when = [datePart && formatShortDate(datePart), timePart && formatTime(timePart)].filter(Boolean).join(' at ');
          const with_ = intName ? ` with ${intName}` : '';
          bucket.interview_booked.push({ line: `${studentName}${when ? ' — ' + when : ''}${with_}` });
          break;
        }

        case 'interview': {
          const scoreMatch = event.notes?.match(/Score:\s*([\d.]+)\/15/);
          const score = scoreMatch?.[1];
          bucket.interview.push({ line: `${studentName}${score ? ` (${score}/15)` : ''}` });
          break;
        }

        case 'placement': {
          const unitMatch = event.notes?.match(/Placed in (.+)$/);
          const unit = unitMatch?.[1]?.trim();
          bucket.placement.push({ line: `${studentName}${unit ? ` — ${unit}` : ''}` });
          break;
        }
      }
    }

    const coordinatorEntries = Object.entries(grouped);

    if (coordinatorEntries.length === 0) {
      console.log('[coordinator-digest] events found but no coordinators resolved — nothing to send');
      return res.status(200).json({ success: true, message: 'No coordinators resolved', sent: 0 });
    }

    // ── 4. Dedup: which coordinators already received a digest for this window? ─
    const { data: recentLogs } = await db
      .from('notification_log')
      .select('contact_id')
      .eq('notification_type', 'coordinator_weekly_digest')
      .gte('sent_at', windowStart.toISOString());

    const alreadySentIds = new Set((recentLogs || []).map(r => r.contact_id).filter(Boolean));

    // ── 5. Send ───────────────────────────────────────────────────────────────
    const summary = { eligible: coordinatorEntries.length, sent: 0, skipped: 0, failed: 0, details: [] };

    for (const [coordinatorId, { coordinator, transitions }] of coordinatorEntries) {

      if (alreadySentIds.has(coordinatorId)) {
        summary.skipped++;
        summary.details.push({ coordinator: coordinator.full_name, status: 'skipped', reason: 'already_sent_this_window' });
        continue;
      }

      if (!coordinator.email) {
        summary.skipped++;
        summary.details.push({ coordinator: coordinator.full_name, status: 'skipped', reason: 'no_email' });
        continue;
      }

      if (coordinator.notification_preferences?.weekly_digest === false) {
        summary.skipped++;
        summary.details.push({ coordinator: coordinator.full_name, status: 'skipped', reason: 'opted_out' });
        continue;
      }

      const schoolDisplay = coordinator.school_name +
        (coordinator.program_type ? ` (${coordinator.program_type})` : '');

      const firstName = coordinator.preferred_name ||
        (coordinator.full_name?.split(' ')[0]) || coordinator.full_name;

      const totalItems = Object.values(transitions).reduce((n, arr) => n + arr.length, 0);

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

      let resendId   = null;
      let sendStatus = 'sent';
      let sendError  = null;

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
        } else {
          resendId = emailData?.id || null;
          console.log(`[coordinator-digest] sent to ${coordinator.email} (${coordinator.full_name}) — ${totalItems} items | resend: ${resendId}`);
        }
      } catch (sendErr) {
        sendStatus = 'failed';
        sendError  = sendErr.message;
        console.error(`[coordinator-digest] send threw for ${coordinator.full_name}:`, sendErr.message);
      }

      // Log to notification_log
      try {
        await db.from('notification_log').insert({
          notification_type: 'coordinator_weekly_digest',
          audience:          'school_coordinator',
          contact_id:        coordinatorId,
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
        });
      } catch (logErr) {
        console.error(`[coordinator-digest] log write failed for ${coordinator.full_name}:`, logErr.message);
      }

      // Update contact's CRM fields on successful send
      if (sendStatus === 'sent') {
        await db.from('contacts').update({
          last_contacted_at:    new Date().toISOString(),
          last_contact_type:    'weekly_digest',
          last_contact_summary: `Weekly digest sent for ${formatDateRange(windowStart, windowEnd)} (${totalItems} item${totalItems !== 1 ? 's' : ''})`,
        }).eq('id', coordinatorId).catch(e =>
          console.warn('[coordinator-digest] contact CRM update failed (non-fatal):', e.message));

        summary.sent++;
        summary.details.push({ coordinator: coordinator.full_name, status: 'sent', items: totalItems });
      } else {
        summary.failed++;
        summary.details.push({ coordinator: coordinator.full_name, status: 'failed', error: sendError });
      }
    }

    // ── 6. Summary logging ────────────────────────────────────────────────────
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

// Resolve the best-matching coordinator for a student.
// Priority: (school, program_type) exact match → (school, NULL) catch-all.
function resolveCoordinator(student, coordinators) {
  if (!student.school) return null;

  // 1. Exact match
  const exact = coordinators.find(c =>
    c.school_name === student.school &&
    c.program_type === student.program_type
  );
  if (exact) return exact;

  // 2. Catch-all (program_type IS NULL)
  return coordinators.find(c =>
    c.school_name === student.school &&
    c.program_type === null
  ) || null;
}

function formatShortDate(dateStr) {
  if (!dateStr) return '';
  return new Date(dateStr + 'T12:00:00Z').toLocaleDateString('en-US', {
    timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric',
  });
}

function formatTime(timeStr) {
  if (!timeStr) return '';
  const [h, m] = timeStr.split(':').map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
}
