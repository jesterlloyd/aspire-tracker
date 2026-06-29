// lib/server/connect/renderContentBlocks.js
//
// RICH-COMPOSE-2A-0 — shared server renderer for ASPIRE Connect Content Blocks (the "block lane").
// Called by buildDirectMessageEmail so PREVIEW and SEND, and Send-to-one and Send-to-many, all share
// ONE renderer and cannot drift.
//
// TWO-LANE MODEL:
//   • PROSE lane  — user-authored rich text is tightly sanitized by sanitizeEmailHtml (the trust
//                   boundary). Phase 2A adds only h2/h3 as bare tags; styling is injected here, NOT
//                   accepted from the client.
//   • BLOCK lane  — approved block markers are EXTRACTED before prose sanitization, replaced with
//                   opaque tokens, and substituted AFTER sanitization with HTML produced by TRUSTED
//                   server templates only. No client HTML/style/attributes are ever echoed.
//
// Phase 2A-0 implements ONE zero-field block: Divider (<hr data-aspire-block="divider">). It has no
// fields, so its attack surface is minimal: a forged marker can at worst produce an extra (benign)
// horizontal rule — never script/style/HTML injection, because the server emits a fixed template.

import { sanitizeEmailHtml } from './sanitizeEmailHtml.js';

const NIGHTFALL = '#1d2567';

// Opaque placeholder delimiters: U+E000/U+E001 are Unicode Private-Use chars that do not occur in
// normal email text. Built at runtime (not as source literals) to avoid invisible-character fragility.
// Each extracted block marker becomes `${TOK_OPEN}<index>${TOK_CLOSE}` between the sanitization passes.
const TOK_OPEN = String.fromCharCode(0xE000);
const TOK_CLOSE = String.fromCharCode(0xE001);

// LOCKED heading styles (server-controlled; the user cannot pick size or color).
const H2_STYLE = `margin:18px 0 8px;color:${NIGHTFALL};font-size:20px;font-weight:700;line-height:1.3;`;
const H3_STYLE = `margin:16px 0 6px;color:${NIGHTFALL};font-size:16px;font-weight:600;line-height:1.4;`;

// Canonical, email-safe divider. Table-based for Outlook safety; no user styling is ever accepted.
function renderDivider() {
  return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0;">'
    + '<tr><td style="border-top:1px solid #e5e7eb;font-size:0;line-height:0;height:1px;">&#160;</td></tr></table>';
}

// Registry of APPROVED blocks → trusted server renderers. Unknown types are dropped (never rendered).
const BLOCK_RENDERERS = {
  divider: renderDivider,
};

// Extract approved block markers from the RAW client HTML, before prose sanitization. Only our own
// fixed marker shapes are matched; everything else stays in the prose stream and is sanitized normally.
// Returns { tokenized, blocks: [{ token, type }] }.
function extractBlocks(rawHtml) {
  const blocks = [];
  // Divider: a void <hr> carrying data-aspire-block="divider". Matched defensively (any attribute
  // order, single/double quotes). No attribute VALUES are trusted — divider has no fields.
  const DIVIDER_RE = /<hr\b[^>]*\bdata-aspire-block\s*=\s*["']divider["'][^>]*>/gi;
  const tokenized = String(rawHtml || '').replace(DIVIDER_RE, () => {
    const token = `${TOK_OPEN}${blocks.length}${TOK_CLOSE}`;
    blocks.push({ token, type: 'divider' });
    return token;
  });
  return { tokenized, blocks };
}

// Inject the LOCKED inline styles onto bare h2/h3 (the sanitizer emits them attribute-free, so the
// opening tag is exactly "<h2>" / "<h3>"). Gmail strips <style> blocks, so headings must be inline.
function styleHeadings(html) {
  return String(html)
    .replace(/<h2>/gi, `<h2 style="${H2_STYLE}">`)
    .replace(/<h3>/gi, `<h3 style="${H3_STYLE}">`);
}

// THE shared body renderer. extract blocks -> sanitize prose -> style headings -> substitute blocks.
// Returns final, safe body HTML ready for the existing manual Connect email shell.
export function renderConnectBody(rawHtml) {
  if (typeof rawHtml !== 'string' || rawHtml.trim() === '') return '';
  const { tokenized, blocks } = extractBlocks(rawHtml);
  let safe = sanitizeEmailHtml(tokenized);   // tight prose allowlist (+ h2/h3); tokens survive as text
  safe = styleHeadings(safe);
  for (const b of blocks) {
    const render = BLOCK_RENDERERS[b.type];   // unknown type -> undefined -> token replaced with ''
    safe = safe.split(b.token).join(render ? render() : '');
  }
  // Defensive: strip any stray sentinel chars (e.g. if a user literally typed one). Never leak tokens.
  safe = safe.split(TOK_OPEN).join('').split(TOK_CLOSE).join('');
  return safe;
}
