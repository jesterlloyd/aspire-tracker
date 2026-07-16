// api/lib/messagesApi.js
//
// ASPIRE MESSAGES, PHASE 3 (STAGE B): shared HTTP concerns for the Messages APIs.
// Method guards, body-size limits, safe error shapes, and the mapping from the
// Phase 3 RPC custom SQLSTATEs to HTTP statuses.
//
// Privacy: nothing here ever logs a message body, preview, snippet, quoted text,
// notification content, an authorization header, or a bearer token. Error logs
// carry only an endpoint name, an error code, and a sanitized operational
// message.

/* global Buffer */
// `Buffer` is the Node/Vercel serverless runtime global. The repo's flat ESLint
// config registers browser globals only, so this file-scoped directive keeps the
// module lint-clean without touching the shared eslint.config.js (the same
// approach lib/server/appUrl.js uses for `process`).

const MAX_BODY_BYTES = 64 * 1024; // generous for a 5000-character plain-text message

// Phase 3 RPC SQLSTATEs (see migration 20260716000002 / 20260716000003).
const SQLSTATE_TO_HTTP = {
  MS400: 422, // validation
  MS403: 403, // forbidden
  MS404: 404, // not found / non-enumerating
  MS409: 409, // conflict (inactive participant, duplicate delivery)
};

export function methodGuard(req, res, allowed) {
  const list = Array.isArray(allowed) ? allowed : [allowed];
  if (!list.includes(req.method)) {
    res.setHeader('Allow', list.join(', '));
    res.status(405).json({ error: 'method_not_allowed' });
    return false;
  }
  return true;
}

// Reject an oversized or wrong-content-type body before parsing.
export function readJsonBody(req) {
  const ct = String(req.headers['content-type'] || '');
  if (!ct.includes('application/json')) {
    return { ok: false, status: 415, error: 'unsupported_media_type' };
  }
  const raw = req.body;
  const size = typeof raw === 'string' ? Buffer.byteLength(raw) : Buffer.byteLength(JSON.stringify(raw || {}));
  if (size > MAX_BODY_BYTES) return { ok: false, status: 413, error: 'payload_too_large' };
  const body = typeof raw === 'string' ? safeParse(raw) : raw;
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, status: 422, error: 'invalid_body' };
  }
  return { ok: true, body };
}

function safeParse(s) {
  try { return JSON.parse(s); } catch { return null; }
}

// Strip anything that could carry a token or message content out of an error.
export function sanitizeOperationalMessage(text) {
  if (text == null) return null;
  return String(text)
    .replace(/https?:\/\/\S+/gi, '[url]')
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}

// Map a Supabase RPC error to an HTTP status and a safe code. Internal SQL text
// is never returned to the caller.
export function mapRpcError(error) {
  const code = error?.code || '';
  const status = SQLSTATE_TO_HTTP[code];
  if (status) return { status, error: rpcErrorCode(code) };
  return { status: 500, error: 'internal_error' };
}

function rpcErrorCode(sqlstate) {
  switch (sqlstate) {
    case 'MS400': return 'validation_failed';
    case 'MS403': return 'forbidden';
    case 'MS404': return 'not_found';
    case 'MS409': return 'conflict';
    default: return 'internal_error';
  }
}

// A denied rate-limit result becomes a 429 with safe retry timing.
export function rateLimitResponse(res, result) {
  const retry = Number(result?.retry_after_seconds) || 60;
  res.setHeader('Retry-After', String(retry));
  return res.status(429).json({
    error: 'rate_limited',
    action: result?.action_kind || null,
    limit: result?.limit ?? null,
    remaining: result?.remaining ?? 0,
    retry_after_seconds: retry,
    reset_at: result?.reset_at ?? null,
  });
}

// Non-enumerating: an inaccessible conversation is indistinguishable from a
// missing one.
export function notFound(res) {
  return res.status(404).json({ error: 'not_found' });
}

export function logApiError(endpoint, code, err) {
  console.error(`[messages-api] ${endpoint} ${code}: ${sanitizeOperationalMessage(err?.message) || ''}`);
}
