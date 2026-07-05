// lib/server/email/emailPrimitives.js
//
// EMAIL-PRIMITIVES-1 - shared, server-rendered, Outlook-safe ASPIRE email design primitives.
//
// These are PURE presentational helpers (no sends, tokens, DB, logging, or TipTap). They are the
// single source of truth for the recurring ASPIRE email building blocks. The Content Block renderers
// in lib/server/connect/renderContentBlocks.js delegate to these so the manual rich-compose blocks
// and (in later phases) automated/system templates share ONE implementation and never drift.
//
// SECURITY MODEL:
//   • All text fields are HTML-escaped here; callers pass plain scalar values only.
//   • renderEmailButton default path validates the URL via validateButtonUrl (https:/mailto: only,
//     protocol-less → https, all unsafe schemes dropped) - identical to the current manual Button.
//   • renderEmailButton({ trustedUrl: true }) is ESCAPE-ONLY: it preserves a server-generated URL
//     verbatim (no validation, no normalization, no hash stripping). It exists for FUTURE tokenized
//     survey links and must NOT be used by the manual Content Block path.
//
// Field length caps are a per-block POLICY and stay with the caller (renderContentBlocks); these
// helpers render whatever prepared scalar values they are given.

import { validateButtonUrl } from '../../../src/lib/connect/buttonUrl.js';

const NIGHTFALL = '#1d2567';
const CS_RED = '#dc1e34';
const RAVEN = '#191919';

// LOCKED heading styles (server-controlled; callers cannot pick size/color). Exported so the prose
// heading-styling pass in renderContentBlocks shares one definition.
export const H2_STYLE = `margin:18px 0 8px;color:${NIGHTFALL};font-size:20px;font-weight:700;line-height:1.3;`;
export const H3_STYLE = `margin:16px 0 6px;color:${NIGHTFALL};font-size:16px;font-weight:600;line-height:1.4;`;

// Escape text content for HTML body context.
export function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
// Escape an already-validated/trusted URL for a double-quoted attribute context.
export function escapeAttr(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/"/g, '&quot;')
    .replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── Heading ──────────────────────────────────────────────────────────────────────────────────────
// Server-rendered h2/h3 with LOCKED styling. (Content Blocks style bare prose h2/h3 via the shared
// H2_STYLE/H3_STYLE above; this helper builds a heading from text for automated templates.)
export function renderEmailHeading({ level = 2, text = '' } = {}) {
  const lvl = level === 3 ? 3 : 2;
  const style = lvl === 3 ? H3_STYLE : H2_STYLE;
  const safe = escapeHtml(text);
  if (!safe) return '';
  return `<h${lvl} style="${style}">${safe}</h${lvl}>`;
}

// ── Divider ──────────────────────────────────────────────────────────────────────────────────────
// Canonical, email-safe divider. Table-based for Outlook safety; no user styling.
export function renderEmailDivider() {
  return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0;">'
    + '<tr><td style="border-top:1px solid #e5e7eb;font-size:0;line-height:0;height:1px;">&#160;</td></tr></table>';
}

// ── Button ───────────────────────────────────────────────────────────────────────────────────────
// Variant background. 'primary' = Cedars-Sinai Red (the current manual Button block color); 'navy' is
// reserved for future evaluation/system CTAs. Default 'primary' preserves current output exactly.
const BUTTON_BG = { primary: CS_RED, navy: NIGHTFALL };

// label is required (empty → dropped). URL: default path is validated (https:/mailto: only,
// protocol-less → https, unsafe schemes dropped). trustedUrl=true preserves the URL verbatim
// (escape-only) - for server-generated tokenized links only; never used by the manual block path.
export function renderEmailButton({ label = '', url = '', variant = 'primary', trustedUrl = false } = {}) {
  if (!label) return '';
  let safeHref;
  if (trustedUrl) {
    const u = String(url || '').trim();
    if (!u) return '';
    safeHref = escapeAttr(u);   // verbatim: no validation, normalization, or hash stripping
  } else {
    const { ok, url: validUrl } = validateButtonUrl(url);
    if (!ok) return '';
    safeHref = escapeAttr(validUrl);
  }
  const bg = BUTTON_BG[variant] || CS_RED;
  const safeLabel = escapeHtml(label);
  return '<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:18px 0;"><tr>'
    + `<td align="center" bgcolor="${bg}" style="background:${bg};border-radius:6px;">`
    + `<a href="${safeHref}" target="_blank" rel="noopener noreferrer" `
    + `style="display:inline-block;padding:12px 26px;color:#ffffff;font-family:'DM Sans',Helvetica,Arial,sans-serif;font-size:15px;font-weight:600;line-height:1.2;text-decoration:none;">`
    + `${safeLabel}</a></td></tr></table>`;
}

// ── Note callout ─────────────────────────────────────────────────────────────────────────────────
// Body REQUIRED (empty → dropped) + escaped (newlines → <br>); title OPTIONAL + escaped. Tone selects
// the soft tint + left accent + title color; body is always Raven. 'info' matches the current Note
// block exactly. 'warning'/'urgent' are reserved for future notification modernization.
const NOTE_TONES = {
  info:    { bg: '#f4f5f9', accent: NIGHTFALL, title: NIGHTFALL },
  warning: { bg: '#FBF5E8', accent: '#C08A2A', title: '#8B5E1A' },
  urgent:  { bg: '#FDECEA', accent: CS_RED,    title: '#B42318' },
};
export function renderEmailNote({ title = '', body = '', tone = 'info' } = {}) {
  if (!body) return '';
  const cfg = NOTE_TONES[tone] || NOTE_TONES.info;
  const titleHtml = title
    ? `<div style="font-size:14px;font-weight:700;color:${cfg.title};line-height:1.4;margin:0 0 6px;">${escapeHtml(title)}</div>`
    : '';
  const bodyHtml = escapeHtml(body).replace(/\r\n|\r|\n/g, '<br>');
  return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:18px 0;"><tr>'
    + `<td bgcolor="${cfg.bg}" style="background:${cfg.bg};border-left:3px solid ${cfg.accent};border-radius:0 6px 6px 0;padding:14px 16px;">`
    + `${titleHtml}<div style="font-size:14px;line-height:1.6;color:${RAVEN};">${bodyHtml}</div>`
    + '</td></tr></table>';
}

// ── Event Details card ───────────────────────────────────────────────────────────────────────────
// Date/Time REQUIRED (missing → dropped); title and the other rows OPTIONAL and only render when
// present. All fields escaped. CS-Red top accent, Nightfall title, muted uppercase labels, Raven
// values, subtle row separators. Matches the current Event block exactly.
export function renderEmailEventDetails({ title = '', dateTime = '', location = '', format = '', respondBy = '' } = {}) {
  if (!dateTime) return '';
  const rows = [['Date / Time', dateTime]];
  if (location) rows.push(['Location', location]);
  if (format) rows.push(['Format', format]);
  if (respondBy) rows.push(['Respond by', respondBy]);
  const rowsHtml = rows.map(([label, value], i) =>
    `<tr><td style="padding:8px 0;${i > 0 ? 'border-top:1px solid #e8e4dc;' : ''}">`
    + `<div style="font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#6b7280;margin:0 0 2px;">${escapeHtml(label)}</div>`
    + `<div style="font-size:14px;color:${RAVEN};line-height:1.5;">${escapeHtml(value)}</div></td></tr>`
  ).join('');
  const titleHtml = title
    ? `<div style="font-size:16px;font-weight:700;color:${NIGHTFALL};line-height:1.3;margin:0 0 10px;">${escapeHtml(title)}</div>`
    : '';
  return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:18px 0;border:1px solid #e8e4dc;border-radius:8px;overflow:hidden;">'
    + `<tr><td style="height:3px;background:${CS_RED};font-size:0;line-height:0;">&#160;</td></tr>`
    + '<tr><td bgcolor="#f8f9fc" style="background:#f8f9fc;padding:16px 18px;">'
    + titleHtml
    + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rowsHtml}</table>`
    + '</td></tr></table>';
}

// ── Details card (key/value) ─────────────────────────────────────────────────────────────────────
// NEW helper for future key/value detail tables (interview/application/survey details). Safe,
// server-generated; title + labels + values all escaped; only rows with a non-empty value render.
// Not wired into Content Blocks. rows: [{ label, value }, ...].
export function renderEmailDetailsCard({ title = '', rows = [] } = {}) {
  const list = (Array.isArray(rows) ? rows : [])
    .filter(r => r && String(r.value || '').trim() !== '');
  if (list.length === 0) return '';
  const rowsHtml = list.map(({ label, value }, i) =>
    `<tr><td style="padding:8px 0;${i > 0 ? 'border-top:1px solid #e8e4dc;' : ''}">`
    + `<div style="font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#6b7280;margin:0 0 2px;">${escapeHtml(label)}</div>`
    + `<div style="font-size:14px;color:${RAVEN};line-height:1.5;">${escapeHtml(value)}</div></td></tr>`
  ).join('');
  const titleHtml = title
    ? `<div style="font-size:16px;font-weight:700;color:${NIGHTFALL};line-height:1.3;margin:0 0 10px;">${escapeHtml(title)}</div>`
    : '';
  return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:18px 0;border:1px solid #e8e4dc;border-radius:8px;overflow:hidden;">'
    + '<tr><td bgcolor="#f8f9fc" style="background:#f8f9fc;padding:16px 18px;">'
    + titleHtml
    + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rowsHtml}</table>`
    + '</td></tr></table>';
}
