// api/admin/resend-interview-reminders.js
// One-shot recovery endpoint: sends interview reminder emails to students whose
// reminders were missed by the cron (e.g., due to the [23h,25h] window bug that
// silently skipped afternoon interviews on 2026-05-20).
//
// Authentication: same ADMIN_NOTIFICATION_TOKEN used by send-notification.js
//
// Usage (POST):
//   curl -X POST https://aspireintelligence.app/api/admin/resend-interview-reminders \
//     -H "x-admin-token: $ADMIN_NOTIFICATION_TOKEN" \
//     -H "Content-Type: application/json" \
//     -d '{"slot_date":"2026-05-21"}'
//
// Body params (all optional):
//   slot_date   - YYYY-MM-DD: send to all booked students on this date who
//                 have NOT already received a reminder.  Defaults to tomorrow
//                 in Pacific time if omitted.
//   student_ids - array of UUIDs: if provided, only send to these students
//                 (still skips already-sent).
//   force       - boolean: if true, bypass the already-sent check and resend
//                 regardless.  Use with caution.
//
// Returns a full summary of what was sent, skipped, and failed.

import { createClient } from '@supabase/supabase-js';
import { sendNotification } from '../../src/lib/notifications/index.js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

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
  const { slot_date, student_ids, force = false } = req.body || {};

  // Determine the target date
  const targetDate = slot_date || getTomorrowDatePacific(now);
  console.log(`[resend-interview-reminders] target date: ${targetDate} force=${force} student_ids=${JSON.stringify(student_ids || 'all')}`);

  try {
    // Fetch booked slots for the target date
    const { data: slots, error: slotsErr } = await supabase
      .from('interview_slots')
      .select('id, slot_date, slot_time, duration_minutes, booked_by_student_id')
      .eq('slot_date', targetDate)
      .eq('is_booked', true);

    if (slotsErr) return res.status(500).json({ error: slotsErr.message });
    if (!slots?.length) {
      return res.status(200).json({ success: true, message: `No booked slots found for ${targetDate}`, sent: 0 });
    }

    // Optionally filter to specific student IDs
    const targetSlots = student_ids?.length
      ? slots.filter(s => student_ids.includes(s.booked_by_student_id))
      : slots;

    if (!targetSlots.length) {
      return res.status(200).json({ success: true, message: 'No matching slots for provided student_ids', sent: 0 });
    }

    // Fetch student details
    const studentIdList = [...new Set(targetSlots.map(s => s.booked_by_student_id).filter(Boolean))];
    const { data: students, error: studErr } = await supabase
      .from('students')
      .select('id, first_name, preferred_first_name, last_name, school_email, personal_email, cohort_id')
      .in('id', studentIdList);
    if (studErr) return res.status(500).json({ error: studErr.message });
    const studentById = Object.fromEntries((students || []).map(s => [s.id, s]));

    // Fetch interview_sessions to get cohort_id and session_id per slot
    const { data: sessions } = await supabase
      .from('interview_sessions')
      .select('id, student_id, cohort_id, slot_id')
      .in('slot_id', targetSlots.map(s => s.id));
    const sessionBySlotId = Object.fromEntries((sessions || []).map(s => [s.slot_id, s]));

    // Fetch cohort names
    const cohortIds = [...new Set((sessions || []).map(s => s.cohort_id).filter(Boolean))];
    const { data: cohorts } = await supabase.from('cohorts').select('id, name').in('id', cohortIds);
    const cohortById = Object.fromEntries((cohorts || []).map(c => [c.id, c]));

    // Fetch already-sent reminders (last 48h) unless force=true
    let alreadySentSessionIds = new Set();
    if (!force) {
      const cutoff = new Date(now.getTime() - 48 * 3600 * 1000).toISOString();
      const { data: sentLog } = await supabase
        .from('notification_log')
        .select('metadata')
        .eq('notification_type', 'interview_reminder')
        .gte('sent_at', cutoff);
      alreadySentSessionIds = new Set(
        (sentLog || []).map(r => r.metadata?.context?.interviewSessionId).filter(Boolean)
      );
    }

    const sent    = [];
    const skipped = [];
    const failed  = [];

    for (const slot of targetSlots) {
      const student = studentById[slot.booked_by_student_id];
      if (!student) { skipped.push({ slotId: slot.id, reason: 'student_not_found' }); continue; }

      const session = sessionBySlotId[slot.id];
      if (!session) { skipped.push({ slotId: slot.id, reason: 'no_session', studentId: student.id }); continue; }

      if (!force && alreadySentSessionIds.has(session.id)) {
        skipped.push({ slotId: slot.id, reason: 'already_sent', studentName: `${student.first_name} ${student.last_name}` });
        continue;
      }

      const studentEmail = student.school_email || student.personal_email || null;
      if (!studentEmail) {
        skipped.push({ slotId: slot.id, reason: 'no_email', studentName: `${student.first_name} ${student.last_name}` });
        continue;
      }

      const interviewDate = formatSlotDate(slot.slot_date);
      const interviewTime = formatSlotTime(slot.slot_time);
      const cohortName    = cohortById[session.cohort_id]?.name || 'ASPIRE';

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
        sent.push({ studentName: `${student.first_name} ${student.last_name}`, email: studentEmail, time: slot.slot_time });
        console.log(`[resend-interview-reminders] sent to ${studentEmail} (${student.first_name} ${student.last_name}) slot=${slot.slot_time}`);
      } catch (err) {
        console.error(`[resend-interview-reminders] send failed for ${studentEmail}:`, err.message);
        failed.push({ studentName: `${student.first_name} ${student.last_name}`, email: studentEmail, error: err.message });
      }
    }

    console.log(`[resend-interview-reminders] done: sent=${sent.length} skipped=${skipped.length} failed=${failed.length}`);
    return res.status(200).json({ success: true, targetDate, sent, skipped, failed });

  } catch (err) {
    console.error('[resend-interview-reminders] unexpected error:', err);
    return res.status(500).json({ error: err.message });
  }
}

function getTomorrowDatePacific(now) {
  const todayPacific = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(now);
  const [y, m, d] = todayPacific.split('-').map(Number);
  const tomorrowUtcNoon = new Date(Date.UTC(y, m - 1, d + 1, 12, 0, 0));
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(tomorrowUtcNoon);
}

function formatSlotDate(dateStr) {
  const dt = new Date(dateStr + 'T12:00:00Z');
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles', weekday: 'long', month: 'long', day: 'numeric',
  }).format(dt);
}

function formatSlotTime(timeStr) {
  if (!timeStr) return 'TBD';
  const [hStr, mStr = '00'] = timeStr.split(':');
  const h = parseInt(hStr, 10), m = parseInt(mStr, 10);
  return `${h % 12 || 12}:${m.toString().padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
}
