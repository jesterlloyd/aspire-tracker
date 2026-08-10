// api/evaluation-send-preceptor-invitations.js
//
// Owner/Admin-only manual send flow for the ASPIRE Preceptor Student Progress &
// Readiness Feedback survey (slug: preceptor_progress). This is an Evaluation-specific
// flow - it does NOT use or modify the ASPIRE Connect → Outreach "Send to many" path,
// nor the Casey-Fink/student send endpoints.
//
// For each selected student (max 5) this endpoint delegates to the shared send core
// (lib/server/evaluation/preceptorSend.js#processPreceptorSend), which resolves the
// student's preceptor server-side, creates a preceptor evaluation assignment
// (respondent_type = 'preceptor') in a sendable state, generates a single-use token
// (raw token never leaves the server), emails the resolved preceptor via Resend, and
// records the send in notification_log. The SAME core is used by the PS-3b queue-release
// endpoint, so behavior is identical; only the source/notes markers differ.
//
// Subject (student_id) vs respondent (resolved preceptor):
//   - student_id remains the SUBJECT of the assignment.
//   - respondent_* identify the responding preceptor (PS-2a columns).
//
// Feedback period → timepoint mapping (no schema migration is permitted; the timepoint
// CHECK constraint does not allow the literal period strings):
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
//   - Recipient emails resolved server-side only - no override from request body.
//   - Sequential sends - no Promise.all around Resend calls.
//   - Per-recipient failure isolation: failures do not abort the batch.
//   - Raw token and survey URL are NEVER persisted (no DB column, no log, no metadata).
//
// POST /api/evaluation-send-preceptor-invitations
// Authorization: Bearer <session-token>
// Body: { items: [{ student_id }], period, confirmation_phrase }

import { createClient } from '@supabase/supabase-js';
import supabaseAdmin from '../lib/server/evaluation/supabase_admin.js';
import { formatExpiresAt } from '../lib/server/evaluation/preceptorEmailTemplates.js';
import { processPreceptorSend } from '../lib/server/evaluation/preceptorSend.js';
import { emailBaseUrl } from '../lib/server/appUrl.js';
import {
  FEEDBACK_PERIODS,
  PERIOD_TO_TIMEPOINT,
  PERIOD_LABELS,
} from '../lib/server/evaluation/preceptor_progress_validation.js';

const INSTRUMENT_SLUG = 'preceptor_progress';
const MAX_BATCH       = 5;
const CONFIRMATION    = 'SEND FEEDBACK REQUESTS';
const WINDOW_DAYS     = 28;
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
  const senderUserId = profile.id;   // user_profiles.id - FK target for assigned_by
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

  // Reject recipient override fields - recipients are resolved server-side only.
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
    // PRECEPTOR-ROUTE-1: optional per-item redirect to one of the student's ACTIVE
    // canonical assignments (a preceptors.id; validated in the shared send core).
    const rp = items[i]?.redirect_preceptor_id;
    if (rp != null && !isUuid(rp)) {
      return res.status(400).json({ success: false, error: `items[${i}].redirect_preceptor_id must be a valid UUID` });
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

  // Base URL: canonical domain in Production; forwarded host on Preview so
  // Preview-token links validate against the Preview database. See lib/server/appUrl.js.
  const baseUrl = emailBaseUrl(req);

  console.log('[preceptor-send] batch_start:', {
    count: items.length, period, instrument_id: instrument.id, by: senderUserId,
  });

  const sent    = [];
  const skipped = [];
  const failed  = [];

  // ── 4. Sequential per-student loop - delegates to the shared send core. The
  //      source/notes markers identify these as manual PS-2b sends.
  for (const item of items) {
    const r = await processPreceptorSend({
      instrument,
      studentId:      item.student_id,
      period, timepoint, periodLabel,
      expiresAt, tokenExpiresAt, expiresAtHuman, baseUrl,
      senderUserId, senderEmail,
      source:     'preceptor_feedback_send',
      notesValue: `preceptor_progress:${period}`,
      redirectPreceptorId: item.redirect_preceptor_id ?? null,
    });
    if (r.status === 'sent') sent.push(r);
    else if (r.status === 'skipped') skipped.push(r);
    else failed.push(r);
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
