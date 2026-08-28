/* global process */
// api/lib/cronAuth.js
//
// S-12: the one authorization check for every cron route.
//
// THE BUG THIS REPLACES. Thirteen handlers each wrote:
//
//   if (req.headers['authorization'] !== `Bearer ${process.env.CRON_SECRET}`)
//
// When CRON_SECRET is unset, that template does not fail to build. It produces
// the literal string "Bearer undefined", so the endpoint's credential silently
// becomes a value an anonymous caller can guess and type. Every reminder,
// digest, and delivery worker was one missing environment variable away from
// being publicly triggerable, and nothing in the code said so.
//
// It also spread. The audit counted eleven handlers; by the time the register
// was reconstructed there were thirteen, because two routes added later
// (student-completion-reconciliation, cohort-access-retirement) were copied
// from a vulnerable neighbour rather than from the one handler that had it
// right. A shared helper plus the guard test in
// test/cronSecretFailClosed.test.mjs is what stops the next one.
//
// THREE PROPERTIES, all of which the old form lacked:
//
//   1. FAILS CLOSED. An unset, non-string, empty, or whitespace-only secret
//      refuses every request. There is no configuration under which this
//      returns true without a real secret being set.
//   2. NO STRING IS BUILT FROM AN UNDEFINED VALUE. The expected credential is
//      only ever constructed after the secret has been proven to be a
//      non-empty string, so "Bearer undefined" cannot exist.
//   3. CONSTANT TIME. The comparison runs over fixed-width SHA-256 digests,
//      so it neither leaks the secret's length nor returns early on the first
//      differing byte. Digesting first also avoids timingSafeEqual's throw on
//      unequal buffer lengths, which a naive length check would have to guard
//      and which would itself leak the length.
//
// This module never reads, logs, or returns the secret's value.

import { createHash, timingSafeEqual } from 'node:crypto'

// Fixed-width digest, so every comparison is over 32 bytes regardless of input.
function digest(value) {
  return createHash('sha256').update(value, 'utf8').digest()
}

/**
 * Is this request carrying the configured cron credential?
 *
 * @param req  the incoming request; only its authorization header is read
 * @param env  environment source, injectable so tests never touch the real one
 * @returns true only when a real secret is configured AND matches
 */
export function isAuthorizedCronRequest(req, env = process.env) {
  const configured = env?.CRON_SECRET
  // Property 1 and 2: nothing is built until the secret is known to be real.
  if (typeof configured !== 'string' || configured.trim() === '') return false

  const header = req?.headers?.['authorization']
  if (typeof header !== 'string' || header === '') return false

  // Property 3: fixed-width, constant-time.
  return timingSafeEqual(digest(header), digest(`Bearer ${configured}`))
}

/**
 * The same check, plus the 401 every cron route returns. Use this unless the
 * route needs to do something else before refusing (coordinator-weekly-digest
 * logs the attempt first, so it calls isAuthorizedCronRequest directly).
 *
 * @returns true when the caller may proceed; when false, the response has
 *          already been sent and the handler must return immediately.
 */
export function requireCronSecret(req, res, env = process.env) {
  if (isAuthorizedCronRequest(req, env)) return true
  res.status(401).json({ error: 'Unauthorized' })
  return false
}
