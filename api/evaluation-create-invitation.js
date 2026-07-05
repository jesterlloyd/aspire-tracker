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
//   studentId | student_id   - required UUID
//   cohortId  | cohort_id    - optional; defaults to student.cohort_id
//   timepoint                - optional; if omitted, auto-derived from approved_hours
//   expiresAt | expires_at   - optional ISO date; defaults to +28 days from now
//   notes                    - optional TEXT (stored on assignment row)
//
// Success response:
//   { assignmentId, surveyUrl, expiresAt, timepoint, student: { id, firstName, lastName, email } }
//
// Errors:
//   400 - missing/invalid body fields
//   401 - invalid or missing session
//   403 - authenticated but not owner or admin
//   404 - student not found
//   409 - blocked: either an UNEXPIRED active invitation exists, or a COMPLETED response exists,
//         for this student+instrument+cohort+timepoint (response body carries `reason`)
//   422 - instrument not found or not authorized
//   500 - assignment or token insert/update failed (with rollback attempt where applicable)
//
// SURVEY-REISSUE-1: when the only existing assignment for the tuple is expired (or revoked) and NOT
// completed, this endpoint REUSES that row (uq_assignment forbids a second row): it mints a new token
// first, then refreshes the row to a fresh sent-state with a new expires_at. Old token rows are left
// in place (each carries its own past expiry, so old links stay unusable). Completed responses always
// block and are never modified.

import { createClient } from '@supabase/supabase-js';
import supabaseAdmin from '../lib/server/evaluation/supabase_admin.js';
import { generateToken } from '../lib/server/evaluation/tokens.js';
import { emailBaseUrl } from '../lib/server/appUrl.js';

// ── Reissue classifier (INLINED) ────────────────────────────────────────────────────────────────
// SURVEY-REISSUE-1 HOTFIX-4: inlined from the former api/lib/server/evaluation/assignment_reissue.js
// to remove a shared-import dependency suspected in a Vercel FUNCTION_INVOCATION_FAILED (module-load)
// crash. Logic is byte-for-byte identical to the former shared helper; the bulk endpoint keeps the
// SAME inlined copy so the two never diverge. Follow-up cleanup: re-extract to a shared module once
// the bundling cause is confirmed/resolved.
//
//   { kind: 'completed', row } - block; a completed response already exists.
//   { kind: 'active',    row } - block; an unexpired usable invitation already exists.
//   { kind: 'reissue',   row } - reuse this row; it is expired/revoked and not completed.
//   { kind: 'new' }            - no existing row; insert a fresh assignment.
function isCompletedAssignment(row) {
  return row?.status === 'completed' || !!row?.completed_at;
}
function isActiveUsableAssignment(row, nowMs) {
  if (!row) return false;
  if (['revoked', 'expired', 'completed'].includes(row.status)) return false;
  if (row.completed_at) return false;
  if (!row.expires_at) return true;
  return new Date(row.expires_at).getTime() > nowMs;
}
function classifyExistingAssignment(rows, nowMs) {
  const list = Array.isArray(rows) ? rows : [];
  const completedRow = list.find(isCompletedAssignment);
  if (completedRow) return { kind: 'completed', row: completedRow };
  const activeRow = list.find((r) => isActiveUsableAssignment(r, nowMs));
  if (activeRow) return { kind: 'active', row: activeRow };
  const reissueRow = list[0] || null;
  if (reissueRow) return { kind: 'reissue', row: reissueRow };
  return { kind: 'new' };
}

const INSTRUMENT_SLUG   = 'casey_fink_readiness_2024';
const VALID_TIMEPOINTS  = new Set(['baseline', 'early_rotation_baseline', 'midpoint', 'post_rotation', 'custom']);
const DEFAULT_WINDOW_DAYS    = 28;   // assignment response window
const TOKEN_GRACE_DAYS       = 2;    // token expires this many days after assignment.expires_at

// UUID format guard - prevents malformed IDs from reaching the DB.
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isUuid(v) { return typeof v === 'string' && UUID_PATTERN.test(v); }

// Safe error payload for an Owner/Admin-gated JSON 500. Surfaces the classification plus the
// Supabase error fields (code/message/details/hint) so the exact failing step is visible in the
// browser Network → Response without Vercel logs. These are schema-level diagnostics
// (e.g. "column X does not exist") - NEVER tokens, hashes, keys, secrets, emails, or links.
function safeDbError(code, err) {
  return {
    code,
    dbCode:    err?.code    || null,
    dbMessage: err?.message || null,
    dbDetails: err?.details || null,
    dbHint:    err?.hint    || null,
  };
}

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
    // Any runtime throw inside _handler lands here as safe JSON. (A module-LOAD failure crashes the
    // function before this runs - which is why the reissue import was inlined above.)
    console.error('[create-invitation] evaluation_create_invitation_unhandled:', err?.message || err);
    return res.status(500).json({
      error:   'Unexpected server error while creating invitation',
      code:    'evaluation_create_invitation_unhandled',
      message: err?.message || 'unknown',
    });
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

  const assignedBy = profile.id;  // user_profiles.id - correct FK target for assigned_by

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

  // ── 8. Classify existing assignment(s) for this tuple ─────────────────────
  // Fetch lifecycle fields (not just id) so an expired-but-still-'sent' row is recognized as
  // reissuable rather than blocking. uq_assignment guarantees ≤1 row per tuple; we fetch all rows
  // defensively and classify in shared, pure logic.
  const { data: existingRows, error: dupErr } = await supabaseAdmin
    .from('evaluation_assignments')
    .select('id, status, expires_at, completed_at')
    .eq('instrument_id', instrument.id)
    .eq('student_id', studentId)
    .eq('cohort_id', cohortId)
    .eq('timepoint', timepoint);

  if (dupErr) {
    console.error('[create-invitation] existing-assignment check error:', dupErr.message);
    return res.status(500).json({ error: 'Failed to check for existing assignment' });
  }

  const decision = classifyExistingAssignment(existingRows, now.getTime());

  if (decision.kind === 'completed') {
    return res.status(409).json({
      error: 'A completed response already exists for this student and timepoint.',
      existingAssignmentId: decision.row.id,
      reason: 'completed',
    });
  }
  if (decision.kind === 'active') {
    return res.status(409).json({
      error: 'An active invitation already exists for this student, instrument, cohort, and timepoint.',
      existingAssignmentId: decision.row.id,
      reason: 'active',
    });
  }
  // decision.kind is 'reissue' (reuse the expired/revoked, non-completed row) or 'new' (insert fresh).
  const reissueRow = decision.kind === 'reissue' ? decision.row : null;

  // ── 9. Generate token ─────────────────────────────────────────────────────
  // Raw token lives only in this function scope. It is:
  //   - used below to build the survey URL fragment
  //   - returned to the Owner in the HTTP response body
  //   - discarded at end of request
  // It is NEVER: logged, stored in DB, written to any audit row, or returned twice.
  const { raw: rawToken, hash: tokenHash, hashPrefix: tokenHashPrefix } = generateToken();

  // Token security expiry = assignment response window + TOKEN_GRACE_DAYS
  const tokenExpiresAt = new Date(expiresAt.getTime() + TOKEN_GRACE_DAYS * 24 * 60 * 60 * 1000);

  let assignmentId;

  if (reissueRow) {
    // ── 10a. REISSUE: reuse the existing row (uq_assignment forbids a second). Token-FIRST so the
    //         assignment is never flipped to a fresh active state without a usable new token.
    //
    // The token table holds ONE row per assignment (lookups are by token_hash; revocation and the
    // rollback path key on assignment_id). Inserting a SECOND token row for an existing assignment
    // violates that uniqueness - the cause of the post-6f11cf8 reissue HTTP 500. So we reissue the
    // token IN PLACE: update the existing row to the new hash (the old hash is discarded, so the old
    // link stops validating) and clear revoked_at. If no token row exists yet (e.g. an earlier
    // partial state), insert a fresh one.
    console.log('[create-invitation] reissue branch', { assignment_id: reissueRow.id });

    const { data: updatedTokens, error: tokenUpdateErr } = await supabaseAdmin
      .from('evaluation_assignment_tokens')
      .update({
        token_hash:        tokenHash,
        token_hash_prefix: tokenHashPrefix,
        expires_at:        tokenExpiresAt.toISOString(),
        revoked_at:        null,
      })
      .eq('assignment_id', reissueRow.id)
      .select('assignment_id');

    if (tokenUpdateErr) {
      // No assignment state changed yet - the row stays expired/revoked. Safe to fail with no cleanup.
      console.error('[create-invitation] reissue_token_refresh_failed:',
        { assignment_id: reissueRow.id, code: tokenUpdateErr.code, message: tokenUpdateErr.message, details: tokenUpdateErr.details, hint: tokenUpdateErr.hint });
      return res.status(500).json({ error: 'Failed to issue invitation token', ...safeDbError('reissue_token_refresh_failed', tokenUpdateErr) });
    }

    if (!updatedTokens || updatedTokens.length === 0) {
      const { error: tokenInsertErr } = await supabaseAdmin
        .from('evaluation_assignment_tokens')
        .insert({
          assignment_id:     reissueRow.id,
          token_hash:        tokenHash,
          token_hash_prefix: tokenHashPrefix,
          expires_at:        tokenExpiresAt.toISOString(),
        });
      if (tokenInsertErr) {
        console.error('[create-invitation] reissue_token_refresh_failed (insert):',
          { assignment_id: reissueRow.id, code: tokenInsertErr.code, message: tokenInsertErr.message, details: tokenInsertErr.details, hint: tokenInsertErr.hint });
        return res.status(500).json({ error: 'Failed to issue invitation token', ...safeDbError('reissue_token_refresh_failed', tokenInsertErr) });
      }
    }

    // Refresh the existing row to a fresh sent-state. The payload is restricted to EXACTLY the fields
    // a successful fresh insert writes (status + the three send-state timestamps + approved-hours
    // snapshot + notes), so it cannot reference a column the insert path does not, and it satisfies
    // chk_assignment_send_state the same way. revoked_at is additionally cleared so reissuing a
    // previously-revoked row is consistent (column confirmed present - read in token-validate). No
    // updated_at is written (not confirmed present in Production). completed_at is NOT touched
    // (completed rows were blocked at step 8).
    const { data: updated, error: updateErr } = await supabaseAdmin
      .from('evaluation_assignments')
      .update({
        status:                       'sent',
        invited_at:                   now.toISOString(),
        sent_at:                      now.toISOString(),
        expires_at:                   expiresAt.toISOString(),
        approved_hours_at_invitation: approvedHoursSnapshot,
        revoked_at:                   null,
        notes:                        body.notes || null,
      })
      .eq('id', reissueRow.id)
      .select('id')
      .single();

    if (updateErr || !updated) {
      // The token row was refreshed but the assignment window was NOT (still expired), so the new
      // link will not validate. No false-active state is produced. Report the failure.
      console.error('[create-invitation] reissue_assignment_refresh_failed:',
        { assignment_id: reissueRow.id, code: updateErr?.code, message: updateErr?.message, details: updateErr?.details, hint: updateErr?.hint });
      return res.status(500).json({ error: 'Failed to refresh assignment for reissue', ...safeDbError('reissue_assignment_refresh_failed', updateErr) });
    }
    assignmentId = updated.id;
  } else {
    // ── 10b. NEW: insert assignment at status='sent' with all four send-state required fields
    //         populated, satisfying chk_assignment_send_state.
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

    // ── 11. Insert token. token_hash is the HMAC-SHA256 hex digest - stored. raw token never stored.
    const { error: tokenErr } = await supabaseAdmin
      .from('evaluation_assignment_tokens')
      .insert({
        assignment_id:     assignment.id,
        token_hash:        tokenHash,
        token_hash_prefix: tokenHashPrefix,
        expires_at:        tokenExpiresAt.toISOString(),
      });

    if (tokenErr) {
      // Rollback: delete the orphaned assignment row so the constraint stays clean. (Only the
      // just-inserted NEW row is deleted - never a reused row.)
      console.error('[create-invitation] token insert error:', tokenErr.message);
      const { error: rollbackErr } = await supabaseAdmin
        .from('evaluation_assignments')
        .delete()
        .eq('id', assignment.id);
      if (rollbackErr) {
        // Log the orphaned assignment ID so it can be manually cleaned up.
        console.error('[create-invitation] ROLLBACK FAILED, orphaned assignment:', assignment.id, rollbackErr.message);
      } else {
        console.error('[create-invitation] assignment rolled back after token insert failure');
      }
      return res.status(500).json({ error: 'Failed to issue invitation token' });
    }
    assignmentId = assignment.id;
  }

  // ── 12. Build and return survey URL ──────────────────────────────────────
  // The raw token is placed in the URL hash fragment. Hash fragments are never
  // sent to the server - they exist only in the browser. The student-facing
  // /evaluation/readiness page reads it via window.location.hash and strips it
  // from the address bar immediately.
  //
  // Base URL for the survey link: the canonical domain (aspireintelligence.app)
  // in production; on Preview deployments the forwarded host so a Preview token
  // validates against the Preview database (a Preview token cannot validate
  // against Production). See lib/server/appUrl.js.
  const baseUrl = emailBaseUrl(req);
  const surveyUrl = `${baseUrl}/evaluation/readiness#t=${rawToken}`;

  const resolvedEmail = student.personal_email || student.school_email || null;

  // Structured log - contains only safe fields. Raw token is excluded.
  // base_url is logged so URL-base mismatches (Preview vs Production) are diagnosable.
  console.log('[create-invitation] invitation created:', {
    assignment_id:     assignmentId,
    reissued:          !!reissueRow,
    student_id:        studentId,
    cohort_id:         cohortId,
    timepoint,
    expires_at:        expiresAt.toISOString(),
    token_hash_prefix: tokenHashPrefix,
    base_url:          baseUrl,
  });

  // Raw token is returned here and discarded at end of request scope.
  return res.status(200).json({
    assignmentId,
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
