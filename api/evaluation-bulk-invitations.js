// api/evaluation-bulk-invitations.js
//
// Owner/admin-authenticated endpoint that generates a secure survey invitation
// for each student in a submitted list (bulk mode).
//
// Phase 3A.1: generate_only mode.
//   - Generates one assignment + token per eligible student.
//   - Returns surveyUrl per student in the response body (shown once, never re-served).
//   - No email is sent. No Resend call. No scheduling.
//   - Raw tokens are never stored in the database.
//   - Raw tokens and survey URLs are never logged.
//
// POST /api/evaluation-bulk-invitations
// Authorization: Bearer <session-token>
//
// Body (JSON):
//   cohortId      - required UUID
//   studentIds    - required non-empty array of UUIDs (max 100, auto-deduplicated)
//   instrumentSlug - optional; defaults to 'casey_fink_readiness_2024'
//   timepoint     - required; must be one of: baseline, early_rotation_baseline, midpoint, post_rotation, custom
//   expiresAt     - optional ISO date; defaults to now + 28 days
//   notes         - optional text, max 500 chars
//   mode          - required; must be 'generate_only'
//
// Success response (200):
//   { success, mode, requestedCount, dedupedCount, createdCount,
//     skippedDuplicateCount, skippedMissingEmailCount, skippedInvalidStatusCount, failedCount,
//     generated, skippedDuplicates, skippedMissingEmails, skippedInvalidStatus, failed }
//
// Errors:
//   400 - missing/invalid body fields
//   401 - invalid or missing session
//   403 - authenticated but not owner or admin
//   422 - instrument not found or not authorized

import { createClient } from '@supabase/supabase-js';
import supabaseAdmin from '../lib/server/evaluation/supabase_admin.js';
import { generateToken } from '../lib/server/evaluation/tokens.js';
import { emailBaseUrl } from '../lib/server/appUrl.js';
import { INACTIVE_MESSAGE } from './lib/activeAccount.js';

// ── Reissue classifier (INLINED) ────────────────────────────────────────────────────────────────
// SURVEY-REISSUE-1 HOTFIX-4: inlined from the former api/lib/server/evaluation/assignment_reissue.js
// to remove a shared-import dependency suspected in a Vercel FUNCTION_INVOCATION_FAILED (module-load)
// crash. Logic is byte-for-byte identical to the single endpoint's inlined copy so the two never
// diverge. Follow-up cleanup: re-extract to a shared module once the bundling cause is resolved.
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

const INSTRUMENT_SLUG      = 'casey_fink_readiness_2024';
const VALID_TIMEPOINTS     = new Set(['baseline', 'early_rotation_baseline', 'midpoint', 'post_rotation', 'custom']);
const DEFAULT_WINDOW_DAYS  = 28;
const TOKEN_GRACE_DAYS     = 2;
const MAX_STUDENTS_PER_REQ = 100;

// Student status values that are eligible for each timepoint.
// Derived from actual app status values observed in api/keith.js and src/pages/Connect.jsx.
// 'Placed' and 'Active Rotation' are confirmed app status strings.
const TIMEPOINT_ELIGIBILITY = {
  baseline:               new Set(['Placed', 'Active Rotation']),
  early_rotation_baseline: new Set(['Placed', 'Active Rotation']),
  midpoint:               new Set(['Active Rotation']),
  post_rotation:          new Set(['Active Rotation', 'Completed']),
  custom:                 new Set(['Placed', 'Active Rotation', 'Completed']),
};

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

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    return await _handler(req, res);
  } catch (err) {
    console.error('[bulk-invitations] unhandled exception:', err?.message || err);
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

  // ── 2. Role check - owner/admin only ─────────────────────────────────────
  // assigned_by must store user_profiles.id (not auth.users.id) per FK constraint.
  const { data: profile } = await supabaseAdmin
    .from('user_profiles')
    .select('id, role, is_active')
    .eq('auth_user_id', user.id)
    .single();

  // S-05: a deactivated account keeps a valid access token until it expires.
  // Refuse it before any work is performed, so deactivation ends access at once.
  if (profile && profile.is_active === false) {
    return res.status(403).json({ error: 'Forbidden', message: INACTIVE_MESSAGE });
  }
  if (!profile || !['owner', 'admin'].includes(profile.role)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const assignedBy = profile.id;

  // ── 3. Parse and validate request body ───────────────────────────────────
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

  // mode - must be 'generate_only' for Phase 3A.1
  const mode = body.mode;
  if (mode !== 'generate_only') {
    return res.status(400).json({ error: 'Only generate_only mode is supported in this release.' });
  }

  // cohortId
  const cohortId = body.cohortId;
  if (!cohortId || !isUuid(cohortId)) {
    return res.status(400).json({ error: 'cohortId is required and must be a valid UUID' });
  }

  // studentIds
  const studentIdsRaw = body.studentIds;
  if (!Array.isArray(studentIdsRaw) || studentIdsRaw.length === 0) {
    return res.status(400).json({ error: 'studentIds must be a non-empty array' });
  }
  if (studentIdsRaw.length > MAX_STUDENTS_PER_REQ) {
    return res.status(400).json({ error: `studentIds may not exceed ${MAX_STUDENTS_PER_REQ} per request` });
  }
  const invalidIds = studentIdsRaw.filter(id => !isUuid(id));
  if (invalidIds.length > 0) {
    return res.status(400).json({ error: `studentIds contains invalid UUIDs: ${invalidIds.slice(0, 5).join(', ')}` });
  }
  // Server-side deduplication
  const studentIds    = [...new Set(studentIdsRaw)];
  const requestedCount = studentIdsRaw.length;
  const dedupedCount   = studentIds.length;

  // timepoint
  const timepoint = body.timepoint;
  if (!timepoint || !VALID_TIMEPOINTS.has(timepoint)) {
    return res.status(400).json({
      error: `timepoint is required. Valid values: ${[...VALID_TIMEPOINTS].join(', ')}`,
    });
  }

  // expiresAt
  let expiresAt;
  const expiresAtInput = body.expiresAt || body.expires_at;
  if (expiresAtInput) {
    const parsed = new Date(expiresAtInput);
    if (isNaN(parsed.getTime())) {
      return res.status(400).json({ error: 'expiresAt is not a valid date' });
    }
    if (parsed <= new Date()) {
      return res.status(400).json({ error: 'expiresAt must be a future date' });
    }
    expiresAt = parsed;
  } else {
    expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + DEFAULT_WINDOW_DAYS);
  }

  // notes
  const rawNotes = typeof body.notes === 'string' ? body.notes.trim().slice(0, 500) : null;
  const notes    = rawNotes || null;

  // instrumentSlug - defaults to the only currently supported instrument
  const instrumentSlug = (typeof body.instrumentSlug === 'string' && body.instrumentSlug.trim())
    ? body.instrumentSlug.trim()
    : INSTRUMENT_SLUG;

  // ── 4. Fetch and authorize instrument ────────────────────────────────────
  const { data: instrument, error: instrumentErr } = await supabaseAdmin
    .from('evaluation_instruments')
    .select('id, permission_status')
    .eq('slug', instrumentSlug)
    .single();

  if (instrumentErr || !instrument) {
    return res.status(422).json({ error: `Instrument not found: ${instrumentSlug}` });
  }
  if (instrument.permission_status !== 'authorized') {
    return res.status(422).json({
      error: `Instrument is not authorized for administration (permission_status: ${instrument.permission_status})`,
    });
  }

  // Derive URL base from Vercel forwarded headers (same logic as single endpoint).
  // Production produces canonical (aspireintelligence.app) links; Preview uses the
  // forwarded host so Preview-token links validate against Preview. See lib/server/appUrl.js.
  const baseUrl = emailBaseUrl(req);

  const now = new Date();
  const tokenExpiresAt = new Date(expiresAt.getTime() + TOKEN_GRACE_DAYS * 24 * 60 * 60 * 1000);
  const eligibleStatuses = TIMEPOINT_ELIGIBILITY[timepoint] || new Set(['Placed', 'Active Rotation']);

  console.log('[bulk-invitations] batch started:', {
    cohort_id:       cohortId,
    timepoint,
    instrument_id:   instrument.id,
    deduped_count:   dedupedCount,
    expires_at:      expiresAt.toISOString(),
    assigned_by:     assignedBy,
    base_url:        baseUrl,
  });

  // ── 5. Per-student processing ─────────────────────────────────────────────
  const generated           = [];
  const skippedDuplicates   = [];
  const skippedMissingEmails = [];
  const skippedInvalidStatus = [];
  const failed              = [];

  for (const studentId of studentIds) {
    try {
      // Step 1: Fetch student and confirm cohort membership
      const { data: student, error: studentErr } = await supabaseAdmin
        .from('students')
        .select('id, first_name, last_name, school_email, personal_email, approved_hours, cohort_id, status, school')
        .eq('id', studentId)
        .single();

      if (studentErr || !student) {
        failed.push({ studentId, studentName: null, reason: 'Student not found' });
        continue;
      }

      const studentName = `${student.first_name || ''} ${student.last_name || ''}`.trim() || studentId;

      if (student.cohort_id !== cohortId) {
        failed.push({ studentId, studentName, reason: 'Student does not belong to the specified cohort' });
        continue;
      }

      // Step 2: Email check - required for future delivery
      const resolvedEmail = student.personal_email || student.school_email || null;
      if (!resolvedEmail) {
        skippedMissingEmails.push({ studentId, studentName, school: student.school || null });
        continue;
      }

      // Step 3: Status eligibility
      if (!eligibleStatuses.has(student.status)) {
        skippedInvalidStatus.push({ studentId, studentName, status: student.status || null });
        continue;
      }

      // Step 4: Classify existing assignment(s) for this tuple - shared with the single endpoint, so
      // single and bulk never diverge. Fetch lifecycle fields (not just id/status) so an
      // expired-but-still-'sent' row is recognized as reissuable rather than blocking.
      const { data: existingRows, error: dupErr } = await supabaseAdmin
        .from('evaluation_assignments')
        .select('id, status, expires_at, completed_at')
        .eq('instrument_id', instrument.id)
        .eq('student_id', studentId)
        .eq('cohort_id', cohortId)
        .eq('timepoint', timepoint);

      if (dupErr) {
        console.error('[bulk-invitations] existing-assignment check error for student', studentId, dupErr.message);
        failed.push({ studentId, studentName, reason: 'Duplicate check failed' });
        continue;
      }

      const decision = classifyExistingAssignment(existingRows, now.getTime());

      // Completed responses and unexpired active invitations both block (skipped, not reissued).
      // A completed row is never modified.
      if (decision.kind === 'completed' || decision.kind === 'active') {
        skippedDuplicates.push({
          studentId,
          studentName,
          existingAssignmentId: decision.row.id,
          existingStatus:       decision.kind === 'completed' ? 'completed' : decision.row.status,
        });
        continue;
      }
      // 'reissue' → reuse the expired/revoked, non-completed row. 'new' → insert fresh.
      const reissueRow = decision.kind === 'reissue' ? decision.row : null;

      // Step 5: Generate token
      // Raw token lives only in this loop iteration scope.
      // It is used once to build the survey URL, returned in this response, then discarded.
      // It is NEVER stored in the database, NEVER logged, NEVER returned a second time.
      const { raw: rawToken, hash: tokenHash, hashPrefix: tokenHashPrefix } = generateToken();

      const approvedHoursSnapshot = parseFloat(student.approved_hours || 0);

      let assignmentId;

      if (reissueRow) {
        // Step 6a: REISSUE - reuse the existing row (uq_assignment forbids a second). Token-FIRST so
        // the row is never flipped to a fresh active state without a usable new token.
        //
        // One token row per assignment (lookups by token_hash; revocation/rollback key on
        // assignment_id), so a SECOND insert for an existing assignment violates uniqueness - the
        // post-6f11cf8 reissue 500. Reissue the token IN PLACE: update the existing row to the new
        // hash (old hash discarded → old link stops validating), clear revoked_at; insert only if no
        // token row exists yet.
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
          // No assignment state changed - the row stays expired/revoked. Safe to fail with no cleanup.
          console.error('[bulk-invitations] reissue_token_refresh_failed for student', studentId,
            { assignment_id: reissueRow.id, code: tokenUpdateErr.code, message: tokenUpdateErr.message, details: tokenUpdateErr.details, hint: tokenUpdateErr.hint });
          failed.push({ studentId, studentName, reason: 'Token reissue failed' });
          continue;
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
            console.error('[bulk-invitations] reissue_token_refresh_failed (insert) for student', studentId,
              { assignment_id: reissueRow.id, code: tokenInsertErr.code, message: tokenInsertErr.message, details: tokenInsertErr.details, hint: tokenInsertErr.hint });
            failed.push({ studentId, studentName, reason: 'Token reissue failed' });
            continue;
          }
        }

        // Refresh to a fresh sent-state. The payload is restricted to EXACTLY the fields a successful
        // fresh insert writes (status + send-state timestamps + approved-hours snapshot + notes), so it
        // cannot reference a column the insert path does not, and satisfies chk_assignment_send_state
        // the same way. revoked_at is additionally cleared (column confirmed present). No updated_at is
        // written (not confirmed present in Production). completed_at never touched (completed rows
        // were skipped above).
        const { data: updated, error: updateErr } = await supabaseAdmin
          .from('evaluation_assignments')
          .update({
            status:                       'sent',
            invited_at:                   now.toISOString(),
            sent_at:                      now.toISOString(),
            expires_at:                   expiresAt.toISOString(),
            approved_hours_at_invitation: approvedHoursSnapshot,
            revoked_at:                   null,
            notes,
          })
          .eq('id', reissueRow.id)
          .select('id')
          .single();

        if (updateErr || !updated) {
          // Token refreshed but the row's window was not (still expired) → new link will not
          // validate; no false-active state. Report as failed for this student.
          console.error('[bulk-invitations] reissue_assignment_refresh_failed for student', studentId,
            { assignment_id: reissueRow.id, code: updateErr?.code, message: updateErr?.message, details: updateErr?.details, hint: updateErr?.hint });
          failed.push({ studentId, studentName, reason: 'Assignment reissue failed' });
          continue;
        }
        assignmentId = updated.id;
      } else {
        // Step 6b: NEW - insert assignment.
        // Satisfies chk_assignment_send_state: status='sent' + invited_at + sent_at + expires_at all set.
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
            notes,
          })
          .select('id')
          .single();

        if (assignmentErr || !assignment) {
          console.error('[bulk-invitations] assignment insert error for student', studentId, assignmentErr?.message);
          failed.push({ studentId, studentName, reason: 'Assignment insert failed' });
          continue;
        }

        // Step 7: Insert token (hash only - raw token never stored)
        const { error: tokenErr } = await supabaseAdmin
          .from('evaluation_assignment_tokens')
          .insert({
            assignment_id:     assignment.id,
            token_hash:        tokenHash,
            token_hash_prefix: tokenHashPrefix,
            expires_at:        tokenExpiresAt.toISOString(),
          });

        if (tokenErr) {
          // Rollback the orphaned NEW assignment row (never a reused row).
          console.error('[bulk-invitations] token insert error for student', studentId, tokenErr.message);
          const { error: rollbackErr } = await supabaseAdmin
            .from('evaluation_assignments')
            .delete()
            .eq('id', assignment.id);
          if (rollbackErr) {
            console.error('[bulk-invitations] ROLLBACK FAILED, orphaned assignment:', assignment.id, rollbackErr.message);
          } else {
            console.error('[bulk-invitations] assignment rolled back after token failure for student', studentId);
          }
          failed.push({ studentId, studentName, reason: 'Token insert failed' });
          continue;
        }
        assignmentId = assignment.id;
      }

      // Step 8: Build survey URL (raw token in hash fragment, never reaches server)
      const surveyUrl = `${baseUrl}/evaluation/readiness#t=${rawToken}`;

      // Safe log: assignment id and student id only - no raw token, no survey URL
      console.log('[bulk-invitations] generated:', {
        assignment_id:     assignmentId,
        reissued:          !!reissueRow,
        student_id:        studentId,
        token_hash_prefix: tokenHashPrefix,
      });

      generated.push({
        studentId,
        studentName,
        school:       student.school || null,
        email:        resolvedEmail,
        assignmentId,
        timepoint,
        expiresAt:    expiresAt.toISOString(),
        surveyUrl,
      });

    } catch (studentErr) {
      const studentName = studentId; // safe fallback if student fetch failed
      console.error('[bulk-invitations] unexpected error for student', studentId, studentErr?.message);
      failed.push({ studentId, studentName, reason: `Unexpected error: ${studentErr?.message || 'unknown'}` });
    }
  }

  const createdCount              = generated.length;
  const skippedDuplicateCount     = skippedDuplicates.length;
  const skippedMissingEmailCount  = skippedMissingEmails.length;
  const skippedInvalidStatusCount = skippedInvalidStatus.length;
  const failedCount               = failed.length;

  // Summary log - counts only, no raw tokens or URLs
  console.log('[bulk-invitations] batch complete:', {
    cohort_id:      cohortId,
    timepoint,
    requested:      requestedCount,
    deduped:        dedupedCount,
    created:        createdCount,
    skipped_dup:    skippedDuplicateCount,
    skipped_email:  skippedMissingEmailCount,
    skipped_status: skippedInvalidStatusCount,
    failed:         failedCount,
  });

  // NOTE: notification_log audit logging is intentionally skipped in Phase 3A.1.
  // The notification_log table is designed for email delivery records with Resend
  // integration (resend_email_id, subject, recipient_email columns). Writing
  // assignment-creation audit events to this table without migration would require
  // providing misleading placeholder values. Proper assignment audit logging should
  // be added as a follow-up with a dedicated audit_log table or evaluation_events table.

  return res.status(200).json({
    success:                  true,
    mode:                     'generate_only',
    requestedCount,
    dedupedCount,
    createdCount,
    skippedDuplicateCount,
    skippedMissingEmailCount,
    skippedInvalidStatusCount,
    failedCount,
    generated,
    skippedDuplicates,
    skippedMissingEmails,
    skippedInvalidStatus,
    failed,
  });
}
