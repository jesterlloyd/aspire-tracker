// lib/server/connect/emailTemplates.js
//
// Email template builder for ASPIRE Connect manual messaging (Direct Message + Bulk Manual Message).
// Used by api/connect-send-direct-email.js AND api/connect-send-bulk-message.js - both call
// buildDirectMessageEmail(), so this single shell governs the look of both. Preview and send call
// the SAME builder, so preview always equals sent.
//
// EMAIL-TEMPLATE-BRAND-REFRESH Phase 1: the approved executive ASPIRE shell -
//   • Nightfall (#1d2567) header: Cedars-Sinai logo left, bold "ASPIRE" right (display-only;
//     no template keys / slugs / notification_type / metadata identifiers change).
//   • Cedars-Sinai Red (#dc1e34) accent line under the header.
//   • Sand (#f4f1ec) outer background, white content card, Raven (#191919) body text.
//   • Signature: "Kind regards," + optional hosted handwritten image (sender-scoped) + typed
//     name (CS Red) / credentials / role / institute (ampersand) / "email | Office: phone".
//   • Nightfall footer (white text): ASPIRE/institute, Cedars-Sinai address, confidentiality note.
// Outlook-safe: table layout, inline CSS, ~620px, fully readable if images are blocked.

import { JESTER_SIGNATURE } from '../../../src/lib/notifications/templates/signatures.js';
import { connectSignatureImagePath, CONNECT_SIGNATURE_DEFAULT_AFFILIATION } from '../../../src/lib/connectSignatureAssets.js';
import { renderConnectBody } from './renderContentBlocks.js';
import { aspireEmailShell } from '../email/aspireShell.js';
import { appUrl } from '../appUrl.js';

const NIGHTFALL = '#1d2567';
const RAVEN     = '#191919';
const CS_RED    = '#dc1e34';

const JESTER_PHONE = '310-248-8964';

// EMAIL-SHELL-CONSOLIDATE-1: the manual-message footer note. Connect manual messages are reply-able
// (a real sender + Reply-To), so they keep this confidentiality note instead of the automated
// "do not reply" line. Passed to the shared aspireEmailShell as footerNote.
const CONNECT_FOOTER_NOTE = 'This ASPIRE communication was sent via ASPIRE Intelligence. It may contain confidential information intended only for the named recipient. If you received it in error, please delete it and notify the sender.';

// SIGNATURE-PREVIEW-PARITY-1: the sender-scoped handwritten image map moved to
// src/lib/connectSignatureAssets.js, shared with the Settings preview so the
// preview and the sent email can never disagree about who carries a GIF.

// ── Branded HTML shell ──────────────────────────────────────────────────────────
// EMAIL-SHELL-CONSOLIDATE-1: the manual Connect shell now reuses the SHARED ASPIRE shell
// (lib/server/email/aspireShell.js) - the single source of truth for header/footer/identity/logos -
// instead of a duplicated local copy. Manual messages pass their reply-able confidentiality footer
// note; everything else (Nightfall header, logos, ASPIRE wordmark, Sand card, footer identity) is
// shared. Body content, Content Blocks, signature, and preview-equals-sent behavior are unchanged.

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
    affiliation: '', // renderer default: the institute line, unchanged from before
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
  const imgPath   = connectSignatureImagePath(emailKey)
  const sigImage  = imgPath
    ? `<img src="${appUrl(imgPath)}" alt="${name}" width="160" height="60" style="display:block;width:160px;max-width:160px;height:auto;border:0;margin:6px 0 0;" />`
    : ''
  // SIGNATURE-PREVIEW-PARITY-1: the affiliation line now honors the sender's
  // Department field (it was hard-coded, so personalization silently dropped
  // it); an empty department renders the same institute line as always.
  const affiliation = escapeHtml(String(s.affiliation || '').trim() || CONNECT_SIGNATURE_DEFAULT_AFFILIATION)
  return `
<p style="margin:24px 0 6px;font-size:14px;color:${RAVEN};">Kind regards,</p>
${sigImage}
<p style="margin:0;font-size:14px;color:${RAVEN};line-height:1.6;">
  <strong style="color:${CS_RED};">${name}${creds}</strong>
  ${titleLine}
  <span style="display:block;">${affiliation}</span>
  ${emailLine}
</p>`;
}

// ── Direct Message / Bulk Manual email builder ──────────────────────────────────
// Builds the branded HTML for a manual outreach message. Used identically by Direct Message and
// Bulk Manual Message, and by their preview modes - so preview always equals sent.
//
// Arguments:
//   body             - composed message body (plain text)
//   bodyFormat       - 'text' | 'html'; 'text' is escaped + pre-wrapped
//   includeSignature - append the ASPIRE signature block
//   signature        - normalized per-sender signature object (null → static Jester fallback)
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
  return { html: aspireEmailShell({ body: content, footerNote: CONNECT_FOOTER_NOTE }) }
}

// Minimal HTML escaping for plain-text bodies
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
