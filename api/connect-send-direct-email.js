// api/connect-send-direct-email.js
//
// Owner/admin-authenticated endpoint for sending a direct one-to-one email
// to a contact via Resend. Phase 3B.2A of ASPIRE Connect Direct Message.
//
// INVARIANTS:
//   - Sends ONE email per request.
//   - Recipient email is ALWAYS resolved server-side from contacts.id.
//   - No recipient field is accepted from the request body.
//   - Does NOT send bulk survey invitations or evaluation assignments.
//   - Does NOT update evaluation_assignments, students, or unrelated tables.
//   - Does NOT trigger cron, scheduling, or downstream sends.
//   - Writes ONE notification_log row with notification_type='direct_message_sent'.
//   - Updates contacts.last_contacted_at, last_contact_type, last_contact_summary
//     ONLY after a successful Resend send and successful notification_log write.
//   - Subject and safe metadata stored in notification_log; body content is NOT stored.
//
// POST /api/connect-send-direct-email
// Authorization: Bearer <session-token>
//
// Body (JSON):
//   contact_id         — required UUID of the contacts row
//   subject            — required non-empty string, max 200 chars
//   body               — required non-empty string, max 10000 chars
//   body_format?       — optional 'text' | 'html', defaults to 'text'
//   include_signature? — optional boolean, defaults to true
//
// Success (200):
//   { success: true, message, resend_message_id, notification_log_id, sent_at }
//
// Errors:
//   400 — validation failure or recipient override attempt
//   401 — missing or invalid session
//   403 — not owner/admin, or contact is inactive
//   404 — contact not found or contact has no email
//   500 — Resend failure or server error

import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import supabaseAdmin from '../lib/server/evaluation/supabase_admin.js';
import { buildDirectMessageEmail } from '../lib/server/connect/emailTemplates.js';

// From-address: use the confirmed working domain.
// aspire@aspire-program.com is not confirmed as a verified Resend sender in this project.
// noreply@aspire-program.com is used in all production Resend integrations
// (coordinator digest, interview reminders, survey test email) and is the safe fallback.
const FROM     = 'ASPIRE Program <noreply@aspire-program.com>';
const REPLY_TO = 'JesterLloyd.Bautista@cshs.org';

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
    console.error('[connect-send-direct] unhandled exception:', err?.message || err);
    return res.status(500).json({ success: false, error: `Server error: ${err?.message || 'unknown'}` });
  }
}

async function _handler(req, res, startMs) {

  // ── 1. Auth: Bearer session token ────────────────────────────────────────────
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
    const { data: { user: u }, error: authErr } = await userClient.auth.getUser();
    if (authErr || !u) return res.status(401).json({ success: false, error: 'Unauthorized' });
    user = u;
  } catch {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }

  // ── 2. Role check + resolve sender identity ───────────────────────────────────
  const { data: profile } = await supabaseAdmin
    .from('user_profiles')
    .select('id, role, email')
    .eq('auth_user_id', user.id)
    .single();

  if (!profile || !['owner', 'admin'].includes(profile.role)) {
    return res.status(403).json({ success: false, error: 'Forbidden' });
  }

  const ownerUserProfileId = profile.id;
  const ownerEmail         = profile.email;

  // ── 3. Parse and validate body ────────────────────────────────────────────────
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

  // Reject any attempt to override the recipient from the request body.
  const RECIPIENT_OVERRIDE_FIELDS = ['recipient', 'recipient_email', 'email', 'to', 'cc', 'bcc']
  for (const field of RECIPIENT_OVERRIDE_FIELDS) {
    if (field in body) {
      return res.status(400).json({
        success: false,
        error: `Field '${field}' is not permitted. Recipient is resolved server-side from contact_id.`,
      });
    }
  }

  const { contact_id, subject, body: msgBody, body_format, include_signature } = body;

  // contact_id
  if (!contact_id) return res.status(400).json({ success: false, error: 'contact_id is required' });
  if (!isUuid(contact_id)) return res.status(400).json({ success: false, error: 'contact_id must be a valid UUID' });

  // subject
  if (!subject || typeof subject !== 'string' || !subject.trim()) {
    return res.status(400).json({ success: false, error: 'subject is required and must be non-empty' });
  }
  if (subject.trim().length > 200) {
    return res.status(400).json({ success: false, error: 'subject must not exceed 200 characters' });
  }

  // body
  if (!msgBody || typeof msgBody !== 'string' || !msgBody.trim()) {
    return res.status(400).json({ success: false, error: 'body is required and must be non-empty' });
  }
  if (msgBody.trim().length > 10000) {
    return res.status(400).json({ success: false, error: 'body must not exceed 10000 characters' });
  }

  // body_format — Phase 3B.2A supports text only.
  // HTML composition and sanitization are deferred to a future release.
  const resolvedBodyFormat = body_format ?? 'text';
  if (resolvedBodyFormat !== 'text') {
    return res.status(400).json({
      success: false,
      error:   'Only text email body format is supported in this release.',
    });
  }

  // include_signature
  const resolvedIncludeSignature = include_signature !== false; // defaults to true
  if (include_signature !== undefined && typeof include_signature !== 'boolean') {
    return res.status(400).json({ success: false, error: 'include_signature must be a boolean' });
  }

  const trimmedSubject = subject.trim();
  const trimmedBody    = msgBody.trim();

  // ── 4. Resolve recipient server-side from contacts table ──────────────────────
  const { data: contact, error: contactErr } = await supabaseAdmin
    .from('contacts')
    .select('id, full_name, email, role, is_active')
    .eq('id', contact_id)
    .single();

  if (contactErr || !contact) {
    return res.status(404).json({ success: false, error: 'Contact not found' });
  }
  if (!contact.email || !contact.email.trim()) {
    return res.status(400).json({ success: false, error: 'Contact has no email on file' });
  }
  if (contact.is_active === false) {
    return res.status(403).json({ success: false, error: 'Contact is inactive and cannot receive email' });
  }

  const recipientEmail = contact.email.trim();
  const recipientName  = contact.full_name || null;

  console.log('[connect-send-direct] handler_entry:', { contact_id, by: ownerUserProfileId });

  // ── 5. Build email HTML ───────────────────────────────────────────────────────
  const { html } = buildDirectMessageEmail({
    body:             trimmedBody,
    bodyFormat:       resolvedBodyFormat,
    includeSignature: resolvedIncludeSignature,
  });

  // ── 6. Send via Resend ────────────────────────────────────────────────────────
  const resend = new Resend(process.env.RESEND_API_KEY);

  let resendMessageId = null;
  let sendError       = null;

  try {
    const { data: emailData, error: emailErr } = await resend.emails.send({
      from:     FROM,
      to:       [recipientEmail],
      reply_to: REPLY_TO,
      subject:  trimmedSubject,
      html,
      tags: [
        { name: 'type',       value: 'direct_message' },
        { name: 'contact_id', value: contact_id },
      ],
    });

    if (emailErr) {
      sendError = emailErr.message || JSON.stringify(emailErr);
      console.error('[connect-send-direct] failed:', { contact_id, error: sendError });
    } else {
      resendMessageId = emailData?.id || null;
      console.log('[connect-send-direct] sent:', { contact_id, resend_message_id: resendMessageId });
    }
  } catch (err) {
    sendError = err.message;
    console.error('[connect-send-direct] failed:', { contact_id, error: sendError });
  }

  if (sendError) {
    const durationMs = Date.now() - startMs;
    console.log('[connect-send-direct] complete:', { contact_id, duration_ms: durationMs, status: 'failed' });
    return res.status(500).json({ success: false, error: `Failed to send email: ${sendError}` });
  }

  const sentAt = new Date().toISOString();

  // ── 7. Audit log to notification_log ─────────────────────────────────────────
  // Body content is NOT stored (privacy). Only safe metadata is kept.
  // If the notification_log insert fails, the contacts CRM update is skipped
  // to keep the audit record and the CRM update in sync.
  let notificationLogId = null;
  let auditLogged       = false;
  try {
    const { data: logRow, error: logErr } = await supabaseAdmin
      .from('notification_log')
      .insert({
        notification_type: 'direct_message_sent',
        audience:          'contact',
        recipient_email:   recipientEmail,
        recipient_name:    recipientName,
        recipient_role:    contact.role || null,
        subject:           trimmedSubject,
        status:            'sent',
        resend_email_id:   resendMessageId,
        sent_at:           sentAt,
        metadata: {
          contact_id,
          sent_by_user_id:    ownerUserProfileId,
          sent_by_email:      ownerEmail,
          body_format:        resolvedBodyFormat,
          body_length:        trimmedBody.length,
          signature_included: resolvedIncludeSignature,
        },
      })
      .select('id')
      .single();

    if (logErr) {
      console.error('[connect-send-direct] log write failed:', logErr.message);
      // auditLogged remains false — contacts update will be skipped
    } else {
      notificationLogId = logRow?.id || null;
      auditLogged       = true;
    }
  } catch (logException) {
    console.error('[connect-send-direct] log write threw:', logException.message);
    // auditLogged remains false
  }

  // ── 8. Update contacts CRM metadata ───────────────────────────────────────────
  // ONLY runs if notification_log was successfully written.
  // Mirrors the pattern in api/cron/coordinator-weekly-digest.js.
  if (auditLogged) {
    try {
      const { error: crmErr } = await supabaseAdmin
        .from('contacts')
        .update({
          last_contacted_at:    sentAt,
          last_contact_type:    'direct_message',
          last_contact_summary: trimmedSubject.slice(0, 200),
        })
        .eq('id', contact_id);

      if (crmErr) {
        console.error('[connect-send-direct] contacts_update_failed:', { contact_id, error: crmErr.message });
      }
    } catch (crmException) {
      console.error('[connect-send-direct] contacts_update_failed:', { contact_id, error: crmException.message });
    }
  } else {
    console.warn('[connect-send-direct] contacts_update_skipped: notification_log write failed for', contact_id);
  }

  const durationMs = Date.now() - startMs;
  console.log('[connect-send-direct] complete:', { contact_id, duration_ms: durationMs, audit_logged: auditLogged });

  return res.status(200).json({
    success:             true,
    message:             `Email sent to ${recipientName || recipientEmail}`,
    resend_message_id:   resendMessageId,
    notification_log_id: notificationLogId,
    audit_logged:        auditLogged,
    sent_at:             sentAt,
  });
}
