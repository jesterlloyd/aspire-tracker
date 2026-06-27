// api/connect-send-bulk-message.js
//
// CONNECT-BULK-MESSAGE Phase 2B-1 — PREVIEW ONLY.
//
// Renders the branded ASPIRE email shell for ONE sample recipient (student | contact | manual/raw
// pasted email) so the Send-to-Many manual composer can show a true "Preview as sent" for recipients
// that have no DB id (the existing direct-email preview requires a UUID recipient_id and cannot
// render raw pasted addresses).
//
// STRUCTURALLY INCAPABLE OF SENDING:
//   - `resend` is NOT imported.
//   - There is no Resend call, no notification_log write, no message_archive write.
//   - Any non-preview request returns 400 ("send mode not enabled in Phase 2B-1").
//   - Send mode (Resend + per-recipient notification_log + batch_id idempotency) arrives in 2B-2.
//
// Reuses the Direct Message renderer + signature behavior so the preview matches what 2B-2 will send.

import { createClient } from '@supabase/supabase-js';
import supabaseAdmin from '../lib/server/evaluation/supabase_admin.js';
import { buildDirectMessageEmail } from '../lib/server/connect/emailTemplates.js';
import { isValidEmail } from '../src/lib/notifications/studentRecipient.js';
import { applyMergeFields } from '../src/lib/recipientParse.js';
import { JESTER_SIGNATURE, KRYSTAL_SIGNATURE } from '../src/lib/notifications/templates/signatures.js';

// Seeded fallback signatures for the two known leads (mirrors api/connect-send-direct-email.js).
const SIGNATURE_SEED = {
  [JESTER_SIGNATURE.email.toLowerCase()]:  { ...JESTER_SIGNATURE, phone: '310-248-8964' },
  [KRYSTAL_SIGNATURE.email.toLowerCase()]: { ...KRYSTAL_SIGNATURE, phone: '' },
};

// Resolve the sender's signature server-side (identical chain to the Direct Message endpoint, so the
// preview matches a future send). Returns { source: 'user'|'seeded'|'fallback'|'static', signature, displayName }.
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

// Resolve the first name to merge, applying the locked fallback policy:
//   student  → 'Student'   when missing
//   contact  → 'Colleague' when missing
//   manual   → ''          when missing (leaves the placeholder intact)
function effectiveFirstName(recipient) {
  const fn = String(recipient?.firstName || '').trim();
  if (fn) return fn;
  if (recipient?.source === 'student') return 'Student';
  if (recipient?.source === 'contact') return 'Colleague';
  return '';
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

  // ── 4. PREVIEW-ONLY GUARD — send mode does not exist in Phase 2B-1 ──
  if (body.preview !== true) {
    return res.status(400).json({ success: false, error: 'send mode not enabled in Phase 2B-1' });
  }

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
