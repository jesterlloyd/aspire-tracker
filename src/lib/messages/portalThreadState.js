// ASPIRE MESSAGES, PHASE 5A: dormant pagination foundation for the Student
// Portal thread.
//
// DORMANT: nothing here is imported by any routed page. Phase 5B mounts it once
// the portal thread screen exists. It is pure (no I/O, no React, no fetch), so
// it can be tested with the repository's node:test stack exactly like the staff
// inbox utilities in inboxState.js.
//
// The portal thread pages BACKWARD from the newest message (Phase 5A migration
// 20260716000006). That inverts two assumptions the staff INBOX helpers make,
// which is why this file exists rather than reusing inboxState.js wholesale:
//
//   1. The inbox pages downward, so a new page is APPENDED. The thread pages
//      into history, so an older page is PREPENDED.
//   2. The inbox derives its cursor client-side from the last row. The thread
//      RPC returns the authoritative backward cursor, so the client must pass
//      next_cursor straight back rather than compute one.

import { normalizeCursor } from './inboxState.js';

// Matches the RPC bounds exactly (LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100)).
// The client must not request more than the backend will honor, or a page would
// silently arrive shorter than asked for and look like the end of history.
export const PORTAL_THREAD_LIMIT_DEFAULT = 50;
export const PORTAL_THREAD_LIMIT_MAX = 100;

export function clampThreadLimit(input) {
  const n = Number(input);
  if (!Number.isInteger(n) || n < 1) return PORTAL_THREAD_LIMIT_DEFAULT;
  return Math.min(n, PORTAL_THREAD_LIMIT_MAX);
}

// Conversation-scoped query key. Scoping by conversation id is what keeps one
// thread's pages from bleeding into another's cache, and it is what makes the
// stale-response rule below enforceable.
export function portalThreadQueryKey(conversationId) {
  return ['portal_messages_thread', conversationId ?? null];
}

// Serialize one thread request. Cursor fields use the repository's established
// cursor_ts and cursor_id names, which is also the shape the RPC returns in
// next_cursor, so an older-page request is a straight round-trip of the previous
// response's cursor with no renaming.
//
//   newest page -> no cursor values
//   older page  -> BOTH cursor_ts and cursor_id
//
// A partial cursor is dropped rather than sent: the endpoint rejects it with 422
// and the RPC rejects it with MS400, so sending one is always a client bug. If
// only one half is present, normalizeCursor returns null and this requests the
// newest page instead of a malformed one.
export function serializePortalThreadQuery({ conversationId, limit, cursor } = {}) {
  const query = { conversation_id: conversationId, limit: String(clampThreadLimit(limit)) };
  const c = normalizeCursor(cursor);
  if (c) {
    query.cursor_ts = c.cursor_ts;
    query.cursor_id = c.cursor_id;
  }
  return { query };
}

// Read the backward cursor out of a thread response. Returns null when no older
// history remains, which is the signal to hide "Load earlier messages".
//
// has_more is authoritative: the RPC derives it from a bounded EXISTS check
// against rows strictly older than the page. Do NOT infer "more history" from a
// full page, the way a forward-paging list does. A thread whose oldest page
// happens to be exactly `limit` long would falsely offer another page.
export function nextThreadCursor(page) {
  if (!page || page.has_more !== true) return null;
  return normalizeCursor(page.next_cursor);
}

// Merge an OLDER page in front of what is already loaded, preserving
// chronological order and dropping duplicates.
//
// Each page arrives chronological (oldest first within the page), and each older
// page is entirely older than everything already held, so prepending is correct
// and no re-sort is needed. Duplicates are still filtered: a message can arrive
// twice if a page boundary lands on a message posted between two requests.
// Existing rows win, so an already-rendered message is never replaced.
export function prependOlderPage(existing, older) {
  const held = Array.isArray(existing) ? existing : [];
  const incoming = Array.isArray(older) ? older : [];
  const seen = new Set(held.map((r) => r?.id).filter(Boolean));
  const merged = [];
  for (const row of incoming) {
    if (!row || !row.id || seen.has(row.id)) continue;
    seen.add(row.id);
    merged.push(row);
  }
  return merged.concat(held);
}

// Merge a REFRESH of the newest page into what is already loaded. New messages
// arrive at the end; already-held messages are left alone.
export function appendNewerPage(existing, newer) {
  const held = Array.isArray(existing) ? existing : [];
  const incoming = Array.isArray(newer) ? newer : [];
  const seen = new Set(held.map((r) => r?.id).filter(Boolean));
  const merged = held.slice();
  for (const row of incoming) {
    if (!row || !row.id || seen.has(row.id)) continue;
    seen.add(row.id);
    merged.push(row);
  }
  return merged;
}

// STALE-RESPONSE PROTECTION, for Phase 5B.
//
// A thread request is only valid for the conversation it was issued against. If
// a student switches conversations while a request is in flight, the late
// response must not be merged into the new thread.
//
// The rule Phase 5B must follow:
//
//   1. Key every query by portalThreadQueryKey(conversationId), so React Query
//      caches and cancels per conversation rather than globally.
//   2. Pass the AbortSignal from the query function into the fetch, so a
//      superseded request is actually cancelled rather than merely ignored.
//   3. Before merging any page, confirm it belongs to the conversation currently
//      selected. threadPageIsCurrent() exists for that check.
//
// This mirrors the staff workspace, which had the same hazard and solved it the
// same way.
export function threadPageIsCurrent(page, conversationId) {
  if (!page || !conversationId) return false;
  const id = page.conversation?.id;
  // A page with no conversation id cannot be proven current, so it is not.
  if (!id) return false;
  return id === conversationId;
}
