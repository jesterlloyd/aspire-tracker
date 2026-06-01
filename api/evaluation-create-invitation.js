// api/evaluation-create-invitation.js
//
// Owner/admin-authenticated endpoint that creates a secure survey invitation
// for one student and returns the raw survey URL exactly once.
//
// The raw token is generated in server memory, used to build the survey URL,
// returned to the Owner in this response, then discarded. It is never stored
// in any database column, never logged, and never transmitted a second time.
//
// POST /api/evaluation-create-invitation
// Authorization: Bearer <session-token>
//
// Body (JSON):
//   studentId | student_id   — required UUID
//   cohortId  | cohort_id    — optional; defaults to student.cohort_id
//   timepoint                — optional; if omitted, auto-derived from approved_hours
//   expiresAt | expires_at   — optional ISO date; defaults to +28 days from now
//   notes                    — optional TEXT (stored on assignment row)
//
// Success response:
//   { assignmentId, surveyUrl, expiresAt, timepoint, student: { id, firstName, lastName, email } }
//
// Errors:
//   400 — missing/invalid body fields
//   401 — invalid or missing session
//   403 — authenticated but not owner or admin
//   404 — student not found
//   409 — active invitation already exists for this student+instrument+cohort+timepoint
//   422 — instrument not found or not authorized
//   500 — assignment or token insert failed (with rollback attempt)

import { createClient } from '@supabase/supabase-js';
import supabaseAdmin from '../lib/server/evaluation/supabase_admin.js';
import { generateToken } from '../lib/server/evaluation/tokens.js';

const INSTRUMENT_SLUG   = 'casey_fink_readiness_2024';
const VALID_TIMEPOINTS  = new Set(['baseline', 'early_rotation_baseline', 'midpoint', 'post_rotation', 'custom']);
const DEFAULT_WINDOW_DAYS    = 28;   // assignment response window
const TOKEN_GRACE_DAYS       = 2;    // token expires this many days after assignment.expires_at

// UUID format guard — prevents malformed IDs from reaching the DB.
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isUuid(v) { return typeof v === 'string' && UUID_PATTERN.test(v); }

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Outer catch ensures all unhandled exceptions return JSON rather than
  // Vercel's HTML error page. HTML responses cause res.json() in the browser
  // to throw, masking the real error as a "Network error" in the UI.
  try {
    return await _handler(req, res);
  } catch (err) {
    console.error('[create-invitation] unhandled exception:', err?.message || err);
    return res.status(500).json({ error: `Server error: ${err?.message || 'unknown'}` });
  }
}

async function _handler(req, res) {

  // ── 1. Auth: Bearer session token ────────────────────────────────────────
  const authHeader  = req.headers['authorization'] || '';
  const bearerToken = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!bearerToken) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const userClient = createClient(
    process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
    process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY,
    { global: { headers: { Authorization: `Bearer ${bearerToken}` } } }
  );

  let user;
  try {
    const { data: { user: u }, error: authErr } = await userClient.auth.getUser();
    if (authErr || !u) return res.status(401).json({ error: 'Unauthorized' });
    user = u;
  } catch {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // ── 2. Role check + resolve user_profiles.id for assigned_by ─────────────
  // IMPORTANT: assigned_by must store user_profiles.id, NOT auth.users.id.
  const { data: profile } = await supabaseAdmin
    .from('user_profiles')
    .select('id, role')
    .eq('auth_user_id', user.id)
    .single();

  if (!profile || !['owner', 'admin'].includes(profile.role)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const assignedBy = profile.id;  // user_profiles.id — correct FK target for assigned_by

  // ── 3. Parse and validate body ────────────────────────────────────────────
  let body;
  try {
    const raw = req.body;
    body = (raw && typeof raw === 'object') ? raw : JSON.parse(raw);
  } catch {
    return res.status(400).json({ error: 'Invalid request body' });
  }
  if (!body || typeof body !== 'object') {
    return res.status(400).json({ error: 'Invalid request body' });
  }

  const studentId = body.studentId || body.student_id;
  if (!studentId) {
    return res.status(400).json({ error: 'studentId is required' });
  }
  if (!isUuid(studentId)) {
    return res.status(400).json({ error: 'studentId must be a valid UUID' });
  }

  // ── 4. Fetch student ──────────────────────────────────────────────────────
  const { data: student, error: studentErr } = await supabaseAdmin
    .from('students')
    .select('id, first_name, last_name, school_email, personal_email, approved_hours, cohort_id')
    .eq('id', studentId)
    .single();

  if (studentErr || !student) {
    return res.status(404).json({ error: 'Student not found' });
  }

  const cohortId = body.cohortId || body.cohort_id || student.cohort_id;
  if (!cohortId || !isUuid(cohortId)) {
    return res.status(400).json({ error: 'cohort_id could not be resolved from student or request' });
  }

  // ── 5. Fetch and authorize instrument ────────────────────────────────────
  const { data: instrument, error: instrumentErr } = await supabaseAdmin
    .from('evaluation_instruments')
    .select('id, permission_status')
    .eq('slug', INSTRUMENT_SLUG)
    .single();

  if (instrumentErr || !instrument) {
    return res.status(422).json({ error: 'Instrument not found' });
  }
  if (instrument.permission_status !== 'authorized') {
    return res.status(422).json({
      error: `Instrument is not authorized for administration (permission_status: ${instrument.permission_status})`,
    });
  }

  // ── 6. Determine timepoint ────────────────────────────────────────────────
  let timepoint = body.timepoint;
  if (timepoint !== undefined && timepoint !== null && timepoint !== '') {
    if (!VALID_TIMEPOINTS.has(timepoint)) {
      return res.status(400).json({
        error: `Invalid timepoint. Valid values: ${[...VALID_TIMEPOINTS].join(', ')}`,
      });
    }
  } else {
    // Auto-derive: baseline when 0 or null approved hours; early_rotation_baseline otherwise
    const approvedHours = parseFloat(student.approved_hours || 0);
    timepoint = approvedHours > 0 ? 'early_rotation_baseline' : 'baseline';
  }

  // ── 7. Determine expires_at ───────────────────────────────────────────────
  let expiresAt;
  const expiresAtInput = body.expiresAt || body.expires_at;
  if (expiresAtInput) {
    const parsed = new Date(expiresAtInput);
    if (isNaN(parsed.getTime())) {
      return res.status(400).json({ error: 'expiresAt is not a valid date' });
    }
    expiresAt = parsed;
  } else {
    expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + DEFAULT_WINDOW_DAYS);
  }

  const now = new Date();
  const approvedHoursSnapshot = parseFloat(student.approved_hours || 0);

  // ── 8. Duplicate guard ────────────────────────────────────────────────────
  const { data: existing, error: dupErr } = await supabaseAdmin
    .from('evaluation_assignments')
    .select('id')
    .eq('instrument_id', instrument.id)
    .eq('student_id', studentId)
    .eq('cohort_id', cohortId)
    .eq('timepoint', timepoint)
    .not('status', 'in', '(revoked,expired)')
    .limit(1);

  if (dupErr) {
    console.error('[create-invitation] duplicate check error:', dupErr.message);
    return res.status(500).json({ error: 'Failed to check for existing assignment' });
  }
  if (existing && existing.length > 0) {
    return res.status(409).json({
      error: 'An active invitation already exists for this student, instrument, cohort, and timepoint.',
      existingAssignmentId: existing[0].id,
    });
  }

  // ── 9. Generate token ─────────────────────────────────────────────────────
  // Raw token lives only in this function scope. It is:
  //   - used below to build the survey URL fragment
  //   - returned to the Owner in the HTTP response body
  //   - discarded at end of request
  // It is NEVER: logged, stored in DB, written to any audit row, or returned twice.
  const { raw: rawToken, hash: tokenHash, hashPrefix: tokenHashPrefix } = generateToken();

  // Token security expiry = assignment response window + TOKEN_GRACE_DAYS
  const tokenExpiresAt = new Date(expiresAt.getTime() + TOKEN_GRACE_DAYS * 24 * 60 * 60 * 1000);

  // ── 10. Insert assignment ─────────────────────────────────────────────────
  // Inserted at status = 'sent' with all four send-state required fields populated,
  // satisfying chk_assignment_send_state.
  const { data: assignment, error: assignmentErr } = await supabaseAdmin
    .from('evaluation_assignments')
    .insert({
      instrument_id:               instrument.id,
      student_id:                  studentId,
      cohort_id:                   cohortId,
      timepoint,
      assigned_by:                 assignedBy,
      status:                      'sent',
      invited_at:                  now.toISOString(),
      sent_at:                     now.toISOString(),
      expires_at:                  expiresAt.toISOString(),
      approved_hours_at_invitation: approvedHoursSnapshot,
      notes:                       body.notes || null,
    })
    .select('id')
    .single();

  if (assignmentErr || !assignment) {
    console.error('[create-invitation] assignment insert error:', assignmentErr?.message);
    return res.status(500).json({ error: 'Failed to create assignment' });
  }

  // ── 11. Insert token ──────────────────────────────────────────────────────
  // token_hash is the HMAC-SHA256 hex digest — stored. raw token is never stored.
  const { error: tokenErr } = await supabaseAdmin
    .from('evaluation_assignment_tokens')
    .insert({
      assignment_id:     assignment.id,
      token_hash:        tokenHash,
      token_hash_prefix: tokenHashPrefix,
      expires_at:        tokenExpiresAt.toISOString(),
    });

  if (tokenErr) {
    // Rollback: delete the orphaned assignment row so the constraint stays clean.
    console.error('[create-invitation] token insert error:', tokenErr.message);
    const { error: rollbackErr } = await supabaseAdmin
      .from('evaluation_assignments')
      .delete()
      .eq('id', assignment.id);
    if (rollbackErr) {
      // Log the orphaned assignment ID so it can be manually cleaned up.
      console.error('[create-invitation] ROLLBACK FAILED — orphaned assignment:', assignment.id, rollbackErr.message);
    } else {
      console.error('[create-invitation] assignment rolled back after token insert failure');
    }
    return res.status(500).json({ error: 'Failed to issue invitation token' });
  }

  // ── 12. Build and return survey URL ──────────────────────────────────────
  // The raw token is placed in the URL hash fragment. Hash fragments are never
  // sent to the server — they exist only in the browser. The student-facing
  // /evaluation/readiness page reads it via window.location.hash and strips it
  // from the address bar immediately.
  //
  // Base URL: derived from Vercel's forwarded headers so Preview deployments
  // produce Preview links and Production produces Production links. A Preview
  // token cannot validate against Production's database — using the correct
  // host eliminates that mismatch.
  const proto   = req.headers['x-forwarded-proto'] || 'https';
  const host    = req.headers['x-forwarded-host'] || req.headers['host'];
  const baseUrl = host
    ? `${proto}://${host}`
    : (process.env.VITE_APP_URL || 'https://aspire-tracker.vercel.app');
  const surveyUrl = `${baseUrl}/evaluation/readiness#t=${rawToken}`;

  const resolvedEmail = student.personal_email || student.school_email || null;

  // Structured log — contains only safe fields. Raw token is excluded.
  // base_url is logged so URL-base mismatches (Preview vs Production) are diagnosable.
  console.log('[create-invitation] invitation created:', {
    assignment_id:     assignment.id,
    student_id:        studentId,
    cohort_id:         cohortId,
    timepoint,
    expires_at:        expiresAt.toISOString(),
    token_hash_prefix: tokenHashPrefix,
    base_url:          baseUrl,
  });

  // Raw token is returned here and discarded at end of request scope.
  return res.status(200).json({
    assignmentId: assignment.id,
    surveyUrl,
    expiresAt:    expiresAt.toISOString(),
    timepoint,
    student: {
      id:        student.id,
      firstName: student.first_name,
      lastName:  student.last_name,
      email:     resolvedEmail,
    },
  });
}
