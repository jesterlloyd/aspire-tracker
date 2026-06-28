// lib/server/connect/sanitizeEmailHtml.js
//
// RICH-COMPOSE-1 Phase 1 — AUTHORITATIVE server-side sanitizer for manual Connect email bodies.
// This is the trust boundary: TipTap's client schema is UX-only and MUST NOT be relied on for safety.
// Every `bodyFormat:'html'` body passes through this before it is injected into the email shell.
//
// Phase 1 allowlist: basic inline formatting + lists + safe links ONLY. No tables, images, styles,
// colors, fonts, scripts, or event handlers. Tables are Phase 2 (will extend this allowlist then).

import sanitizeHtml from 'sanitize-html';

// Only http(s)/mailto links are ever allowed; everything else (javascript:, data:, vbscript:,
// protocol-relative) is dropped by scheme rules below and double-guarded in transformTags.
const SAFE_LINK = /^(https?:\/\/|mailto:)/i;

const PHASE1_OPTIONS = {
  allowedTags: ['p', 'br', 'strong', 'b', 'em', 'i', 'u', 'ul', 'ol', 'li', 'a'],
  // Only <a> keeps attributes; every other tag is stripped of ALL attributes (so on*=,
  // style=, class=, id= etc. are removed everywhere).
  allowedAttributes: { a: ['href', 'target', 'rel'] },
  // No inline styles in Phase 1.
  allowedStyles: {},
  allowedClasses: {},
  // Link scheme allowlist (no javascript:/data:/vbscript:/protocol-relative).
  allowedSchemes: ['http', 'https', 'mailto'],
  allowedSchemesByTag: { a: ['http', 'https', 'mailto'] },
  allowProtocolRelative: false,
  // Disallowed tags: drop the tag but keep its visible text (e.g. an unsupported <div> becomes text).
  disallowedTagsMode: 'discard',
  // These tags are removed ALONG WITH their text content (never leak script/style source, etc.).
  nonTextTags: ['script', 'style', 'iframe', 'object', 'embed', 'form', 'noscript', 'textarea', 'title'],
  // Strip comments (could carry conditional-comment payloads).
  allowedTagsWithComments: false,
  parser: { decodeEntities: true },
  // Force every surviving link to safe, explicit target/rel; drop the href entirely if not safe
  // (the anchor text remains, just not clickable).
  transformTags: {
    a: (tagName, attribs) => {
      const href = String(attribs.href || '');
      if (SAFE_LINK.test(href)) {
        return { tagName: 'a', attribs: { href, target: '_blank', rel: 'noopener noreferrer' } };
      }
      return { tagName: 'a', attribs: {} };
    },
  },
};

// Returns a safe HTML fragment limited to the Phase 1 allowlist. Empty string for empty/non-string.
export function sanitizeEmailHtml(html) {
  if (typeof html !== 'string' || html.trim() === '') return '';
  return sanitizeHtml(html, PHASE1_OPTIONS);
}
