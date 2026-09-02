// api/cron/teams-invite-reminders.js
// Runs daily at 8 AM Pacific (Mon–Fri) via Vercel Cron.
// Finds upcoming interviews with missing Teams invites and emails the interviewer.
// Escalates if a first reminder is ignored for 24h.
//
// Prerequisites: run migration_teams_reminder_tracking.sql in Supabase first.

import { createClient } from '@supabase/supabase-js';
import { sendNotification } from '../../src/lib/notifications/index.js';
import { startCronRun, finishCronRunSuccess, finishCronRunError } from '../lib/cronRuns.js';
import { isAutomationEnabled } from '../lib/automationSettings.js';
import { isAuthorizedCronRequest } from '../lib/cronAuth.js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Reminder cadence:
//   First reminder  - 24-36h before interview, teams_reminder_count === 0
//   Second reminder - 24h after first if invite still unsent, teams_reminder_count === 1
//   No more than 2 reminders per session
const MAX_REMINDERS = 2;

export default async function handler(req, res) {
  // Vercel Cron attaches CRON_SECRET in the Authorization header automatically
  if (!isAuthorizedCronRequest(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const now = new Date();
  console.log(`[teams-reminders] cron run at ${now.toISOString()}`);
  const runId = await startCronRun(supabase, 'teams-invite-reminders');

  try {
    // Automation gate - scheduled auto-send only. Default-ON / fail-open: a missing row or a read
    // failure keeps sending as today. Disabled => paused heartbeat (success) + 200, no query/send.
    const gate = await isAutomationEnabled({ supabaseAdmin: supabase, automationKey: 'teams_invite_reminders' });
    if (!gate.enabled) {
      await finishCronRunSuccess(supabase, runId, {
        skipped_disabled: true,
        automation_key: 'teams_invite_reminders',
        enabled: false,
      });
      return res.status(200).json({ skipped: true, reason: 'automation_disabled' });
    }

    const { data: sessions, error } = await supabase
      .from('interview_sessions')
      .select(`
        id,
        student_id,
        cohort_id,
        slot_id,
        teams_invite_sent_at,
        teams_reminder_sent_at,
        teams_reminder_count,
        teams_reminder_escalated,
        students:student_id (
          id, first_name, preferred_first_name, last_name, school, school_email, program_type
        ),
        slots:slot_id (
          id, slot_date, slot_time, duration_minutes, interviewer_name
        )
      `)
      .is('teams_invite_sent_at', null);

    if (error) {
      console.error('[teams-reminders] query failed:', error);
      await finishCronRunError(supabase, runId, error.message);
      return res.status(500).json({ error: error.message });
    }

    const candidates = (sessions || []).filter(s => s.slots && s.students);
    console.log(`[teams-reminders] ${candidates.length} sessions without Teams invite`);

    const fired = [];
    const skipped = [];

    for (const session of candidates) {
      const result = await processSession(session, now);
      if (result.fired) fired.push(result);
      else skipped.push(result);
    }

    await finishCronRunSuccess(supabase, runId, {
      checked_count: candidates.length,
      fired_count: fired.length,
      skipped_count: skipped.length,
      // Observability only - present solely when the settings read failed open (ran as today).
      ...(gate.source === 'fail_open' ? { settings_warning: gate.warning } : {}),
    });
    return res.status(200).json({
      success: true,
      checkedAt: now.toISOString(),
      totalCandidates: candidates.length,
      firedReminders: fired.length,
      skipped: skipped.length,
      details: { fired, skipped: skipped.slice(0, 10) },
    });
  } catch (err) {
    console.error('[teams-reminders] error:', err);
    await finishCronRunError(supabase, runId, err.message);
    return res.status(500).json({ error: err.message });
  }
}

async function processSession(session, now) {
  const slot    = session.slots;
  const student = session.students;

  const interviewStart = parseSlotDateTimePacific(slot.slot_date, slot.slot_time);
  if (!interviewStart) {
    return { fired: false, sessionId: session.id, reason: 'invalid_slot_datetime' };
  }

  const hoursUntilInterview = (interviewStart.getTime() - now.getTime()) / (1000 * 60 * 60);

  if (hoursUntilInterview < 0) {
    return { fired: false, sessionId: session.id, reason: 'in_past' };
  }
  if (hoursUntilInterview > 36) {
    return { fired: false, sessionId: session.id, reason: 'too_far_out', hoursUntilInterview: Math.round(hoursUntilInterview) };
  }
  if ((session.teams_reminder_count || 0) >= MAX_REMINDERS) {
    return { fired: false, sessionId: session.id, reason: 'max_reminders_reached' };
  }

  let notificationType;
  let isEscalation = false;

  if (session.teams_reminder_count === 0) {
    notificationType = 'teams_invite_reminder';
  } else {
    // Escalation: only fire if 24h have passed since the first reminder
    const hoursSinceFirst = session.teams_reminder_sent_at
      ? (now.getTime() - new Date(session.teams_reminder_sent_at).getTime()) / (1000 * 60 * 60)
      : Infinity;

    if (hoursSinceFirst < 24) {
      return { fired: false, sessionId: session.id, reason: 'too_soon_after_first_reminder', hoursSinceFirst: Math.round(hoursSinceFirst) };
    }
    notificationType = 'teams_invite_reminder_escalation';
    isEscalation = true;
  }

  // Look up interviewer's email by name
  let interviewerEmail = null;
  if (slot.interviewer_name) {
    const { data: ivRow } = await supabase
      .from('user_profiles')
      .select('email')
      .ilike('full_name', slot.interviewer_name)
      .maybeSingle();
    interviewerEmail = ivRow?.email?.toLowerCase() || null;
  }

  if (!interviewerEmail) {
    console.warn(`[teams-reminders] no email found for interviewer "${slot.interviewer_name}" (session ${session.id})`);
    return { fired: false, sessionId: session.id, reason: 'interviewer_email_missing' };
  }

  try {
    await sendNotification(notificationType, {
      sessionId:        session.id,
      studentId:        student.id,
      cohortId:         session.cohort_id,
      studentName:      `${student.first_name} ${student.last_name}`,
      studentSchool:    student.school,
      studentProgram:   student.program_type,
      studentEmail:     student.school_email,
      interviewDate:    slot.slot_date,
      interviewTime:    slot.slot_time,
      duration:         slot.duration_minutes,
      interviewerName:  slot.interviewer_name,
      interviewerEmail,
      hoursUntilInterview: Math.round(hoursUntilInterview),
      isEscalation,
    });

    await supabase
      .from('interview_sessions')
      .update({
        teams_reminder_sent_at:   now.toISOString(),
        teams_reminder_count:     (session.teams_reminder_count || 0) + 1,
        teams_reminder_escalated: isEscalation,
      })
      .eq('id', session.id);

    return {
      fired: true,
      sessionId: session.id,
      studentName: `${student.first_name} ${student.last_name}`,
      interviewerName: slot.interviewer_name,
      notificationType,
      hoursUntilInterview: Math.round(hoursUntilInterview),
    };
  } catch (err) {
    console.error(`[teams-reminders] send failed for session ${session.id}:`, err);
    return { fired: false, sessionId: session.id, reason: 'send_failed', error: err.message };
  }
}

// Parse 'YYYY-MM-DD' + 'HH:MM' in Pacific Time into a UTC Date object
function parseSlotDateTimePacific(dateStr, timeStr) {
  if (!dateStr || !timeStr) return null;
  const naive = new Date(`${dateStr}T${timeStr}:00`);
  if (isNaN(naive.getTime())) return null;

  // Determine Pacific offset for this specific date (handles DST)
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
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
