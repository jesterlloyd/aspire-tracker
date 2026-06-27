// api/connect-send-bulk-message.js
//
// CONNECT-BULK-MESSAGE — bulk manual message endpoint.
//
//   • PREVIEW MODE (Phase 2B-1) — body.preview === true. Renders the branded ASPIRE email shell for
//     ONE sample recipient. STRUCTURALLY INCAPABLE OF SENDING in this path: no Resend call, no
//     notification_log write, no message_archive write. BEHAVIOR UNCHANGED from Phase 2B-1.
//
//   • SEND MODE (Phase 2B-2) — body.preview !== true. Sends real email in bulk for the four MANUAL
//     Send-to-Many templates. Tested ONLY via direct controlled API calls in this phase; NOT wired
//     to the Send-to-Many UI (that is Phase 2B-3). Because this can send real email, the server-side
//     safeguards are the ONLY protection in this phase and are airtight:
//       - Owner/admin auth + role check (identical to connect-send-direct-email.js).
//       - Server-enforced typed confirmation: body.confirmation === 'SEND MESSAGES'.
//       - Required client-provided UUID batch_id (idempotency + replay/resumability).
//       - Safety ceiling: at most MAX_RECIPIENTS per request (reject, never partial-send).
//       - Sequential per-recipient processing (no Promise.all), gentle pacing + 429 retry-once.
//       - Per-recipient isolation: one failure never aborts the batch; each recipient lands in
//         exactly one bucket (sent / skipped / failed).
//       - Within-batch idempotency: a recipient already logged sent under the same batch_id is
//         skipped (already_sent_in_batch). Cross-batch/double-submit protection is deferred to 2B-3.
//       - Recipient email is the CLIENT-SELECTED email, verified to belong to the student/contact.
//         NO school-vs-personal routing override (resolveStudentCorrespondenceRecipient is NOT used).
//       - One notification_log row per successful recipient (notification_type='bulk_message_sent').
//       - NO message_archive write (content_kind CHECK does not permit bulk manual email).
//
// POST /api/connect-send-bulk-message
// Authorization: Bearer <session-token>

import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import supabaseAdmin from '../lib/server/evaluation/supabase_admin.js';
import { buildDirectMessageEmail } from '../lib/server/connect/emailTemplates.js';
import { isValidEmail } from '../src/lib/notifications/studentRecipient.js';
import { normalizeEmailForLookup } from '../src/lib/emailUtils.js';
import { applyMergeFields } from '../src/lib/recipientParse.js';
import { JESTER_SIGNATURE, KRYSTAL_SIGNATURE } from '../src/lib/notifications/templates/signatures.js';

// Seeded fallback signatures for the two known leads (mirrors api/connect-send-direct-email.js).
const SIGNATURE_SEED = {
  [JESTER_SIGNATURE.email.toLowerCase()]:  { ...JESTER_SIGNATURE, phone: '310-248-8964' },
  [KRYSTAL_SIGNATURE.email.toLowerCase()]: { ...KRYSTAL_SIGNATURE, phone: '' },
};

// ── Send-mode constants ──
const FROM            = 'ASPIRE Program <noreply@aspire-program.com>';
const REPLY_TO        = 'JesterLloyd.Bautista@cshs.org';
const CONFIRMATION    = 'SEND MESSAGES';   // exact server-enforced phrase
const MAX_RECIPIENTS  = 75;                // Phase 2B-2 safety ceiling (reject, never partial-send)
const SEND_DELAY_MS   = 300;               // gentle pacing between Resend calls (rate-limit friendly)
const RATE_RETRY_MS   = 1000;              // backoff before a single 429 retry
const SUBJECT_MAX     = 200;
const BODY_MAX        = 10000;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isUuid(v) { return typeof v === 'string' && UUID_PATTERN.test(v); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Detect a Resend rate-limit (429) response so we can retry that ONE recipient once.
function isRateLimited(err) {
  if (!err) return false;
  if (err.statusCode === 429 || err.status === 429) return true;
  const name = String(err.name || '').toLowerCase();
  if (name.includes('rate_limit') || name.includes('rate limit')) return true;
  const msg = String(err.message || JSON.stringify(err) || '').toLowerCase();
  return /rate.?limit|too many requests|\b429\b/.test(msg);
}

// Resolve the sender's signature server-side (identical chain to the Direct Message endpoint, so the
// preview matches a send). Returns { source: 'user'|'seeded'|'fallback'|'static', signature, displayName }.
function resolveSenderSignature(profile) {
  const email = (profile?.email || '').trim();
  const cs = (profile?.connect_signature && typeof profile.connect_signature === 'object') ? profile.connect_signature : null;

  if (cs && cs.signature_enabled !== false && String(cs.display_name || '').trim()) {
    const displayName = String(cs.display_name).trim();
    return {
      source: 'user',
      displayName,
      signature: {
        displayName,
        credentials: String(cs.credentials || '').trim(),
        title:       String(cs.title || '').trim(),
        affiliation: String(cs.department || '').trim() || 'Brawerman Nursing Institute, Cedars-Sinai',
        email,
        phone:       String(cs.phone || '').trim(),
      },
    };
  }
  const seed = SIGNATURE_SEED[email.toLowerCase()];
  if (seed) {
    return {
      source: 'seeded',
      displayName: seed.fullName,
      signature: { displayName: seed.fullName, credentials: '', title: seed.title || '', affiliation: seed.affiliation, email: seed.email, phone: seed.phone || '' },
    };
  }
  if (String(profile?.full_name || '').trim()) {
    const displayName = String(profile.full_name).trim();
    return {
      source: 'fallback',
      displayName,
      signature: { displayName, credentials: '', title: profile?.role ? String(profile.role) : '', affiliation: 'ASPIRE Program · Brawerman Nursing Institute, Cedars-Sinai', email, phone: '' },
    };
  }
  return { source: 'static', displayName: JESTER_SIGNATURE.fullName, signature: null };
}

const ALLOWED_SOURCES = new Set(['student', 'contact', 'manual']);

// PREVIEW-mode first-name fallback (UNCHANGED from Phase 2B-1):
//   student → 'Student', contact → 'Colleague', manual → '' (leaves placeholder intact).
function effectiveFirstName(recipient) {
  const fn = String(recipient?.firstName || '').trim();
  if (fn) return fn;
  if (recipient?.source === 'student') return 'Student';
  if (recipient?.source === 'contact') return 'Colleague';
  return '';
}

// SEND-mode first-name fallback (Phase 2B-2 owner-locked): NEVER leaves a literal placeholder.
//   student → 'Student', contact → 'Colleague', manual/raw → 'there'.
function sendFirstName(source, firstName) {
  const fn = String(firstName || '').trim();
  if (fn) return fn;
  if (source === 'student') return 'Student';
  if (source === 'contact') return 'Colleague';
  return 'there';
}

// SEND-mode school fallback (Phase 2B-2 owner-locked): missing school → 'your school'.
function sendSchool(school) {
  return String(school || '').trim() || 'your school';
}

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

  try {
    return await _handler(req, res);
  } catch (err) {
    console.error('[connect-send-bulk-message] unhandled exception:', err?.message || err);
    return res.status(500).json({ success: false, error: `Server error: ${err?.message || 'unknown'}` });
  }
}

async function _handler(req, res) {
  // ── 1. Auth: Bearer session token (same pattern as connect-send-direct-email) ──
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

  // ── 2. Role check + resolve sender identity/signature ──
  const { data: profile } = await supabaseAdmin
    .from('user_profiles')
    .select('id, role, email, full_name, connect_signature')
    .eq('auth_user_id', user.id)
    .single();

  if (!profile || !['owner', 'admin'].includes(profile.role)) {
    return res.status(403).json({ success: false, error: 'Forbidden' });
  }
  const senderSig = resolveSenderSignature(profile);

  // ── 3. Parse body ──
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

  // ── 4. Mode branch ──
  // PREVIEW path is byte-unchanged from Phase 2B-1. SEND path is purely additive.
  if (body.preview === true) {
    // ===================== PREVIEW MODE (Phase 2B-1) — BEHAVIOR UNCHANGED =====================

    // ── 5. Validate inputs ──
    const recipient = body.recipient;
    if (!recipient || typeof recipient !== 'object') {
      return res.status(400).json({ success: false, error: 'recipient is required' });
    }
    const source = recipient.source;
    if (!ALLOWED_SOURCES.has(source)) {
      return res.status(400).json({ success: false, error: "recipient.source must be 'student', 'contact', or 'manual'" });
    }
    const recipientEmail = String(recipient.email || '').trim();
    if (!isValidEmail(recipientEmail)) {
      return res.status(400).json({ success: false, error: 'recipient.email is invalid' });
    }
    const subject = typeof body.subject === 'string' ? body.subject : '';
    const messageBody = typeof body.body === 'string' ? body.body : '';
    if (!messageBody.trim()) {
      return res.status(400).json({ success: false, error: 'body is required' });
    }
    const includeSignature = body.include_signature !== false; // default true

    // ── 6. Merge (first name + school only; locked fallback policy) ──
    const mergeCtx = {
      firstName: effectiveFirstName(recipient),
      school:    String(recipient.school || '').trim(),
    };
    const mergedBody    = applyMergeFields(messageBody, mergeCtx);
    const mergedSubject = applyMergeFields(subject, mergeCtx);

    // ── 7. Render branded HTML (same renderer + server-resolved signature as Direct Message) ──
    const { html } = buildDirectMessageEmail({
      body:             mergedBody,
      bodyFormat:       'text',
      includeSignature,
      signature:        senderSig.signature,
    });

    // ── 8. Return preview — NO send, NO notification_log, NO message_archive ──
    return res.status(200).json({
      success: true,
      html,
      subject: mergedSubject,
      recipient: {
        email: recipientEmail,
        name:  String(recipient.name || '').trim() || null,
        source,
      },
      signature: {
        source:       senderSig.source,
        display_name: senderSig.displayName,
      },
    });
  }

  // ============================ SEND MODE (Phase 2B-2) ============================
  return await runSendMode(res, body, senderSig, profile);
}

// Send-mode handler. Kept separate from the preview path so preview behavior is provably untouched.
async function runSendMode(res, body, senderSig, profile) {
  // ── S1. Reject any caller attempt to inject a top-level recipient override. ──
  for (const f of ['email', 'to', 'cc', 'bcc']) {
    if (f in body) {
      return res.status(400).json({ success: false, error: `Field '${f}' is not permitted in send mode.` });
    }
  }

  // ── S2. Server-enforced typed confirmation (primary guard this phase). ──
  if (body.confirmation !== CONFIRMATION) {
    return res.status(400).json({ success: false, error: `confirmation must be exactly "${CONFIRMATION}"` });
  }

  // ── S3. Required client-provided UUID batch_id (idempotency + replay/resumability). ──
  const batchId = body.batch_id;
  if (!isUuid(batchId)) {
    return res.status(400).json({ success: false, error: 'batch_id is required and must be a valid UUID' });
  }

  // ── S4. Subject/body required + capped (mirrors Direct Message). ──
  const subjectRaw = typeof body.subject === 'string' ? body.subject : '';
  const bodyRaw    = typeof body.body === 'string' ? body.body : '';
  if (!subjectRaw.trim()) return res.status(400).json({ success: false, error: 'subject is required and must be non-empty' });
  if (!bodyRaw.trim())    return res.status(400).json({ success: false, error: 'body is required and must be non-empty' });
  if (subjectRaw.trim().length > SUBJECT_MAX) return res.status(400).json({ success: false, error: `subject must not exceed ${SUBJECT_MAX} characters` });
  if (bodyRaw.trim().length > BODY_MAX)       return res.status(400).json({ success: false, error: `body must not exceed ${BODY_MAX} characters` });
  const includeSignature = body.include_signature !== false; // default true

  // ── S5. Recipients array + safety ceiling (reject over-limit; never partial-send). ──
  const recipients = body.recipients;
  if (!Array.isArray(recipients) || recipients.length === 0) {
    return res.status(400).json({ success: false, error: 'recipients must be a non-empty array' });
  }
  if (recipients.length > MAX_RECIPIENTS) {
    return res.status(400).json({
      success: false,
      error: `recipients must not exceed ${MAX_RECIPIENTS} per request (Phase 2B-2 safety ceiling). Split the list and resend.`,
    });
  }

  // Optional template identity (audit metadata only; not security-sensitive).
  const templateKey   = typeof body.template_key === 'string' ? body.template_key : null;
  const templateLabel = typeof body.template_label === 'string' ? body.template_label : null;

  const senderUserId = profile.id;
  const senderEmail  = profile.email;
  const replyTo      = isValidEmail(senderEmail) ? senderEmail.trim() : REPLY_TO;

  console.log('[connect-send-bulk-message] batch_start:', {
    batch_id: batchId, count: recipients.length, by: senderUserId,
  });

  const resend  = new Resend(process.env.RESEND_API_KEY);
  const sent    = [];
  const skipped = [];
  const failed  = [];
  const seenNorm = new Set();   // within-request duplicate detection
  let attemptedSend = false;    // gate pacing so we only delay around real Resend calls

  for (let i = 0; i < recipients.length; i++) {
    const r = recipients[i] || {};
    const source = r.source;
    const rawEmail = String(r.email || '').trim();
    const normEmail = normalizeEmailForLookup(rawEmail);
    const label = { index: i, source: source || null, email: rawEmail || null };

    try {
      // S6a. Shape + email validity.
      if (!ALLOWED_SOURCES.has(source)) { skipped.push({ ...label, reason: 'invalid_source' }); continue; }
      if (!rawEmail)                    { skipped.push({ ...label, reason: 'missing_email' }); continue; }
      if (!isValidEmail(rawEmail))      { skipped.push({ ...label, reason: 'invalid_email' }); continue; }

      // S6b. Within-request duplicate (first valid occurrence wins).
      if (seenNorm.has(normEmail)) { skipped.push({ ...label, reason: 'duplicate' }); continue; }
      seenNorm.add(normEmail);

      // S6c. Ownership verification — send to the CHOSEN email, verified to belong to the recipient.
      //      NO school-vs-personal routing override is ever invoked.
      let emailSource = null;     // students only: 'school' | 'personal'
      let recipientId = null;
      let recipientName = String(r.name || '').trim() || null;

      if (source === 'student') {
        if (!isUuid(r.studentId)) { skipped.push({ ...label, reason: 'invalid_student_id' }); continue; }
        const { data: student, error: sErr } = await supabaseAdmin
          .from('students')
          .select('id, first_name, last_name, personal_email, school_email')
          .eq('id', r.studentId)
          .single();
        if (sErr || !student) { skipped.push({ ...label, reason: 'student_not_found' }); continue; }
        emailSource = r.emailType === 'personal' ? 'personal' : 'school';
        const ownedEmail = emailSource === 'personal' ? student.personal_email : student.school_email;
        if (!ownedEmail || normalizeEmailForLookup(String(ownedEmail).trim()) !== normEmail) {
          skipped.push({ ...label, reason: 'email_mismatch' }); continue;
        }
        recipientId = student.id;
        recipientName = recipientName || `${student.first_name || ''} ${student.last_name || ''}`.trim() || null;

      } else if (source === 'contact') {
        if (!isUuid(r.contactId)) { skipped.push({ ...label, reason: 'invalid_contact_id' }); continue; }
        const { data: contact, error: cErr } = await supabaseAdmin
          .from('contacts')
          .select('id, full_name, email, is_active')
          .eq('id', r.contactId)
          .single();
        if (cErr || !contact) { skipped.push({ ...label, reason: 'contact_not_found' }); continue; }
        if (contact.is_active === false) { skipped.push({ ...label, reason: 'contact_inactive' }); continue; }
        if (!contact.email || normalizeEmailForLookup(String(contact.email).trim()) !== normEmail) {
          skipped.push({ ...label, reason: 'email_mismatch' }); continue;
        }
        recipientId = contact.id;
        recipientName = recipientName || contact.full_name || null;
      }
      // source === 'manual': no id, no ownership row; email already validated.

      // S6d. Within-batch idempotency — skip a recipient already logged sent under this batch_id.
      const { data: dup } = await supabaseAdmin
        .from('notification_log')
        .select('id')
        .eq('notification_type', 'bulk_message_sent')
        .filter('metadata->>batch_id', 'eq', batchId)
        .filter('metadata->>recipient_email_norm', 'eq', normEmail)
        .limit(1);
      if (dup && dup.length > 0) { skipped.push({ ...label, reason: 'already_sent_in_batch' }); continue; }

      // S6e. Merge (first name + school with graceful fallback; all other placeholders left literal).
      const mergeCtx = { firstName: sendFirstName(source, r.firstName), school: sendSchool(r.school) };
      const mergedSubject = applyMergeFields(subjectRaw.trim(), mergeCtx);
      const mergedBody    = applyMergeFields(bodyRaw.trim(), mergeCtx);

      // S6f. Render branded HTML (same renderer + server-resolved signature as Direct Message).
      const { html } = buildDirectMessageEmail({
        body:             mergedBody,
        bodyFormat:       'text',
        includeSignature,
        signature:        senderSig.signature,
      });

      // S6g. Send via Resend (pace + single 429 retry). Per-recipient failure never aborts the batch.
      if (attemptedSend) await sleep(SEND_DELAY_MS);
      attemptedSend = true;

      let resendMessageId = null;
      let sendError       = null;
      const sendParams = {
        from:     FROM,
        to:       [rawEmail],
        reply_to: replyTo,
        subject:  mergedSubject,
        html,
        tags: [
          { name: 'type',             value: 'bulk_message_sent' },
          { name: 'batch_id',         value: batchId },
          { name: 'recipient_source', value: source },
        ],
      };
      try {
        let { data: emailData, error: emailErr } = await resend.emails.send(sendParams);
        if (emailErr && isRateLimited(emailErr)) {
          await sleep(RATE_RETRY_MS);
          ({ data: emailData, error: emailErr } = await resend.emails.send(sendParams));
        }
        if (emailErr) {
          sendError = emailErr.message || JSON.stringify(emailErr);
        } else {
          resendMessageId = emailData?.id || null;
        }
      } catch (err) {
        sendError = err?.message || 'unknown send error';
      }

      if (sendError) {
        console.error('[connect-send-bulk-message] send_failed:', { batch_id: batchId, index: i, error: sendError });
        failed.push({ ...label, reason: `send_error: ${sendError}` });
        continue;
      }

      // S6h. Audit log — ONE row per successful recipient. Body content is NOT stored.
      const sentAt = new Date().toISOString();
      const metadata = {
        batch_id:             batchId,
        template_key:         templateKey,
        template_label:       templateLabel,
        recipient_source:     source,
        recipient_type:       source,
        recipient_id:         recipientId,
        recipient_email:      rawEmail,
        recipient_email_norm: normEmail,
        email_source:         emailSource,            // student only; null otherwise
        subject:              mergedSubject,
        source:               'connect_bulk_message',
        resend_message_id:    resendMessageId,
        sent_by_user_id:      senderUserId,
        sent_by_email:        senderEmail,
        signature_source:     senderSig.source,
      };
      try {
        await supabaseAdmin.from('notification_log').insert({
          notification_type: 'bulk_message_sent',
          audience:          source,
          recipient_email:   rawEmail,
          recipient_name:    recipientName,
          recipient_role:    source === 'student' ? 'Student' : source === 'contact' ? 'Contact' : null,
          subject:           mergedSubject,
          status:            'sent',
          resend_email_id:   resendMessageId,
          sent_at:           sentAt,
          recipient_type:    source,
          student_id:        source === 'student' ? recipientId : null,
          contact_id:        source === 'contact' ? recipientId : null,
          metadata,
        });
      } catch (logErr) {
        // Non-fatal — the email already sent. Record the audit-log failure for diagnostics.
        console.error('[connect-send-bulk-message] log_write_failed:', { batch_id: batchId, index: i, error: logErr?.message });
      }

      sent.push({ index: i, source, email: rawEmail, recipient_id: recipientId, sent_at: sentAt });

    } catch (itemErr) {
      console.error('[connect-send-bulk-message] item_error:', { batch_id: batchId, index: i, error: itemErr?.message });
      failed.push({ ...label, reason: `unexpected_error: ${itemErr?.message || 'unknown'}` });
    }
  }

  console.log('[connect-send-bulk-message] batch_complete:', {
    batch_id: batchId, sent: sent.length, skipped: skipped.length, failed: failed.length,
  });

  return res.status(200).json({
    success: true,
    batch_id: batchId,
    summary: { total: recipients.length, sent: sent.length, skipped: skipped.length, failed: failed.length },
    sent,
    skipped,
    failed,
  });
}
