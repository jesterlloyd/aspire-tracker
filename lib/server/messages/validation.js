// lib/server/messages/validation.js
//
// ASPIRE MESSAGES, PHASE 3 (STAGE B): pure input validation, normalization, and
// pagination parsing for the backend APIs. No I/O. Mirrors the constraints the
// Phase 1 schema and the Phase 3 RPCs enforce, so the API can return a clean
// 422 before touching the database.

import { MESSAGE_MAX_BODY_CHARS } from './config.js';

export const MESSAGE_CATEGORIES = [
  'Placement and matching',
  'Scheduling',
  'Onboarding requirements',
  'Clinical rotation support',
  'Preceptor support',
  'Portal or account help',
  'General question',
];

export const CONVERSATION_STATUSES = ['open', 'waiting', 'resolved'];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isUuid = (v) => typeof v === 'string' && UUID_RE.test(v);

// Messages are plain text. Normalize line endings only; never treat input as
// HTML and never sanitize or render rich text.
export function normalizeBody(input) {
  if (typeof input !== 'string') return '';
  return input.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

// Body: trimmed content must be at least 1 character, at most 5000 characters.
export function validateBody(input) {
  const value = normalizeBody(input);
  if (value.trim().length < 1) return { ok: false, error: 'body_required' };
  if (value.length > MESSAGE_MAX_BODY_CHARS) return { ok: false, error: 'body_too_long' };
  return { ok: true, value };
}

// Subject: required, trimmed, 3 to 120 characters, never whitespace only.
export function validateSubject(input) {
  if (typeof input !== 'string') return { ok: false, error: 'subject_required' };
  const value = input.trim();
  if (value.length < 3) return { ok: false, error: 'subject_too_short' };
  if (value.length > 120) return { ok: false, error: 'subject_too_long' };
  return { ok: true, value };
}

// Category: optional. Null, undefined, or empty means no category.
export function validateCategory(input) {
  if (input === undefined || input === null || input === '') return { ok: true, value: null };
  if (typeof input !== 'string' || !MESSAGE_CATEGORIES.includes(input)) {
    return { ok: false, error: 'invalid_category' };
  }
  return { ok: true, value: input };
}

export function validateStatus(input) {
  if (typeof input !== 'string' || !CONVERSATION_STATUSES.includes(input)) {
    return { ok: false, error: 'invalid_status' };
  }
  return { ok: true, value: input };
}

// Limit: capped. Rejects a non-numeric or out-of-range value rather than
// silently clamping a malformed input.
export function parseLimit(input, { fallback = 25, max = 100 } = {}) {
  if (input === undefined || input === null || input === '') return { ok: true, value: fallback };
  const n = Number(input);
  if (!Number.isInteger(n) || n < 1) return { ok: false, error: 'invalid_limit' };
  return { ok: true, value: Math.min(n, max) };
}

// Cursor: both parts or neither. A partial or malformed cursor is rejected
// rather than silently ignored, so pagination can never quietly restart.
export function parseCursor({ cursorTs, cursorId } = {}) {
  const hasTs = cursorTs !== undefined && cursorTs !== null && cursorTs !== '';
  const hasId = cursorId !== undefined && cursorId !== null && cursorId !== '';
  if (!hasTs && !hasId) return { ok: true, value: { ts: null, id: null } };
  if (hasTs !== hasId) return { ok: false, error: 'invalid_cursor' };
  if (!isUuid(cursorId)) return { ok: false, error: 'invalid_cursor' };
  const d = new Date(cursorTs);
  if (Number.isNaN(d.getTime())) return { ok: false, error: 'invalid_cursor' };
  return { ok: true, value: { ts: d.toISOString(), id: cursorId } };
}

// Build the next cursor from the last row of a page, or null when the page is
// not full (no further rows).
export function nextCursorFrom(rows, limit, tsField = 'last_message_at') {
  if (!Array.isArray(rows) || rows.length < limit || rows.length === 0) return null;
  const last = rows[rows.length - 1];
  if (!last || !last[tsField] || !last.id) return null;
  return { cursor_ts: last[tsField], cursor_id: last.id };
}
