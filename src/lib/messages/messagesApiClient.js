// src/lib/messages/messagesApiClient.js
//
// ASPIRE MESSAGES, PHASE 4A: the browser-side client for the deployed Phase 3
// staff endpoints. It follows the existing Connect convention of taking the
// Supabase access token from the session and sending it as a bearer token.
//
// Safety rules enforced here:
//   - every call is an authenticated Vercel API call; the browser NEVER calls a
//     Supabase transactional RPC directly and never touches service-role
//     credentials
//   - the browser NEVER submits notification-routing fields (recipient_email,
//     recipient_kind, recipient_profile_id for routing, event_type,
//     idempotency_key, snapshot fields, cta_path, or p_delivery). The trusted
//     server owns all routing and delivery construction.
//   - nothing here logs a raw response, a message body, a message preview, or an
//     authorization header
//   - errors carry only an HTTP status and a safe code, never provider or SQL text

import { supabase } from '../supabase';

// Fields the browser must never send. Guarded explicitly so a future caller
// cannot reintroduce client-controlled routing.
const FORBIDDEN_WRITE_FIELDS = [
  'p_delivery', 'delivery', 'recipient_email', 'recipient_kind', 'recipient_profile_id',
  'event_type', 'idempotency_key', 'snapshot_sender_name', 'snapshot_subject',
  'snapshot_category', 'cta_path',
];

export class MessagesApiError extends Error {
  constructor(status, code) {
    super(code || `http_${status}`);
    this.name = 'MessagesApiError';
    this.status = status;
    this.code = code || null;
  }
}

async function authHeader() {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) throw new MessagesApiError(401, 'unauthenticated');
  return `Bearer ${token}`;
}

// Drop undefined and null so 'no filter' never becomes the string "null".
function toQuery(params = {}) {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    usp.append(k, String(v));
  }
  const s = usp.toString();
  return s ? `?${s}` : '';
}

function assertNoRoutingFields(body = {}) {
  for (const key of Object.keys(body)) {
    if (FORBIDDEN_WRITE_FIELDS.includes(key)) {
      throw new Error(`messagesApiClient: the browser may not send ${key}`);
    }
  }
}

// Exported so the portal client can reuse this exact authenticated request core
// (bearer token, routing-field guard, safe error mapping, no raw logging) rather
// than duplicate it. The portal client adds no transport behavior of its own.
export async function request(path, { method = 'GET', params, body, signal } = {}) {
  const headers = { Authorization: await authHeader() };
  const init = { method, headers, signal };
  if (body !== undefined) {
    assertNoRoutingFields(body);
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const res = await fetch(`${path}${toQuery(params)}`, init);
  if (!res.ok) {
    // Read only a short safe code; never surface or log the raw payload.
    let code = null;
    try {
      const parsed = await res.json();
      if (typeof parsed?.error === 'string') code = parsed.error;
    } catch {
      // The body was not JSON. Keep code null and rely on the status.
    }
    throw new MessagesApiError(res.status, code);
  }
  if (res.status === 204) return null;
  return res.json();
}

// ── Reads used by the Phase 4A inbox ────────────────────────────────────────

export function listStaffConversations(params = {}, { signal } = {}) {
  return request('/api/messages-staff-list', { params, signal });
}

export function getStaffUnreadCount({ signal } = {}) {
  return request('/api/messages-staff-read', { signal });
}

export function listAssigneeOptions({ signal } = {}) {
  return request('/api/messages-staff-options', { params: { kind: 'assignees' }, signal });
}

export function listParticipantOptions(q = '', { signal } = {}) {
  return request('/api/messages-staff-options', { params: { kind: 'participants', q }, signal });
}

// ── Typed functions Phase 4B will use. Defined here so the routing-field guard
//    and error mapping live in one place. Not called by Phase 4A. ─────────────

export function getStaffThread(params = {}, { signal } = {}) {
  return request('/api/messages-staff-thread', { params, signal });
}

export function markStaffRead(conversationId, { signal } = {}) {
  return request('/api/messages-staff-read', {
    method: 'POST', body: { conversation_id: conversationId }, signal,
  });
}

export function startStaffConversation({ participantProfileId, studentId, subject, category, body }, { signal } = {}) {
  return request('/api/messages-staff-start', {
    method: 'POST',
    body: {
      participant_profile_id: participantProfileId,
      student_id: studentId,
      subject,
      category: category ?? null,
      body,
    },
    signal,
  });
}

export function replyStaffConversation({ conversationId, body }, { signal } = {}) {
  return request('/api/messages-staff-reply', {
    method: 'POST', body: { conversation_id: conversationId, body }, signal,
  });
}

export function manageStaffConversation(payload, { signal } = {}) {
  return request('/api/messages-staff-manage', { method: 'POST', body: payload, signal });
}
