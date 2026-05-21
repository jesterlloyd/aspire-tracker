// api/cron/interview-reminders.js
// Runs daily at 17:00 UTC (9 AM PST / 10 AM PDT) via Vercel Cron.
// Finds all booked interviews scheduled for TOMORROW in Pacific time and
// sends a 24-hour reminder email to each student.
//
// PREVIOUS BUG (fixed): used a [23h, 25h] timestamp window relative to now.
// At 17:00 UTC (10 AM PDT), only interviews at exactly 23–25 hours away would
// fire.  Michael Gonzales' 11:00 AM interview was exactly 25h away; all
// afternoon interviews (11:30 AM – 2:45 PM) were 25.5–28.75h away and silently
// skipped every day.
//
// FIX: switch to a date comparison.  "Tomorrow" is computed in Pacific time so
// the window is "any interview on tomorrow's calendar date" regardless of what
// specific time the interview is scheduled.  This is the correct semantics for
// a 24-hour reminder: if your interview is anytime tomorrow, you get an email
// today.
//
// Known limitation: same-day bookings (< 24h out) will not receive this reminder.
// A future enhancement could add a separate transactional "your interview is
// confirmed" reminder triggered at booking time.

import { createClient } from '@supabase/supabase-js';
import { sendNotification } from '../../src/lib/notifications/index.js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// When (sent / eligible) < this threshold, emit a console.error so the Vercel
// function log surfaces the problem immediately.
const ALERT_THRESHOLD = 0.8;

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
          id, first_name, last_name, school_email, personal_email, cohort_id
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

    const tomorrowPacific = getTomorrowDatePacific(now);
    console.log(`[interview-reminders] target date (Pacific): ${tomorrowPacific}`);

    const candidates = (sessions || []).filter(s => s.students && s.slots);

    const fired   = [];
    const skipped = [];

    for (const session of candidates) {
      const slot    = session.slots;
      const student = session.students;

      // Only send to interviews scheduled for tomorrow (Pacific date)
      if (slot.slot_date !== tomorrowPacific) {
        skipped.push({ id: session.id, reason: 'not_tomorrow', slotDate: slot.slot_date });
        continue;
      }

      if (alreadySentSessionIds.has(session.id)) {
        skipped.push({ id: session.id, reason: 'already_sent' });
        continue;
      }

      // Prefer school_email; fall back to personal_email
      const studentEmail = student.school_email || student.personal_email || null;
      if (!studentEmail) {
        console.warn(`[interview-reminders] no email for student ${student.id} (session ${session.id})`);
        skipped.push({ id: session.id, reason: 'no_student_email', studentId: student.id });
        continue;
      }

      const interviewDate = formatSlotDate(slot.slot_date);
      const interviewTime = formatSlotTime(slot.slot_time);
      const cohortName    = session.cohorts?.name || 'ASPIRE';

      try {
        await sendNotification('interview_reminder', {
          interviewSessionId: session.id,
          studentId:          student.id,
          cohortId:           session.cohort_id,
          firstName:          student.first_name || 'there',
          studentEmail,
          interviewDate,
          interviewTime,
          cohortName,
        });

        fired.push({
          sessionId:    session.id,
          studentEmail,
          interviewDate,
          interviewTime,
        });
        console.log(`[interview-reminders] sent to ${studentEmail} (${student.first_name} ${student.last_name}) for session ${session.id}`);
      } catch (err) {
        console.error(`[interview-reminders] send failed for session ${session.id} (${studentEmail}):`, err.message);
        skipped.push({ id: session.id, reason: 'send_failed', error: err.message });
      }
    }

    // ── Summary logging ────────────────────────────────────────────────────
    const tomorrowCount = candidates.filter(s => s.slots?.slot_date === tomorrowPacific).length;
    const skipReasons   = skipped.reduce((acc, s) => {
      acc[s.reason] = (acc[s.reason] || 0) + 1;
      return acc;
    }, {});

    console.log(
      `[interview-reminders] SUMMARY: targetDate=${tomorrowPacific}` +
      ` eligible=${tomorrowCount} sent=${fired.length} skipped=${skipped.length}`
    );
    console.log('[interview-reminders] skip breakdown:', JSON.stringify(skipReasons));

    // Alert if the send rate drops below threshold (surfaces in Vercel function logs)
    if (tomorrowCount > 0 && fired.length < tomorrowCount * ALERT_THRESHOLD) {
      console.error(
        `[interview-reminders] ⚠ ALERT: low send rate — sent ${fired.length}/${tomorrowCount}` +
        ` (${Math.round((fired.length / tomorrowCount) * 100)}%). Investigate skip reasons above.`
      );
    }

    return res.status(200).json({
      success:         true,
      checkedAt:       now.toISOString(),
      targetDate:      tomorrowPacific,
      totalCandidates: candidates.length,
      eligibleTomorrow: tomorrowCount,
      firedReminders:  fired.length,
      skipped:         skipped.length,
      details:         { fired, skipped: skipped.slice(0, 20) },
    });
  } catch (err) {
    console.error('[interview-reminders] unexpected error:', err);
    return res.status(500).json({ error: err.message });
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

// Returns the YYYY-MM-DD string for tomorrow in the America/Los_Angeles timezone.
// Using noon UTC prevents date-boundary edge cases around DST transitions.
function getTomorrowDatePacific(now) {
  const todayPacific = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
  }).format(now);                                       // "2026-05-20"
  const [y, m, d] = todayPacific.split('-').map(Number);
  const tomorrowUtcNoon = new Date(Date.UTC(y, m - 1, d + 1, 12, 0, 0));
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
  }).format(tomorrowUtcNoon);                           // "2026-05-21"
}

// Format "2026-05-21" → "Wednesday, May 21" (Pacific reference, DST-safe)
function formatSlotDate(dateStr) {
  const dt = new Date(dateStr + 'T12:00:00Z'); // noon UTC avoids boundary issues
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    weekday:  'long',
    month:    'long',
    day:      'numeric',
  }).format(dt);
}

// Format "13:30" → "1:30 PM" (no timezone needed — slot_time is already Pacific)
function formatSlotTime(timeStr) {
  if (!timeStr) return 'TBD';
  const [hStr, mStr = '00'] = timeStr.split(':');
  const h    = parseInt(hStr, 10);
  const m    = parseInt(mStr, 10);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12  = h % 12 || 12;
  return `${h12}:${m.toString().padStart(2, '0')} ${ampm}`;
}
