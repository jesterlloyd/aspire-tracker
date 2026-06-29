// src/lib/connect/richCompose.js
//
// RICH-COMPOSE-1 Phase 1 — minimal, owner-gated feature flag for the ASPIRE Connect rich-text
// manual composer. There is no general feature-flag system in this app, so this is a deliberately
// tiny local flag:
//
//   ON  ⇔  the user is the Owner  AND  localStorage['aspire.connect.richCompose'] === 'on'
//
// Default OFF (no localStorage key → off). Non-owners can NEVER enable it (UX gate), and the SEND
// endpoints independently require an Owner to accept body_format:'html' (authoritative server gate),
// so a non-owner can never produce a rich send even by forging a request.
//
// To enable (Owner, this browser):   localStorage.setItem('aspire.connect.richCompose', 'on')
// To roll back instantly:            localStorage.removeItem('aspire.connect.richCompose')
//                                    (or set it to anything other than 'on')
// Rolling back never touches saved drafts; an html draft simply degrades to plain text (below).

export const RICH_COMPOSE_FLAG_KEY = 'aspire.connect.richCompose';

// RICH-COMPOSE-2A-1 — shallow validity check for a persisted TipTap document (richDoc) before it is
// used to hydrate the editor. A valid ProseMirror doc is { type: 'doc', content: [...] }. This is a
// cheap guard, NOT a schema validation: TipTap setContent is still wrapped in try/catch by the editor,
// and the composer falls back to the body HTML if richDoc is missing or invalid. Never throws.
export function isValidRichDoc(doc) {
  return !!doc && typeof doc === 'object' && doc.type === 'doc' && Array.isArray(doc.content);
}

export function isRichComposeEnabled(isOwner) {
  if (!isOwner) return false;
  try {
    return localStorage.getItem(RICH_COMPOSE_FLAG_KEY) === 'on';
  } catch {
    return false;
  }
}

// Convert plain text (legacy drafts, manual templates) into safe HTML paragraphs for the rich editor,
// so line breaks survive (HTML collapses raw newlines). Blank lines split paragraphs; single newlines
// become <br>. Placeholders/links in the text are preserved verbatim as escaped text. Returns '' for
// empty input. The result still passes through the editor schema + the server sanitizer.
export function plainTextToHtml(text) {
  const s = String(text == null ? '' : text);
  if (s.trim() === '') return '';
  const esc = (v) => v
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  return s
    .split(/\n{2,}/)
    .map(p => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

// Degrade a stored rich (HTML) draft body to readable plain text when the flag is OFF, so the
// plain-text textarea never shows raw tags and a 'text' send never ships literal markup. Block-ish
// tags become line breaks; everything else is unwrapped to its text. Browser-only (uses the DOM).
export function htmlToPlainText(html) {
  if (typeof html !== 'string' || html === '') return '';
  try {
    const withBreaks = html
      .replace(/<\s*(br|\/p|\/li|\/div|\/h[1-6])\s*>/gi, '\n')
      .replace(/<\s*li[^>]*>/gi, '• ');
    const el = document.createElement('div');
    el.innerHTML = withBreaks;
    const text = el.textContent || el.innerText || '';
    return text.replace(/\n{3,}/g, '\n\n').replace(/[ \t]+\n/g, '\n').trim();
  } catch {
    // Last-resort regex strip if the DOM is unavailable.
    return html.replace(/<[^>]+>/g, '').trim();
  }
}
