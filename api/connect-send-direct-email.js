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
//   recipient_type - 'contact' | 'student'
//   recipient_id   - required UUID
//   subject        - required non-empty string, max 200 chars
//   body           - required non-empty string, max 10000 chars
//   body_format?   - optional, only 'text' supported
//   include_signature? - optional boolean, defaults to true
//
// Legacy contact shape (backward compatible):
//   contact_id - normalized internally as recipient_type='contact', recipient_id=contact_id
//
// Success (200):
//   { success: true, message, resend_message_id, notification_log_id, audit_logged, sent_at }
//
// Errors:
//   400 - validation failure or recipient override attempt
//   401 - missing or invalid session
//   403 - not owner/admin, or contact is inactive
//   404 - recipient not found or has no email
//   500 - Resend failure or server error

import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import supabaseAdmin from '../lib/server/evaluation/supabase_admin.js';
import { buildDirectMessageEmail } from '../lib/server/connect/emailTemplates.js';
import { archiveManualMessage } from './lib/messageArchive.js';
import { resolveAttachments } from './lib/outreachAttachments.js';
import { resolveStudentCorrespondenceRecipient, isValidEmail } from '../src/lib/notifications/studentRecipient.js';
import { normalizeEmailForLookup } from '../src/lib/emailUtils.js';
import { verifyPlacementSend } from './lib/placementSendGuard.js';
import { JESTER_SIGNATURE, KRYSTAL_SIGNATURE } from '../src/lib/notifications/templates/signatures.js';
import { INACTIVE_MESSAGE } from './lib/activeAccount.js';

// CONNECT-COMMS-1D: seeded fallback signatures for the two known leads (by email), used when a
// sender has not configured their own connect_signature yet. (signatures.js has no phone field.)
const SIGNATURE_SEED = {
  [JESTER_SIGNATURE.email.toLowerCase()]:  { ...JESTER_SIGNATURE, phone: '310-248-8964' },
  [KRYSTAL_SIGNATURE.email.toLowerCase()]: { ...KRYSTAL_SIGNATURE, phone: '' },
};

// Resolve the manual sender's signature (normalized for the renderer) with a documented fallback
// chain. Returns { source: 'user'|'seeded'|'fallback'|'static', signature: object|null, displayName }.
function resolveSenderSignature(profile) {
  const email = (profile?.email || '').trim();
  const cs = (profile?.connect_signature && typeof profile.connect_signature === 'object') ? profile.connect_signature : null;

  // 1. User-configured + enabled signature.
  if (cs && cs.signature_enabled !== false && String(cs.display_name || '').trim()) {
    const displayName = String(cs.display_name).trim();
    return {
      source: 'user',
      displayName,
      signature: {
        displayName,
        credentials: String(cs.credentials || '').trim(),
        title:       String(cs.title || '').trim(),
        // SIGNATURE-PREVIEW-PARITY-1: pass the department through EMPTY when unset -
        // the renderer's default is the institute line every email printed before
        // the affiliation became personalizable, so unset departments render unchanged.
        affiliation: String(cs.department || '').trim(),
        email,
        phone:       String(cs.phone || '').trim(),
      },
    };
  }
  // 2. Seeded fallback for known leads.
  const seed = SIGNATURE_SEED[email.toLowerCase()];
  if (seed) {
    return {
      source: 'seeded',
      displayName: seed.fullName,
      signature: { displayName: seed.fullName, credentials: '', title: seed.title || '', affiliation: '', email: seed.email, phone: seed.phone || '' },
    };
  }
  // 3. Profile-derived fallback (name + role).
  if (String(profile?.full_name || '').trim()) {
    const displayName = String(profile.full_name).trim();
    return {
      source: 'fallback',
      displayName,
      signature: { displayName, credentials: '', title: profile?.role ? String(profile.role) : '', affiliation: '', email, phone: '' },
    };
  }
  // 4. Final compatibility fallback - renderer uses the static Jester block.
  return { source: 'static', displayName: JESTER_SIGNATURE.fullName, signature: null };
}

// Validate + sanitize a client-supplied CC list (array or comma/semicolon/newline string).
// Drops invalids into `invalid` (caller blocks on these), dedupes, drops entries equal to To,
// caps at 5. Returns { cc, invalid, capped }.
function resolveCcList(rawCc, toEmail) {
  let arr = [];
  if (Array.isArray(rawCc)) arr = rawCc;
  else if (typeof rawCc === 'string') arr = rawCc.split(/[,;\n]/);
  const toNorm = normalizeEmailForLookup(toEmail || '');
  const seen = new Set();
  const cc = [];
  const invalid = [];
  for (const raw of arr) {
    const e = String(raw || '').trim();
    if (!e) continue;
    if (!isValidEmail(e)) { invalid.push(e); continue; }
    const norm = normalizeEmailForLookup(e);
    if (norm === toNorm) continue;     // drop CC == To
    if (seen.has(norm)) continue;       // dedupe
    seen.add(norm);
    cc.push(e);
  }
  return { cc: cc.slice(0, 5), invalid, capped: cc.length > 5 };
}

// From-address: noreply@aspire-program.com is the confirmed working sender
// used in all production Resend integrations. aspire@aspire-program.com is
// not confirmed as a verified sender.
const FROM     = 'ASPIRE at Cedars-Sinai <noreply@aspire-program.com>';
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
    // CONNECT-COMMS-1D: include full_name + connect_signature to resolve the manual sender's signature.
    .select('id, role, email, full_name, connect_signature, is_owner, is_active')
    .eq('auth_user_id', user.id)
    .single();

  // S-05: a deactivated account keeps a valid access token until it expires.
  // Refuse it before any work is performed, so deactivation ends access at once.
  if (profile && profile.is_active === false) {
    return res.status(403).json({ success: false, error: 'Forbidden', message: INACTIVE_MESSAGE });
  }
  if (!profile || !['owner', 'admin'].includes(profile.role)) {
    return res.status(403).json({ success: false, error: 'Forbidden' });
  }

  const ownerUserProfileId = profile.id;
  const ownerEmail         = profile.email;
  // Resolve sender signature server-side (re-fetched here every request - preview AND send - so a
  // client can never inject a signature and preview always matches what will actually be sent).
  const senderSig = resolveSenderSignature(profile);

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

  // CONNECT-COMMS-1B: preview mode returns the exact branded HTML + resolved recipient WITHOUT
  // sending or logging. Same auth/role gate, same renderer, same recipient resolver as send.
  const isPreview = body.preview === true;

  // Reject any attempt to override the PRIMARY recipient from the request body. CONNECT-COMMS-1D:
  // 'cc' is now an explicitly validated field (handled below), so it is no longer rejected here.
  // The To recipient remains server-resolved and un-overridable.
  const RECIPIENT_OVERRIDE_FIELDS = ['recipient', 'recipient_email', 'email', 'to', 'bcc'];
  for (const field of RECIPIENT_OVERRIDE_FIELDS) {
    if (field in body) {
      return res.status(400).json({
        success: false,
        error: `Field '${field}' is not permitted. Recipient is resolved server-side from recipient_id.`,
      });
    }
  }

  // PLACEMENT-COMMUNICATION-HANDOFF-1A: the OPTIONAL placement this message is
  // about. It never changes the recipient, the body, or the attachments - those
  // stay server-resolved exactly as before. What it does is make a SUCCESSFUL
  // send attributable to one exact placement, so the Placement Board can show
  // that preceptor as sent.
  //
  // NOTHING IN IT IS TRUSTED. It is a CLAIM, verified row by row against the
  // database before the mail provider is contacted (step 5d), and a claim that
  // does not survive that check fails the send outright - no email, no log row.
  // Its presence also makes the send STRICTER, never looser: a message with no
  // placement reference is unaffected and behaves exactly as it always has.
  const placementRefRaw = body.placement_ref && typeof body.placement_ref === 'object' && !Array.isArray(body.placement_ref)
    ? body.placement_ref
    : null;
  // The metadata is NOT built here. It is produced by verifyPlacementSend below,
  // from rows this server read itself, only after every claim in the reference has
  // been proved against the database - see api/lib/placementSendGuard.js.
  let placementMeta = null;

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

  // subject/body - required for SEND; for PREVIEW they may be empty/partial (user still typing).
  // Length caps apply in both modes; values are coerced to safe strings either way.
  const { subject, body: msgBody, body_format, include_signature } = body;
  const subjStr = typeof subject === 'string' ? subject : '';
  const bodyStr = typeof msgBody === 'string' ? msgBody : '';
  if (!isPreview) {
    if (!subjStr.trim()) return res.status(400).json({ success: false, error: 'subject is required and must be non-empty' });
    if (!bodyStr.trim()) return res.status(400).json({ success: false, error: 'body is required and must be non-empty' });
  }
  if (subjStr.trim().length > 200) return res.status(400).json({ success: false, error: 'subject must not exceed 200 characters' });

  // body_format - 'text' always; 'html' (RICH-COMPOSE-1) ONLY for the Owner (authoritative server
  // gate; the client feature flag is UX-only). Any other value is rejected. The builder sanitizes
  // html before it reaches the shell, so raw HTML can never be delivered.
  const resolvedBodyFormat = body_format ?? 'text';
  const callerIsOwner = profile?.is_owner === true || profile?.role === 'owner';
  if (resolvedBodyFormat !== 'text' && !(resolvedBodyFormat === 'html' && callerIsOwner)) {
    return res.status(400).json({ success: false, error: 'Only text email body format is supported for this account.' });
  }
  const maxBody = resolvedBodyFormat === 'html' ? 40000 : 10000;
  if (bodyStr.trim().length > maxBody) return res.status(400).json({ success: false, error: `body must not exceed ${maxBody} characters` });

  // include_signature
  if (include_signature !== undefined && typeof include_signature !== 'boolean') {
    return res.status(400).json({ success: false, error: 'include_signature must be a boolean' });
  }
  const resolvedIncludeSignature = include_signature !== false;

  const trimmedSubject = subjStr.trim();
  const trimmedBody    = bodyStr.trim();

  // ── 4. Resolve recipient server-side ──────────────────────────────────────────
  // Students route SCHOOL-FIRST via the shared canon resolver (CONNECT-COMMS-1B). A descriptor
  // (email/source/reason/warning) is always computed; hard failures are applied only in SEND mode
  // so PREVIEW can still render the branded email and surface a missing/fallback recipient.
  let recipientEmail       = null;
  let recipientName        = null;
  let recipientRole        = null;
  let notificationAudience = null;
  let recipientSource      = recipientType; // 'contact' | 'school' | 'personal' | 'override' | 'missing'
  let recipientReason      = null;
  let recipientWarning     = null;
  let hardError            = null;          // { status, error } - enforced in SEND mode only

  if (recipientType === 'contact') {
    const { data: contact, error: contactErr } = await supabaseAdmin
      .from('contacts')
      .select('id, full_name, email, role, is_active')
      .eq('id', recipientId)
      .single();

    if (contactErr || !contact) {
      hardError = { status: 404, error: 'Contact not found' };
      recipientSource = 'missing';
    } else {
      recipientName        = contact.full_name || null;
      recipientRole        = contact.role || null;
      notificationAudience = 'contact';
      recipientSource      = 'contact';
      const email = (contact.email || '').trim();
      if (!email) {
        hardError = { status: 400, error: 'Contact has no email on file' };
        recipientSource = 'missing';
        recipientWarning = 'No email on file for this contact.';
      } else if (contact.is_active === false) {
        recipientEmail = email; // shown in preview, but blocked for send
        hardError = { status: 403, error: 'Contact is inactive and cannot receive email' };
        recipientWarning = 'Contact is inactive and cannot receive email.';
      } else {
        recipientEmail = email;
      }
    }

  } else {
    // recipient_type === 'student' - SCHOOL-FIRST canon resolver
    const { data: student, error: studentErr } = await supabaseAdmin
      .from('students')
      .select('id, first_name, last_name, personal_email, school_email, school, status, cohort_school_rotation_id, school_coordinator_email, school_coordinator_name')
      .eq('id', recipientId)
      .single();

    if (studentErr || !student) {
      hardError = { status: 404, error: 'Student not found' };
      recipientSource = 'missing';
    } else {
      const resolved = resolveStudentCorrespondenceRecipient(student, null, {});
      recipientEmail       = resolved.email;
      recipientName        = `${student.first_name || ''} ${student.last_name || ''}`.trim() || null;
      recipientRole        = 'Student';
      notificationAudience = 'student';
      recipientSource      = resolved.type;   // 'school' | 'personal' | 'missing'
      recipientReason      = resolved.reason;
      recipientWarning     = resolved.warning;
      if (resolved.type === 'missing' || !recipientEmail) {
        hardError = { status: 400, error: 'Student has no valid email on file' };
      }
    }
  }

  console.log('[connect-send-direct] handler_entry:', {
    recipient_type: recipientType,
    recipient_id:   recipientId,
    by:             ownerUserProfileId,
  });

  // ── 4b. Resolve + validate CC (CONNECT-COMMS-1D) ──────────────────────────────
  // CC is the only caller-supplied recipient field; To stays server-resolved. Invalid CC blocks
  // (both preview and send) so a typo never silently drops a recipient. Auto-suggested flag is
  // advisory audit only. cc==To and duplicates are dropped; capped at 5.
  const ccResult = resolveCcList(body.cc, recipientEmail);
  const ccList = ccResult.cc;
  const ccAutoSuggested = body.cc_auto_suggested === true;
  if (ccResult.invalid.length > 0) {
    return res.status(400).json({ success: false, error: `Invalid CC email: ${ccResult.invalid[0]}` });
  }

  // ── 5. Build email HTML (same renderer + same resolved signature for preview AND send) ──
  const { html } = buildDirectMessageEmail({
    body:             trimmedBody,
    bodyFormat:       resolvedBodyFormat,
    includeSignature: resolvedIncludeSignature,
    signature:        senderSig.signature,
  });

  // ── 5b. PREVIEW: return exact HTML + resolved recipient/CC/signature. No send, no log. ──
  // OUTREACH-ATTACHMENTS-1: preview reports the attachment list it WOULD send by
  // resolving the same slugs through the same server path, so what Review shows
  // is what Send uses. It still writes nothing and emails no one.
  if (isPreview) {
    const pv = await resolveAttachments({ db: supabaseAdmin, slugs: body.attachment_slugs });
    if (!pv.ok) {
      return res.status(pv.status || 400).json({ success: false, error: pv.error });
    }
    return res.status(200).json({
      success: true,
      html,
      attachments: pv.summary,
      recipient: {
        email:   recipientEmail,
        type:    recipientSource,
        name:    recipientName,
        reason:  recipientReason,
        warning: recipientWarning,
      },
      cc: ccList,
      signature: {
        source:       senderSig.source,
        display_name: senderSig.displayName,
        warning:      resolvedIncludeSignature && senderSig.source !== 'user'
          ? 'Using a fallback signature, configure yours in Settings → Email Signature.'
          : null,
      },
    });
  }

  // SEND mode: enforce any hard recipient failure now (after preview short-circuit).
  if (hardError) {
    return res.status(hardError.status).json({ success: false, error: hardError.error });
  }

  // ── 5c. Resolve attachments BEFORE any provider client exists ────────────────
  // OUTREACH-ATTACHMENTS-1: an invalid, missing, inactive, unauthorized or
  // oversized attachment fails HERE - before new Resend(...) and before the
  // recipient is emailed. Slugs in, validated bytes out.
  const att = await resolveAttachments({ db: supabaseAdmin, slugs: body.attachment_slugs });
  if (!att.ok) {
    return res.status(att.status || 400).json({ success: false, error: att.error });
  }

  // ── 5d. Prove the placement BEFORE any provider client exists ────────────────
  // A stale, altered, cross-cohort, cross-unit, wrong-preceptor or wrong-recipient
  // handoff fails HERE: no email is sent and no notification_log row is written,
  // so the Placement Board can never show a Sent chip that is not true. The
  // metadata that will be stamped is returned by the guard, built from the rows it
  // verified rather than from the request body.
  if (placementRefRaw) {
    const verdict = await verifyPlacementSend({
      db: supabaseAdmin,
      ref: placementRefRaw,
      recipientType,
      recipientEmail,
    });
    if (!verdict.ok) {
      console.warn('[connect-send-direct] placement rejected:', { code: verdict.code, match_id: placementRefRaw.match_id });
      return res.status(verdict.status).json({ success: false, error: verdict.error, placement_error: verdict.code });
    }
    placementMeta = verdict.metadata;
  }

  // ── 6. Send via Resend ────────────────────────────────────────────────────────
  const resend = new Resend(process.env.RESEND_API_KEY);

  let resendMessageId = null;
  let sendError       = null;

  try {
    const { data: emailData, error: emailErr } = await resend.emails.send({
      from:     FROM,
      to:       [recipientEmail],
      // CONNECT-COMMS-1D: reply_to = the logged-in sender's email when valid, else the prior default.
      reply_to: isValidEmail(ownerEmail) ? ownerEmail.trim() : REPLY_TO,
      // CC only when non-empty (never send cc: []).
      ...(ccList.length ? { cc: ccList } : {}),
      subject:  trimmedSubject,
      html,
      ...(att.attachments.length ? { attachments: att.attachments } : {}),
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

  // CONNECT-COMMS-1B: record which email source was used (school/personal/contact/override) so the
  // school-first routing is auditable without a schema migration (stored in the metadata jsonb).
  // CONNECT-COMMS-1D: sender/signature/CC audit (jsonb metadata - no migration). Body NOT stored.
  const sharedMeta = {
    recipient_source:      recipientSource,
    sent_by_user_id:       ownerUserProfileId,
    sent_by_email:         ownerEmail,
    sender_user_id:        ownerUserProfileId,
    sender_name:           senderSig.displayName,
    sender_email:          ownerEmail,
    signature_source:      senderSig.source,
    signature_display_name: senderSig.displayName,
    include_signature:     resolvedIncludeSignature,
    signature_included:    resolvedIncludeSignature,
    recipient_warning:     recipientWarning || null,
    cc_recipients:         ccList,
    cc_auto_suggested:     ccAutoSuggested,
    body_format:           resolvedBodyFormat,
    body_length:           trimmedBody.length,
    // OUTREACH-ATTACHMENTS-1: metadata ONLY (slug, title, filename, type, size).
    // Never bytes, storage paths, signed URLs, or upload tokens.
    attachments:           att.summary,
    attachment_count:      att.summary.length,
    // Present only for a placement-scoped send, and only on this success path -
    // a failed send returned 500 above, so no row exists to carry it.
    ...(placementMeta || {}),
  };
  const logMetadata = recipientType === 'contact'
    ? { recipient_type: 'contact', contact_id: recipientId,  ...sharedMeta }
    : { recipient_type: 'student', student_id: recipientId, ...sharedMeta };

  // Top-level recipient columns (Phase B.1). Mirror the identity already kept in
  // metadata so direct messages surface in per-contact / per-student history
  // queries that filter on the top-level columns (e.g. ContactsView). metadata
  // is preserved unchanged above. recipientType is validated to 'contact' |
  // 'student' upstream, so exactly one id is set and the other is null.
  const logRecipientColumns = recipientType === 'contact'
    ? { contact_id: recipientId, student_id: null,        recipient_type: 'contact' }
    : { contact_id: null,        student_id: recipientId, recipient_type: 'student' };

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
        ...logRecipientColumns,
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

  // ── 9. Best-effort message archive (Phase 2B) - store a REDACTED copy of the just-sent body so
  //      Sent History can preview this manual message later. NEVER fails the send: Resend already
  //      delivered and notification_log is written. Only runs once the notification_log id exists. ──
  let archiveStatus = 'skipped';
  if (notificationLogId) {
    const archiveResult = await archiveManualMessage({
      db:                supabaseAdmin,
      notificationLogId,
      html,
      bodyFormat:        resolvedBodyFormat,
      createdBy:         ownerUserProfileId || null,
    });
    archiveStatus = archiveResult.status;
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
    archive_status:      archiveStatus,
    sent_at:             sentAt,
  });
}
