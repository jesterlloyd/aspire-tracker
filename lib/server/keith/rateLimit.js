// KEITH-P0: weighted per-profile rate limiting.
//
// Keith is the most expensive endpoint in the app and was the only uncapped one,
// in a repo that already rate-limits four cheaper surfaces. A single
// authenticated profile could issue unlimited requests, each up to five model
// rounds, with no ceiling and no way to attribute the spend after the fact.
//
// Budget: 30 WEIGHTED requests per profile per 10-minute sliding window, where a
// skill invocation costs 2 (it runs a quality-route model over a whole document,
// so it is worth roughly double a chat turn). Ordinary chat costs 1.
//
// The counter increment happens inside a SECURITY DEFINER function so the
// read-modify-write is atomic; two concurrent requests cannot both observe 29.
//
// FAILURE POSTURE: fail CLOSED (decided 2026-08-05). If the counter cannot be
// consulted, the request is REFUSED rather than waved through. Keith is the most
// expensive endpoint in the app, and an unmeterable window is exactly the window
// in which uncapped spend would go unnoticed. The accepted cost is that a
// counter outage makes Keith unavailable rather than unmetered.
//
// A refusal for this reason is reported distinctly from a genuine over-budget
// refusal (`degraded: true`), because they are different facts and the caller
// deserves different copy: one says "you have used your allowance", the other
// says "we cannot check right now". Telling a user who has done nothing that
// they hit a limit would be a lie.

export const WINDOW_SECONDS = 600;
export const WEIGHTED_LIMIT = 30;
export const WEIGHT_CHAT = 1;
export const WEIGHT_SKILL = 2;

/**
 * Consume budget for one request.
 * Returns { allowed, count, limit, retryAfterSeconds, degraded }.
 * `degraded: true` means the limiter could not run, so the request was REFUSED
 * without a budget ever being consulted - not that the caller was over budget.
 */
export async function consumeRateLimit(db, { profileId, weight = WEIGHT_CHAT, requestId }) {
  if (!profileId) {
    // No identity means no attributable budget. verifyCaller runs first, so this
    // is unreachable in practice; refused rather than silently passed.
    return { allowed: false, count: 0, limit: WEIGHTED_LIMIT, retryAfterSeconds: 0, degraded: true };
  }
  try {
    const { data, error } = await db.rpc('keith_consume_rate_limit', {
      p_profile_id: profileId,
      p_weight: weight,
      p_window_seconds: WINDOW_SECONDS,
      p_limit: WEIGHTED_LIMIT,
    });
    if (error) throw new Error(error.message || 'rate_limit_rpc_failed');
    const row = Array.isArray(data) ? data[0] : data;
    const count = Number(row?.weighted_count ?? 0);
    const allowed = row?.allowed !== false;
    return {
      allowed,
      count,
      limit: WEIGHTED_LIMIT,
      retryAfterSeconds: allowed ? 0 : Number(row?.retry_after_seconds ?? WINDOW_SECONDS),
      degraded: false,
    };
  } catch (err) {
    console.warn('[keith-ratelimit] degraded, REFUSING request (fail closed)', {
      request_id: requestId, reason: err?.message || 'unknown',
    });
    return { allowed: false, count: 0, limit: WEIGHTED_LIMIT, retryAfterSeconds: 0, degraded: true };
  }
}

/** User-facing copy for a 429. States the actual window, no jargon. */
export function rateLimitMessage(retryAfterSeconds) {
  const mins = Math.max(1, Math.ceil((retryAfterSeconds || WINDOW_SECONDS) / 60));
  return `You have reached Keith's usage limit for now. Please try again in about ${mins} minute${mins === 1 ? '' : 's'}.`;
}

/**
 * Copy for a fail-closed refusal. Does NOT claim the caller hit a limit, because
 * they did not - the limiter could not be consulted.
 */
export function limiterUnavailableMessage() {
  // Says nothing about limits or allowances: the caller did not reach one, and
  // implying they did would send them looking for a quota they never used.
  return 'Keith is briefly unavailable. Please try again in a moment.';
}
