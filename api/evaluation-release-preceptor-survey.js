// api/evaluation-release-preceptor-survey.js
//
// PS-3b - Owner/Admin per-item RELEASE for an automated preceptor survey.
//
// The "queue" is live-computed from PS-3a detection; there is NO queue table. This
// endpoint re-runs PS-3a detection (classifyCohort) for ONE student + period at release
// time and proceeds ONLY if that item is still due_sendable. It then sends through the
// SAME shared core as the PS-2b manual send (processPreceptorSend), so behavior is
// identical - the only differences are the source/notes markers identifying a queue
// release. The durable record of a release is the evaluation_assignment + notification_log
// (which then makes PS-3a classify the item as suppressed_existing on refresh).
//
// SECURITY INVARIANTS:
//   - Owner/Admin only (server-verified).
//   - Body accepts ONLY { student_id, period }. Any recipient/email field is rejected.
//   - The recipient is resolved server-side from the student (no override, ever).
//   - Refusal (not due_sendable) sends nothing and writes nothing.
//
// POST /api/evaluation-release-preceptor-survey
// Authorization: Bearer <session-token>
// Body: { student_id, period }   period ∈ { 'midpoint', 'end_of_rotation' }

import { createClient } from '@supabase/supabase-js';
import supabaseAdmin from '../lib/server/evaluation/supabase_admin.js';
import { formatExpiresAt } from '../lib/server/evaluation/preceptorEmailTemplates.js';
import { processPreceptorSend } from '../lib/server/evaluation/preceptorSend.js';
import { emailBaseUrl } from '../lib/server/appUrl.js';
import { PERIOD_TO_TIMEPOINT, PERIOD_LABELS } from '../lib/server/evaluation/preceptor_progress_validation.js';
import { classifyCohort, AUTO_PERIODS } from '../src/lib/evaluation/preceptorDueDetection.js';
import { INACTIVE_MESSAGE } from './lib/activeAccount.js';

const INSTRUMENT_SLUG = 'preceptor_progress';
const WINDOW_DAYS      = 28;
const TOKEN_GRACE_DAYS = 2;

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
    console.error('[preceptor-release] unhandled exception:', err?.message || err);
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

  // ── 2. Parse + validate body (student_id + period ONLY) ─────────────────────────
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

  // Strict allowlist - the body may contain ONLY these keys. Any other field (recipient
  // overrides, force/override flags, confirmation_phrase, items, metadata, etc.) is rejected
  // with 400 and nothing is sent or written.
  //
  // expected_preceptor_email is a mismatch-CHECK value only: it is the recipient the Owner
  // saw in the confirmation view. It is NEVER used as the send recipient - the recipient is
  // always resolved server-side from the student. It exists solely so the server can refuse
  // if the resolved preceptor changed between the Owner's view and the release click.
  // PRECEPTOR-ROUTE-1: redirect_preceptor_id is a preceptors.id selecting one of the
  // student's ACTIVE canonical assignments (validated in the shared send core). It is
  // NOT a recipient override - email-shaped fields remain rejected.
  const ALLOWED = new Set(['student_id', 'period', 'expected_preceptor_email', 'redirect_preceptor_id']);
  const extraKeys = Object.keys(body).filter(k => !ALLOWED.has(k));
  if (extraKeys.length > 0) {
    return res.status(400).json({ success: false, error: `Unexpected field(s): ${extraKeys.join(', ')}. Allowed: student_id, period, expected_preceptor_email, redirect_preceptor_id.` });
  }

  const studentId = body.student_id;
  const period    = body.period;
  const redirectPreceptorId = body.redirect_preceptor_id ?? null;
  if (redirectPreceptorId !== null && !isUuid(redirectPreceptorId)) {
    return res.status(400).json({ success: false, error: 'redirect_preceptor_id must be a valid UUID' });
  }
  const expectedPreceptorEmail =
    typeof body.expected_preceptor_email === 'string' ? body.expected_preceptor_email.trim() : null;
  if (!isUuid(studentId)) {
    return res.status(400).json({ success: false, error: 'student_id must be a valid UUID' });
  }
  // Only the two auto-detected periods are releasable from the queue.
  if (!AUTO_PERIODS.includes(period)) {
    return res.status(422).json({ success: false, error: 'Period not supported for release' });
  }
  const timepoint = PERIOD_TO_TIMEPOINT[period];

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

  // ── 4. Load detection inputs for THIS student (read-only) and re-run PS-3a. ──────
  const { data: student, error: studentErr } = await supabaseAdmin
    .from('students')
    .select('id, first_name, preferred_first_name, last_name, approved_hours, hours_required, cohort_id, preceptor_id, preceptor_email, matched_preceptor')
    .eq('id', studentId)
    .single();
  if (studentErr || !student) {
    return res.status(404).json({ success: false, error: 'Student not found' });
  }

  let preceptorsForDetection = [];
  if (student.preceptor_id) {
    const { data: prec } = await supabaseAdmin
      .from('preceptors')
      .select('id, full_name, email, unit_name, is_active')
      .eq('id', student.preceptor_id)
      .single();
    if (prec) preceptorsForDetection = [prec];
  }

  const { data: rawAssignments, error: asgErr } = await supabaseAdmin
    .from('evaluation_assignments')
    .select(`
      id, student_id, timepoint, status, revoked_at, completed_at, expires_at,
      notes, sent_at, created_at,
      evaluation_instruments!inner ( slug )
    `)
    .eq('student_id', studentId)
    .eq('respondent_type', 'preceptor');
  if (asgErr) {
    return res.status(500).json({ success: false, error: 'Failed to load existing assignments' });
  }
  const slugFor = (a) => {
    const inst = a.evaluation_instruments;
    const i = Array.isArray(inst) ? inst[0] : inst;
    return i?.slug;
  };
  const assignments = (rawAssignments || []).filter(a => slugFor(a) === INSTRUMENT_SLUG);

  // Re-run the SAME detection module used by PS-3a, for this single student.
  const { rows } = classifyCohort({
    students: [student],
    preceptors: preceptorsForDetection,
    assignments,
    nowMs: Date.now(),
  });

  const row = rows.find(r => r.period === period);
  if (!row) {
    const inel = rows.find(r => r.classification === 'ineligible_hours');
    return res.status(200).json({
      success: true, released: false,
      classification: inel ? 'ineligible_hours' : 'not_due',
      reason: inel ? inel.reason : 'Not currently due for this period',
    });
  }

  // ── 5. Proceed ONLY if still due_sendable. Otherwise refuse (no write/send). ─────
  if (row.classification !== 'due_sendable') {
    return res.status(200).json({
      success: true, released: false,
      classification: row.classification,
      reason: row.reason,
    });
  }

  // ── 5b. "Same resolved preceptor" guard. If the Owner's confirmation view referenced a
  //       specific resolved preceptor, refuse when the current server-resolved recipient
  //       differs (e.g., the student's preceptor changed between render and release). The
  //       send recipient is still resolved server-side - expectedPreceptorEmail is compared,
  //       never used as the recipient.
  if (expectedPreceptorEmail) {
    const currentEmail = (row.preceptorEmail || '').trim();
    if (currentEmail.toLowerCase() !== expectedPreceptorEmail.toLowerCase()) {
      return res.status(200).json({
        success: true, released: false,
        classification: 'preceptor_changed',
        reason: 'The resolved preceptor changed since you viewed this item. Re-run detection and review the recipient before releasing.',
      });
    }
  }

  // ── 6. Release via the shared send core (queue-release source/notes markers). ────
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + WINDOW_DAYS);
  const tokenExpiresAt = new Date(expiresAt.getTime() + TOKEN_GRACE_DAYS * 24 * 60 * 60 * 1000);
  const expiresAtHuman = formatExpiresAt(expiresAt.toISOString());
  const periodLabel = PERIOD_LABELS[period];

  // Canonical domain in Production; forwarded host on Preview. See lib/server/appUrl.js.
  const baseUrl = emailBaseUrl(req);

  const result = await processPreceptorSend({
    instrument,
    studentId,
    period, timepoint, periodLabel,
    expiresAt, tokenExpiresAt, expiresAtHuman, baseUrl,
    senderUserId, senderEmail,
    source:     'preceptor_feedback_queue_release',
    notesValue: `preceptor_progress:${period}:queue_release`,
    redirectPreceptorId,
    logPrefix:  '[preceptor-release]',
  });

  if (result.status === 'sent') {
    return res.status(200).json({
      success: true, released: true,
      assignment_id: result.assignment_id,
      student_id: result.student_id,
      student_name: result.student_name,
      preceptor_name: result.preceptor_name,
      preceptor_email: result.preceptor_email,
      period, period_label: periodLabel,
      sent_at: result.sent_at,
    });
  }

  // skipped/failed (e.g., a race created an assignment between detection and insert,
  // or the email failed) - nothing lingering; surface the reason.
  return res.status(200).json({
    success: true, released: false,
    classification: result.status === 'skipped' ? 'suppressed_existing' : 'send_failed',
    reason: result.reason || 'Release did not complete',
  });
}
