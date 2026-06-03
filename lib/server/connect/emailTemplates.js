// lib/server/connect/emailTemplates.js
//
// Email template builders for ASPIRE Connect direct messaging.
// Used by api/connect-send-direct-email.js.
// Follows the HTML structure established in lib/server/evaluation/emailTemplates.js.

import { JESTER_SIGNATURE } from '../../../src/lib/notifications/templates/signatures.js';

const NAVY  = '#1D2567';
const SAND  = '#F4F1EC';
const RAVEN = '#191919';

const JESTER_PHONE = '310-248-8964';

// ── HTML wrapper (matches coordinator digest / evaluation email pattern) ───────

function wrap(content) {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ASPIRE Program</title></head>
<body style="margin:0;padding:0;background:${SAND};font-family:'DM Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:${RAVEN};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${SAND};padding:32px 16px;">
<tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0"
  style="max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.06);">

<!-- Nightfall header with Cedars-Sinai logo — compact general communications variant -->
<tr><td style="background:${NAVY};padding:12px 28px;">
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%"><tr>
    <td style="vertical-align:middle;">
      <img src="https://aspire-tracker.vercel.app/cs-logo-large.png"
           alt="Cedars-Sinai"
           width="160" height="auto"
           style="display:block;height:auto;max-height:46px;width:auto;max-width:160px;border:0;" />
    </td>
    <td style="text-align:right;vertical-align:middle;">
      <div style="color:#ffffff;font-size:11px;font-weight:700;letter-spacing:1.1px;text-transform:uppercase;line-height:1.4;">ASPIRE Program</div>
      <div style="color:rgba(255,255,255,0.75);font-size:10px;letter-spacing:0.3px;margin-top:3px;line-height:1.4;">Brawerman Nursing Institute</div>
    </td>
  </tr></table>
</td></tr>

<!-- Body -->
<tr><td style="padding:32px 28px;font-size:15px;line-height:1.6;color:${RAVEN};">${content}</td></tr>

<!-- Footer -->
<tr><td style="padding:0 28px 24px;font-size:11px;color:#9ca3af;line-height:1.5;border-top:1px solid #f0ede8;padding-top:16px;">
  This is an ASPIRE Program communication sent via ASPIRE Intelligence.
</td></tr>

</table>
</td></tr>
</table>
</body></html>`;
}

// ── Signature block ────────────────────────────────────────────────────────────

function signatureBlock() {
  return `
<p style="margin:24px 0 6px;font-size:14px;color:${RAVEN};">Warm regards,</p>
<p style="margin:0;font-size:14px;color:${RAVEN};line-height:1.6;">
  <strong>${JESTER_SIGNATURE.fullName}</strong><br>
  ${JESTER_SIGNATURE.affiliation}<br>
  <a href="mailto:${JESTER_SIGNATURE.email}" style="color:${NAVY};">${JESTER_SIGNATURE.email}</a>
  &nbsp;|&nbsp;Office: ${JESTER_PHONE}
</p>`;
}

// ── Direct Message email builder ───────────────────────────────────────────────
// Builds a polished HTML email for a direct outreach message.
//
// Arguments:
//   body             — the composed message body text (plain text)
//   bodyFormat       — 'text' | 'html'; 'text' is wrapped in pre-style block
//   includeSignature — whether to append the ASPIRE Program signature
//
// Returns: { html: string }
// The subject is not injected into the HTML body; it is sent as the email subject.

export function buildDirectMessageEmail({ body, bodyFormat = 'text', includeSignature = true }) {
  const bodyHtml = bodyFormat === 'html'
    ? body
    : `<p style="margin:0;font-size:15px;line-height:1.7;white-space:pre-wrap;color:${RAVEN};">${escapeHtml(body)}</p>`

  const sig = includeSignature ? signatureBlock() : ''

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
