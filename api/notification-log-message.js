// api/notification-log-message.js
//
// CONNECT-SENT-HISTORY message preview. Owner/Admin, read-only detail for ONE
// notification_log row, for the Sent History "View message" drawer.
//
// Preview precedence is deliberately truthful:
//   1. immutable redacted body captured in message_archive at send time;
//   2. read-only recovery of the exact provider body for historical rows;
//   3. deterministic template reconstruction from the stored row context;
//   4. an explicit unavailable reason.
// Provider recovery is never cached. Secure links are removed and verified
// before any recovered content is returned to the browser.
//
// Never returns raw tokens, secure links, candidate documents, or raw Supabase/Resend errors.
/* global process */
import { createClient } from '@supabase/supabase-js';
import supabaseAdmin from '../lib/server/evaluation/supabase_admin.js';
import { templates } from '../src/lib/notifications/templates/index.js';
import { redactArchiveHtml } from './lib/messageArchive.js';
import { buildSecureLinkSnapshot } from './lib/secureLinkSnapshot.js';
import { Resend } from 'resend';
import { INACTIVE_MESSAGE } from './lib/activeAccount.js';

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
  // NGRP-RELEASE-2: the Transition Form invitation carries a per-recipient
  // secure link - same posture as every other secure-link type above.
  ngrp_transition_form_sent:      'secure_link_email',
  evaluation_survey_test_sent:    'secure_link_email',
  casey_fink_post_rotation_request_sent: 'secure_link_email',
  post_rotation_evaluation_request_sent: 'secure_link_email',
  student_preceptor_eval_request_sent: 'secure_link_email',
  preceptor_feedback_request_sent:'secure_link_email',
  preceptor_certificate_ready:    'secure_link_email',
  evaluation_reminder_sent:       'secure_link_email',
});

export const NOTICE = {
  reconstructed: 'Reconstructed preview. Secure links and attachments are removed.',
  archived_redacted: 'Archived preview. Secure links and sensitive content may be removed.',
  manual_body_not_stored: 'Full message preview is not available for this historical manual email because the body was not stored.',
  reconstruction_unsupported: 'A safe preview could not be reconstructed for this message type.',
  digest_contents_not_stored: 'The weekly digest listed activity that was not stored with this record, so its body cannot be shown without inventing content. The subject and delivery details above are the real ones.',
  secure_link_email: 'This email contained a secure personal link, which is never reproduced in a preview. The subject and delivery details above are the real ones.',
  reconstruction_failed: 'A safe preview could not be reconstructed for this message.',
  provider_redacted: 'Retrieved from the delivery provider. Links and sensitive content have been disabled for this preview.',
};

function isUuid(v) {
  return typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

function unavailable(reason) {
  return { available: false, source: 'unavailable', format: null, html: null, text: null, reason, notice: NOTICE[reason] };
}

function bodyPreview({ source, html, text, notice }) {
  if (typeof html === 'string' && html.trim() !== '') {
    return { available: true, source, format: 'html', html: redactArchiveHtml(html), text: null, reason: null, notice };
  }
  if (typeof text === 'string' && text.trim() !== '') {
    return { available: true, source, format: 'text', html: null, text, reason: null, notice };
  }
  return null;
}

async function archivedPreview(notificationLogId) {
  try {
    const { data: archive } = await supabaseAdmin
      .from('message_archive')
      .select('html_redacted, text_redacted')
      .eq('notification_log_id', notificationLogId)
      .limit(1)
      .maybeSingle();
    if (!archive) return null;
    const safe = buildSecureLinkSnapshot({
      html: archive.html_redacted,
      text: archive.text_redacted,
    });
    if (!safe.safe) return null;
    return bodyPreview({
      source: 'archived_redacted',
      html: safe.html,
      text: safe.text,
      notice: NOTICE.archived_redacted,
    });
  } catch {
    // An archive lookup must not turn a readable notification_log row into a
    // failed drawer. Continue to provider recovery/reconstruction instead.
    return null;
  }
}

async function providerPreview(resendEmailId) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey || !resendEmailId) return null;
  try {
    const { data, error } = await new Resend(apiKey).emails.get(resendEmailId);
    if (error || !data) return null;

    // Use the same redact-then-verify gate as secure archive writes for EVERY
    // provider body. Historical rows predate today's classifications, so the
    // read side must not assume an "ordinary" type cannot contain a secret.
    const safe = buildSecureLinkSnapshot({ html: data.html, text: data.text });
    if (!safe.safe) return null;
    return bodyPreview({
      source: 'provider_redacted',
      html: safe.html,
      text: safe.text,
      notice: NOTICE.provider_redacted,
    });
  } catch {
    // Provider retention is best-effort and read-only. A missing/expired body
    // falls through to reconstruction or the type-specific explanation.
    return null;
  }
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
    .select('role, is_owner, is_active')
    .eq('auth_user_id', user.id)
    .single();

  const isOwnerAdmin = !!profile && (profile.is_owner === true || ['owner', 'admin'].includes(profile.role));
  // S-05: a deactivated account keeps a valid access token until it expires.
  // Refuse it before any work is performed, so deactivation ends access at once.
  if (profile && profile.is_active === false) return res.status(403).json({ error: 'Forbidden', message: INACTIVE_MESSAGE });
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
  let preview = await archivedPreview(row.id);

  // Historical rows often predate ASPIRE's archive. If Resend still retains
  // the delivery, recover that exact body instead of inventing one.
  if (!preview) preview = await providerPreview(row.resend_email_id);

  if (!preview && RECONSTRUCTABLE.has(type) && templates[type]) {
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
  } else if (!preview && MANUAL_TYPES.has(type)) {
    preview = unavailable('manual_body_not_stored');
  } else if (!preview && UNSUPPORTED_REASONS[type]) {
    // Intentionally not reconstructed, and the reader is told which reason.
    preview = unavailable(UNSUPPORTED_REASONS[type]);
  } else if (!preview) {
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
