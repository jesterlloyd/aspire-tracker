// lib/server/messages/rateLimitUtil.js
//
// ASPIRE MESSAGES, PHASE 2 (STAGE B): server-only portal-user rate-limit utility.
// Future conversation APIs call this with a SERVER-VERIFIED user_profiles.id
// (resolved from the JWT via verifyPortalCaller), never a client-supplied id.
// It delegates to the Stage A service-role RPC consume_message_rate_limit using
// the approved windows and returns a future-API-friendly result. It creates no
// API endpoint.

import { MESSAGE_RATE_LIMITS, MESSAGE_MAX_BODY_CHARS } from './config.js';

// Consume one unit of the given action's window for a verified profile id.
// action: 'new_conversation' | 'message'. Returns the RPC jsonb:
// { allowed, action_kind, limit, remaining, reset_at, retry_after_seconds }.
// Fails closed: any RPC error resolves to a denied result so a future API returns
// 429 rather than proceeding.
export async function consumeMessageRateLimit(db, { profileId, action }) {
  const cfg = MESSAGE_RATE_LIMITS[action];
  if (!cfg) throw new Error(`consumeMessageRateLimit: unknown action ${action}`);
  if (!profileId) throw new Error('consumeMessageRateLimit: a server-verified profileId is required');

  const { data, error } = await db.rpc('consume_message_rate_limit', {
    p_profile_id: profileId,
    p_action_kind: cfg.action,
    p_window_seconds: cfg.windowSeconds,
    p_max_per_window: cfg.maxPerWindow,
  });

  if (error || !data) {
    return {
      allowed: false,
      action_kind: cfg.action,
      limit: cfg.maxPerWindow,
      remaining: 0,
      reset_at: null,
      retry_after_seconds: cfg.windowSeconds,
      failed_closed: true,
    };
  }
  return data;
}

export function consumeNewConversation(db, profileId) {
  return consumeMessageRateLimit(db, { profileId, action: 'new_conversation' });
}

export function consumeMessage(db, profileId) {
  return consumeMessageRateLimit(db, { profileId, action: 'message' });
}

// Shared, pure validation constant for a future message-composer API. The hard
// limit is already enforced by the Phase 1 messages body CHECK; this mirrors it.
export function isMessageBodyWithinLimit(body) {
  return typeof body === 'string' && body.length <= MESSAGE_MAX_BODY_CHARS;
}
