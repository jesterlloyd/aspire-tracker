// lib/server/signatures/tokens.js
//
// SIGNATURES-PHASE2: the secrets a signer holds, and how the server checks them without
// ever storing one (brief section 9: tokens and codes as hashes only).
//
//   Link token   base64url(HMAC-SHA256(SIG_TOKEN_SECRET, "link:" + signer id + ":" + version)).
//                Derived, not random, so a reminder can carry the SAME link without the
//                server keeping it; only its SHA-256 is stored. The link stops working
//                when the request is completed, declined, voided or expired, because
//                every signer endpoint checks the request's status, not just the hash.
//   One-time     6 random digits, stored as HMAC(secret, signer id + code), 10 minutes,
//   code         5 attempts (both from sig_settings), then a new code must be sent.
//   Session      32 random bytes issued after the code verifies, stored hashed, 2 hours.
//                Every later call from the signer carries it, so a forwarded link alone
//                cannot open the document.
//
// SIG_TOKEN_SECRET is required: without it nothing can be issued or checked (fail closed).

import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto'

export class TokenConfigError extends Error {
  constructor() { super('SIG_TOKEN_SECRET is not configured.'); this.code = 'token_secret_missing' }
}

const secret = (env = process.env) => {
  const s = env.SIG_TOKEN_SECRET
  if (!s || s.length < 32) throw new TokenConfigError()
  return s
}

export const sha256 = (s) => createHash('sha256').update(String(s)).digest('hex')

export function linkTokenFor(signerId, version = 1, env) {
  return createHmac('sha256', secret(env)).update(`link:${signerId}:${version}`).digest('base64url')
}
export const LINK_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/

export function newCode() { return String(randomInt(0, 1_000_000)).padStart(6, '0') }
export function codeHash(signerId, code, env) {
  return createHmac('sha256', secret(env)).update(`code:${signerId}:${code}`).digest('hex')
}
export function codeMatches(signerId, code, storedHash, env) {
  if (!/^\d{6}$/.test(String(code || '')) || !storedHash) return false
  const a = Buffer.from(codeHash(signerId, code, env), 'hex')
  const b = Buffer.from(storedHash, 'hex')
  return a.length === b.length && timingSafeEqual(a, b)
}

export const SESSION_TTL_MS = 2 * 60 * 60 * 1000
export function newSession() {
  const raw = randomBytes(32).toString('base64url')
  return { raw, hash: sha256(raw), expiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString() }
}

export function clientContext(req) {
  const fwd = String(req.headers?.['x-forwarded-for'] || '').split(',')[0].trim()
  const ip = fwd || req.headers?.['x-real-ip'] || req.socket?.remoteAddress || ''
  return { ip: String(ip).slice(0, 64), userAgent: String(req.headers?.['user-agent'] || '').slice(0, 300) }
}
