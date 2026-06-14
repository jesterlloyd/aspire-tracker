// api/evaluation-send-preceptor-invitations.js
//
// Owner/Admin-only manual send flow for the ASPIRE Preceptor Student Progress &
// Readiness Feedback survey (slug: preceptor_progress). This is an Evaluation-specific
// flow — it does NOT use or modify the ASPIRE Connect → Outreach "Send to many" path,
// nor the Casey-Fink/student send endpoints.
//
// For each selected student (max 5), this endpoint resolves the student's preceptor,
// creates a preceptor evaluation assignment (respondent_type = 'preceptor') in a
// sendable state, generates a single-use token (raw token never leaves the server),
// emails the resolved preceptor via Resend, and records the send in notification_log.
//
// Subject (student_id) vs respondent (resolved preceptor):
//   - student_id remains the SUBJECT of the assignment.
//   - respondent_* identify the responding preceptor (PS-2a columns).
//
// Feedback period → timepoint mapping (no schema migration is permitted in PS-2b; the
// timepoint CHECK constraint does not allow the literal period strings):
//   midpoint → midpoint, end_of_rotation → post_rotation, other_interim → custom.
// The true period is stored in assignment.notes and carried in the response payload.
//
// Idempotency: a student is skipped when a non-revoked, non-expired preceptor_progress
// assignment already exists for (student, cohort, period). The uq_assignment UNIQUE
// constraint is the database backstop.
//
// CRITICAL SAFETY INVARIANTS:
//   - Owner/Admin only.
//   - Requires exact typed confirmation phrase: "SEND FEEDBACK REQUESTS".
//   - Recipient emails resolved server-side only — no override from request body.
//   - Sequential sends — no Promise.all around Resend calls.
//   - Per-recipient failure isolation: failures do not abort the batch.
//   - Raw token and survey URL are NEVER persisted (no DB column, no log, no metadata).
//
// POST /api/evaluation-send-preceptor-invitations
// Authorization: Bearer <session-token>
// Body: { items: [{ student_id }], period, confirmation_phrase }

import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import supabaseAdmin from '../lib/server/evaluation/supabase_admin.js';
import { generateToken } from '../lib/server/evaluation/tokens.js';
import {
  buildPreceptorInvitationEmail,
  formatExpiresAt,
} from '../lib/server/evaluation/preceptorEmailTemplates.js';
import {
  FEEDBACK_PERIODS,
  PERIOD_TO_TIMEPOINT,
  PERIOD_LABELS,
} from '../lib/server/evaluation/preceptor_progress_validation.js';

const INSTRUMENT_SLUG = 'preceptor_progress';
const FROM            = 'ASPIRE Program <noreply@aspire-program.com>';
const REPLY_TO        = 'JesterLloyd.Bautista@cshs.org';
const MAX_BATCH       = 5;
const CONFIRMATION    = 'SEND FEEDBACK REQUESTS';
const WINDOW_DAYS     = 28;
const TOKEN_GRACE_DAYS = 2;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isUuid(v) { return typeof v === 'string' && UUID_PATTERN.test(v); }

// Conservative email shape check. Rejects empty, whitespace, and obviously invalid.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function isSafeEmail(v) {
  return typeof v === 'string' && v.trim().length > 0 && v.trim().length <= 254 && EMAIL_PATTERN.test(v.trim());
}

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
    console.error('[preceptor-send] unhandled exception:', err?.message || err);
    return res.status(500).json({ success: false, error: `Server error: ${err?.message || 'unknown'}` });
  }
}

async function _handler(req, res, startMs) {

  // ── 1. Auth ──────────────────────────────────────────────────────────────────
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
  const senderUserId = profile.id;   // user_profiles.id — FK target for assigned_by
  const senderEmail  = profile.email;

  // ── 2. Parse + validate body ───────────────────────────────────────────────────
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

  // Reject recipient override fields — recipients are resolved server-side only.
  for (const f of ['email', 'recipient_email', 'recipient', 'to', 'cc', 'bcc', 'respondent_email']) {
    if (f in body) {
      return res.status(400).json({ success: false, error: `Field '${f}' is not permitted. Recipients are resolved server-side.` });
    }
  }

  if (body.confirmation_phrase !== CONFIRMATION) {
    return res.status(400).json({ success: false, error: `confirmation_phrase must be exactly "${CONFIRMATION}"` });
  }

  const { items, period } = body;
  if (!FEEDBACK_PERIODS.includes(period)) {
    return res.status(400).json({ success: false, error: `period must be one of: ${FEEDBACK_PERIODS.join(', ')}` });
  }
  const timepoint = PERIOD_TO_TIMEPOINT[period];

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ success: false, error: 'items must be a non-empty array' });
  }
  if (items.length > MAX_BATCH) {
    return res.status(400).json({ success: false, error: `items must not exceed ${MAX_BATCH} per request` });
  }
  for (let i = 0; i < items.length; i++) {
    if (!isUuid(items[i]?.student_id)) {
      return res.status(400).json({ success: false, error: `items[${i}].student_id must be a valid UUID` });
    }
  }

  // ── 3. Resolve + authorize instrument ──────────────────────────────────────────
  const { data: instrument, error: instrumentErr } = await supabaseAdmin
    .from('evaluation_instruments')
    .select('id, permission_status')
    .eq('slug', INSTRUMENT_SLUG)
    .single();

  if (instrumentErr || !instrument) {
    return res.status(422).json({ success: false, error: `Instrument not found: ${INSTRUMENT_SLUG}` });
  }
  if (instrument.permission_status !== 'authorized') {
    return res.status(422).json({ success: false, error: 'Instrument is not authorized for administration' });
  }

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + WINDOW_DAYS);
  const tokenExpiresAt = new Date(expiresAt.getTime() + TOKEN_GRACE_DAYS * 24 * 60 * 60 * 1000);
  const expiresAtHuman = formatExpiresAt(expiresAt.toISOString());
  const periodLabel = PERIOD_LABELS[period];

  // Derive base URL from forwarded headers (Preview vs Production correctness).
  const proto   = req.headers['x-forwarded-proto'] || 'https';
  const host    = req.headers['x-forwarded-host'] || req.headers['host'];
  const baseUrl = host ? `${proto}://${host}` : (process.env.VITE_APP_URL || 'https://aspire-tracker.vercel.app');

  console.log('[preceptor-send] batch_start:', {
    count: items.length, period, instrument_id: instrument.id, by: senderUserId,
  });

  const resend  = new Resend(process.env.RESEND_API_KEY);
  const sent    = [];
  const skipped = [];
  const failed  = [];

  // ── 4. Sequential per-student loop ─────────────────────────────────────────────
  for (const item of items) {
    const studentId = item.student_id;
    let createdAssignmentId = null;

    try {
      // 4a. Load student (subject) + preceptor link fields.
      const { data: student, error: studentErr } = await supabaseAdmin
        .from('students')
        .select('id, first_name, last_name, cohort_id, approved_hours, preceptor_id, preceptor_email, matched_preceptor')
        .eq('id', studentId)
        .single();

      if (studentErr || !student) {
        failed.push({ student_id: studentId, reason: 'Student not found' });
        continue;
      }
      const cohortId = student.cohort_id;
      if (!cohortId || !isUuid(cohortId)) {
        failed.push({ student_id: studentId, reason: 'Student has no cohort' });
        continue;
      }
      const studentName = `${student.first_name || ''} ${student.last_name || ''}`.trim() || 'the student';

      // 4b. Resolve preceptor (normalized first, free-text fallback).
      let respondentPreceptorId = null;
      let respondentName = '';
      let respondentEmail = '';
      let preceptorActive = true;

      if (student.preceptor_id) {
        const { data: prec } = await supabaseAdmin
          .from('preceptors')
          .select('id, full_name, email, unit_name, is_active')
          .eq('id', student.preceptor_id)
          .single();
        if (prec) {
          respondentPreceptorId = prec.id;
          respondentName  = (prec.full_name || '').trim();
          respondentEmail = (prec.email || '').trim();
          preceptorActive = prec.is_active !== false;
        }
      }
      // Free-text fallback when no normalized record/email.
      if (!respondentEmail) {
        respondentName  = respondentName || (student.matched_preceptor || '').trim();
        respondentEmail = (student.preceptor_email || '').trim();
        // No is_active flag exists for free-text preceptors; treated as active.
      }

      // 4c. Missing / inactive / invalid-email handling — skip with a clear reason.
      if (!respondentName && !respondentEmail) {
        skipped.push({ student_id: studentId, student_name: studentName, reason: 'No preceptor on file' });
        continue;
      }
      if (!preceptorActive) {
        skipped.push({ student_id: studentId, student_name: studentName, reason: 'Preceptor is inactive' });
        continue;
      }
      if (!isSafeEmail(respondentEmail)) {
        skipped.push({ student_id: studentId, student_name: studentName, reason: 'Preceptor email is missing or invalid' });
        continue;
      }
      respondentEmail = respondentEmail.trim();

      // 4d. Idempotency: block when a live preceptor_progress assignment already exists
      //     for (student, cohort, period). Excludes revoked/expired.
      const { data: existing, error: dupErr } = await supabaseAdmin
        .from('evaluation_assignments')
        .select('id, status')
        .eq('instrument_id', instrument.id)
        .eq('student_id', studentId)
        .eq('cohort_id', cohortId)
        .eq('timepoint', timepoint)
        .eq('respondent_type', 'preceptor')
        .not('status', 'in', '(revoked,expired)')
        .limit(1);

      if (dupErr) {
        failed.push({ student_id: studentId, student_name: studentName, reason: 'Failed to check for existing request' });
        continue;
      }
      if (existing && existing.length > 0) {
        skipped.push({
          student_id: studentId,
          student_name: studentName,
          reason: existing[0].status === 'completed'
            ? 'Feedback already submitted for this period'
            : 'An active feedback request already exists for this period',
        });
        continue;
      }

      // 4e. Create the assignment in a sendable state (status = 'sent').
      const nowIso = new Date().toISOString();
      const approvedHoursSnapshot = parseFloat(student.approved_hours || 0) || 0;
      const { data: assignment, error: assignErr } = await supabaseAdmin
        .from('evaluation_assignments')
        .insert({
          instrument_id:                instrument.id,
          student_id:                   studentId,
          cohort_id:                    cohortId,
          timepoint,
          assigned_by:                  senderUserId,
          status:                       'sent',
          invited_at:                   nowIso,
          sent_at:                      nowIso,
          expires_at:                   expiresAt.toISOString(),
          approved_hours_at_invitation: approvedHoursSnapshot,
          respondent_type:              'preceptor',
          respondent_preceptor_id:      respondentPreceptorId,
          respondent_email:             respondentEmail,
          respondent_name:              respondentName || null,
          notes:                        `preceptor_progress:${period}`,
        })
        .select('id')
        .single();

      if (assignErr || !assignment) {
        // uq_assignment violation or other insert failure.
        const msg = (assignErr?.message || '').toLowerCase();
        if (msg.includes('uq_assignment') || msg.includes('duplicate') || assignErr?.code === '23505') {
          skipped.push({ student_id: studentId, student_name: studentName, reason: 'A feedback request already exists for this period' });
        } else {
          failed.push({ student_id: studentId, student_name: studentName, reason: 'Failed to create feedback request' });
        }
        continue;
      }
      createdAssignmentId = assignment.id;

      // 4f. Generate token. Raw token lives only in this function scope.
      const { raw: rawToken, hash: tokenHash, hashPrefix: tokenHashPrefix } = generateToken();
      const { error: tokenErr } = await supabaseAdmin
        .from('evaluation_assignment_tokens')
        .insert({
          assignment_id:     assignment.id,
          token_hash:        tokenHash,
          token_hash_prefix: tokenHashPrefix,
          expires_at:        tokenExpiresAt.toISOString(),
        });

      if (tokenErr) {
        // Rollback the orphaned assignment.
        const { error: rbErr } = await supabaseAdmin
          .from('evaluation_assignments').delete().eq('id', assignment.id);
        if (rbErr) console.error('[preceptor-send] ROLLBACK FAILED — orphaned assignment:', assignment.id, rbErr.message);
        failed.push({ student_id: studentId, student_name: studentName, reason: 'Failed to issue feedback token' });
        continue;
      }

      // 4g. Build the survey URL — raw token only in the email, never stored/logged.
      const surveyUrl = `${baseUrl}/evaluation/feedback#t=${rawToken}`;
      const preceptorFirstName = respondentName ? respondentName.split(/\s+/)[0] : '';

      const { subject, html } = buildPreceptorInvitationEmail({
        period,
        studentName,
        preceptorFirstName,
        expiresAtHuman,
        surveyUrl,
      });

      // 4h. Send via Resend.
      let resendMessageId = null;
      let sendError = null;
      try {
        const { data: emailData, error: emailErr } = await resend.emails.send({
          from:     FROM,
          to:       [respondentEmail],
          reply_to: REPLY_TO,
          subject,
          html,
          tags: [
            { name: 'type',          value: 'preceptor_feedback_request_sent' },
            { name: 'assignment_id', value: assignment.id },
          ],
        });
        if (emailErr) {
          sendError = emailErr.message || JSON.stringify(emailErr);
        } else {
          resendMessageId = emailData?.id || null;
        }
      } catch (err) {
        sendError = err.message;
      }

      if (sendError) {
        // Email failed: revoke the assignment so it does not linger as a live invite.
        await supabaseAdmin.from('evaluation_assignments')
          .update({ status: 'revoked', revoked_at: new Date().toISOString(), updated_at: new Date().toISOString() })
          .eq('id', assignment.id);
        await supabaseAdmin.from('evaluation_assignment_tokens')
          .update({ revoked_at: new Date().toISOString() })
          .eq('assignment_id', assignment.id);
        console.error('[preceptor-send] send_failed (assignment revoked):', { assignment_id: assignment.id, error: sendError });
        failed.push({ student_id: studentId, student_name: studentName, reason: `Email failed to send` });
        continue;
      }

      // 4i. Audit log — survey_url and token are NOT included.
      const sentAtIso = new Date().toISOString();
      try {
        await supabaseAdmin.from('notification_log').insert({
          notification_type: 'preceptor_feedback_request_sent',
          audience:          'preceptor',
          recipient_email:   respondentEmail,
          recipient_name:    respondentName || null,
          recipient_role:    'Preceptor',
          subject,
          status:            'sent',
          resend_email_id:   resendMessageId,
          sent_at:           sentAtIso,
          student_id:        studentId,
          recipient_type:    'preceptor',
          metadata: {
            assignment_id:           assignment.id,
            student_id:              studentId,
            instrument_id:           instrument.id,
            period,
            timepoint,
            respondent_preceptor_id: respondentPreceptorId,
            source:                  'preceptor_feedback_send',
            sent_by_user_id:         senderUserId,
            sent_by_email:           senderEmail,
            // survey_url / token intentionally omitted — must not be persisted.
          },
        });
      } catch (logErr) {
        console.error('[preceptor-send] log_write_failed:', { assignment_id: assignment.id, error: logErr.message });
      }

      console.log('[preceptor-send] sent:', {
        assignment_id: assignment.id, student_id: studentId,
        token_hash_prefix: tokenHashPrefix, period,
      });
      sent.push({
        assignment_id: assignment.id,
        student_id:    studentId,
        student_name:  studentName,
        preceptor_name: respondentName || null,
        period_label:  periodLabel,
        sent_at:       sentAtIso,
      });

    } catch (itemErr) {
      console.error('[preceptor-send] item_error:', { student_id: studentId, error: itemErr?.message });
      // Best-effort rollback if an assignment was created before the failure.
      if (createdAssignmentId) {
        await supabaseAdmin.from('evaluation_assignments').delete().eq('id', createdAssignmentId).then(() => {}, () => {});
      }
      failed.push({ student_id: studentId, reason: `Unexpected error` });
    }
  }

  const durationMs = Date.now() - startMs;
  console.log('[preceptor-send] batch_complete:', {
    sent: sent.length, skipped: skipped.length, failed: failed.length, duration_ms: durationMs,
  });

  return res.status(200).json({
    success: true,
    summary: {
      total_requested: items.length,
      total_sent:      sent.length,
      total_skipped:   skipped.length,
      total_failed:    failed.length,
    },
    sent, skipped, failed,
  });
}
