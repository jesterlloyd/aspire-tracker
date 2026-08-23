// api/lib/publicRateLimit.js
//
// S-11: one throttle for the unauthenticated surface.
//
// These endpoints exist so a student, coordinator, or unit leader can do their
// own work without going through the ASPIRE team, so none of them can require a
// login. What they can require is that a caller behaves like a person. Every one
// of them was previously unthrottled, which is what made walking a school's
// whole address space cheap.
//
// TWO BUCKETS, not one, for the reason S-01 recorded: enumeration is a SUSTAINED
// attack. A per-minute cap alone leaves a patient caller free to probe all day at
// just under the ceiling. The burst bucket stops a script, the sustained bucket
// stops a slow crawl, and both ceilings sit far above what a real submission
// needs.
//
// FAILS CLOSED. An RPC error is treated exactly like an exceeded limit: if the
// limiter cannot confirm the caller is under budget, the caller does not proceed.
//
// Keyed on a peppered HMAC of the client IP, never the raw IP and never the
// email or unit being looked up, so the limiter's own storage cannot become a
// record of who submitted what.
//
// Importing this makes EVALUATION_RATE_LIMIT_PEPPER a hard requirement of every
// route that uses it: rate_limit.js throws at import when it is unset. That is
// deliberate and fail-closed, and the variable is already required by the
// deployed evaluation, certificate, and interview endpoints.

import { extractClientIp, bucketKey } from '../../lib/server/evaluation/rate_limit.js'

// Shown verbatim to a real person who has hit a ceiling. No mechanism, no
// numbers, and no hint that anything about their input was interesting.
export const TOO_MANY_REQUESTS = 'Too many requests. Please wait a moment and try again.'

/**
 * Consume one unit from each of the given buckets.
 *
 * @param db      service-role Supabase client
 * @param req     the incoming request, for the client IP
 * @param limits  [{ prefix, windowSeconds, maxPerWindow }, ...]
 * @returns true when the caller may proceed, false when it must be refused.
 */
export async function consumePublicRateLimit(db, req, limits) {
  const ip = extractClientIp(req)
  for (const { prefix, windowSeconds, maxPerWindow } of limits) {
    let allowed
    try {
      const { data, error } = await db.rpc('consume_evaluation_rate_limit', {
        p_bucket_key:     bucketKey(prefix, ip),
        p_window_seconds: windowSeconds,
        p_max_per_window: maxPerWindow,
      })
      if (error) return false
      allowed = data
    } catch {
      return false
    }
    if (allowed !== true) return false
  }
  return true
}

// ── Ceilings, per endpoint ───────────────────────────────────────────────────
//
// Chosen from what the real workflow needs, then multiplied to leave room for a
// retry, a refresh, and a shaky connection. A submitter who trips one of these
// has done something no form flow produces.
//
// LOOKUPS are the enumeration targets, so they are the tightest. A student looks
// themselves up once, maybe twice after a typo.
export const INTAKE_LOOKUP_LIMITS = [
  { prefix: 'intake_lookup_burst',     windowSeconds: 60,   maxPerWindow: 10 },
  { prefix: 'intake_lookup_sustained', windowSeconds: 3600, maxPerWindow: 60 },
]

// A coordinator selects a unit, and now also re-checks once after typing their
// email, so the per-minute allowance is a little wider than a pure lookup.
export const UNIT_LOOKUP_LIMITS = [
  { prefix: 'unit_lookup_burst',     windowSeconds: 60,   maxPerWindow: 15 },
  { prefix: 'unit_lookup_sustained', windowSeconds: 3600, maxPerWindow: 90 },
]

// The shift-log lookup is the front door to check-in, check-out, and past-shift
// submission, and a student may legitimately re-enter their email across a shift.
export const SHIFT_LOOKUP_LIMITS = [
  { prefix: 'shift_lookup_burst',     windowSeconds: 60,   maxPerWindow: 15 },
  { prefix: 'shift_lookup_sustained', windowSeconds: 3600, maxPerWindow: 90 },
]

// SUBMISSIONS are not enumeration vectors in the same way (they write, and the
// write itself is idempotent or duplicate-checked), but an unthrottled write
// endpoint is still a flood target. These are deliberately generous: a
// coordinator correcting and resubmitting a roster several times is normal.
export const INTAKE_SUBMIT_LIMITS = [
  { prefix: 'intake_submit_burst',     windowSeconds: 60,   maxPerWindow: 5 },
  { prefix: 'intake_submit_sustained', windowSeconds: 3600, maxPerWindow: 30 },
]

export const UNIT_SUBMIT_LIMITS = [
  { prefix: 'unit_submit_burst',     windowSeconds: 60,   maxPerWindow: 5 },
  { prefix: 'unit_submit_sustained', windowSeconds: 3600, maxPerWindow: 30 },
]

export const SCHOOL_SUBMIT_LIMITS = [
  { prefix: 'school_submit_burst',     windowSeconds: 60,   maxPerWindow: 5 },
  { prefix: 'school_submit_sustained', windowSeconds: 3600, maxPerWindow: 30 },
]

// Shift writes happen at the start and end of a shift. A student may retry a
// check-out on a bad hospital connection, so the burst allowance is real.
export const SHIFT_WRITE_LIMITS = [
  { prefix: 'shift_write_burst',     windowSeconds: 60,   maxPerWindow: 10 },
  { prefix: 'shift_write_sustained', windowSeconds: 3600, maxPerWindow: 60 },
]
