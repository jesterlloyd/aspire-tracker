// api/cron/interview-reminders.js
// Runs daily at 9 AM Pacific (17:00 UTC) via Vercel Cron.
// Finds upcoming interviews ~24 hours out and emails the registered student.
//
// Known limitation: same-day bookings (< 24h out) will not receive this reminder.
// A future enhancement could add a separate transactional "your interview is in X hours"
// reminder triggered at booking time.

import { createClient } from '@supabase/supabase-js';
import { sendNotification } from '../../src/lib/notifications/index.js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Query window: sessions whose interview falls between 23h and 25h from now.
const WINDOW_EARLY_H = 23;
const WINDOW_LATE_H  = 25;

export default async function handler(req, res) {
  if (req.headers['authorization'] !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const now = new Date();
  console.log(`[interview-reminders] cron run at ${now.toISOString()}`);

  try {
    // Fetch all upcoming sessions with student + slot data
    const { data: sessions, error: sessionsErr } = await supabase
      .from('interview_sessions')
      .select(`
        id,
        student_id,
        cohort_id,
        slot_id,
        students:student_id (
          id, first_name, last_name, school_email, cohort_id
        ),
        slots:slot_id (
          id, slot_date, slot_time, duration_minutes
        ),
        cohorts:cohort_id (
          id, name
        )
      `)
      .not('student_id', 'is', null)
      .not('slot_id',    'is', null);

    if (sessionsErr) {
      console.error('[interview-reminders] query error:', sessionsErr);
      return res.status(500).json({ error: sessionsErr.message });
    }

    // Fetch already-sent reminders (last 48h to cover any re-runs)
    const cutoff = new Date(now.getTime() - 48 * 3600 * 1000).toISOString();
    const { data: sentLog } = await supabase
      .from('notification_log')
      .select('metadata')
      .eq('notification_type', 'interview_reminder')
      .gte('sent_at', cutoff);

    const alreadySentSessionIds = new Set(
      (sentLog || [])
        .map(r => r.metadata?.context?.interviewSessionId)
        .filter(Boolean)
    );

    const candidates = (sessions || []).filter(s => s.students && s.slots);
    const windowEarly = WINDOW_EARLY_H * 3600 * 1000;
    const windowLate  = WINDOW_LATE_H  * 3600 * 1000;

    const fired   = [];
    const skipped = [];

    for (const session of candidates) {
      const slot    = session.slots;
      const student = session.students;

      // Parse the interview start time in Pacific
      const interviewStart = parseSlotDateTimePacific(slot.slot_date, slot.slot_time);
      if (!interviewStart) {
        skipped.push({ id: session.id, reason: 'invalid_slot_datetime' });
        continue;
      }

      const msUntil = interviewStart.getTime() - now.getTime();

      if (msUntil < windowEarly || msUntil > windowLate) {
        skipped.push({ id: session.id, reason: 'outside_window', hoursUntil: Math.round(msUntil / 3600000) });
        continue;
      }

      if (alreadySentSessionIds.has(session.id)) {
        skipped.push({ id: session.id, reason: 'already_sent' });
        continue;
      }

      if (!student.school_email) {
        console.warn(`[interview-reminders] no email for student ${student.id} (session ${session.id})`);
        skipped.push({ id: session.id, reason: 'no_student_email' });
        continue;
      }

      // Format date/time for display
      const interviewDate = formatDateLong(interviewStart);
      const interviewTime = formatTimePacific(interviewStart);
      const cohortName    = session.cohorts?.name || 'ASPIRE';

      try {
        await sendNotification('interview_reminder', {
          interviewSessionId: session.id,
          studentId:          student.id,
          cohortId:           session.cohort_id,
          firstName:          student.first_name,
          studentEmail:       student.school_email,
          interviewDate,
          interviewTime,
          cohortName,
        });

        fired.push({
          sessionId:     session.id,
          studentEmail:  student.school_email,
          interviewDate,
          interviewTime,
        });
        console.log(`[interview-reminders] sent to ${student.school_email} for session ${session.id}`);
      } catch (err) {
        console.error(`[interview-reminders] send failed for session ${session.id}:`, err);
        skipped.push({ id: session.id, reason: 'send_failed', error: err.message });
      }
    }

    return res.status(200).json({
      success:          true,
      checkedAt:        now.toISOString(),
      totalCandidates:  candidates.length,
      firedReminders:   fired.length,
      skipped:          skipped.length,
      details:          { fired, skipped: skipped.slice(0, 10) },
    });
  } catch (err) {
    console.error('[interview-reminders] unexpected error:', err);
    return res.status(500).json({ error: err.message });
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function parseSlotDateTimePacific(dateStr, timeStr) {
  if (!dateStr || !timeStr) return null;
  const naive = new Date(`${dateStr}T${timeStr}:00`);
  if (isNaN(naive.getTime())) return null;

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone:     'America/Los_Angeles',
    timeZoneName: 'shortOffset',
  }).formatToParts(naive);
  const offsetStr = parts.find(p => p.type === 'timeZoneName')?.value || 'GMT-8';
  const m = offsetStr.match(/GMT([+-]\d{1,2})(?::(\d{2}))?/);
  const offsetHours = m ? parseInt(m[1], 10) : -8;
  const offsetMins  = m && m[2] ? parseInt(m[2], 10) : 0;
  const sign = offsetHours < 0 ? '-' : '+';
  const iso = `${dateStr}T${timeStr}:00${sign}${Math.abs(offsetHours).toString().padStart(2,'0')}:${offsetMins.toString().padStart(2,'0')}`;
  return new Date(iso);
}

function formatDateLong(dt) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    weekday:  'long',
    month:    'long',
    day:      'numeric',
  }).format(dt);
}

function formatTimePacific(dt) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    hour:     'numeric',
    minute:   '2-digit',
  }).format(dt);
}
