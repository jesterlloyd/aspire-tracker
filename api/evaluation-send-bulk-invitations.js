// api/evaluation-send-bulk-invitations.js
//
// Owner/admin-authenticated endpoint for sending bulk survey invitation emails
// to students via Resend. Phase 3B.2B.
//
// Sends real emails to real students. Cannot be unsent.
//
// CRITICAL SAFETY INVARIANTS:
//   - Owner/admin only.
//   - Requires exact typed confirmation phrase: "SEND SURVEYS".
//   - Recipient emails resolved server-side only — no override from request body.
//   - Sequential sends — no Promise.all around Resend calls.
//   - Idempotency: skips any assignment already in notification_log as evaluation_invitation_sent.
//   - Per-recipient failure isolation: failures do not abort the batch.
//   - Does NOT create evaluation_assignments or evaluation_assignment_tokens.
//   - Does NOT mutate evaluation_assignments (status/sent_at set at generation time).
//   - Does NOT persist survey_url or raw token in notification_log metadata or console logs.
//   - Delivery truth is in notification_log.notification_type = 'evaluation_invitation_sent'.
//
// Batch size limit: 5 per request (Vercel default 10s timeout without explicit maxDuration).
// Add "api/evaluation-send-bulk-invitations.js": { "maxDuration": 60 } to vercel.json
// to safely raise the batch limit to 25 in a future update.
//
// POST /api/evaluation-send-bulk-invitations
// Authorization: Bearer <session-token>
//
// Body (JSON):
//   items              — required non-empty array, max 5, each: { assignment_id, student_id, survey_url }
//   instrument_slug    — required (e.g. 'casey_fink_readiness_2024')
//   timepoint          — required valid timepoint
//   expires_at         — required ISO datetime
//   confirmation_phrase — required, must exactly equal 'SEND SURVEYS'

import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import supabaseAdmin from '../lib/server/evaluation/supabase_admin.js';
import {
  buildStudentInvitationEmail,
  TIMEPOINT_LABELS,
  formatExpiresAt,
} from '../lib/server/evaluation/emailTemplates.js';

const FROM          = 'ASPIRE Program <noreply@aspire-program.com>';
const REPLY_TO      = 'JesterLloyd.Bautista@cshs.org';
const MAX_BATCH     = 5;   // conservative limit for 10s default Vercel timeout
const CONFIRMATION  = 'SEND SURVEYS';

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
    console.error('[bulk-send] unhandled exception:', err?.message || err);
    return res.status(500).json({ success: false, error: `Server error: ${err?.message || 'unknown'}` });
  }
}

async function _handler(req, res, startMs) {

  // ── 1. Auth ───────────────────────────────────────────────────────────────────
  const authHeader  = req.headers['authorization'] || '';
  const bearerToken = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!bearerToken) return res.status(401).json({ success: false, error: 'Unauthorized' });

  const userClient = createClient(
    process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
    process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY,
    { global: { headers: { Authorization: `Bearer ${bearerToken}` } } }
  );

  let user;
  try {
    const { data: { user: u }, error } = await userClient.auth.getUser();
    if (error || !u) return res.status(401).json({ success: false, error: 'Unauthorized' });
    user = u;
  } catch {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }

  const { data: profile } = await supabaseAdmin
    .from('user_profiles')
    .select('id, role, email')
    .eq('auth_user_id', user.id)
    .single();

  if (!profile || !['owner', 'admin'].includes(profile.role)) {
    return res.status(403).json({ success: false, error: 'Forbidden' });
  }

  const senderUserId    = profile.id;
  const senderEmail     = profile.email;

  // ── 2. Parse body ─────────────────────────────────────────────────────────────
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

  // Reject recipient override fields
  for (const f of ['email', 'recipient_email', 'recipient', 'to', 'cc', 'bcc']) {
    if (f in body) {
      return res.status(400).json({ success: false, error: `Field '${f}' is not permitted. Recipients are resolved server-side.` });
    }
  }

  // ── 3. Typed confirmation ─────────────────────────────────────────────────────
  if (body.confirmation_phrase !== CONFIRMATION) {
    return res.status(400).json({
      success: false,
      error:   `confirmation_phrase must be exactly "${CONFIRMATION}"`,
    });
  }

  // ── 4. Validate request-level fields ──────────────────────────────────────────
  const { items, instrument_slug, timepoint, expires_at } = body;

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ success: false, error: 'items must be a non-empty array' });
  }
  if (items.length > MAX_BATCH) {
    return res.status(400).json({ success: false, error: `items must not exceed ${MAX_BATCH} per request` });
  }
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (!isUuid(it?.assignment_id)) {
      return res.status(400).json({ success: false, error: `items[${i}].assignment_id must be a valid UUID` });
    }
    if (!isUuid(it?.student_id)) {
      return res.status(400).json({ success: false, error: `items[${i}].student_id must be a valid UUID` });
    }
    if (!it?.survey_url || typeof it.survey_url !== 'string' ||
        !it.survey_url.includes('/evaluation/readiness#t=')) {
      return res.status(400).json({ success: false, error: `items[${i}].survey_url is invalid` });
    }
  }

  if (!timepoint || !VALID_TIMEPOINTS.has(timepoint)) {
    return res.status(400).json({ success: false, error: `timepoint is required and must be one of: ${[...VALID_TIMEPOINTS].join(', ')}` });
  }

  if (!expires_at) return res.status(400).json({ success: false, error: 'expires_at is required' });
  const expiresDate = new Date(expires_at);
  if (isNaN(expiresDate.getTime())) {
    return res.status(400).json({ success: false, error: 'expires_at is not a valid datetime' });
  }

  // Resolve instrument by slug (consistent with evaluate-bulk-invitations.js pattern)
  const slugToUse = instrument_slug || 'casey_fink_readiness_2024';
  const { data: instrument, error: instrumentErr } = await supabaseAdmin
    .from('evaluation_instruments')
    .select('id, permission_status')
    .eq('slug', slugToUse)
    .single();

  if (instrumentErr || !instrument) {
    return res.status(422).json({ success: false, error: `Instrument not found: ${slugToUse}` });
  }
  if (instrument.permission_status !== 'authorized') {
    return res.status(422).json({ success: false, error: `Instrument is not authorized for administration` });
  }

  const timepointLabel = TIMEPOINT_LABELS[timepoint] || timepoint;
  const expiresAtHuman = formatExpiresAt(expires_at);

  console.log('[bulk-send] batch_start:', {
    count:          items.length,
    timepoint,
    instrument_id:  instrument.id,
    by:             senderUserId,
  });

  // ── 5. Sequential send loop ───────────────────────────────────────────────────
  const resend  = new Resend(process.env.RESEND_API_KEY);
  const sent    = [];
  const skipped = [];
  const failed  = [];

  for (const item of items) {
    const { assignment_id, student_id, survey_url } = item;

    try {
      // 5a. Idempotency: skip if already sent
      const { data: existingLog } = await supabaseAdmin
        .from('notification_log')
        .select('id')
        .eq('notification_type', 'evaluation_invitation_sent')
        .filter('metadata->>assignment_id', 'eq', assignment_id)
        .limit(1);

      if (existingLog && existingLog.length > 0) {
        skipped.push({ assignment_id, student_id, reason: 'Already sent' });
        continue;
      }

      // 5b. Assignment validation — read only, no mutation
      const { data: assignment, error: assignErr } = await supabaseAdmin
        .from('evaluation_assignments')
        .select('id, student_id, instrument_id, timepoint, status, expires_at')
        .eq('id', assignment_id)
        .single();

      if (assignErr || !assignment) {
        failed.push({ assignment_id, student_id, reason: 'Assignment not found' });
        continue;
      }
      if (assignment.student_id !== student_id) {
        failed.push({ assignment_id, student_id, reason: 'student_id mismatch' });
        continue;
      }
      if (assignment.instrument_id !== instrument.id) {
        failed.push({ assignment_id, student_id, reason: 'instrument_id mismatch' });
        continue;
      }
      if (assignment.timepoint !== timepoint) {
        failed.push({ assignment_id, student_id, reason: 'timepoint mismatch' });
        continue;
      }
      if (['revoked', 'expired'].includes(assignment.status)) {
        failed.push({ assignment_id, student_id, reason: `Assignment is ${assignment.status}` });
        continue;
      }
      if (new Date(assignment.expires_at) < new Date()) {
        failed.push({ assignment_id, student_id, reason: 'Assignment has expired' });
        continue;
      }

      // 5c. Resolve student email server-side
      const { data: student, error: studentErr } = await supabaseAdmin
        .from('students')
        .select('id, first_name, last_name, personal_email, school_email, school')
        .eq('id', student_id)
        .single();

      if (studentErr || !student) {
        failed.push({ assignment_id, student_id, reason: 'Student not found' });
        continue;
      }
      const recipientEmail = student.personal_email || student.school_email || null;
      if (!recipientEmail) {
        failed.push({ assignment_id, student_id, reason: 'Student has no email on file' });
        continue;
      }
      const studentFirstName = student.first_name || 'Student';
      const studentName      = `${student.first_name || ''} ${student.last_name || ''}`.trim();

      // 5d. Build email — survey_url used only in email body, never stored/logged
      const { subject, html } = buildStudentInvitationEmail({
        studentFirstName,
        timepointLabel,
        expiresAtHuman,
        surveyUrl: survey_url,
      });

      // 5e. Send via Resend
      let resendMessageId = null;
      let sendError       = null;

      try {
        const { data: emailData, error: emailErr } = await resend.emails.send({
          from:     FROM,
          to:       [recipientEmail],
          reply_to: REPLY_TO,
          subject,
          html,
          tags: [
            { name: 'type',          value: 'evaluation_invitation_sent' },
            { name: 'assignment_id', value: assignment_id },
          ],
        });
        if (emailErr) {
          sendError = emailErr.message || JSON.stringify(emailErr);
          console.error('[bulk-send] send_failed:', { assignment_id, student_id, error: sendError });
        } else {
          resendMessageId = emailData?.id || null;
          console.log('[bulk-send] sent:', { assignment_id, student_id, resend_message_id: resendMessageId });
        }
      } catch (err) {
        sendError = err.message;
        console.error('[bulk-send] send_threw:', { assignment_id, student_id, error: sendError });
      }

      if (sendError) {
        failed.push({ assignment_id, student_id, reason: `Resend error: ${sendError}` });
        continue;
      }

      // 5f. Audit log — survey_url and token are NOT included in metadata
      const sentAt = new Date().toISOString();
      try {
        await supabaseAdmin.from('notification_log').insert({
          notification_type: 'evaluation_invitation_sent',
          audience:          'student',
          recipient_email:   recipientEmail,
          recipient_name:    studentName,
          recipient_role:    'Student',
          subject,
          status:            'sent',
          resend_email_id:   resendMessageId,
          sent_at:           sentAt,
          student_id,
          recipient_type:    'student',
          metadata: {
            assignment_id,
            student_id,
            instrument_id:   instrument.id,
            timepoint,
            source:          'bulk_survey_send',
            sent_by_user_id: senderUserId,
            sent_by_email:   senderEmail,
            // survey_url intentionally omitted — token must not be persisted
          },
        });
      } catch (logErr) {
        // Non-fatal — email was already sent; log the failure
        console.error('[bulk-send] log_write_failed:', { assignment_id, student_id, error: logErr.message });
      }

      sent.push({ assignment_id, student_id, student_name: studentName, sent_at: sentAt });

    } catch (itemErr) {
      console.error('[bulk-send] item_error:', { assignment_id, student_id, error: itemErr?.message });
      failed.push({ assignment_id, student_id, reason: `Unexpected error: ${itemErr?.message || 'unknown'}` });
    }
  }

  const durationMs = Date.now() - startMs;
  console.log('[bulk-send] batch_complete:', {
    sent:     sent.length,
    skipped:  skipped.length,
    failed:   failed.length,
    duration_ms: durationMs,
  });

  return res.status(200).json({
    success: true,
    summary: {
      total_requested: items.length,
      total_sent:      sent.length,
      total_skipped:   skipped.length,
      total_failed:    failed.length,
    },
    sent,
    skipped,
    failed,
  });
}
