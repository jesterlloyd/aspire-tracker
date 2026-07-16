// lib/server/messages/deliveryLogic.js
//
// ASPIRE MESSAGES, PHASE 2 (STAGE B): pure delivery logic. Retry backoff, the
// queue-state transition after a send attempt, provider-status monotonicity, the
// no-body snapshot allowlist, and error sanitization. No I/O. These functions are
// the testable core of the retry worker and the webhook reconciliation.

import {
  BACKOFF_SECONDS, MAX_ATTEMPTS, SNAPSHOT_ALLOWED_KEYS,
} from './config.js';

// Seconds to wait before the next attempt, given the number of attempts already
// made (1-based). Bounded and non-decreasing; clamps at the last backoff step.
export function nextAttemptDelaySeconds(attemptsMade) {
  const idx = Math.min(Math.max(attemptsMade - 1, 0), BACKOFF_SECONDS.length - 1);
  return BACKOFF_SECONDS[idx];
}

// Pure queue-state transition after an attempt on a claimed (processing) row.
// outcome: 'sent' | 'transient' | 'permanent' | 'suppressed'.
// attemptsMade is the incremented attempt count (after this attempt).
// Returns { queueStatus, delaySeconds } where delaySeconds is 0 for terminal
// states and the backoff for a retry.
export function nextDeliveryState({ outcome, attemptsMade, maxAttempts = MAX_ATTEMPTS } = {}) {
  if (outcome === 'sent')       return { queueStatus: 'sent', delaySeconds: 0 };
  if (outcome === 'suppressed') return { queueStatus: 'suppressed', delaySeconds: 0 };
  if (outcome === 'permanent')  return { queueStatus: 'failed', delaySeconds: 0 };
  if (outcome === 'transient') {
    if (attemptsMade >= maxAttempts) return { queueStatus: 'failed', delaySeconds: 0 };
    return { queueStatus: 'retry_wait', delaySeconds: nextAttemptDelaySeconds(attemptsMade) };
  }
  throw new Error(`nextDeliveryState: unknown outcome ${outcome}`);
}

// Provider (Resend) status precedence. Higher rank = more authoritative. Used
// only to update provider_status; never touches queue_status.
export const PROVIDER_RANK = {
  sent: 1, delivered: 2, opened: 3, clicked: 4, bounced: 5, complained: 5,
};

// True when an incoming provider status should overwrite the current one. Never
// downgrades (a delivered/opened/clicked event never regresses a later state).
export function shouldApplyProviderStatus(current, incoming) {
  if (!(incoming in PROVIDER_RANK)) return false;
  if (current == null) return true;
  const currentRank = PROVIDER_RANK[current] ?? 0;
  return PROVIDER_RANK[incoming] >= currentRank;
}

// Keys that must never appear in a persisted snapshot (defense in depth).
const FORBIDDEN_SNAPSHOT_KEY = /(^|_)(body|preview|snippet|content|html|text|message)(_|$)/i;

// Throws if any key looks like message content. The special-cased safe keys
// (snapshot_subject, snapshot_sender_name, snapshot_category, cta_path) never
// match the pattern.
export function assertNoBodyFields(obj = {}) {
  for (const key of Object.keys(obj)) {
    if (FORBIDDEN_SNAPSHOT_KEY.test(key)) {
      throw new Error(`snapshot may not contain a body-like field: ${key}`);
    }
  }
  return true;
}

// Build the explicit safe snapshot from named parts only. Rejects anything else.
export function buildSafeSnapshot({ senderName = null, subject = null, category = null, ctaPath = null } = {}) {
  const snapshot = {
    snapshot_sender_name: senderName ?? null,
    snapshot_subject: subject ?? null,
    snapshot_category: category ?? null,
    cta_path: ctaPath ?? null,
  };
  // Only the allowlisted keys are present.
  for (const key of Object.keys(snapshot)) {
    if (!SNAPSHOT_ALLOWED_KEYS.includes(key)) delete snapshot[key];
  }
  assertNoBodyFields(snapshot);
  return snapshot;
}

// Short, sanitized error text: strip URLs (may carry tokens) and bearer tokens,
// collapse whitespace, truncate. Never store a message body in an error field.
export function sanitizeErrorText(text) {
  if (text == null) return null;
  return String(text)
    .replace(/https?:\/\/\S+/gi, '[url]')
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300);
}

// Classify a Resend/transport error into a retryable transient or a permanent
// failure. Validation, invalid-address, and restricted-key errors are permanent;
// rate limits, timeouts, and server errors are transient.
const PERMANENT_CODES = new Set([
  'validation_error', 'invalid_from_address', 'invalid_attachment',
  'invalid_parameter', 'missing_required_field', 'restricted_api_key',
  'invalid_api_key', 'missing_api_key', 'invalid_access',
]);
export function classifyResendError(errorCode) {
  if (errorCode && PERMANENT_CODES.has(errorCode)) return 'permanent';
  return 'transient';
}
