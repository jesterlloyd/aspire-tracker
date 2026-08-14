// api/notification-log-message.js
//
// CONNECT-SENT-HISTORY message preview (Phase 1 - NO SQL). Owner/Admin, read-only detail for ONE
// notification_log row, for the Sent History "View message" drawer.
//
// Phase 1 stores NO new message bodies. Automated/system emails are RECONSTRUCTED on demand by
// re-rendering their template from the stored notification_type + sanitized metadata.context. The
// reconstruction is token-free by construction (templates contain only static program links;
// sanitizeContext already stripped resume/headshot URLs; survey tokens were never stored) and the
// rendered HTML is additionally redacted (any tokenized/query-bearing href|src is neutralized).
//
// Manual/direct Outreach emails were intentionally never stored (body not persisted), so they return
// preview.available=false with a clear reason - the row's metadata still shows.
//
// Never returns raw tokens, secure links, candidate documents, or raw Supabase/Resend errors.
import { createClient } from '@supabase/supabase-js';
import supabaseAdmin from '../lib/server/evaluation/supabase_admin.js';
import { templates } from '../src/lib/notifications/templates/index.js';
import { redactArchiveHtml } from './lib/messageArchive.js';

// Template-backed types renderable from stored context. All verified to contain only static program
// links (logo, program domain, mailto/tel) - no context-derived/tokenized URLs.
export const RECONSTRUCTABLE = new Set([
  'form_received',
  'placement_request_received',
  'unit_form_received',
  'teams_invite_reminder',
  'teams_invite_reminder_escalation',
  'interview_reminder',
  'midpoint_checkin',
  'clockout_reminder',
  // SENT-HISTORY-PREVIEW-1: both are template-backed and sent through
  // sendNotification, so metadata.context holds exactly the inputs their
  // builder takes. They were simply never added here.
  'unit_leader_alert',
  'birthday_greeting',
]);
// Operator-composed emails whose body was intentionally not stored.
// bulk_message_sent belongs here, not in the generic unsupported bucket: it is a
// manual composition whose body was deliberately never archived (the
// message_archive content_kind CHECK does not permit bulk manual email), so
// "the body was not stored" is the accurate explanation rather than "this
// message type cannot be reconstructed".
export const MANUAL_TYPES = new Set(['direct_message_sent', 'bulk_message_sent']);

// SENT-HISTORY-PREVIEW-1: types we deliberately do NOT reconstruct, each with
// the reason. Being explicit matters twice over: the reader is told why rather
// than being handed a generic shrug, and a NEW send type that nobody classified
// is detectable (a structural test asserts every known type appears in exactly
// one bucket) instead of silently landing in "unsupported" forever.
export const UNSUPPORTED_REASONS = Object.freeze({
  // The digest's own log row stores only window bounds, school, and a
  // transition COUNT - never the transition rows the template renders. Rebuilding
  // from that would invent a digest that was never sent.
  coordinator_weekly_digest:      'digest_contents_not_stored',
  coordinator_weekly_digest_test: 'digest_contents_not_stored',
  // These carry a per-recipient secure link. Re-rendering either fabricates a
  // link that was never in the original or omits the email's entire purpose;
  // neither is a truthful preview, and minting a token to preview a past email
  // is not something a preview should ever do.
  evaluation_invitation_sent:     'secure_link_email',
  evaluation_invitation_test:     'secure_link_email',
  evaluation_survey_test_sent:    'secure_link_email',
  preceptor_feedback_request_sent:'secure_link_email',
  preceptor_certificate_ready:    'secure_link_email',
});

export const NOTICE = {
  reconstructed: 'Reconstructed preview. Secure links and attachments are removed.',
  archived_redacted: 'Archived preview. Secure links and sensitive content may be removed.',
  manual_body_not_stored: 'Full message preview is not available for this historical manual email because the body was not stored.',
  reconstruction_unsupported: 'A safe preview could not be reconstructed for this message type.',
  digest_contents_not_stored: 'The weekly digest listed activity that was not stored with this record, so its body cannot be shown without inventing content. The subject and delivery details above are the real ones.',
  secure_link_email: 'This email contained a secure personal link, which is never reproduced in a preview. The subject and delivery details above are the real ones.',
  reconstruction_failed: 'A safe preview could not be reconstructed for this message.',
};

function isUuid(v) {
  return typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

function unavailable(reason) {
  return { available: false, source: 'unavailable', format: null, html: null, text: null, reason, notice: NOTICE[reason] };
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  // ── Auth: same pattern as notification-log-query (JWT → Owner/Admin) ──
  const bearer = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '').trim();
  if (!bearer) return res.status(401).json({ error: 'Unauthorized' });

  const userClient = createClient(
    process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
    process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY,
    { global: { headers: { Authorization: `Bearer ${bearer}` } } },
  );

  let user;
  try {
    const { data: { user: u }, error } = await userClient.auth.getUser();
    if (error || !u) return res.status(401).json({ error: 'Unauthorized' });
    user = u;
  } catch {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { data: profile } = await supabaseAdmin
    .from('user_profiles')
    .select('role, is_owner')
    .eq('auth_user_id', user.id)
    .single();

  const isOwnerAdmin = !!profile && (profile.is_owner === true || ['owner', 'admin'].includes(profile.role));
  if (!isOwnerAdmin) return res.status(403).json({ error: 'Forbidden' });

  const id = req.query?.id;
  if (!isUuid(id)) return res.status(400).json({ error: 'A valid id is required' });

  // ── Load the row (service-role read; whitelisted columns) ──
  let row;
  try {
    const { data, error } = await supabaseAdmin
      .from('notification_log')
      .select('id, notification_type, audience, recipient_email, recipient_name, recipient_role, recipient_type, student_id, cohort_id, subject, status, sent_at, delivered_at, opened_at, resend_email_id, error_message, metadata')
      .eq('id', id)
      .single();
    if (error || !data) return res.status(404).json({ error: 'Not found' });
    row = data;
  } catch (e) {
    console.error('[notification-log-message] read failed:', e?.message);
    return res.status(500).json({ error: 'Failed to load message' });
  }

  // ── Build preview ──
  const type = row.notification_type;
  let preview;
  if (MANUAL_TYPES.has(type)) {
    // Phase 2B: manual/direct emails may have a REDACTED archived body (forward-only). If present,
    // serve it; otherwise keep the historical unavailable state (legacy rows were never stored).
    preview = unavailable('manual_body_not_stored');
    try {
      const { data: archive } = await supabaseAdmin
        .from('message_archive')
        .select('html_redacted, text_redacted')
        .eq('notification_log_id', row.id)
        .limit(1)
        .maybeSingle();
      if (archive && typeof archive.html_redacted === 'string' && archive.html_redacted.trim() !== '') {
        preview = { available: true, source: 'archived_redacted', format: 'html', html: redactArchiveHtml(archive.html_redacted), text: null, reason: null, notice: NOTICE.archived_redacted };
      } else if (archive && typeof archive.text_redacted === 'string' && archive.text_redacted.trim() !== '') {
        preview = { available: true, source: 'archived_redacted', format: 'text', html: null, text: archive.text_redacted, reason: null, notice: NOTICE.archived_redacted };
      }
    } catch (e) {
      console.error('[notification-log-message] archive lookup failed:', e?.message);
      // leave the unavailable state - graceful fallback
    }
  } else if (RECONSTRUCTABLE.has(type) && templates[type]) {
    try {
      const ctx = (row.metadata && row.metadata.context) || {};
      const group = templates[type];
      const tpl = group[row.audience] || group.default || Object.values(group)[0];
      const out = typeof tpl === 'function'
        ? tpl(ctx, { email: row.recipient_email, name: row.recipient_name, audience: row.audience, role: row.recipient_role })
        : null;
      const html = out && typeof out.html === 'string' ? redactArchiveHtml(out.html) : null;
      preview = html
        ? { available: true, source: 'reconstructed', format: 'html', html, text: null, reason: null, notice: NOTICE.reconstructed }
        : unavailable('reconstruction_failed');
    } catch (e) {
      console.error('[notification-log-message] reconstruction failed:', e?.message);
      preview = unavailable('reconstruction_failed');
    }
  } else if (UNSUPPORTED_REASONS[type]) {
    // Intentionally not reconstructed, and the reader is told which reason.
    preview = unavailable(UNSUPPORTED_REASONS[type]);
  } else {
    preview = unavailable('reconstruction_unsupported');
  }

  return res.status(200).json({
    message: {
      id: row.id,
      notification_type: row.notification_type,
      recipient_email: row.recipient_email,
      recipient_name: row.recipient_name,
      recipient_type: row.recipient_type,
      subject: row.subject, // the real stored subject (accurate even when the body is reconstructed)
      status: row.status,
      sent_at: row.sent_at,
      resend_email_id: row.resend_email_id || null,
      delivery: {
        status: row.status,
        delivered_at: row.delivered_at || null,
        opened_at: row.opened_at || null,
        error_message: row.error_message || null,
      },
      preview,
      metadata: row.metadata || null, // already sanitized at store time (no tokens/urls); same data the list endpoint returns
    },
  });
}
