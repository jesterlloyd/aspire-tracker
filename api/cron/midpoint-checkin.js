// api/cron/midpoint-checkin.js
// Runs daily at 15:00 UTC (8 AM PDT / 7 AM PST) via Vercel Cron.
// Finds Active Rotation students who have reached ≥50% of their required hours
// in any cohort with midpoint_checkin_automation_enabled = true, and sends each
// one a midpoint check-in email (once per rotation).
//
// Writes to notification_log for delivery tracking, and to the communications table
// so the frontend hasSent() check (and ActionCenter act8) clears automatically.

import { createClient } from '@supabase/supabase-js';
import { sendNotification } from '../../src/lib/notifications/index.js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// notification_log.status is advanced by the Resend webhook (sent → delivered → opened →
// clicked, plus terminal bounced/complained and transient delayed). Idempotency must treat
// ALL of these as "already sent" so a delivered/opened/clicked check-in is never re-sent on
// a later daily run. Only 'failed' (Resend handoff failure) and 'queued' stay retryable.
const ALREADY_SENT_STATUSES = ['sent', 'delivered', 'opened', 'clicked', 'delayed', 'bounced', 'complained'];

export default async function handler(req, res) {
  if (req.headers['authorization'] !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const now = new Date();
  console.log(`[midpoint-checkin] cron run at ${now.toISOString()}`);

  try {
    // Fetch cohorts with automation enabled
    const { data: cohorts, error: cohortsErr } = await supabase
      .from('cohorts')
      .select('id, name')
      .eq('midpoint_checkin_automation_enabled', true);

    if (cohortsErr) {
      console.error('[midpoint-checkin] cohorts query error:', cohortsErr);
      return res.status(500).json({ error: cohortsErr.message });
    }
    if (!cohorts || cohorts.length === 0) {
      console.log('[midpoint-checkin] no cohorts with automation enabled');
      return res.status(200).json({ success: true, message: 'no enabled cohorts', fired: 0 });
    }

    const cohortIds = cohorts.map(c => c.id);

    // Fetch Active Rotation students in enabled cohorts
    const { data: students, error: studentsErr } = await supabase
      .from('students')
      .select('id, first_name, last_name, school_email, personal_email, cohort_id, approved_hours, hours_required, matched_unit_id')
      .in('cohort_id', cohortIds)
      .eq('status', 'Active Rotation');

    if (studentsErr) {
      console.error('[midpoint-checkin] students query error:', studentsErr);
      return res.status(500).json({ error: studentsErr.message });
    }

    // Fetch already-sent check-ins from notification_log (last 6 months to cover all rotations).
    // Match any non-failed/non-queued status so webhook-advanced rows (delivered/opened/...)
    // still count as already sent — this is the duplicate-send fix.
    const cutoff = new Date(now.getTime() - 180 * 24 * 3600 * 1000).toISOString();
    const { data: sentLog } = await supabase
      .from('notification_log')
      .select('student_id')
      .eq('notification_type', 'midpoint_checkin')
      .in('status', ALREADY_SENT_STATUSES)
      .gte('sent_at', cutoff);

    const alreadySentStudentIds = new Set(
      (sentLog || []).map(r => r.student_id).filter(Boolean)
    );

    // Fetch unit names for context (best-effort)
    const unitIds = [...new Set((students || []).map(s => s.matched_unit_id).filter(Boolean))];
    let unitNameMap = {};
    if (unitIds.length > 0) {
      const { data: units } = await supabase
        .from('units')
        .select('id, unit_name')
        .in('id', unitIds);
      (units || []).forEach(u => { unitNameMap[u.id] = u.unit_name; });
    }

    const cohortNameMap = Object.fromEntries(cohorts.map(c => [c.id, c.name]));

    const fired   = [];
    const skipped = [];

    for (const student of (students || [])) {
      const required  = parseFloat(student.hours_required || 0);
      const completed = parseFloat(student.approved_hours || 0);

      if (required <= 0) {
        skipped.push({ id: student.id, reason: 'no_required_hours' });
        continue;
      }
      if (completed < required * 0.5) {
        skipped.push({ id: student.id, reason: 'under_50pct', pct: Math.round((completed / required) * 100) });
        continue;
      }
      if (alreadySentStudentIds.has(student.id)) {
        skipped.push({ id: student.id, reason: 'already_sent' });
        continue;
      }

      const studentEmail = student.school_email || student.personal_email || null;
      if (!studentEmail) {
        console.warn(`[midpoint-checkin] no email for student ${student.id}`);
        skipped.push({ id: student.id, reason: 'no_email' });
        continue;
      }

      const unitName = unitNameMap[student.matched_unit_id] || null;

      try {
        await sendNotification('midpoint_checkin', {
          studentId:     student.id,
          cohortId:      student.cohort_id,
          firstName:     student.first_name || 'there',
          studentEmail,
          approvedHours: completed,
          hoursRequired: required,
          unitName,
          triggerMode:   'cron',
          templateVersion: 'v1.0',
        });

        // Log to communications so the frontend hasSent() check clears act8
        await supabase.from('communications').insert({
          student_id:     student.id,
          cohort_id:      student.cohort_id,
          type:           'midpoint_checkin',
          sent_to_email:  studentEmail,
          sent_to_name:   `${student.last_name}, ${student.first_name}`,
          sent_by:        'ASPIRE Automation',
        });

        fired.push({ studentId: student.id, studentEmail, cohortName: cohortNameMap[student.cohort_id] });
        console.log(`[midpoint-checkin] sent to ${studentEmail} (${student.first_name} ${student.last_name})`);
      } catch (err) {
        console.error(`[midpoint-checkin] send failed for student ${student.id} (${studentEmail}):`, err.message);
        skipped.push({ id: student.id, reason: 'send_failed', error: err.message });
      }
    }

    const skipReasons = skipped.reduce((acc, s) => {
      acc[s.reason] = (acc[s.reason] || 0) + 1;
      return acc;
    }, {});
    console.log(`[midpoint-checkin] SUMMARY: eligible=${(students||[]).length} sent=${fired.length} skipped=${skipped.length}`);
    console.log('[midpoint-checkin] skip breakdown:', JSON.stringify(skipReasons));

    return res.status(200).json({
      success:  true,
      checkedAt: now.toISOString(),
      cohorts:   cohorts.map(c => c.name),
      total:     (students || []).length,
      fired:     fired.length,
      skipped:   skipped.length,
      details:   { fired, skipped: skipped.slice(0, 20) },
    });
  } catch (err) {
    console.error('[midpoint-checkin] unexpected error:', err);
    return res.status(500).json({ error: err.message });
  }
}
