// api/connect-send-direct-email.js
//
// Owner/admin-authenticated endpoint for sending a direct one-to-one email
// to a contact or student via Resend. Phase 3B.2A.1.
//
// INVARIANTS:
//   - Sends ONE email per request.
//   - Recipient email is ALWAYS resolved server-side from recipient_id + recipient_type.
//   - No recipient field is accepted from the request body.
//   - Does NOT send bulk survey invitations or evaluation assignments.
//   - Does NOT update evaluation_assignments, evaluation tokens, or evaluation responses.
//   - Does NOT import students into Contacts.
//   - Does NOT trigger cron, scheduling, or downstream sends.
//   - Writes ONE notification_log row with notification_type='direct_message_sent'.
//   - Updates contacts.last_contacted_at only after successful Resend send AND log write.
//   - Students do not yet have last_contacted_at; that update is deferred.
//   - Subject and safe metadata stored in notification_log; body content is NOT stored.
//
// POST /api/connect-send-direct-email
// Authorization: Bearer <session-token>
//
// Unified body shape (Phase 3B.2A.1):
//   recipient_type — 'contact' | 'student'
//   recipient_id   — required UUID
//   subject        — required non-empty string, max 200 chars
//   body           — required non-empty string, max 10000 chars
//   body_format?   — optional, only 'text' supported
//   include_signature? — optional boolean, defaults to true
//
// Legacy contact shape (backward compatible):
//   contact_id — normalized internally as recipient_type='contact', recipient_id=contact_id
//
// Success (200):
//   { success: true, message, resend_message_id, notification_log_id, audit_logged, sent_at }
//
// Errors:
//   400 — validation failure or recipient override attempt
//   401 — missing or invalid session
//   403 — not owner/admin, or contact is inactive
//   404 — recipient not found or has no email
//   500 — Resend failure or server error

import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import supabaseAdmin from '../lib/server/evaluation/supabase_admin.js';
import { buildDirectMessageEmail } from '../lib/server/connect/emailTemplates.js';

// From-address: noreply@aspire-program.com is the confirmed working sender
// used in all production Resend integrations. aspire@aspire-program.com is
// not confirmed as a verified sender.
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
  const RECIPIENT_OVERRIDE_FIELDS = ['recipient', 'recipient_email', 'email', 'to', 'cc', 'bcc'];
  for (const field of RECIPIENT_OVERRIDE_FIELDS) {
    if (field in body) {
      return res.status(400).json({
        success: false,
        error: `Field '${field}' is not permitted. Recipient is resolved server-side from recipient_id.`,
      });
    }
  }

  // Normalize legacy contact_id to unified shape for backward compatibility.
  // Phase 3B.2A.0 UI sends contact_id; Phase 3B.2A.1 UI sends recipient_type + recipient_id.
  let recipientType = body.recipient_type;
  let recipientId   = body.recipient_id;

  if (!recipientType && body.contact_id) {
    recipientType = 'contact';
    recipientId   = body.contact_id;
  }

  // Validate recipient_type
  if (!recipientType || !['contact', 'student'].includes(recipientType)) {
    return res.status(400).json({
      success: false,
      error: "recipient_type must be 'contact' or 'student' (or use legacy contact_id for contacts)",
    });
  }

  // Validate recipient_id
  if (!recipientId) return res.status(400).json({ success: false, error: 'recipient_id is required' });
  if (!isUuid(recipientId)) return res.status(400).json({ success: false, error: 'recipient_id must be a valid UUID' });

  // subject
  const { subject, body: msgBody, body_format, include_signature } = body;
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

  // body_format — text only
  const resolvedBodyFormat = body_format ?? 'text';
  if (resolvedBodyFormat !== 'text') {
    return res.status(400).json({
      success: false,
      error: 'Only text email body format is supported in this release.',
    });
  }

  // include_signature
  const resolvedIncludeSignature = include_signature !== false;
  if (include_signature !== undefined && typeof include_signature !== 'boolean') {
    return res.status(400).json({ success: false, error: 'include_signature must be a boolean' });
  }

  const trimmedSubject = subject.trim();
  const trimmedBody    = msgBody.trim();

  // ── 4. Resolve recipient server-side ──────────────────────────────────────────
  let recipientEmail;
  let recipientName;
  let recipientRole;
  let notificationAudience;

  if (recipientType === 'contact') {
    const { data: contact, error: contactErr } = await supabaseAdmin
      .from('contacts')
      .select('id, full_name, email, role, is_active')
      .eq('id', recipientId)
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

    recipientEmail       = contact.email.trim();
    recipientName        = contact.full_name || null;
    recipientRole        = contact.role || null;
    notificationAudience = 'contact';

  } else {
    // recipient_type === 'student'
    const { data: student, error: studentErr } = await supabaseAdmin
      .from('students')
      .select('id, first_name, last_name, personal_email, school_email, school, status')
      .eq('id', recipientId)
      .single();

    if (studentErr || !student) {
      return res.status(404).json({ success: false, error: 'Student not found' });
    }
    const resolvedStudentEmail = student.personal_email || student.school_email || null;
    if (!resolvedStudentEmail) {
      return res.status(400).json({ success: false, error: 'Student has no email on file' });
    }

    recipientEmail       = resolvedStudentEmail.trim();
    recipientName        = `${student.first_name || ''} ${student.last_name || ''}`.trim() || null;
    recipientRole        = 'Student';
    notificationAudience = 'student';
  }

  console.log('[connect-send-direct] handler_entry:', {
    recipient_type: recipientType,
    recipient_id:   recipientId,
    by:             ownerUserProfileId,
  });

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
        { name: 'type',           value: 'direct_message' },
        { name: 'recipient_type', value: recipientType },
        { name: 'recipient_id',   value: recipientId },
      ],
    });

    if (emailErr) {
      sendError = emailErr.message || JSON.stringify(emailErr);
      console.error('[connect-send-direct] failed:', { recipient_type: recipientType, recipient_id: recipientId, error: sendError });
    } else {
      resendMessageId = emailData?.id || null;
      console.log('[connect-send-direct] sent:', { recipient_type: recipientType, recipient_id: recipientId, resend_message_id: resendMessageId });
    }
  } catch (err) {
    sendError = err.message;
    console.error('[connect-send-direct] failed:', { recipient_type: recipientType, recipient_id: recipientId, error: sendError });
  }

  if (sendError) {
    const durationMs = Date.now() - startMs;
    console.log('[connect-send-direct] complete:', { recipient_type: recipientType, recipient_id: recipientId, duration_ms: durationMs, status: 'failed' });
    return res.status(500).json({ success: false, error: `Failed to send email: ${sendError}` });
  }

  const sentAt = new Date().toISOString();

  // ── 7. Audit log to notification_log ─────────────────────────────────────────
  // Body content is NOT stored. Only safe metadata is kept.
  // If the notification_log insert fails, the last-contact update is skipped.
  let notificationLogId = null;
  let auditLogged       = false;

  const logMetadata = recipientType === 'contact'
    ? { recipient_type: 'contact', contact_id: recipientId,  sent_by_user_id: ownerUserProfileId, sent_by_email: ownerEmail, body_format: resolvedBodyFormat, body_length: trimmedBody.length, signature_included: resolvedIncludeSignature }
    : { recipient_type: 'student', student_id: recipientId, sent_by_user_id: ownerUserProfileId, sent_by_email: ownerEmail, body_format: resolvedBodyFormat, body_length: trimmedBody.length, signature_included: resolvedIncludeSignature };

  try {
    const { data: logRow, error: logErr } = await supabaseAdmin
      .from('notification_log')
      .insert({
        notification_type: 'direct_message_sent',
        audience:          notificationAudience,
        recipient_email:   recipientEmail,
        recipient_name:    recipientName,
        recipient_role:    recipientRole,
        subject:           trimmedSubject,
        status:            'sent',
        resend_email_id:   resendMessageId,
        sent_at:           sentAt,
        metadata:          logMetadata,
      })
      .select('id')
      .single();

    if (logErr) {
      console.error('[connect-send-direct] log write failed:', logErr.message);
    } else {
      notificationLogId = logRow?.id || null;
      auditLogged       = true;
    }
  } catch (logException) {
    console.error('[connect-send-direct] log write threw:', logException.message);
  }

  // ── 8. Update last-contact metadata (ONLY after successful send + audit log) ──
  if (auditLogged) {
    if (recipientType === 'contact') {
      // Contacts have last_contacted_at, last_contact_type, last_contact_summary
      try {
        const { error: crmErr } = await supabaseAdmin
          .from('contacts')
          .update({
            last_contacted_at:    sentAt,
            last_contact_type:    'direct_message',
            last_contact_summary: trimmedSubject.slice(0, 200),
          })
          .eq('id', recipientId);
        if (crmErr) {
          console.error('[connect-send-direct] contacts_update_failed:', { recipient_id: recipientId, error: crmErr.message });
        }
      } catch (crmException) {
        console.error('[connect-send-direct] contacts_update_failed:', { recipient_id: recipientId, error: crmException.message });
      }
    } else {
      // Students do not yet have last_contacted_at columns.
      // This update is deferred to a future migration.
      console.log('[connect-send-direct] student_last_contact_skipped: column not yet available for', recipientId);
    }
  } else {
    console.warn('[connect-send-direct] last_contact_update_skipped: notification_log write failed for', recipientId);
  }

  const durationMs = Date.now() - startMs;
  console.log('[connect-send-direct] complete:', {
    recipient_type: recipientType,
    recipient_id:   recipientId,
    duration_ms:    durationMs,
    audit_logged:   auditLogged,
  });

  return res.status(200).json({
    success:             true,
    message:             `Email sent to ${recipientName || recipientEmail}`,
    resend_message_id:   resendMessageId,
    notification_log_id: notificationLogId,
    audit_logged:        auditLogged,
    sent_at:             sentAt,
  });
}
