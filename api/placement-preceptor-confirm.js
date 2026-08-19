import { createClient } from '@supabase/supabase-js';
import supabaseAdmin from '../lib/server/evaluation/supabase_admin.js';
import { verifyPlacementSend } from './lib/placementSendGuard.js';
import {
  PLACEMENT_META, MANUAL_CONFIRMATION_TYPE, MANUAL_CONFIRMATION_STATUS,
  DIRECT_MESSAGE_TYPE, SENT_EVIDENCE_STATUSES, PRECEPTOR_ASSIGNMENT_TEMPLATE,
} from '../src/lib/placementPreceptorSent.js';

// PRECEPTOR-DRAFT-CONTINUITY-1 - "Yes, Mark Preceptor as Notified."
//
// The MANUAL half of preceptor sent tracking. The automatic half records a
// placement send when ASPIRE Connect's own provider-confirmed send carries a
// verified placement reference. This endpoint exists for the send that happened
// but was not captured - a detached draft, an email sent before tracking
// existed - where the only honest evidence available is a human saying "yes, I
// sent it."
//
// WHAT IT RECORDS, AND AS WHAT. One notification_log row with its OWN
// notification_type ('placement_manual_confirmation') and its OWN status
// ('confirmed'). It never writes 'direct_message_sent' and never fabricates a
// provider receipt: anyone reading the log can see a person confirmed this, who
// they were, and when. The board's reducer accepts both kinds of evidence and
// labels the manual kind as manual.
//
// WHAT IT REFUSES. The claimed placement is re-proved against the database by
// the SAME guard a real send passes through (only the recipient-address tie is
// waived - no message is being addressed here). A stale match, a replaced
// preceptor, a cross-cohort claim, or an incomplete reference is rejected with
// the reason, and nothing is written.
//
// IDEMPOTENT BY EVIDENCE. If ANY evidence already exists for this exact
// (match, preceptor) - a provider send or an earlier manual confirmation - the
// endpoint answers already:true and writes nothing, so repeated confirmation
// can never double-count.

/* global process */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v) => typeof v === 'string' && UUID_RE.test(v.trim());

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
  // Confirming a placement notification is an Owner/Admin action, the same
  // authority that can send the email it stands in for.
  if (!(profile.is_owner === true || ['owner', 'admin'].includes(profile.role))) {
    return { ok: false, status: 403 };
  }
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

  // ── 2. Strict body: the five placement identifiers, nothing else ──────────
  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  } catch {
    return res.status(400).json({ success: false, error: 'Invalid request body' });
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return res.status(400).json({ success: false, error: 'Invalid request body' });
  }
  const ALLOWED = ['match_id', 'student_id', 'unit_id', 'cohort_id', 'preceptor_id'];
  const extra = Object.keys(body).filter(k => !ALLOWED.includes(k));
  if (extra.length) {
    // The acting user comes from the session; a body that tries to supply one -
    // or anything else - is refused outright rather than silently trimmed.
    return res.status(400).json({
      success: false,
      error: `Unexpected field(s): ${extra.join(', ')}. The confirming user is taken from your session, never from the request.`,
    });
  }
  for (const k of ALLOWED) {
    if (!isUuid(body[k])) {
      return res.status(400).json({ success: false, error: `${k} must be a valid UUID` });
    }
  }

  // ── 3. Prove the placement. The SAME guard a real send passes. ────────────
  const verdict = await verifyPlacementSend({
    db: supabaseAdmin,
    ref: body,
    recipientType: 'contact',
    recipientEmail: '',
    skipRecipientCheck: true,   // nothing is being addressed; every placement check still runs
  });
  if (!verdict.ok) {
    return res.status(verdict.status).json({ success: false, error: verdict.error, placement_error: verdict.code });
  }

  // ── 4. Idempotency: ANY existing evidence means nothing to record ─────────
  const { data: existing, error: existErr } = await supabaseAdmin
    .from('notification_log')
    .select('id, notification_type, status, sent_at, metadata')
    .in('notification_type', [DIRECT_MESSAGE_TYPE, MANUAL_CONFIRMATION_TYPE])
    .eq('metadata->>placement_template_key', PRECEPTOR_ASSIGNMENT_TEMPLATE)
    .eq('metadata->>placement_match_id', body.match_id)
    .eq('metadata->>placement_preceptor_id', body.preceptor_id);
  if (existErr) {
    return res.status(503).json({ success: false, error: 'The notification history could not be read. Nothing was recorded.' });
  }
  const already = (existing || []).some(r =>
    (r.notification_type === DIRECT_MESSAGE_TYPE && SENT_EVIDENCE_STATUSES.includes(r.status))
    || (r.notification_type === MANUAL_CONFIRMATION_TYPE && r.status === MANUAL_CONFIRMATION_STATUS));
  if (already) {
    return res.status(200).json({
      success: true, recorded: false, already: true,
      message: 'This preceptor is already recorded as notified for this placement.',
    });
  }

  // ── 5. Record the confirmation - as a confirmation, never as a send ───────
  const sentAt = new Date().toISOString();
  const { data: row, error: insErr } = await supabaseAdmin
    .from('notification_log')
    .insert({
      notification_type: MANUAL_CONFIRMATION_TYPE,
      audience: 'contact',
      recipient_email: verdict.verified.preceptorEmail || '',
      recipient_name: verdict.verified.preceptorName || '',
      recipient_role: 'Preceptor',
      subject: 'Preceptor Assignment & Details - confirmed sent manually',
      status: MANUAL_CONFIRMATION_STATUS,
      sent_at: sentAt,
      metadata: {
        // The placement identity, from the guard's VERIFIED rows - the same
        // stamp an automatic send earns, plus the human provenance.
        ...verdict.metadata,
        source: 'manual_confirmation',
        confirmed_by: actorId,
        confirmed_by_name: actorName,
        confirmed_at: sentAt,
      },
    })
    .select('id')
    .single();
  if (insErr) {
    return res.status(500).json({ success: false, error: 'The confirmation could not be recorded. Nothing was changed.' });
  }

  return res.status(200).json({
    success: true,
    recorded: true,
    id: row?.id || null,
    state: {
      match_id: verdict.metadata[PLACEMENT_META.match],
      preceptor_id: verdict.metadata[PLACEMENT_META.preceptor],
      sent_at: sentAt,
      source: 'manual_confirmation',
    },
    // Stated explicitly because this endpoint sits beside ones that do send.
    sent_email: false,
  });
}
