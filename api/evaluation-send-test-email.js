// api/evaluation-send-test-email.js
//
// Owner/admin-authenticated endpoint for sending a test survey invitation email.
// Phase 3B.1: sends ONE email to the authenticated Owner's own inbox only.
//
// Purpose: allows the Owner to verify the email template, Resend configuration,
// sender identity, and survey URL before student-facing sends are enabled.
//
// INVARIANTS:
//   - Sends only to the authenticated user's email (never to a student or override recipient).
//   - Does NOT update evaluation_assignments status, sent_at, delivered_at, or any field.
//   - Does NOT update students.last_contacted_at or any contact/student timestamp.
//   - Does NOT trigger cron, scheduling, or downstream actions.
//   - Writes ONE notification_log row with notification_type='evaluation_invitation_test'.
//   - Raw token (in survey_url hash fragment) is NEVER logged in console or stored in DB.
//
// POST /api/evaluation-send-test-email
// Authorization: Bearer <session-token>
//
// Body (JSON):
//   assignment_id  — required UUID of the evaluation_assignment
//   survey_url     — required raw survey URL (contains #t= token in hash fragment)
//   student_name   — required student name for the greeting
//   timepoint      — required timepoint key
//   expires_at     — required ISO datetime
//
// Success (200):
//   { success: true, message, resend_message_id, notification_log_id }
//
// Errors:
//   400 — validation failure
//   401 — missing or invalid session
//   403 — authenticated but not owner or admin
//   404 — assignment not found
//   500 — server error, Resend failure, or Owner email not configured

import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import supabaseAdmin from '../lib/server/evaluation/supabase_admin.js';
import {
  buildStudentInvitationTestEmail,
  TIMEPOINT_LABELS,
  formatExpiresAt,
  validateDraftOverrides,
} from '../lib/server/evaluation/emailTemplates.js';

// Sender: use the confirmed working domain pattern.
// aspire@aspire-program.com is not confirmed as a verified Resend sender in this
// project. The existing from-address noreply@aspire-program.com is used in all
// production Resend integrations (coordinator digest, interview reminders) and is
// the safe fallback. Name is changed to 'ASPIRE Program' for student-facing context.
const FROM      = 'ASPIRE at Cedars-Sinai <noreply@aspire-program.com>';
const REPLY_TO  = 'JesterLloyd.Bautista@cshs.org';

const VALID_TIMEPOINTS = new Set([
  'baseline', 'early_rotation_baseline', 'midpoint', 'post_rotation', 'custom',
]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isUuid(v) { return typeof v === 'string' && UUID_PATTERN.test(v); }

function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
}

export default async function handler(req, res) {
  setCorsHeaders(res);
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });

  const startMs = Date.now();

  try {
    return await _handler(req, res, startMs);
  } catch (err) {
    console.error('[evaluation-send-test] unhandled exception:', err?.message || err);
    return res.status(500).json({ success: false, error: `Server error: ${err?.message || 'unknown'}` });
  }
}

async function _handler(req, res, startMs) {

  // ── 1. Auth: Bearer session token ─────────────────────────────────────────
  const authHeader  = req.headers['authorization'] || '';
  const bearerToken = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!bearerToken) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }

  const userClient = createClient(
    process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
    process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY,
    { global: { headers: { Authorization: `Bearer ${bearerToken}` } } }
  );

  let user;
  try {
    const { data: { user: u }, error: authErr } = await userClient.auth.getUser();
    if (authErr || !u) return res.status(401).json({ success: false, error: 'Unauthorized' });
    user = u;
  } catch {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }

  // ── 2. Role check + resolve Owner email ───────────────────────────────────
  const { data: profile } = await supabaseAdmin
    .from('user_profiles')
    .select('id, role, email')
    .eq('auth_user_id', user.id)
    .single();

  if (!profile || !['owner', 'admin'].includes(profile.role)) {
    return res.status(403).json({ success: false, error: 'Forbidden' });
  }

  // The test email goes ONLY to the authenticated user's own email address.
  // No recipient override is accepted from the request body.
  const ownerEmail = profile.email;
  if (!ownerEmail || typeof ownerEmail !== 'string' || !ownerEmail.includes('@')) {
    return res.status(500).json({
      success: false,
      error: 'Owner email is not configured in user_profiles. Update your profile email before sending test emails.',
    });
  }

  console.log('[evaluation-send-test] handler_entry:', {
    assignment_id: '(see body validation below)',
    by: profile.id,
  });

  // ── 3. Parse and validate body ────────────────────────────────────────────
  let body;
  try {
    const raw = req.body;
    body = (raw && typeof raw === 'object') ? raw : JSON.parse(raw);
  } catch {
    return res.status(400).json({ success: false, error: 'Invalid request body' });
  }
  if (!body || typeof body !== 'object') {
    return res.status(400).json({ success: false, error: 'Invalid request body' });
  }

  // Reject any attempt to override the recipient — this endpoint sends only to the Owner.
  // The presence of 'recipient', 'recipientEmail', or 'to' in the body is a protocol error.
  if ('recipient' in body || 'recipientEmail' in body || 'to' in body) {
    return res.status(400).json({
      success: false,
      error: 'Recipient override is not permitted. The test email is sent only to the authenticated user.',
    });
  }

  const { assignment_id, survey_url, student_name, timepoint, expires_at, subject_override, body_override } = body;

  // Optional editable-draft overrides (Send-to-One). Absent → fixed template (unchanged behavior).
  const draftCheck = validateDraftOverrides({ subject_override, body_override });
  if (!draftCheck.ok) return res.status(400).json({ success: false, error: draftCheck.error });

  if (!assignment_id) return res.status(400).json({ success: false, error: 'assignment_id is required' });
  if (!isUuid(assignment_id)) return res.status(400).json({ success: false, error: 'assignment_id must be a valid UUID' });

  if (!survey_url || typeof survey_url !== 'string') {
    return res.status(400).json({ success: false, error: 'survey_url is required' });
  }
  if (!survey_url.includes('/evaluation/readiness#t=')) {
    return res.status(400).json({
      success: false,
      error: 'survey_url does not match the expected evaluation URL pattern',
    });
  }

  if (!student_name || typeof student_name !== 'string' || !student_name.trim()) {
    return res.status(400).json({ success: false, error: 'student_name is required' });
  }
  const studentFirstName = student_name.trim().split(' ')[0];

  if (!timepoint || !VALID_TIMEPOINTS.has(timepoint)) {
    return res.status(400).json({
      success: false,
      error: `timepoint is required and must be one of: ${[...VALID_TIMEPOINTS].join(', ')}`,
    });
  }

  if (!expires_at) return res.status(400).json({ success: false, error: 'expires_at is required' });
  const expiresDate = new Date(expires_at);
  if (isNaN(expiresDate.getTime())) {
    return res.status(400).json({ success: false, error: 'expires_at is not a valid datetime' });
  }

  // ── 4. Confirm assignment exists (read-only — no mutation) ────────────────
  const { data: assignment, error: assignErr } = await supabaseAdmin
    .from('evaluation_assignments')
    .select('id, student_id, cohort_id')
    .eq('id', assignment_id)
    .single();

  if (assignErr || !assignment) {
    return res.status(404).json({ success: false, error: 'Assignment not found' });
  }

  console.log('[evaluation-send-test] handler_entry:', {
    assignment_id,
    by: profile.id,
  });

  // ── 5. Build email ─────────────────────────────────────────────────────────
  const timepointLabel = TIMEPOINT_LABELS[timepoint] || timepoint;
  const expiresAtHuman = formatExpiresAt(expires_at);

  const { subject, html } = buildStudentInvitationTestEmail({
    studentFirstName,
    timepointLabel,
    expiresAtHuman,
    surveyUrl: survey_url,
    subjectOverride: subject_override,
    bodyOverride:    body_override,
  });

  // ── 6. Send via Resend ─────────────────────────────────────────────────────
  // The survey_url (containing the raw token in its hash fragment) is passed to
  // the template builder and transmitted in the email body. It is not logged in
  // console anywhere in this file. The assignment_id is sufficient for diagnostics.
  const resend = new Resend(process.env.RESEND_API_KEY);

  let resendMessageId = null;
  let sendError       = null;
  let sendStatus      = 'sent';

  try {
    const { data: emailData, error: emailErr } = await resend.emails.send({
      from:     FROM,
      to:       [ownerEmail],
      reply_to: REPLY_TO,
      subject,
      html,
      tags: [
        { name: 'type',          value: 'evaluation_invitation_test' },
        { name: 'assignment_id', value: assignment_id },
      ],
    });

    if (emailErr) {
      sendStatus = 'failed';
      sendError  = emailErr.message || JSON.stringify(emailErr);
      console.error('[evaluation-send-test] failed:', { assignment_id, error: sendError });
    } else {
      resendMessageId = emailData?.id || null;
      console.log('[evaluation-send-test] sent:', { assignment_id, resend_message_id: resendMessageId });
    }
  } catch (err) {
    sendStatus = 'failed';
    sendError  = err.message;
    console.error('[evaluation-send-test] failed:', { assignment_id, error: sendError });
  }

  if (sendStatus === 'failed') {
    const durationMs = Date.now() - startMs;
    console.log('[evaluation-send-test] complete:', { assignment_id, duration_ms: durationMs, status: 'failed' });
    return res.status(500).json({
      success: false,
      error: `Failed to send email via Resend: ${sendError}`,
    });
  }

  // ── 7. Audit log to notification_log ──────────────────────────────────────
  // notification_type 'evaluation_invitation_test' is distinct from the future
  // production 'evaluation_invitation_sent' type to be added in Phase 3B.2.
  //
  // survey_url is NOT stored in metadata per the project safety policy —
  // URLs containing raw tokens should not be persisted in database records.
  // The assignment_id and student_id are sufficient for audit traceability.
  let notificationLogId = null;
  try {
    const { data: logRow, error: logErr } = await supabaseAdmin
      .from('notification_log')
      .insert({
        notification_type: 'evaluation_invitation_test',
        audience:          'owner_test',
        recipient_email:   ownerEmail,
        recipient_role:    profile.role,
        student_id:        assignment.student_id,
        cohort_id:         assignment.cohort_id,
        recipient_type:    'student',
        subject,
        resend_email_id:   resendMessageId,
        status:            sendStatus,
        metadata: {
          source_assignment_id: assignment_id,
          student_id:           assignment.student_id,
          timepoint,
          test_recipient:       ownerEmail,
          sent_by:              profile.id,
          source:               'bulk_test',
        },
      })
      .select('id')
      .single();

    if (logErr) {
      console.error('[evaluation-send-test] log write failed (non-fatal):', logErr.message);
    } else {
      notificationLogId = logRow?.id || null;
    }
  } catch (logException) {
    console.error('[evaluation-send-test] log write threw (non-fatal):', logException.message);
  }

  const durationMs = Date.now() - startMs;
  console.log('[evaluation-send-test] complete:', { assignment_id, duration_ms: durationMs });

  return res.status(200).json({
    success:            true,
    message:            `Test email sent to ${ownerEmail}`,
    resend_message_id:  resendMessageId,
    notification_log_id: notificationLogId,
  });
}
