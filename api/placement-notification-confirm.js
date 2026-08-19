import { createClient } from '@supabase/supabase-js';
import supabaseAdmin from '../lib/server/evaluation/supabase_admin.js';
import { verifyPlacementSend } from './lib/placementSendGuard.js';
import {
  NOTIFICATION_TARGETS, NOTIFY_META, notificationKey, notificationStateIndex,
  CONFIRMED_TYPE, CORRECTED_TYPE, CONFIRMED_STATUS, CORRECTED_STATUS, LEGACY_MANUAL_TYPE,
} from '../src/lib/placementNotificationState.js';

// PLACEMENT-NOTIFICATION-CONTROL-1 - the ONE writer of placement notification
// state, for both targets and both directions.
//
//   POST { target: 'unit_leader'|'preceptor', action: 'confirm'|'correct', ... }
//
// WHAT IT IS FOR. Staff, not systems, decide whether a unit leader or preceptor
// has been notified about a placement. Sending an email produces provider
// delivery history; it never produces the state this endpoint writes. That is
// why there is no automatic caller: every row here exists because a person
// clicked a confirmation in a dialog that named who, which student, and which
// unit.
//
// APPEND-ONLY. A correction is a NEW row carrying its reason and its author,
// and it points at the confirmation it corrects. The original is never updated
// or deleted, so the audit trail reads forwards: confirmed by X on date, then
// corrected by Y on date because Z. Nothing here touches the match, the unit,
// or the preceptor assignment.
//
// THE PLACEMENT IS PROVED, NOT TRUSTED. Every claim in the request is
// re-verified against the database by the same guard a real send passes
// through - so a stale tab, an edited payload, a replaced preceptor or a
// recreated match is refused with the reason, and nothing is written.

/* global process */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v) => typeof v === 'string' && UUID_RE.test(v.trim());
const TARGETS = [NOTIFICATION_TARGETS.UNIT_LEADER, NOTIFICATION_TARGETS.PRECEPTOR];
const ACTIONS = ['confirm', 'correct'];

async function verifyCaller(req) {
  const authHeader = req.headers['authorization'] || req.headers['Authorization'] || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) return { ok: false, status: 401 };

  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

  let user;
  try {
    const userClient = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data, error } = await userClient.auth.getUser();
    if (error || !data?.user) return { ok: false, status: 401 };
    user = data.user;
  } catch {
    return { ok: false, status: 401 };
  }

  const { data: profile } = await supabaseAdmin
    .from('user_profiles')
    .select('id, role, is_owner, full_name, email')
    .eq('auth_user_id', user.id)
    .maybeSingle();

  if (!profile) return { ok: false, status: 403 };
  const isOwnerAdmin = profile.is_owner === true || ['owner', 'admin'].includes(profile.role);
  if (!isOwnerAdmin) return { ok: false, status: 403 };
  return { ok: true, profile };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });

  // ── 1. Authorize on the SERVER. UI gating is not a gate. ──────────────────
  const auth = await verifyCaller(req);
  if (!auth.ok) {
    return res.status(auth.status).json({ success: false, error: auth.status === 403 ? 'Forbidden' : 'Unauthorized' });
  }
  const actorId = auth.profile.id;
  const actorName = (auth.profile.full_name || auth.profile.email || 'Staff member').trim();

  // ── 2. Strict body ────────────────────────────────────────────────────────
  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  } catch {
    return res.status(400).json({ success: false, error: 'Invalid request body' });
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return res.status(400).json({ success: false, error: 'Invalid request body' });
  }

  const ALLOWED = ['target', 'action', 'match_id', 'student_id', 'unit_id', 'cohort_id', 'preceptor_id', 'reason'];
  const extra = Object.keys(body).filter(k => !ALLOWED.includes(k));
  if (extra.length) {
    // The acting user comes from the session. A body that tries to supply one -
    // or anything else - is refused outright rather than silently trimmed.
    return res.status(400).json({
      success: false,
      error: `Unexpected field(s): ${extra.join(', ')}. The confirming user is taken from your session, never from the request.`,
    });
  }

  const target = typeof body.target === 'string' ? body.target.trim() : '';
  if (!TARGETS.includes(target)) {
    return res.status(400).json({ success: false, error: `target must be one of: ${TARGETS.join(', ')}` });
  }
  const action = typeof body.action === 'string' ? body.action.trim() : 'confirm';
  if (!ACTIONS.includes(action)) {
    return res.status(400).json({ success: false, error: `action must be one of: ${ACTIONS.join(', ')}` });
  }
  for (const k of ['match_id', 'student_id', 'unit_id', 'cohort_id']) {
    if (!isUuid(body[k])) return res.status(400).json({ success: false, error: `${k} must be a valid UUID` });
  }
  const isPreceptor = target === NOTIFICATION_TARGETS.PRECEPTOR;
  if (isPreceptor && !isUuid(body.preceptor_id)) {
    return res.status(400).json({ success: false, error: 'preceptor_id must be a valid UUID for a preceptor notification' });
  }
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (action === 'correct' && reason.length < 3) {
    // The reason IS the audit. A correction without one is not auditable.
    return res.status(400).json({ success: false, error: 'A correction requires a reason.' });
  }

  // ── 3. Prove the placement. The SAME guard a real send passes. ────────────
  // For a UNIT-LEADER notification there is no preceptor in the claim, so the
  // guard's preceptor and recipient checks do not apply; the match, student,
  // unit and cohort are still verified below from the same rows.
  let verified;
  if (isPreceptor) {
    const verdict = await verifyPlacementSend({
      db: supabaseAdmin,
      ref: {
        match_id: body.match_id, student_id: body.student_id, unit_id: body.unit_id,
        cohort_id: body.cohort_id, preceptor_id: body.preceptor_id,
      },
      recipientType: 'contact',
      recipientEmail: '',
      skipRecipientCheck: true,   // nothing is addressed here; every placement check still runs
    });
    if (!verdict.ok) {
      return res.status(verdict.status).json({ success: false, error: verdict.error, placement_error: verdict.code });
    }
    verified = verdict.verified;
  } else {
    const { data: match, error: matchErr } = await supabaseAdmin
      .from('matches')
      .select('id, student_id, unit_id, cohort_id')
      .eq('id', body.match_id)
      .maybeSingle();
    if (matchErr) {
      return res.status(503).json({ success: false, error: 'The placement could not be verified. Nothing was recorded.' });
    }
    if (!match) {
      return res.status(409).json({ success: false, error: 'This placement no longer exists. Reopen it from the Placement Board and try again.', placement_error: 'match_missing' });
    }
    if (String(match.student_id) !== String(body.student_id)) {
      return res.status(409).json({ success: false, error: 'This placement is for a different student than claimed. Nothing was recorded.', placement_error: 'student_mismatch' });
    }
    if (String(match.unit_id) !== String(body.unit_id)) {
      return res.status(409).json({ success: false, error: 'This placement is for a different unit than claimed. Nothing was recorded.', placement_error: 'unit_mismatch' });
    }
    if (String(match.cohort_id) !== String(body.cohort_id)) {
      return res.status(409).json({ success: false, error: 'This placement belongs to a different cohort than claimed. Nothing was recorded.', placement_error: 'cohort_mismatch' });
    }
    const { data: unit } = await supabaseAdmin
      .from('units').select('id, unit_name, contact_person, contact_email').eq('id', match.unit_id).maybeSingle();
    verified = { unitName: unit?.unit_name || '', preceptorName: unit?.contact_person || '', preceptorEmail: unit?.contact_email || '' };
  }

  // ── 4. Read the CURRENT state from the ledger ─────────────────────────────
  //
  // Filtered by MATCH only, never by notification_target. A pre-ledger
  // placement_manual_confirmation carries no target field - the field did not
  // exist when it was written - so filtering on it made those rows invisible
  // here while the board still (correctly) showed them as confirmed. The Owner
  // then got a correction control that silently answered "nothing to correct".
  // notificationStateIndex already resolves each row's target, including the
  // legacy rows, so the reducer is the right place to make that decision.
  const key = notificationKey({ target, matchId: body.match_id, preceptorId: body.preceptor_id });
  const { data: existing, error: existErr } = await supabaseAdmin
    .from('notification_log')
    .select('id, notification_type, status, sent_at, created_at, metadata')
    .in('notification_type', [CONFIRMED_TYPE, CORRECTED_TYPE, LEGACY_MANUAL_TYPE])
    .eq('metadata->>placement_match_id', body.match_id);
  if (existErr) {
    return res.status(503).json({ success: false, error: 'The notification history could not be read. Nothing was recorded.' });
  }
  const index = notificationStateIndex(existing || []);
  const current = index.get(key) || null;

  // Idempotency by EFFECT: confirming what is already confirmed, or correcting
  // what is not confirmed, changes nothing - so nothing is appended and no
  // duplicate effective state can exist.
  if (action === 'confirm' && current?.confirmed) {
    return res.status(200).json({
      success: true, recorded: false, already: true,
      message: 'This placement is already recorded as notified.',
    });
  }
  if (action === 'correct') {
    // A legacy confirmation (matches.notification_sent, no ledger row) is still
    // correctable - the correction row becomes the first ledger event.
    let legacyConfirmed = false;
    if (!current) {
      const { data: m } = await supabaseAdmin
        .from('matches').select('notification_sent').eq('id', body.match_id).maybeSingle();
      legacyConfirmed = target === NOTIFICATION_TARGETS.UNIT_LEADER && m?.notification_sent === true;
    }
    if (!current?.confirmed && !legacyConfirmed) {
      return res.status(200).json({
        success: true, recorded: false, already: true,
        message: 'This placement is not currently recorded as notified, so there is nothing to correct.',
      });
    }
  }

  // ── 5. Append. Never update, never delete. ────────────────────────────────
  const now = new Date().toISOString();
  const isConfirm = action === 'confirm';
  const metadata = {
    [NOTIFY_META.target]: target,
    [NOTIFY_META.match]: body.match_id,
    [NOTIFY_META.student]: body.student_id,
    [NOTIFY_META.unit]: body.unit_id,
    [NOTIFY_META.cohort]: body.cohort_id,
    ...(isPreceptor ? { [NOTIFY_META.preceptor]: body.preceptor_id } : {}),
    [NOTIFY_META.actor]: actorId,
    [NOTIFY_META.actorName]: actorName,
    ...(isConfirm ? {} : {
      [NOTIFY_META.reason]: reason,
      // Points at the record it corrects, which is preserved untouched.
      [NOTIFY_META.corrects]: current?.id || null,
    }),
    source: isConfirm ? 'staff_confirmation' : 'staff_correction',
  };

  const { data: row, error: insErr } = await supabaseAdmin
    .from('notification_log')
    .insert({
      notification_type: isConfirm ? CONFIRMED_TYPE : CORRECTED_TYPE,
      audience: isPreceptor ? 'contact' : 'unit_leader',
      recipient_email: verified?.preceptorEmail || '',
      recipient_name: verified?.preceptorName || '',
      recipient_role: isPreceptor ? 'Preceptor' : 'Unit Leader',
      subject: isConfirm
        ? `Placement notification confirmed (${target})`
        : `Placement notification corrected (${target})`,
      status: isConfirm ? CONFIRMED_STATUS : CORRECTED_STATUS,
      sent_at: now,
      // student_id is a real notification_log column (the per-student history
      // queries read it). The cohort is NOT a column on this table, so it lives
      // in metadata only - which is also what the board filters on.
      student_id: body.student_id,
      metadata,
    })
    .select('id')
    .single();
  if (insErr) {
    return res.status(500).json({ success: false, error: 'The notification could not be recorded. Nothing was changed.' });
  }

  // ── 6. Keep the legacy projection in step ─────────────────────────────────
  // matches.notification_sent is read by lib/attention.js and the board's
  // "N of M notified" count. The LEDGER is authoritative; this mirrors it so
  // every existing reader stays correct without a migration. It carries no
  // history of its own - the ledger above is the record - and it never touches
  // the match's student, unit, or preceptor.
  if (target === NOTIFICATION_TARGETS.UNIT_LEADER) {
    await supabaseAdmin
      .from('matches')
      .update(isConfirm
        ? { notification_sent: true, notified_at: now }
        : { notification_sent: false, notified_at: null })
      .eq('id', body.match_id);
  }

  return res.status(200).json({
    success: true,
    recorded: true,
    id: row?.id || null,
    state: { target, match_id: body.match_id, preceptor_id: body.preceptor_id || null, confirmed: isConfirm, at: now },
    // Stated explicitly because this endpoint sits beside ones that do send.
    sent_email: false,
  });
}
