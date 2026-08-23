// api/send-midpoint-checkin.js
// Manual trigger: owner/admin sends a midpoint check-in to a specific student
// or previews the rendered HTML email.
//
// POST body:
//   { studentId, cohortId, preview?: boolean }
//
// Returns:
//   preview=true  → { html: "..." }
//   preview=false → { success: true, studentId, email }

import { createClient } from '@supabase/supabase-js';
import { sendNotification } from '../src/lib/notifications/index.js';
import { buildMidpointCheckinEmail } from '../src/lib/notifications/templates/midpointCheckin.js';
import { getStudentPreferredGreetingName } from '../src/lib/studentNameFormatters.js';
import { INACTIVE_MESSAGE } from './lib/activeAccount.js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Auth: require a valid Supabase session token from the calling user
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.replace('Bearer ', '').trim();
  if (!token) {
    return res.status(401).json({ error: 'Missing auth token' });
  }

  // Verify the session and check role
  const userClient = createClient(
    process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
    process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );
  const { data: { user }, error: authErr } = await userClient.auth.getUser();
  if (authErr || !user) {
    return res.status(401).json({ error: 'Invalid session' });
  }

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role, is_active')
    .eq('auth_user_id', user.id)
    .single();

  // S-05: a deactivated account keeps a valid access token until it expires.
  // Refuse it before any work is performed, so deactivation ends access at once.
  if (profile && profile.is_active === false) {
    return res.status(403).json({ error: 'Insufficient role', message: INACTIVE_MESSAGE });
  }
  if (!profile || !['owner', 'admin'].includes(profile.role)) {
    return res.status(403).json({ error: 'Insufficient role' });
  }

  const { studentId, cohortId, preview } = req.body || {};
  if (!studentId) {
    return res.status(400).json({ error: 'studentId required' });
  }

  // Fetch student
  const { data: student, error: studentErr } = await supabase
    .from('students')
    .select('id, first_name, last_name, preferred_first_name, school_email, personal_email, cohort_id, approved_hours, hours_required, matched_unit_id')
    .eq('id', studentId)
    .single();

  if (studentErr || !student) {
    return res.status(404).json({ error: 'Student not found' });
  }

  const studentEmail = student.school_email || student.personal_email || null;
  if (!studentEmail) {
    return res.status(422).json({ error: 'Student has no email address' });
  }

  // Resolve unit name
  let unitName = null;
  if (student.matched_unit_id) {
    const { data: unit } = await supabase
      .from('units')
      .select('unit_name')
      .eq('id', student.matched_unit_id)
      .single();
    unitName = unit?.unit_name || null;
  }

  const ctx = {
    firstName:     getStudentPreferredGreetingName(student),
    approvedHours: parseFloat(student.approved_hours || 0),
    hoursRequired: parseFloat(student.hours_required || 0),
    unitName,
  };

  // Preview mode: return rendered HTML without sending
  if (preview) {
    const { html } = buildMidpointCheckinEmail(ctx);
    return res.status(200).json({ html });
  }

  try {
    await sendNotification('midpoint_checkin', {
      studentId:     student.id,
      cohortId:      cohortId || student.cohort_id,
      studentEmail,
      triggerMode:   'manual',
      templateVersion: 'v1.0',
      ...ctx,
    });

    // Log to communications so hasSent() clears act8
    await supabase.from('communications').insert({
      student_id:    student.id,
      cohort_id:     cohortId || student.cohort_id,
      type:          'midpoint_checkin',
      sent_to_email: studentEmail,
      sent_to_name:  `${student.last_name}, ${student.first_name}`,
      sent_by:       profile.role === 'owner' ? 'Owner (Manual)' : 'Admin (Manual)',
    });

    console.log(`[send-midpoint-checkin] manually sent to ${studentEmail} (${student.first_name} ${student.last_name})`);
    return res.status(200).json({ success: true, studentId: student.id, email: studentEmail });
  } catch (err) {
    console.error('[send-midpoint-checkin] send failed:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
