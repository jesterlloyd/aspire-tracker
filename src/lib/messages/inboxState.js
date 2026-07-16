// src/lib/messages/inboxState.js
//
// ASPIRE MESSAGES, PHASE 4A: pure inbox state helpers. Filter serialization,
// duplicate-safe page appending, and cursor handling for the Phase 3 staff list
// endpoint. No I/O, no React, no storage.

// The inbox filter shape. 'all' means the filter is not sent to the server.
export const DEFAULT_FILTERS = Object.freeze({
  status: 'all',
  assignee: 'all',   // 'all' | 'unassigned' | 'me' | <profile uuid>
  category: 'all',   // 'all' | 'uncategorized' | <approved category>
  flagged: 'all',    // 'all' | 'flagged' | 'not_flagged'
});

export function filtersAreDefault(filters) {
  return DEFAULT_FILTERS.status === filters.status
    && DEFAULT_FILTERS.assignee === filters.assignee
    && DEFAULT_FILTERS.category === filters.category
    && DEFAULT_FILTERS.flagged === filters.flagged;
}

// Serialize filters, search, and cursor into the exact query the Phase 3 staff
// list endpoint accepts. Only defined values are included, so 'all' never
// narrows the server query.
//
// 'unassigned' and 'uncategorized' are NOT sent as filter values: the deployed
// endpoint treats a null p_assignee / p_category as "no filter", so it cannot
// express "is null" server side. They are returned in `clientOnly` so the caller
// can surface an accurate limitation rather than silently filtering a partial
// server page. See the Phase 4A documentation.
export function serializeInboxQuery({ filters = DEFAULT_FILTERS, search = '', cursor = null, limit = 25, meProfileId = null } = {}) {
  const query = { limit: String(clampLimit(limit)) };
  const clientOnly = {};

  if (filters.status !== 'all') query.status = filters.status;

  if (filters.assignee === 'unassigned') clientOnly.assignee = 'unassigned';
  else if (filters.assignee === 'me') { if (meProfileId) query.assignee = meProfileId; }
  else if (filters.assignee !== 'all') query.assignee = filters.assignee;

  if (filters.category === 'uncategorized') clientOnly.category = 'uncategorized';
  else if (filters.category !== 'all') query.category = filters.category;

  if (filters.flagged === 'flagged') query.flagged = 'true';
  else if (filters.flagged === 'not_flagged') query.flagged = 'false';

  const trimmed = String(search || '').trim();
  if (trimmed) query.search = trimmed;

  if (cursor && cursor.cursor_ts && cursor.cursor_id) {
    query.cursor_ts = cursor.cursor_ts;
    query.cursor_id = cursor.cursor_id;
  }

  return { query, clientOnly };
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

// A filter or search change must reset pagination, so pages never interleave
// across different server queries.
export function queryIdentity({ filters = DEFAULT_FILTERS, search = '' } = {}) {
  return JSON.stringify([filters.status, filters.assignee, filters.category, filters.flagged, String(search || '').trim()]);
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
