// api/evaluation-release-student-eval-survey.js
//
// SR-2b-2 — Owner/Admin per-student RELEASE for the Student Evaluation of Preceptor/Unit
// Experience survey (slug: student_preceptor_eval). Parallel to the preceptor release
// endpoint (evaluation-release-preceptor-survey.js), which is NOT modified.
//
// The queue is live-computed from the SR-2b-1 detector. This endpoint re-runs that detector
// for ONE student at release time and proceeds ONLY if still due_sendable. The recipient is
// the STUDENT (personal_email first, school_email fallback) — there is no recipient override.
// The preceptor/unit is the evaluated_target (context only); it is resolved for display by
// the SR-2a token-validate endpoint from the student's record and is NEVER written to
// respondent_preceptor_id (which stays NULL for student surveys).
//
// SECURITY INVARIANTS:
//   - Owner/Admin only (server-verified).
//   - Body accepts ONLY { student_id }. Any other field is rejected with 400.
//   - Recipient resolved server-side from the student. No override.
//   - Refusal (not due_sendable / already sent) sends nothing and writes nothing.
//   - Raw token + survey URL are never persisted.
//
// POST /api/evaluation-release-student-eval-survey   Body: { student_id }

import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import supabaseAdmin from '../lib/server/evaluation/supabase_admin.js';
import { generateToken } from '../lib/server/evaluation/tokens.js';
import { buildStudentEvalInvitationEmail, formatExpiresAt } from '../lib/server/evaluation/studentEvalEmailTemplates.js';
import { classifyStudentEvalCohort } from '../src/lib/evaluation/studentEvalDueDetection.js';
import { getStudentPreferredFirstName } from '../src/lib/studentNameFormatters.js';

const INSTRUMENT_SLUG  = 'student_preceptor_eval';
const TIMEPOINT        = 'post_rotation';
const FROM             = 'ASPIRE Program <noreply@aspire-program.com>';
const REPLY_TO         = 'JesterLloyd.Bautista@cshs.org';
const WINDOW_DAYS      = 28;
const TOKEN_GRACE_DAYS = 2;
const NOTIF_TYPE       = 'student_preceptor_eval_request_sent';
const SOURCE           = 'student_preceptor_eval_queue_release';

// Broadened "already sent" status set — mirrors the midpoint-checkin fix so the Resend
// webhook advancing status (sent → delivered → opened → …) never defeats dedup.
const ALREADY_SENT_STATUSES = ['sent', 'delivered', 'opened', 'clicked', 'delayed', 'bounced', 'complained'];

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

  try {
    return await _handler(req, res);
  } catch (err) {
    console.error('[student-eval-release] unhandled exception:', err?.message || err);
    return res.status(500).json({ success: false, error: `Server error: ${err?.message || 'unknown'}` });
  }
}

async function _handler(req, res) {
  // ── 1. Auth (Owner/Admin) ──────────────────────────────────────────────────────
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
  const senderUserId = profile.id;
  const senderEmail  = profile.email;

  // ── 2. Parse + validate body (student_id ONLY) ──────────────────────────────────
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

  // Strict allowlist — the body may contain ONLY student_id. No recipient/email/override.
  const extraKeys = Object.keys(body).filter(k => k !== 'student_id');
  if (extraKeys.length > 0) {
    return res.status(400).json({ success: false, error: `Unexpected field(s): ${extraKeys.join(', ')}. Allowed: student_id.` });
  }
  const studentId = body.student_id;
  if (!isUuid(studentId)) {
    return res.status(400).json({ success: false, error: 'student_id must be a valid UUID' });
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

  // ── 4. Load detection inputs for THIS student (read-only) and re-run SR-2b-1. ────
  const { data: student, error: studentErr } = await supabaseAdmin
    .from('students')
    .select('id, first_name, last_name, preferred_first_name, school, program_type, cohort_id, approved_hours, hours_required, personal_email, school_email, preceptor_id, matched_preceptor')
    .eq('id', studentId)
    .single();
  if (studentErr || !student) {
    return res.status(404).json({ success: false, error: 'Student not found' });
  }
  const cohortId = student.cohort_id;
  if (!cohortId || !isUuid(cohortId)) {
    return res.status(422).json({ success: false, error: 'Student has no cohort' });
  }

  let preceptorsForDetection = [];
  if (student.preceptor_id) {
    const { data: prec } = await supabaseAdmin
      .from('preceptors')
      .select('id, full_name, unit_name')
      .eq('id', student.preceptor_id)
      .single();
    if (prec) preceptorsForDetection = [prec];
  }

  // Existing student_preceptor_eval assignments for this student (slug-scoped; never counts
  // preceptor_progress or Casey-Fink).
  const { data: rawAssignments, error: asgErr } = await supabaseAdmin
    .from('evaluation_assignments')
    .select(`
      id, student_id, status, revoked_at, completed_at, expires_at, sent_at, created_at,
      evaluation_instruments!inner ( slug )
    `)
    .eq('student_id', studentId);
  if (asgErr) {
    return res.status(500).json({ success: false, error: 'Failed to load existing assignments' });
  }
  const slugFor = (a) => {
    const inst = a.evaluation_instruments;
    const i = Array.isArray(inst) ? inst[0] : inst;
    return i?.slug;
  };
  const assignments = (rawAssignments || []).filter(a => slugFor(a) === INSTRUMENT_SLUG);

  const { rows } = classifyStudentEvalCohort({
    students: [student],
    preceptors: preceptorsForDetection,
    assignments,
    nowMs: Date.now(),
  });
  const row = rows[0];

  // ── 5. Proceed ONLY if still due_sendable. Otherwise refuse (no write/send). ─────
  if (!row || row.classification !== 'due_sendable') {
    return res.status(200).json({
      success: true, released: false,
      classification: row?.classification || 'not_due',
      reason: row?.reason || 'Not currently due',
    });
  }

  // ── 6. Broadened-status notification_log dedup (no status='sent'-only bug). ──────
  const { data: priorLog, error: logErr } = await supabaseAdmin
    .from('notification_log')
    .select('id')
    .eq('notification_type', NOTIF_TYPE)
    .eq('student_id', studentId)
    .in('status', ALREADY_SENT_STATUSES)
    .limit(1);
  if (logErr) {
    return res.status(500).json({ success: false, error: 'Failed to check send history' });
  }
  if (priorLog && priorLog.length > 0) {
    return res.status(200).json({
      success: true, released: false,
      classification: 'suppressed_existing',
      reason: 'A survey request has already been sent to this student',
    });
  }

  // ── 7. Resolve recipient server-side (personal first, school fallback). ──────────
  const studentEmail = (student.personal_email || '').trim() || (student.school_email || '').trim();
  const studentName  = `${student.first_name || ''} ${student.last_name || ''}`.trim() || 'the student';
  // Detector already guaranteed a valid email for due_sendable; guard defensively.
  if (!studentEmail) {
    return res.status(200).json({ success: true, released: false, classification: 'due_unsendable', reason: 'No student email on file' });
  }

  // ── 8. Create the assignment (student is subject AND respondent). ────────────────
  const nowIso = new Date().toISOString();
  const expiresAt = new Date(); expiresAt.setDate(expiresAt.getDate() + WINDOW_DAYS);
  const tokenExpiresAt = new Date(expiresAt.getTime() + TOKEN_GRACE_DAYS * 24 * 60 * 60 * 1000);
  const approvedHoursSnapshot = parseFloat(student.approved_hours || 0) || 0;

  const { data: assignment, error: assignErr } = await supabaseAdmin
    .from('evaluation_assignments')
    .insert({
      instrument_id:                instrument.id,
      student_id:                   studentId,
      cohort_id:                    cohortId,
      timepoint:                    TIMEPOINT,
      assigned_by:                  senderUserId,
      status:                       'sent',
      invited_at:                   nowIso,
      sent_at:                      nowIso,
      expires_at:                   expiresAt.toISOString(),
      approved_hours_at_invitation: approvedHoursSnapshot,
      respondent_type:              'student',
      respondent_preceptor_id:      null,           // NEVER the evaluated preceptor
      respondent_email:             studentEmail,   // the student's own email
      respondent_name:              studentName,
      notes:                        'student_preceptor_eval:queue_release',
    })
    .select('id')
    .single();

  if (assignErr || !assignment) {
    const msg = (assignErr?.message || '').toLowerCase();
    if (msg.includes('uq_assignment') || msg.includes('duplicate') || assignErr?.code === '23505') {
      return res.status(200).json({ success: true, released: false, classification: 'suppressed_existing', reason: 'A survey request already exists for this student' });
    }
    return res.status(500).json({ success: false, error: 'Failed to create survey request' });
  }

  // ── 9. Mint token. Raw token lives only in this function scope. ──────────────────
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
    const { error: rbErr } = await supabaseAdmin
      .from('evaluation_assignments').delete().eq('id', assignment.id);
    if (rbErr) console.error('[student-eval-release] ROLLBACK FAILED — orphaned assignment:', assignment.id, rbErr.message);
    return res.status(500).json({ success: false, error: 'Failed to issue survey token' });
  }

  // ── 10. Build survey URL — raw token only in the email, never stored/logged. ─────
  const proto   = req.headers['x-forwarded-proto'] || 'https';
  const host    = req.headers['x-forwarded-host'] || req.headers['host'];
  const baseUrl = host ? `${proto}://${host}` : (process.env.VITE_APP_URL || 'https://aspire-tracker.vercel.app');
  const surveyUrl = `${baseUrl}/evaluation/experience#t=${rawToken}`;
  const expiresAtHuman = formatExpiresAt(expiresAt.toISOString());
  const studentFirstName = getStudentPreferredFirstName(student);  // preferred → legal; '' keeps 'Hello,' fallback

  // ── 11. Send via Resend. ─────────────────────────────────────────────────────────
  const resend = new Resend(process.env.RESEND_API_KEY);
  const { subject, html } = buildStudentEvalInvitationEmail({ studentFirstName, expiresAtHuman, surveyUrl });

  let resendMessageId = null;
  let sendError = null;
  try {
    const { data: emailData, error: emailErr } = await resend.emails.send({
      from:     FROM,
      to:       [studentEmail],
      reply_to: REPLY_TO,
      subject,
      html,
      tags: [
        { name: 'type',          value: NOTIF_TYPE },
        { name: 'assignment_id', value: assignment.id },
      ],
    });
    if (emailErr) sendError = emailErr.message || JSON.stringify(emailErr);
    else resendMessageId = emailData?.id || null;
  } catch (err) {
    sendError = err.message;
  }

  if (sendError) {
    // Email failed: revoke the assignment + token so nothing lingers as a live invite.
    await supabaseAdmin.from('evaluation_assignments')
      .update({ status: 'revoked', revoked_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', assignment.id);
    await supabaseAdmin.from('evaluation_assignment_tokens')
      .update({ revoked_at: new Date().toISOString() })
      .eq('assignment_id', assignment.id);
    console.error('[student-eval-release] send_failed (assignment revoked):', { assignment_id: assignment.id, error: sendError });
    return res.status(200).json({ success: true, released: false, classification: 'send_failed', reason: 'Email failed to send' });
  }

  // ── 12. Audit log — survey_url and token are NOT included. ───────────────────────
  const sentAtIso = new Date().toISOString();
  try {
    await supabaseAdmin.from('notification_log').insert({
      notification_type: NOTIF_TYPE,
      audience:          'student',
      recipient_email:   studentEmail,
      recipient_name:    studentName,
      recipient_role:    'Student',
      subject,
      status:            'sent',
      resend_email_id:   resendMessageId,
      sent_at:           sentAtIso,
      student_id:        studentId,
      recipient_type:    'student',
      metadata: {
        assignment_id:   assignment.id,
        student_id:      studentId,
        instrument_id:   instrument.id,
        timepoint:       TIMEPOINT,
        source:          SOURCE,
        sent_by_user_id: senderUserId,
        sent_by_email:   senderEmail,
        // survey_url / token intentionally omitted — must not be persisted.
      },
    });
  } catch (logWriteErr) {
    console.error('[student-eval-release] log_write_failed:', { assignment_id: assignment.id, error: logWriteErr.message });
  }

  console.log('[student-eval-release] sent:', {
    assignment_id: assignment.id, student_id: studentId, source: SOURCE,
  });
  return res.status(200).json({
    success: true, released: true,
    assignment_id: assignment.id,
    student_id: studentId,
    student_name: studentName,
    student_email: studentEmail,
    sent_at: sentAtIso,
  });
}
