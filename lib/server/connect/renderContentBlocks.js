// lib/server/connect/renderContentBlocks.js
//
// Shared server renderer for ASPIRE Connect Content Blocks (the "block lane"). Called by
// buildDirectMessageEmail so PREVIEW and SEND, and Send-to-one and Send-to-many, share ONE renderer.
//
// TWO-LANE MODEL:
//   • PROSE lane  — user-authored rich text is tightly sanitized by sanitizeEmailHtml (trust boundary;
//                   adds only bare h2/h3, styled server-side).
//   • BLOCK lane  — approved block markers are EXTRACTED (via htmlparser2, robust against any value
//                   content) before prose sanitization, replaced with opaque tokens, then substituted
//                   AFTER sanitization with HTML from TRUSTED server templates that render ONLY from
//                   VALIDATED + ESCAPED scalar fields. No client HTML/style/attributes are ever echoed.
//
// Blocks: Divider (2A-0, no fields) and Linked Button (2A-2, label + url). Marker HTML/children are
// discarded; only known scalar attributes are read, then validated and escaped. A forged/malformed
// marker can at worst render a benign block or be dropped — never script/style/HTML injection.

import { Parser } from 'htmlparser2';
import { sanitizeEmailHtml } from './sanitizeEmailHtml.js';
import { validateButtonUrl } from '../../../src/lib/connect/buttonUrl.js';

const NIGHTFALL = '#1d2567';
const CS_RED = '#dc1e34';
const LABEL_MAX = 60;

// Opaque placeholder delimiters: U+E000/U+E001 Private-Use chars; built at runtime to avoid invisible
// source literals. Each extracted marker becomes `${TOK_OPEN}<index>${TOK_CLOSE}` between passes.
const TOK_OPEN = String.fromCharCode(0xE000);
const TOK_CLOSE = String.fromCharCode(0xE001);

// LOCKED heading styles (server-controlled; the user cannot pick size or color).
const H2_STYLE = `margin:18px 0 8px;color:${NIGHTFALL};font-size:20px;font-weight:700;line-height:1.3;`;
const H3_STYLE = `margin:16px 0 6px;color:${NIGHTFALL};font-size:16px;font-weight:600;line-height:1.4;`;

const VOID_TAGS = new Set(['hr', 'br', 'img', 'input', 'meta', 'link', 'area', 'base', 'col', 'source', 'wbr']);

// Escape text content (label) for HTML body context.
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
// Escape an already-validated URL for a double-quoted attribute context.
function escapeAttr(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/"/g, '&quot;')
    .replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── Block renderers (TRUSTED; render only from validated/escaped scalar fields) ──

// Canonical, email-safe divider. Table-based for Outlook safety; no user styling.
function renderDivider() {
  return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0;">'
    + '<tr><td style="border-top:1px solid #e5e7eb;font-size:0;line-height:0;height:1px;">&#160;</td></tr></table>';
}

// Canonical, email-safe Cedars-Sinai Red button. Label is required + escaped; URL is validated
// (https:/mailto: only) + escaped. Missing label or invalid URL → the button is DROPPED safely.
function renderButton(attribs) {
  const label = String(attribs['data-label'] || '').trim().slice(0, LABEL_MAX);
  if (!label) return '';
  const { ok, url } = validateButtonUrl(attribs['data-url']);
  if (!ok) return '';
  const safeLabel = escapeHtml(label);
  const safeHref = escapeAttr(url);
  return '<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:18px 0;"><tr>'
    + `<td align="center" bgcolor="${CS_RED}" style="background:${CS_RED};border-radius:6px;">`
    + `<a href="${safeHref}" target="_blank" rel="noopener noreferrer" `
    + `style="display:inline-block;padding:12px 26px;color:#ffffff;font-family:'DM Sans',Helvetica,Arial,sans-serif;font-size:15px;font-weight:600;line-height:1.2;text-decoration:none;">`
    + `${safeLabel}</a></td></tr></table>`;
}

// Registry of APPROVED blocks → trusted server renderers. Unknown types are dropped (token → '').
const BLOCK_RENDERERS = {
  divider: renderDivider,
  button: renderButton,
};

// Extract approved block markers (any element carrying data-aspire-block) from the RAW client HTML,
// using htmlparser2 so attribute values containing '>' / quotes are parsed robustly. Returns the
// tokenized HTML (markers replaced with opaque tokens) plus the captured { token, type, attribs }.
function extractBlocks(rawHtml) {
  const src = String(rawHtml || '');
  if (src === '') return { tokenized: '', blocks: [] };
  const found = [];        // { start, end, type, attribs }
  let open = null, depth = 0;
  const parser = new Parser({
    onopentag(name, attribs) {
      if (attribs['data-aspire-block'] && !open) {
        if (VOID_TAGS.has(name)) {
          found.push({ start: parser.startIndex, end: parser.endIndex, type: attribs['data-aspire-block'], attribs });
        } else {
          open = { start: parser.startIndex, type: attribs['data-aspire-block'], attribs };
          depth = 0;
        }
        return;
      }
      if (open && !VOID_TAGS.has(name)) depth++;   // a child inside a block element (defensive)
    },
    onclosetag() {
      if (!open) return;
      if (depth > 0) { depth--; return; }
      found.push({ start: open.start, end: parser.endIndex, type: open.type, attribs: open.attribs });
      open = null;
    },
  }, { decodeEntities: true, lowerCaseTags: true, lowerCaseAttributeNames: true });
  parser.write(src);
  parser.end();

  const blocks = found.map((f, i) => ({ token: `${TOK_OPEN}${i}${TOK_CLOSE}`, type: f.type, attribs: f.attribs }));
  // Replace each marker span with its token, in REVERSE so earlier indices stay valid.
  let out = src;
  for (let i = found.length - 1; i >= 0; i--) {
    out = out.slice(0, found[i].start) + blocks[i].token + out.slice(found[i].end + 1);
  }
  return { tokenized: out, blocks };
}

// Inject LOCKED inline styles onto bare h2/h3 (the sanitizer emits them attribute-free).
function styleHeadings(html) {
  return String(html)
    .replace(/<h2>/gi, `<h2 style="${H2_STYLE}">`)
    .replace(/<h3>/gi, `<h3 style="${H3_STYLE}">`);
}

// THE shared body renderer. extract blocks -> sanitize prose -> style headings -> substitute blocks.
export function renderConnectBody(rawHtml) {
  if (typeof rawHtml !== 'string' || rawHtml.trim() === '') return '';
  const { tokenized, blocks } = extractBlocks(rawHtml);
  let safe = sanitizeEmailHtml(tokenized);   // tight prose allowlist (+ h2/h3); tokens survive as text
  safe = styleHeadings(safe);
  for (const b of blocks) {
    const render = BLOCK_RENDERERS[b.type];   // unknown type -> undefined -> token replaced with ''
    safe = safe.split(b.token).join(render ? render(b.attribs) : '');
  }
  // Defensive: strip any stray sentinel chars. Never leak tokens.
  safe = safe.split(TOK_OPEN).join('').split(TOK_CLOSE).join('');
  return safe;
}
