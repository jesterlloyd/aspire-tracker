// lib/server/connect/renderContentBlocks.js
//
// Shared server renderer for ASPIRE Connect Content Blocks (the "block lane"). Called by
// buildDirectMessageEmail so PREVIEW and SEND, and Send-to-one and Send-to-many, share ONE renderer.
//
// TWO-LANE MODEL:
//   • PROSE lane  - user-authored rich text is tightly sanitized by sanitizeEmailHtml (trust boundary;
//                   adds only bare h2/h3, styled server-side).
//   • BLOCK lane  - approved block markers are EXTRACTED (via htmlparser2, robust against any value
//                   content) before prose sanitization, replaced with opaque tokens, then substituted
//                   AFTER sanitization with HTML from TRUSTED server templates that render ONLY from
//                   VALIDATED + ESCAPED scalar fields. No client HTML/style/attributes are ever echoed.
//
// Blocks: Divider (2A-0, no fields) and Linked Button (2A-2, label + url). Marker HTML/children are
// discarded; only known scalar attributes are read, then validated and escaped. A forged/malformed
// marker can at worst render a benign block or be dropped - never script/style/HTML injection.

import { Parser } from 'htmlparser2';
import { sanitizeEmailHtml } from './sanitizeEmailHtml.js';
import {
  renderEmailDivider, renderEmailButton, renderEmailNote, renderEmailEventDetails,
  H2_STYLE, H3_STYLE,
} from '../email/emailPrimitives.js';

// Per-block field length caps (POLICY for the manual Content Block lane; the shared primitives render
// whatever prepared values they receive). The renderers below trim + cap, then delegate.
const LABEL_MAX = 60;
const NOTE_TITLE_MAX = 80;
const NOTE_BODY_MAX = 600;
const EVT_TITLE_MAX = 80;
const EVT_DT_MAX = 120;
const EVT_LOC_MAX = 120;
const EVT_FMT_MAX = 80;
const EVT_RSVP_MAX = 120;

// Opaque placeholder delimiters: U+E000/U+E001 Private-Use chars; built at runtime to avoid invisible
// source literals. Each extracted marker becomes `${TOK_OPEN}<index>${TOK_CLOSE}` between passes.
const TOK_OPEN = String.fromCharCode(0xE000);
const TOK_CLOSE = String.fromCharCode(0xE001);

const VOID_TAGS = new Set(['hr', 'br', 'img', 'input', 'meta', 'link', 'area', 'base', 'col', 'source', 'wbr']);

// ── Block renderers (TRUSTED) ──
// EMAIL-PRIMITIVES-1: each renderer now reads + trims + caps its known scalar attributes (the block
// POLICY) and DELEGATES the markup/escaping/validation to the shared email primitives. Output is
// byte-identical to the prior inline implementation (proven by golden-master parity tests).

// Canonical, email-safe divider. Table-based for Outlook safety; no user styling.
function renderDivider() {
  return renderEmailDivider();
}

// Canonical, email-safe Cedars-Sinai Red button. Label required (capped); URL validated
// (https:/mailto: only) + escaped by the helper. Missing label or invalid URL → DROPPED safely.
// Manual blocks ALWAYS use the validated (trustedUrl:false) path.
function renderButton(attribs) {
  const label = String(attribs['data-label'] || '').trim().slice(0, LABEL_MAX);
  return renderEmailButton({ label, url: attribs['data-url'], variant: 'primary', trustedUrl: false });
}

// Canonical, email-safe Note callout. Body REQUIRED (capped, newlines -> <br>); title OPTIONAL
// (capped). Soft tint, Nightfall left accent + title, Raven body. Empty body -> DROPPED safely.
function renderNote(attribs) {
  const title = String(attribs['data-title'] || '').trim().slice(0, NOTE_TITLE_MAX);
  const body = String(attribs['data-body'] || '').trim().slice(0, NOTE_BODY_MAX);
  return renderEmailNote({ title, body, tone: 'info' });
}

// Canonical, email-safe Event Details card. Date/Time REQUIRED; other rows OPTIONAL (only render when
// present). All fields capped + escaped by the helper. Missing Date/Time -> DROPPED safely.
function renderEvent(attribs) {
  const get = (k, max) => String(attribs[k] || '').trim().slice(0, max);
  return renderEmailEventDetails({
    title:     get('data-title', EVT_TITLE_MAX),
    dateTime:  get('data-datetime', EVT_DT_MAX),
    location:  get('data-location', EVT_LOC_MAX),
    format:    get('data-format', EVT_FMT_MAX),
    respondBy: get('data-respondby', EVT_RSVP_MAX),
  });
}

// Registry of APPROVED blocks → trusted server renderers. Unknown types are dropped (token → '').
const BLOCK_RENDERERS = {
  divider: renderDivider,
  button: renderButton,
  note: renderNote,
  event: renderEvent,
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
