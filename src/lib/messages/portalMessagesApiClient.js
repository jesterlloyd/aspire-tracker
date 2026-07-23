// ASPIRE MESSAGES, PHASE 5B-i: the browser-side client for the deployed portal
// endpoints under /api/portal/.
//
// DORMANT: nothing here is imported by a routed portal page. Phase 5B-ii mounts
// it once the Student Portal Messages surface is activated.
//
// This file deliberately contains NO transport logic. It reuses the authenticated
// request core from messagesApiClient.js, which already owns the bearer token,
// the routing-field guard, the safe error mapping, and the no-raw-logging rule.
// The only thing added here is the portal endpoint surface.
//
// Safety rules inherited and preserved:
//   - every call is an authenticated Vercel API call; the browser NEVER calls a
//     Supabase transactional RPC directly and never touches service-role
//     credentials
//   - the browser NEVER submits notification-routing fields; the trusted server
//     owns all routing and delivery construction
//   - nothing logs a raw response, a message body, a preview, a draft, or an
//     authorization header
//   - errors carry only an HTTP status and a safe code, never provider or SQL text

import { request, MessagesApiError } from './messagesApiClient.js';

export { MessagesApiError };

// GET the student's conversations, newest activity first.
// Contract: limit default 25, max 100; cursor is cursor_ts plus cursor_id.
// Returns { conversations, next_cursor }.
export function listPortalConversations({ limit, cursor, signal } = {}) {
  return request('/api/portal/messages-list', {
    params: {
      limit,
      cursor_ts: cursor?.cursor_ts,
      cursor_id: cursor?.cursor_id,
    },
    signal,
  });
}

// GET one thread page. No cursor means the NEWEST bounded page; a cursor means
// the newest page strictly older than it (Phase 5A v2 reverse pagination).
// Returns { conversation, messages, has_more, next_cursor }.
export function getPortalThreadPage({ conversationId, limit, cursor, signal } = {}) {
  return request('/api/portal/messages-thread', {
    params: {
      conversation_id: conversationId,
      limit,
      cursor_ts: cursor?.cursor_ts,
      cursor_id: cursor?.cursor_id,
    },
    signal,
  });
}

// POST a new conversation to the ASPIRE Team.
//
// The endpoint accepts ONLY subject, category, and body. There is no recipient
// picker and no participant field: the server resolves the student profile from
// the verified JWT and the ASPIRE Team is the implicit recipient. Sending a
// student_id or participant_profile_id from the browser would be both useless
// and a routing field, so it is never sent.
//
// Returns 201 { conversation_id, message_id, created_at, status, confirmation }.
export function startPortalConversation({ subject, category, body, signal } = {}) {
  return request('/api/portal/messages-start', {
    method: 'POST',
    // category null means Uncategorized, which the server validator accepts.
    body: { subject, category: category ?? null, body },
    signal,
  });
}

// POST a new GENERAL ASPIRE Team conversation for an authorized portal user.
//
// This is the role-aware backend contract for Student and Unit Leader callers.
// The browser supplies only the stable request id and first message body. It
// never sends a student id, unit key, role, profile id, destination, category, or
// subject. The server derives all routing and classification.
//
// Returns 201 for a new thread or 200 for an idempotent replay:
// { conversation_id, message_id, created_at, status, thread_kind, idempotent_replay, confirmation }.
export function startGeneralTeamConversation({ requestId, body, signal } = {}) {
  return request('/api/portal/team-messages-start', {
    method: 'POST',
    body: { request_id: requestId, body },
    signal,
  });
}

// POST a reply. Replying to a Closed conversation reopens it inside the
// transactional RPC; the server reports that through `reopened`. The browser
// never reopens anything itself.
//
// Returns 201 { message_id, created_at, reopened, confirmation }.
export function replyToPortalConversation({ conversationId, body, signal } = {}) {
  return request('/api/portal/messages-reply', {
    method: 'POST',
    body: { conversation_id: conversationId, body },
    signal,
  });
}

// POST mark one conversation read for this student.
//
// The body carries ONLY the conversation id. The read timestamp is derived
// server-side from the latest message, and the participant profile comes from
// the verified JWT, so a client clock and a client profile id can never move a
// read pointer.
//
// Returns 200 { conversation_id, last_read_at }.
export function markPortalConversationRead({ conversationId, signal } = {}) {
  return request('/api/portal/messages-mark-read', {
    method: 'POST',
    body: { conversation_id: conversationId },
    signal,
  });
}

// GET the student's unread total (staff-authored messages newer than this
// participant's own read pointer). Returns { unread_count }.
export function getPortalUnreadCount({ signal } = {}) {
  return request('/api/portal/messages-unread-count', { signal });
}
