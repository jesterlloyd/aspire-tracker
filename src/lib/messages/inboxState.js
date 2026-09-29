// src/lib/messages/inboxState.js
//
// ASPIRE MESSAGES, PHASE 4A: pure inbox state helpers. View serialization,
// duplicate-safe page appending, and cursor handling for the Phase 3 staff list
// endpoint. No I/O, no React, no storage.

// MESSAGES-SIMPLIFY-1: the inbox has three views and no filters. Needs reply
// is the default; All is every thread that is not Done; Done is reached from
// the View done link. Search narrows whichever view is open.
export const INBOX_VIEWS = Object.freeze(['needs_reply', 'all', 'done']);
export const DEFAULT_VIEW = 'needs_reply';

// Serialize the view, search, and cursor into the exact query the staff list
// endpoint accepts. The view is always sent, so the server never has to guess.
export function serializeInboxQuery({
  search = '', view = DEFAULT_VIEW, cursor = null, limit = 25,
} = {}) {
  const query = { limit: String(clampLimit(limit)) };
  query.view = INBOX_VIEWS.includes(view) ? view : DEFAULT_VIEW;

  const trimmed = String(search || '').trim();
  if (trimmed) query.search = trimmed;

  if (cursor && cursor.cursor_ts && cursor.cursor_id) {
    query.cursor_ts = cursor.cursor_ts;
    query.cursor_id = cursor.cursor_id;
  }

  return { query };
}

export function clampLimit(limit) {
  const n = Number(limit);
  if (!Number.isInteger(n) || n < 1) return 25;
  return Math.min(n, 100);
}

// Append a page while preserving SERVER order and never duplicating a row. The
// server's ordering (last_message_at desc, id desc) is authoritative; this never
// re-sorts.
export function appendPage(existing, incoming) {
  const rows = Array.isArray(existing) ? existing : [];
  const next = Array.isArray(incoming) ? incoming : [];
  const seen = new Set(rows.map((r) => r.id));
  const merged = rows.slice();
  for (const row of next) {
    if (!row || !row.id || seen.has(row.id)) continue;
    seen.add(row.id);
    merged.push(row);
  }
  return merged;
}

// A cursor is usable only when both parts are present and well formed. A partial
// or malformed cursor yields null (start from the beginning) rather than a bad
// request.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function normalizeCursor(cursor) {
  if (!cursor || typeof cursor !== 'object') return null;
  const { cursor_ts: ts, cursor_id: id } = cursor;
  if (!ts || !id || !UUID_RE.test(String(id))) return null;
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return null;
  return { cursor_ts: d.toISOString(), cursor_id: String(id) };
}

// A view or search change must reset pagination, so pages never interleave
// across different server queries.
export function queryIdentity({ search = '', view = DEFAULT_VIEW } = {}) {
  return JSON.stringify([view, String(search || '').trim()]);
}

// Small debounce used by the search input. Returns a cancelable function so a
// pending call can be dropped on unmount.
export function debounce(fn, wait = 300) {
  let timer = null;
  const debounced = (...args) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { timer = null; fn(...args); }, wait);
  };
  debounced.cancel = () => { if (timer) clearTimeout(timer); timer = null; };
  return debounced;
}
