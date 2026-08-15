// api/evaluation-release-casey-fink-post-rotation-survey.js
//
// Owner/Admin per-student RELEASE for the post-rotation Casey-Fink Readiness for Practice Survey
// (slug: casey_fink_readiness_2024, timepoint: post_rotation). This is the certificate-gating
// workflow: completing this survey unlocks the ASPIRE Certificate of Completion (issuance
// happens at submit, inside submit_evaluation_response, NOT here). Parallel to the ASPIRE
// Post-Rotation Evaluation release endpoint, which is not modified.
//
// SECURITY INVARIANTS:
//   - Owner/Admin only (server-verified).
//   - Body accepts ONLY { student_id }. Any other field is rejected with 400.
//   - Recipient resolved server-side (personal first, school fallback). No override.
//   - Refusal (not eligible / already released) sends nothing and writes nothing.
//   - Raw token + survey URL are never persisted.
//   - No certificate row, certificate number, or PDF is created here.
//
// POST /api/evaluation-release-casey-fink-post-rotation-survey   Body: { student_id }

/* global process */
import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import { archiveSentMessage } from './lib/messageArchive.js';
import supabaseAdmin from '../lib/server/evaluation/supabase_admin.js';
import { generateToken } from '../lib/server/evaluation/tokens.js';
import { buildCaseyFinkPostRotationInvitationEmail, formatExpiresAt } from '../lib/server/evaluation/caseyFinkPostRotationEmailTemplates.js';
import { emailBaseUrl } from '../lib/server/appUrl.js';
import { classifyCaseyFinkPostRotationCohort } from '../src/lib/evaluation/caseyFinkPostRotationDueDetection.js';
import { getStudentPreferredFirstName } from '../src/lib/studentNameFormatters.js';

const INSTRUMENT_SLUG  = 'casey_fink_readiness_2024';
const TIMEPOINT        = 'post_rotation';
const FROM             = 'ASPIRE at Cedars-Sinai <noreply@aspire-program.com>';
const REPLY_TO         = 'JesterLloyd.Bautista@cshs.org';
const WINDOW_DAYS      = 28;
const TOKEN_GRACE_DAYS = 2;
const NOTIF_TYPE       = 'casey_fink_post_rotation_request_sent';
const SOURCE           = 'casey_fink_post_rotation_queue_release';

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
    console.error('[casey-fink-post-rotation-release] unhandled exception:', err?.message || err);
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

  const ALLOWED_KEYS = ['student_id', 'expected_instrument_slug'];
  const extraKeys = Object.keys(body).filter(k => !ALLOWED_KEYS.includes(k));
  if (extraKeys.length > 0) {
    return res.status(400).json({ success: false, error: `Unexpected field(s): ${extraKeys.join(', ')}. Allowed: ${ALLOWED_KEYS.join(', ')}.` });
  }
  const studentId = body.student_id;
  if (!isUuid(studentId)) {
    return res.status(400).json({ success: false, error: 'student_id must be a valid UUID' });
  }
  // ROUTING-HOTFIX-1B pre-send guard (MANDATORY): the caller must declare which workflow it intends,
  // and it must match this endpoint's instrument. This runs BEFORE instrument resolution, student
  // load, assignment creation, token creation, notification insertion, and email send - so a call
  // aimed at the wrong workflow (or an unlabeled direct call) writes nothing and sends nothing. The
  // instrument slug uniquely identifies the workflow, so it is a complete pre-send identity; no
  // separate timepoint/workflow-key field is needed. The only callers are the Review & Release
  // panels, which always send this field.
  if (body.expected_instrument_slug == null || body.expected_instrument_slug === '') {
    return res.status(400).json({ success: false, error: 'expected_instrument_slug is required. Nothing was sent.' });
  }
  if (body.expected_instrument_slug !== INSTRUMENT_SLUG) {
    return res.status(400).json({ success: false, error: `Workflow mismatch: this endpoint releases ${INSTRUMENT_SLUG}, not ${body.expected_instrument_slug}. Nothing was sent.` });
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

  // ── 4. Load the student and re-run the post-rotation Casey-Fink detector. ────────
  const { data: student, error: studentErr } = await supabaseAdmin
    .from('students')
    .select('id, first_name, last_name, preferred_first_name, school, program_type, cohort_id, approved_hours, hours_required, pending_hours, personal_email, school_email')
    .eq('id', studentId)
    .single();
  if (studentErr || !student) {
    return res.status(404).json({ success: false, error: 'Student not found' });
  }
  const cohortId = student.cohort_id;
  if (!cohortId || !isUuid(cohortId)) {
    return res.status(422).json({ success: false, error: 'Student has no cohort' });
  }

  // Existing Casey-Fink assignments for this student; keep ONLY post_rotation ones (baseline and
  // early_rotation_baseline Casey-Fink must never block a post-rotation release).
  const { data: rawAssignments, error: asgErr } = await supabaseAdmin
    .from('evaluation_assignments')
    .select(`
      id, student_id, status, revoked_at, completed_at, expires_at, sent_at, created_at, timepoint,
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
  const assignments = (rawAssignments || []).filter(a => slugFor(a) === INSTRUMENT_SLUG && a.timepoint === TIMEPOINT);

  const { data: certificates, error: certErr } = await supabaseAdmin
    .from('certificates')
    .select('id, student_id, certificate_number')
    .eq('student_id', studentId);
  if (certErr) {
    return res.status(500).json({ success: false, error: 'Failed to load certificate state' });
  }

  const { rows } = classifyCaseyFinkPostRotationCohort({
    students: [student],
    assignments,
    certificates: certificates || [],
    nowMs: Date.now(),
  });
  const row = rows[0];

  // ── 5. Proceed ONLY if still eligible_for_review. Otherwise refuse (no write/send). ─────
  if (!row || row.status !== 'eligible_for_review') {
    const REFUSAL_REASON = {
      readiness_released:   'The post-rotation Casey-Fink survey has already been released to this student',
      readiness_completed:  'This student has already completed the post-rotation Casey-Fink survey',
      certificate_unlocked: 'This student already has a Certificate of Completion',
      not_eligible_hours:   'This student does not have valid required hours set',
      not_eligible:         'This student has not yet reached the required hours',
    };
    const classification = row?.status || 'not_eligible';
    return res.status(200).json({
      success: true, released: false,
      classification,
      reason: REFUSAL_REASON[classification] || 'This student is not currently eligible for post-rotation Casey-Fink release',
    });
  }

  // ── 6. notification_log dedup. ──────────────────────────────────────────────────
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
      reason: 'A post-rotation Casey-Fink survey has already been sent to this student',
    });
  }

  // ── 7. Resolve recipient server-side (personal first, school fallback). ──────────
  const studentEmail = (student.personal_email || '').trim() || (student.school_email || '').trim();
  const studentName  = `${student.first_name || ''} ${student.last_name || ''}`.trim() || 'the student';
  if (!studentEmail) {
    return res.status(200).json({ success: true, released: false, classification: 'no_email', reason: 'No student email on file' });
  }

  // ── 8. Create the Casey-Fink post_rotation assignment. ───────────────────────────
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
      respondent_preceptor_id:      null,
      respondent_email:             studentEmail,
      respondent_name:              studentName,
      notes:                        'casey_fink_readiness_2024:post_rotation:queue_release',
    })
    .select('id')
    .single();

  if (assignErr || !assignment) {
    const msg = (assignErr?.message || '').toLowerCase();
    if (msg.includes('uq_assignment') || msg.includes('duplicate') || assignErr?.code === '23505') {
      return res.status(200).json({ success: true, released: false, classification: 'suppressed_existing', reason: 'A post-rotation Casey-Fink survey already exists for this student' });
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
    if (rbErr) console.error('[casey-fink-post-rotation-release] ROLLBACK FAILED, orphaned assignment:', assignment.id, rbErr.message);
    return res.status(500).json({ success: false, error: 'Failed to issue survey token' });
  }

  // ── 10. Build survey URL - raw token only in the email, never stored/logged. ─────
  const baseUrl = emailBaseUrl(req);
  const surveyUrl = `${baseUrl}/evaluation/readiness#t=${rawToken}`;
  const expiresAtHuman = formatExpiresAt(expiresAt.toISOString());
  const studentFirstName = getStudentPreferredFirstName(student);

  // ── 11. Send via Resend. ─────────────────────────────────────────────────────────
  const resend = new Resend(process.env.RESEND_API_KEY);
  const { subject, html } = buildCaseyFinkPostRotationInvitationEmail({ studentFirstName, surveyUrl, expiresAtHuman });

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
    await supabaseAdmin.from('evaluation_assignments')
      .update({ status: 'revoked', revoked_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', assignment.id);
    await supabaseAdmin.from('evaluation_assignment_tokens')
      .update({ revoked_at: new Date().toISOString() })
      .eq('assignment_id', assignment.id);
    console.error('[casey-fink-post-rotation-release] send_failed (assignment revoked):', { assignment_id: assignment.id, error: sendError });
    return res.status(200).json({ success: true, released: false, classification: 'send_failed', reason: 'Email failed to send' });
  }

  // ── 12. Audit log - survey_url and token are NOT included. ───────────────────────
  const sentAtIso = new Date().toISOString();
  let notificationLogId = null;
  try {
    const { data: logRow } = await supabaseAdmin.from('notification_log').insert({
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
      },
    }).select('id').single();
    notificationLogId = logRow?.id || null;
  } catch (logWriteErr) {
    console.error('[casey-fink-post-rotation-release] log_write_failed:', { assignment_id: assignment.id, error: logWriteErr.message });
  }

  if (notificationLogId) {
    await archiveSentMessage({
      db: supabaseAdmin,
      notificationLogId,
      contentKind: 'secure_link_email',
      html,
      bodyFormat: 'html',
      source: SOURCE,
      templateKey: NOTIF_TYPE,
      templateVersion: 1,
    });
  }

  console.log('[casey-fink-post-rotation-release] sent:', {
    assignment_id: assignment.id, student_id: studentId, source: SOURCE,
  });
  return res.status(200).json({
    success: true, released: true,
    assignment_id: assignment.id,
    student_id: studentId,
    student_name: studentName,
    student_email: studentEmail,
    sent_at: sentAtIso,
    // ROUTING-HOTFIX-1: echo the workflow identity so the client can assert it matches the workflow
    // it intended (post-send tripwire, complementing the pre-send expected_instrument_slug guard).
    instrument_slug: INSTRUMENT_SLUG,
    timepoint: TIMEPOINT,
  });
}
