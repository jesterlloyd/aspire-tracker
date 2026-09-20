// api/evaluation-release-casey-fink-pre-rotation-survey.js
//
// REVIEW-RELEASE-1. Owner/Admin per-student RELEASE for the PRE-rotation Casey-Fink
// Readiness for Practice Survey (slug: casey_fink_readiness_2024, timepoint: baseline).
// Recipient is the STUDENT. This is the baseline half of the Casey-Fink pair: the same
// instrument the student answers again after the rotation. It gates nothing, and the
// database will not issue a certificate for it (issue_participation_certificate refuses
// any timepoint but post_rotation).
//
// Modelled line for line on evaluation-release-casey-fink-post-rotation-survey.js, which is
// not modified. The differences are exactly the ones the workflow needs and no others:
//   - TIMEPOINT is 'baseline', so the assignment sits beside the post-rotation one under
//     the (instrument, student, cohort, timepoint) unique key rather than colliding with it.
//   - Eligibility is ASPIRE STATUS (Interviewed, Placed, Active Rotation), not hours, and
//     there is no prerequisite: nothing has to be submitted before a baseline.
//   - No certificate is read or written, because none is involved.
//   - Its own notification type, source, and notes prefix, so send history, dedup and the
//     Sent log can never confuse the two administrations.
//
// SECURITY INVARIANTS (unchanged from the model):
//   - Owner/Admin only (server-verified). A deactivated account is refused first.
//   - Body accepts ONLY { student_id, expected_instrument_slug }. Any other field is rejected.
//   - Recipient resolved server-side (personal first, school fallback). No override.
//   - Refusal (not eligible / already released) sends nothing and writes nothing.
//   - Raw token + survey URL are never persisted.
//
// POST /api/evaluation-release-casey-fink-pre-rotation-survey
// Body: { student_id, expected_instrument_slug: 'casey_fink_readiness_2024' }
// GET  /api/evaluation-release-casey-fink-pre-rotation-survey?cohort_id=<uuid>  (read-only eligibility)

/* global process */
import { createClient } from '@supabase/supabase-js';
import { createMailer } from '../lib/server/email/mailer.js';
import { archiveSentMessage } from './lib/messageArchive.js';
import supabaseAdmin from '../lib/server/evaluation/supabase_admin.js';
import { generateToken } from '../lib/server/evaluation/tokens.js';
import { buildCaseyFinkPreRotationInvitationEmail, formatExpiresAt } from '../lib/server/evaluation/caseyFinkPreRotationEmailTemplates.js';
import { emailBaseUrl } from '../lib/server/appUrl.js';
import {
  classifyCaseyFinkPreRotationCohort,
  PRE_ROTATION_TIMEPOINT,
} from '../src/lib/evaluation/caseyFinkPreRotationDueDetection.js';
import { isCaseyFinkReissuableAssignment } from '../src/lib/evaluation/caseyFinkPostRotationDueDetection.js';
import { getStudentPreferredFirstName } from '../src/lib/studentNameFormatters.js';
import { INACTIVE_MESSAGE } from './lib/activeAccount.js';

const INSTRUMENT_SLUG  = 'casey_fink_readiness_2024';
const TIMEPOINT        = PRE_ROTATION_TIMEPOINT;
const FROM             = 'ASPIRE at Cedars-Sinai <noreply@aspire-program.com>';
const REPLY_TO         = 'JesterLloyd.Bautista@cshs.org';
const WINDOW_DAYS      = 28;
const TOKEN_GRACE_DAYS = 2;
const NOTIF_TYPE       = 'casey_fink_pre_rotation_request_sent';
const SOURCE           = 'casey_fink_pre_rotation_queue_release';

const ALREADY_SENT_STATUSES = ['sent', 'delivered', 'opened', 'clicked', 'delayed', 'bounced', 'complained'];
const NOTES_PREFIX          = `${INSTRUMENT_SLUG}:${TIMEPOINT}`;
const REISSUE_CLAIM_NOTE    = `${NOTES_PREFIX}:reissue_claim`;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isUuid(v) { return typeof v === 'string' && UUID_PATTERN.test(v); }

async function restoreReissueClaim(row) {
  const { error } = await supabaseAdmin
    .from('evaluation_assignments')
    .update({
      status:     row.status,
      revoked_at: row.revoked_at || null,
      notes:      row.notes || null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', row.id)
    .eq('status', 'draft')
    .eq('notes', REISSUE_CLAIM_NOTE);
  if (error) {
    console.error('[casey-fink-pre-rotation-release] reissue_claim_restore_failed:', {
      assignment_id: row.id, error: error.message,
    });
  }
}

function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
}

function slugForAssignment(row) {
  const instrument = row?.evaluation_instruments;
  const resolved = Array.isArray(instrument) ? instrument[0] : instrument;
  return resolved?.slug;
}

const REFUSAL_REASON = {
  readiness_released:   'The pre-rotation Casey-Fink survey has already been released to this student',
  readiness_completed:  'This student has already completed the pre-rotation Casey-Fink survey',
  readiness_attention:  'An existing pre-rotation Casey-Fink assignment needs support review before release',
  not_eligible:         'This student has not been interviewed yet',
};

function eligibilityReason(row) {
  if (!row?.sendable) return 'No valid student email is available.';
  return REFUSAL_REASON[row?.status] || null;
}

const STUDENT_COLUMNS = 'id, first_name, last_name, preferred_first_name, school, program_type, cohort_id, aspire_status, approved_hours, personal_email, school_email';

async function getCohortEligibility(req, res) {
  const cohortId = typeof req.query?.cohort_id === 'string' ? req.query.cohort_id.trim() : '';
  if (!isUuid(cohortId)) {
    return res.status(400).json({ success: false, error: 'cohort_id must be a valid UUID' });
  }

  const [studentResult, assignmentResult] = await Promise.all([
    supabaseAdmin
      .from('students')
      .select(STUDENT_COLUMNS)
      .eq('cohort_id', cohortId),
    supabaseAdmin
      .from('evaluation_assignments')
      .select(`
        id, student_id, status, revoked_at, completed_at, expires_at, sent_at, created_at, notes, timepoint,
        evaluation_instruments!inner ( slug )
      `)
      .eq('cohort_id', cohortId),
  ]);
  if (studentResult.error || assignmentResult.error) {
    return res.status(500).json({ success: false, error: 'Failed to load Pre-Rotation eligibility' });
  }

  const students = studentResult.data || [];
  const assignments = (assignmentResult.data || []).filter(a =>
    slugForAssignment(a) === INSTRUMENT_SLUG && a.timepoint === TIMEPOINT
  );

  const { rows } = classifyCaseyFinkPreRotationCohort({ students, assignments, nowMs: Date.now() });
  return res.status(200).json({
    success: true,
    cohort_id: cohortId,
    instrument_slug: INSTRUMENT_SLUG,
    timepoint: TIMEPOINT,
    rows: rows.map(row => {
      const releaseState = row.status === 'eligible_for_review' || row.status === 'readiness_reissue';
      return {
        student_id: row.studentId,
        status: row.status,
        aspire_status: row.aspireStatus,
        actionable: releaseState && row.sendable,
        reissue: row.status === 'readiness_reissue',
        reason: eligibilityReason(row),
      };
    }),
  });
}

export default async function handler(req, res) {
  setCorsHeaders(res);
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ success: false, error: 'Method not allowed' });

  try {
    return await _handler(req, res);
  } catch (err) {
    console.error('[casey-fink-pre-rotation-release] unhandled exception:', err?.message || err);
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
    .select('id, role, email, is_active')
    .eq('auth_user_id', user.id)
    .single();

  // S-05: a deactivated account keeps a valid access token until it expires.
  // Refuse it before any work is performed, so deactivation ends access at once.
  if (profile && profile.is_active === false) {
    return res.status(403).json({ success: false, error: 'Forbidden', message: INACTIVE_MESSAGE });
  }
  if (!profile || !['owner', 'admin'].includes(profile.role)) {
    return res.status(403).json({ success: false, error: 'Forbidden' });
  }
  const senderUserId = profile.id;
  const senderEmail  = profile.email;

  if (req.method === 'GET') return getCohortEligibility(req, res);

  // ── 2. Parse + validate the two-field request body. ─────────────────────────────
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
  // aimed at the wrong workflow (or an unlabeled direct call) writes nothing and sends nothing.
  // The pre- and post-rotation endpoints share a slug, so the slug alone cannot tell them apart;
  // the ENDPOINT is the workflow, and the response echoes its timepoint for the post-send tripwire.
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

  // ── 4. Load the student and re-run the pre-rotation Casey-Fink detector. ─────────
  const { data: student, error: studentErr } = await supabaseAdmin
    .from('students')
    .select(STUDENT_COLUMNS)
    .eq('id', studentId)
    .single();
  if (studentErr || !student) {
    return res.status(404).json({ success: false, error: 'Student not found' });
  }
  const cohortId = student.cohort_id;
  if (!cohortId || !isUuid(cohortId)) {
    return res.status(422).json({ success: false, error: 'Student has no cohort' });
  }

  // Existing assignments for this student's CURRENT cohort only. Keep only BASELINE Casey-Fink
  // rows below; the post-rotation Casey-Fink and assignments from a prior cohort must never
  // block or be mutated by this release.
  const { data: rawAssignments, error: asgErr } = await supabaseAdmin
    .from('evaluation_assignments')
    .select(`
      id, student_id, status, revoked_at, completed_at, invited_at, expires_at, sent_at, created_at,
      updated_at, notes, timepoint,
      evaluation_instruments!inner ( slug )
    `)
    .eq('student_id', studentId)
    .eq('cohort_id', cohortId);
  if (asgErr) {
    return res.status(500).json({ success: false, error: 'Failed to load existing assignments' });
  }
  const assignments = (rawAssignments || []).filter(a => slugForAssignment(a) === INSTRUMENT_SLUG && a.timepoint === TIMEPOINT);

  const { rows } = classifyCaseyFinkPreRotationCohort({
    students: [student],
    assignments,
    nowMs: Date.now(),
  });
  const row = rows[0];

  // ── 5. Proceed only for a new release or a deliberate expired/revoked reissue. ──────────
  // The queue and endpoint share isCaseyFinkReissuableAssignment, so an existing terminal row is
  // never presented as a brand-new release. Completed and active assignments still fail closed.
  const releaseMode = row?.status === 'eligible_for_review'
    ? 'new'
    : row?.status === 'readiness_reissue'
      ? 'reissue'
      : null;
  const reissueRow = releaseMode === 'reissue'
    ? assignments.find(a => isCaseyFinkReissuableAssignment(a, Date.now())) || null
    : null;

  if (!releaseMode || (releaseMode === 'reissue' && !reissueRow)) {
    const classification = row?.status || 'not_eligible';
    return res.status(200).json({
      success: true, released: false,
      classification,
      reason: REFUSAL_REASON[classification] || 'This student is not currently eligible for the pre-rotation Casey-Fink release',
    });
  }

  // ── 6. notification_log dedup. ──────────────────────────────────────────────────
  // A historical send is authoritative for a NEW assignment, but it must not suppress a deliberate
  // reissue of the same expired/revoked assignment. Once reissued, the refreshed active assignment
  // blocks every repeat request before this point, which provides current-cycle deduplication.
  if (!reissueRow) {
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
        reason: 'A pre-rotation Casey-Fink survey has already been sent to this student',
      });
    }
  }

  // ── 7. Resolve recipient server-side (personal first, school fallback). ──────────
  const studentEmail = (student.personal_email || '').trim() || (student.school_email || '').trim();
  const studentName  = `${student.first_name || ''} ${student.last_name || ''}`.trim() || 'the student';
  if (!studentEmail) {
    return res.status(200).json({ success: true, released: false, classification: 'no_email', reason: 'No student email on file' });
  }

  // ── 8. Create or safely reissue the Casey-Fink baseline assignment. ──────────────
  const nowIso = new Date().toISOString();
  const expiresAt = new Date(); expiresAt.setDate(expiresAt.getDate() + WINDOW_DAYS);
  const tokenExpiresAt = new Date(expiresAt.getTime() + TOKEN_GRACE_DAYS * 24 * 60 * 60 * 1000);
  // The schema requires an hours snapshot on every sent assignment. A baseline is sent before
  // any hours exist, so the snapshot is whatever the record holds, usually 0. It is a fact
  // about the moment of sending, not an eligibility input.
  const approvedHoursSnapshot = parseFloat(student.approved_hours || 0) || 0;
  const { raw: rawToken, hash: tokenHash, hashPrefix: tokenHashPrefix } = generateToken();
  let assignmentId;

  if (reissueRow) {
    const { data: claimed, error: claimErr } = await supabaseAdmin
      .from('evaluation_assignments')
      .update({ status: 'draft', revoked_at: null, notes: REISSUE_CLAIM_NOTE, updated_at: nowIso })
      .eq('id', reissueRow.id)
      .eq('status', reissueRow.status)
      .select('id')
      .maybeSingle();
    if (claimErr) {
      return res.status(500).json({ success: false, released: false, classification: 'reissue_claim_failed', error: 'Failed to claim the existing survey for reissue' });
    }
    if (!claimed) {
      return res.status(409).json({ success: false, released: false, classification: 'release_in_progress', reason: 'Another release attempt changed this survey. Re-run detection before trying again.' });
    }

    const { data: tokenRows, error: tokenLoadErr } = await supabaseAdmin
      .from('evaluation_assignment_tokens')
      .select('id')
      .eq('assignment_id', reissueRow.id);
    if (tokenLoadErr) {
      await restoreReissueClaim(reissueRow);
      return res.status(500).json({ success: false, released: false, classification: 'reissue_token_failed', error: 'Failed to load survey tokens for reissue' });
    }

    const survivor = tokenRows?.[0] || null;
    const obsoleteTokenIds = (tokenRows || []).slice(1).map(r => r.id);
    if (obsoleteTokenIds.length > 0) {
      const { error: retireErr } = await supabaseAdmin
        .from('evaluation_assignment_tokens')
        .update({ revoked_at: nowIso })
        .in('id', obsoleteTokenIds);
      if (retireErr) {
        await restoreReissueClaim(reissueRow);
        return res.status(500).json({ success: false, released: false, classification: 'reissue_token_failed', error: 'Failed to retire historical survey tokens' });
      }
    }

    if (survivor) {
      const { error: tokenUpdateErr } = await supabaseAdmin
        .from('evaluation_assignment_tokens')
        .update({
          token_hash: tokenHash, token_hash_prefix: tokenHashPrefix,
          expires_at: tokenExpiresAt.toISOString(),
          revoked_at: null, used_at: null, ip_used_first: null, user_agent_used_first: null,
        })
        .eq('id', survivor.id);
      if (tokenUpdateErr) {
        await restoreReissueClaim(reissueRow);
        return res.status(500).json({ success: false, released: false, classification: 'reissue_token_failed', error: 'Failed to refresh the survey token' });
      }
    } else {
      const { error: tokenInsertErr } = await supabaseAdmin
        .from('evaluation_assignment_tokens')
        .insert({
          assignment_id: reissueRow.id, token_hash: tokenHash, token_hash_prefix: tokenHashPrefix,
          expires_at: tokenExpiresAt.toISOString(),
        });
      if (tokenInsertErr) {
        await restoreReissueClaim(reissueRow);
        return res.status(500).json({ success: false, released: false, classification: 'reissue_token_failed', error: 'Failed to refresh the survey token' });
      }
    }

    const { data: activated, error: activateErr } = await supabaseAdmin
      .from('evaluation_assignments')
      .update({
        assigned_by: senderUserId,
        status: 'sent', invited_at: nowIso, sent_at: nowIso, expires_at: expiresAt.toISOString(),
        approved_hours_at_invitation: approvedHoursSnapshot,
        respondent_type: 'student', respondent_preceptor_id: null,
        respondent_email: studentEmail, respondent_name: studentName,
        revoked_at: null, notes: `${NOTES_PREFIX}:queue_reissue`,
        updated_at: nowIso,
      })
      .eq('id', reissueRow.id)
      .eq('status', 'draft')
      .eq('notes', REISSUE_CLAIM_NOTE)
      .select('id')
      .maybeSingle();
    if (activateErr || !activated) {
      await supabaseAdmin.from('evaluation_assignment_tokens')
        .update({ revoked_at: new Date().toISOString() }).eq('assignment_id', reissueRow.id);
      await restoreReissueClaim(reissueRow);
      return res.status(500).json({ success: false, released: false, classification: 'reissue_activation_failed', error: 'Failed to activate the reissued survey' });
    }
    assignmentId = activated.id;
  } else {
    const { data: assignment, error: assignErr } = await supabaseAdmin
      .from('evaluation_assignments')
      .insert({
        instrument_id: instrument.id, student_id: studentId, cohort_id: cohortId,
        timepoint: TIMEPOINT, assigned_by: senderUserId, status: 'sent',
        invited_at: nowIso, sent_at: nowIso, expires_at: expiresAt.toISOString(),
        approved_hours_at_invitation: approvedHoursSnapshot,
        respondent_type: 'student', respondent_preceptor_id: null,
        respondent_email: studentEmail, respondent_name: studentName,
        notes: `${NOTES_PREFIX}:queue_release`,
      })
      .select('id')
      .single();

    if (assignErr || !assignment) {
      const msg = (assignErr?.message || '').toLowerCase();
      if (msg.includes('uq_assignment') || msg.includes('duplicate') || assignErr?.code === '23505') {
        return res.status(200).json({ success: true, released: false, classification: 'suppressed_existing', reason: 'A pre-rotation Casey-Fink survey already exists for this student' });
      }
      return res.status(500).json({ success: false, error: 'Failed to create survey request' });
    }
    assignmentId = assignment.id;

    const { error: tokenErr } = await supabaseAdmin
      .from('evaluation_assignment_tokens')
      .insert({ assignment_id: assignmentId, token_hash: tokenHash, token_hash_prefix: tokenHashPrefix, expires_at: tokenExpiresAt.toISOString() });
    if (tokenErr) {
      const { error: rbErr } = await supabaseAdmin.from('evaluation_assignments').delete().eq('id', assignmentId);
      if (rbErr) console.error('[casey-fink-pre-rotation-release] ROLLBACK FAILED, orphaned assignment:', assignmentId, rbErr.message);
      return res.status(500).json({ success: false, error: 'Failed to issue survey token' });
    }
  }

  // ── 10. Build survey URL - raw token only in the email, never stored/logged. ─────
  const baseUrl = emailBaseUrl(req);
  const surveyUrl = `${baseUrl}/evaluation/readiness#t=${rawToken}`;
  const expiresAtHuman = formatExpiresAt(expiresAt.toISOString());
  const studentFirstName = getStudentPreferredFirstName(student);

  // ── 11. Send via Resend. ─────────────────────────────────────────────────────────
  const resend = createMailer();
  const { subject, html } = buildCaseyFinkPreRotationInvitationEmail({ studentFirstName, surveyUrl, expiresAtHuman });

  let resendMessageId = null;
  let sendError = null;
  let deliveryUncertain = false;
  try {
    const { data: emailData, error: emailErr } = await resend.emails.send({
      from:     FROM,
      to:       [studentEmail],
      reply_to: REPLY_TO,
      subject,
      html,
      tags: [
        { name: 'type',          value: NOTIF_TYPE },
        { name: 'assignment_id', value: assignmentId },
      ],
    }, { idempotencyKey: `casey-fink-pre-release/${assignmentId}:${nowIso}` });
    if (emailErr) sendError = emailErr.message || JSON.stringify(emailErr);
    else resendMessageId = emailData?.id || null;
  } catch (err) {
    // A thrown transport error is indeterminate: the provider may have accepted the exact email.
    // Keep this assignment/token active and block a blind retry, which could send a second email
    // carrying a different token. An explicit provider rejection below remains safely reissuable.
    deliveryUncertain = true;
    sendError = err.message;
  }

  if (deliveryUncertain) {
    await supabaseAdmin.from('evaluation_assignments')
      .update({ notes: `${NOTES_PREFIX}:delivery_uncertain`, updated_at: new Date().toISOString() })
      .eq('id', assignmentId);
    console.error('[casey-fink-pre-rotation-release] delivery_uncertain (do not retry blindly):', {
      assignment_id: assignmentId, error: sendError,
    });
    return res.status(202).json({
      success: false, released: false, classification: 'delivery_uncertain',
      reason: 'The email provider may have accepted this message. Do not retry until delivery is verified in Sent History.',
    });
  }

  if (sendError) {
    await supabaseAdmin.from('evaluation_assignments')
      .update({ status: 'revoked', revoked_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', assignmentId);
    await supabaseAdmin.from('evaluation_assignment_tokens')
      .update({ revoked_at: new Date().toISOString() })
      .eq('assignment_id', assignmentId);
    console.error('[casey-fink-pre-rotation-release] send_failed (assignment revoked):', { assignment_id: assignmentId, error: sendError });
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
        assignment_id:   assignmentId,
        student_id:      studentId,
        instrument_id:   instrument.id,
        timepoint:       TIMEPOINT,
        source:          SOURCE,
        reissued:        !!reissueRow,
        invitation_cycle_started_at: nowIso,
        sent_by_user_id: senderUserId,
        sent_by_email:   senderEmail,
      },
    }).select('id').single();
    notificationLogId = logRow?.id || null;
  } catch (logWriteErr) {
    console.error('[casey-fink-pre-rotation-release] log_write_failed:', { assignment_id: assignmentId, error: logWriteErr.message });
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

  console.log('[casey-fink-pre-rotation-release] sent:', {
    assignment_id: assignmentId, student_id: studentId, source: SOURCE, reissued: !!reissueRow,
  });
  return res.status(200).json({
    success: true, released: true,
    assignment_id: assignmentId,
    student_id: studentId,
    student_name: studentName,
    student_email: studentEmail,
    sent_at: sentAtIso,
    reissued: !!reissueRow,
    // ROUTING-HOTFIX-1: echo the workflow identity so the client can assert it matches the workflow
    // it intended (post-send tripwire, complementing the pre-send expected_instrument_slug guard).
    // For the two Casey-Fink administrations the TIMEPOINT is the half of that identity that differs.
    instrument_slug: INSTRUMENT_SLUG,
    timepoint: TIMEPOINT,
  });
}
