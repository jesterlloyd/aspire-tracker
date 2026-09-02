// lib/server/evaluation/preceptorSend.js
//
// Shared server-side send core for the ASPIRE Preceptor Student Progress & Readiness
// Feedback survey. Extracted verbatim from the per-student block of
// api/evaluation-send-preceptor-invitations.js (PS-2b) so the PS-2b manual bulk send and
// the PS-3b queue-release endpoint use IDENTICAL send behavior.
//
// SECURITY INVARIANTS (preserved from PS-2b):
//   - The recipient is ALWAYS resolved server-side from the student. This function takes a
//     studentId, never an email - it structurally cannot accept a recipient override.
//   - Raw token and survey URL are never persisted (no DB column, no log, no metadata).
//   - On email failure the assignment + token are revoked.
//
// The ONLY per-caller differences are `source` (notification_log.metadata.source) and
// `notesValue` (evaluation_assignments.notes), so manual PS-2b vs PS-3b queue-release sends
// are distinguishable without any schema change.

import { Resend } from 'resend';
import { archiveSentMessage } from '../../../api/lib/messageArchive.js';
import supabaseAdmin from './supabase_admin.js';
import { generateToken } from './tokens.js';
import { buildPreceptorInvitationEmail } from './preceptorEmailTemplates.js';

const FROM     = 'ASPIRE at Cedars-Sinai <noreply@aspire-program.com>';
const REPLY_TO = 'JesterLloyd.Bautista@cshs.org';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isUuid(v) { return typeof v === 'string' && UUID_PATTERN.test(v); }

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function isSafeEmail(v) {
  return typeof v === 'string' && v.trim().length > 0 && v.trim().length <= 254 && EMAIL_PATTERN.test(v.trim());
}

// Process exactly one preceptor send for one student. Resolves the preceptor server-side,
// enforces idempotency, creates the assignment + token, sends the email, and writes
// notification_log - all the PS-2b steps 4a–4i. Returns a normalized result:
//
//   { status: 'sent',    assignment_id, student_id, student_name, preceptor_name, period_label, sent_at }
//   { status: 'skipped', student_id, student_name, reason }
//   { status: 'failed',  student_id, student_name?, reason }
//
// ctx:
//   instrument       - { id }                  (already resolved + authorized by the caller)
//   studentId        - UUID                     (recipient is derived from this; NO email param)
//   period           - 'midpoint'|'end_of_rotation'|'other_interim'
//   timepoint        - mapped evaluation_assignments.timepoint
//   periodLabel      - human label
//   expiresAt        - Date (assignment response window)
//   tokenExpiresAt   - Date (token security expiry)
//   expiresAtHuman   - formatted date string for the email
//   baseUrl          - origin for the survey URL
//   senderUserId     - user_profiles.id (assigned_by + audit)
//   senderEmail      - sender email (audit only)
//   source           - notification_log.metadata.source marker
//   notesValue       - evaluation_assignments.notes value
//   logPrefix        - console log prefix (default '[preceptor-send]')
export async function processPreceptorSend(ctx) {
  const {
    instrument, studentId, period, timepoint, periodLabel,
    expiresAt, tokenExpiresAt, expiresAtHuman, baseUrl,
    senderUserId, senderEmail, source, notesValue,
    // PRECEPTOR-ROUTE-1 (Owner decision 2026-08-10): optional redirect of THIS send to
    // another of the student's ACTIVE canonical preceptor assignments. A preceptors.id,
    // never an email - the recipient is still resolved server-side from canonical rows,
    // so this is a selection among server-validated options, not a recipient override.
    redirectPreceptorId = null,
    logPrefix = '[preceptor-send]',
  } = ctx;

  const resend = new Resend(process.env.RESEND_API_KEY);

  // 4a. Load student (subject) + preceptor link fields.
  const { data: student, error: studentErr } = await supabaseAdmin
    .from('students')
    .select('id, first_name, preferred_first_name, last_name, cohort_id, approved_hours, preceptor_id, preceptor_email, matched_preceptor')
    .eq('id', studentId)
    .single();

  if (studentErr || !student) {
    return { status: 'failed', student_id: studentId, reason: 'Student not found' };
  }
  const cohortId = student.cohort_id;
  if (!cohortId || !isUuid(cohortId)) {
    return { status: 'failed', student_id: studentId, reason: 'Student has no cohort' };
  }
  const studentName = `${student.first_name || ''} ${student.last_name || ''}`.trim() || 'the student';

  // 4b. Resolve preceptor (normalized first, free-text fallback).
  let respondentPreceptorId = null;
  let respondentName = '';
  let respondentEmail = '';
  let preceptorActive = true;
  let redirectRole = null;

  if (redirectPreceptorId && redirectPreceptorId !== student.preceptor_id) {
    // PRECEPTOR-ROUTE-1: the target must be an ACTIVE canonical assignment for THIS
    // student in THIS cohort (any role). Anything else is refused with nothing written.
    // Redirects never use the free-text fallback - canonical records only.
    const { data: spa } = await supabaseAdmin
      .from('student_preceptor_assignments')
      .select('id, role')
      .eq('student_id', student.id)
      .eq('cohort_id', cohortId)
      .eq('preceptor_id', redirectPreceptorId)
      .eq('status', 'active')
      .maybeSingle();
    if (!spa) {
      return { status: 'failed', student_id: studentId, student_name: studentName,
        reason: 'Redirect target is not an active preceptor assignment for this student' };
    }
    redirectRole = spa.role;
    const { data: prec } = await supabaseAdmin
      .from('preceptors')
      .select('id, full_name, email, unit_name, is_active')
      .eq('id', redirectPreceptorId)
      .single();
    if (!prec) {
      return { status: 'failed', student_id: studentId, student_name: studentName,
        reason: 'Redirect target preceptor record not found' };
    }
    respondentPreceptorId = prec.id;
    respondentName  = (prec.full_name || '').trim();
    respondentEmail = (prec.email || '').trim();
    preceptorActive = prec.is_active !== false;
    if (!respondentEmail) {
      return { status: 'skipped', student_id: studentId, student_name: studentName,
        reason: 'Redirect target has no email on file' };
    }
  } else if (student.preceptor_id) {
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
  // Free-text fallback when no normalized record/email. Never reached for a
  // redirected send (the redirect branch returns on any missing data).
  if (!respondentEmail && !redirectRole) {
    respondentName  = respondentName || (student.matched_preceptor || '').trim();
    respondentEmail = (student.preceptor_email || '').trim();
    // No is_active flag exists for free-text preceptors; treated as active.
  }

  // 4c. Missing / inactive / invalid-email handling - skip with a clear reason.
  if (!respondentName && !respondentEmail) {
    return { status: 'skipped', student_id: studentId, student_name: studentName, reason: 'No preceptor on file' };
  }
  if (!preceptorActive) {
    return { status: 'skipped', student_id: studentId, student_name: studentName, reason: 'Preceptor is inactive' };
  }
  if (!isSafeEmail(respondentEmail)) {
    return { status: 'skipped', student_id: studentId, student_name: studentName, reason: 'Preceptor email is missing or invalid' };
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
    return { status: 'failed', student_id: studentId, student_name: studentName, reason: 'Failed to check for existing request' };
  }
  if (existing && existing.length > 0) {
    return {
      status: 'skipped', student_id: studentId, student_name: studentName,
      reason: existing[0].status === 'completed'
        ? 'Feedback already submitted for this period'
        : 'An active feedback request already exists for this period',
    };
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
      notes:                        notesValue,
    })
    .select('id')
    .single();

  if (assignErr || !assignment) {
    // uq_assignment violation or other insert failure (race backstop).
    const msg = (assignErr?.message || '').toLowerCase();
    if (msg.includes('uq_assignment') || msg.includes('duplicate') || assignErr?.code === '23505') {
      return { status: 'skipped', student_id: studentId, student_name: studentName, reason: 'A feedback request already exists for this period' };
    }
    return { status: 'failed', student_id: studentId, student_name: studentName, reason: 'Failed to create feedback request' };
  }

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
    if (rbErr) console.error(`${logPrefix} ROLLBACK FAILED, orphaned assignment:`, assignment.id, rbErr.message);
    return { status: 'failed', student_id: studentId, student_name: studentName, reason: 'Failed to issue feedback token' };
  }

  // 4g. Build the survey URL - raw token only in the email, never stored/logged.
  const surveyUrl = `${baseUrl}/evaluation/feedback#t=${rawToken}`;
  const preceptorFirstName = respondentName ? respondentName.split(/\s+/)[0] : '';

  const { subject, html } = buildPreceptorInvitationEmail({
    period, studentName, preceptorFirstName, expiresAtHuman, surveyUrl,
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
    console.error(`${logPrefix} send_failed (assignment revoked):`, { assignment_id: assignment.id, error: sendError });
    return { status: 'failed', student_id: studentId, student_name: studentName, reason: 'Email failed to send' };
  }

  // 4i. Audit log - survey_url and token are NOT included.
  const sentAtIso = new Date().toISOString();
  let notificationLogId = null;
  try {
    const { data: logRow } = await supabaseAdmin.from('notification_log').insert({
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
        source,
        sent_by_user_id:         senderUserId,
        sent_by_email:           senderEmail,
        // PRECEPTOR-ROUTE-1: present only when the Owner redirected this send away
        // from the primary; records the canonical target and its assignment role.
        ...(redirectRole ? { redirect: { preceptor_id: respondentPreceptorId, role: redirectRole } } : {}),
        // survey_url / token intentionally omitted - must not be persisted.
      },
    }).select('id').single();
    notificationLogId = logRow?.id || null;
  } catch (logErr) {
    console.error(`${logPrefix} log_write_failed:`, { assignment_id: assignment.id, error: logErr.message });
  }

  if (notificationLogId) {
    await archiveSentMessage({
      db: supabaseAdmin,
      notificationLogId,
      contentKind: 'secure_link_email',
      html,
      bodyFormat: 'html',
      source: 'preceptor_feedback_request',
      templateKey: 'preceptor_feedback_request_sent',
      templateVersion: 1,
    });
  }

  console.log(`${logPrefix} sent:`, {
    assignment_id: assignment.id, student_id: studentId, token_hash_prefix: tokenHashPrefix, period, source,
  });
  return {
    status: 'sent',
    assignment_id: assignment.id,
    student_id:    studentId,
    student_name:  studentName,
    preceptor_name: respondentName || null,
    preceptor_email: respondentEmail,
    period_label:  periodLabel,
    sent_at:       sentAtIso,
  };
}
