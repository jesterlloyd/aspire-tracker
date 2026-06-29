// lib/server/connect/emailTemplates.js
//
// Email template builder for ASPIRE Connect manual messaging (Direct Message + Bulk Manual Message).
// Used by api/connect-send-direct-email.js AND api/connect-send-bulk-message.js — both call
// buildDirectMessageEmail(), so this single shell governs the look of both. Preview and send call
// the SAME builder, so preview always equals sent.
//
// EMAIL-TEMPLATE-BRAND-REFRESH Phase 1: the approved executive ASPIRE shell —
//   • Nightfall (#1d2567) header: Cedars-Sinai logo left, bold "ASPIRE" right (display-only;
//     no template keys / slugs / notification_type / metadata identifiers change).
//   • Cedars-Sinai Red (#dc1e34) accent line under the header.
//   • Sand (#f4f1ec) outer background, white content card, Raven (#191919) body text.
//   • Signature: "Kind regards," + optional hosted handwritten image (sender-scoped) + typed
//     name (CS Red) / credentials / role / institute (ampersand) / "email | Office: phone".
//   • Nightfall footer (white text): ASPIRE/institute, Cedars-Sinai address, confidentiality note.
// Outlook-safe: table layout, inline CSS, ~620px, fully readable if images are blocked.

import { JESTER_SIGNATURE } from '../../../src/lib/notifications/templates/signatures.js';
import { renderConnectBody } from './renderContentBlocks.js';

const NIGHTFALL = '#1d2567';
const SAND      = '#f4f1ec';
const RAVEN     = '#191919';
const CS_RED    = '#dc1e34';

const JESTER_PHONE = '310-248-8964';

// Hosted handwritten-signature images, keyed by the sender's email (normalized lowercase). The
// image is an ENHANCEMENT only — the typed name/credentials block stands on its own if it is
// blocked. Only senders with a registered image get one (others render text-only, correctly).
const SIGNATURE_IMAGES = {
  'jesterlloyd.bautista@cshs.org': 'https://aspire-tracker.vercel.app/signature-jester.gif',
};

// ── Branded HTML shell (shared by Direct Message + Bulk Manual Message) ─────────

function wrap(content) {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ASPIRE</title></head>
<body style="margin:0;padding:0;background:${SAND};font-family:'DM Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:${RAVEN};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${SAND};padding:32px 16px;">
<tr><td align="center">
<table role="presentation" width="620" cellpadding="0" cellspacing="0"
  style="max-width:620px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.06);">

<!-- Header: Nightfall, Cedars-Sinai logo left (institutional anchor), ASPIRE wordmark + meaning right -->
<tr><td style="background:${NIGHTFALL};padding:14px 28px;">
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%"><tr>
    <td align="left" style="vertical-align:middle;">
      <img src="https://aspire-tracker.vercel.app/cs-logo-large.png"
           alt="Cedars-Sinai"
           width="140" height="62"
           style="display:block;width:140px;max-width:140px;height:62px;border:0;" />
    </td>
    <td align="right" style="vertical-align:middle;text-align:right;">
      <div style="color:#ffffff;font-size:22px;font-weight:800;letter-spacing:1.5px;line-height:1.1;font-family:'DM Sans',Helvetica,Arial,sans-serif;">ASPIRE</div>
      <div style="color:rgba(255,255,255,0.72);font-size:9px;font-weight:400;letter-spacing:0.2px;line-height:1.3;margin-top:5px;">Affiliate Students&rsquo; Pathway from Internship to Residency Experience</div>
    </td>
  </tr></table>
</td></tr>

<!-- Body -->
<tr><td style="padding:32px 30px;font-size:15px;line-height:1.6;color:${RAVEN};">${content}</td></tr>

<!-- Footer: Nightfall, white Cedars-Sinai mark + identity block -->
<tr><td style="background:${NIGHTFALL};padding:18px 28px;">
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%"><tr>
    <td width="54" style="vertical-align:top;padding-right:14px;">
      <img src="https://aspire-tracker.vercel.app/cs-logo-white-mark.png"
           alt="Cedars-Sinai"
           width="40" height="40"
           style="display:block;width:40px;height:40px;border:0;" />
    </td>
    <td style="vertical-align:top;">
      <p style="margin:0;color:#ffffff;font-size:12px;font-weight:700;line-height:1.5;">ASPIRE &bull; Geri &amp; Richard Brawerman Nursing Institute</p>
      <p style="margin:3px 0 0;color:rgba(255,255,255,0.82);font-size:11px;line-height:1.5;">Cedars-Sinai Medical Center &bull; 8700 Beverly Blvd, Los Angeles, CA 90048</p>
      <p style="margin:12px 0 0;color:rgba(255,255,255,0.6);font-size:10px;line-height:1.55;">This ASPIRE communication was sent via ASPIRE Intelligence. It may contain confidential information intended only for the named recipient. If you received it in error, please delete it and notify the sender.</p>
    </td>
  </tr></table>
</td></tr>

</table>
</td></tr>
</table>
</body></html>`;
}

// ── Signature block ────────────────────────────────────────────────────────────
// `sig` is a normalized object { displayName, credentials, title, affiliation, email, phone }
// resolved server-side per sender (CONNECT-COMMS-1D); null → static Jester fallback. ALL fields are
// user-editable free text → escaped here. The institute line is the fixed approved ASPIRE institute
// (all manual senders share it); the handwritten image is sender-scoped + enhancement-only.

function signatureBlock(sig) {
  const s = sig || {
    displayName: JESTER_SIGNATURE.fullName,
    credentials: '',
    title:       '',
    affiliation: JESTER_SIGNATURE.affiliation,
    email:       JESTER_SIGNATURE.email,
    phone:       JESTER_PHONE,
  }
  const name      = escapeHtml(s.displayName || '')
  const creds     = s.credentials ? `, ${escapeHtml(s.credentials)}` : ''
  const titleLine = s.title ? `<span style="display:block;">${escapeHtml(s.title)}</span>` : ''
  const email     = escapeHtml(s.email || '')
  const emailKey  = String(s.email || '').trim().toLowerCase()
  const phonePart = s.phone ? ` | Office: ${escapeHtml(s.phone)}` : ''
  const emailLine = email
    ? `<span style="display:block;margin-top:2px;"><a href="mailto:${email}" style="color:${NIGHTFALL};text-decoration:none;">${email}</a>${phonePart}</span>`
    : ''
  // Sender-scoped handwritten image (enhancement only). Typed block below stands alone if blocked.
  const imgUrl    = SIGNATURE_IMAGES[emailKey]
  const sigImage  = imgUrl
    ? `<img src="${imgUrl}" alt="${name}" width="160" height="60" style="display:block;width:160px;max-width:160px;height:auto;border:0;margin:6px 0 0;" />`
    : ''
  return `
<p style="margin:24px 0 6px;font-size:14px;color:${RAVEN};">Kind regards,</p>
${sigImage}
<p style="margin:0;font-size:14px;color:${RAVEN};line-height:1.6;">
  <strong style="color:${CS_RED};">${name}${creds}</strong>
  ${titleLine}
  <span style="display:block;">Geri &amp; Richard Brawerman Nursing Institute</span>
  ${emailLine}
</p>`;
}

// ── Direct Message / Bulk Manual email builder ──────────────────────────────────
// Builds the branded HTML for a manual outreach message. Used identically by Direct Message and
// Bulk Manual Message, and by their preview modes — so preview always equals sent.
//
// Arguments:
//   body             — composed message body (plain text)
//   bodyFormat       — 'text' | 'html'; 'text' is escaped + pre-wrapped
//   includeSignature — append the ASPIRE signature block
//   signature        — normalized per-sender signature object (null → static Jester fallback)
//
// Returns: { html: string }. Subject is sent separately, not injected into the body.

export function buildDirectMessageEmail({ body, bodyFormat = 'text', includeSignature = true, signature = null }) {
  // SECURITY: the 'html' branch is the chokepoint for BOTH endpoints. renderConnectBody runs the
  // two-lane pipeline (extract Content Block markers -> sanitize prose -> style h2/h3 -> render blocks
  // from trusted server templates), so raw HTML can never reach the shell even if a caller forgets to
  // pre-process (defense in depth). 'text' behavior is unchanged: escape + pre-wrap.
  const bodyHtml = bodyFormat === 'html'
    ? renderConnectBody(body)
    : `<p style="margin:0;font-size:15px;line-height:1.7;white-space:pre-wrap;color:${RAVEN};">${escapeHtml(body)}</p>`

  const sig = includeSignature ? signatureBlock(signature) : ''

  const content = `${bodyHtml}${sig}`
  return { html: wrap(content) }
}

// Minimal HTML escaping for plain-text bodies
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
