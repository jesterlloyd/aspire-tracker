// lib/server/studio/newsToken.js
//
// STUDIO-2: the token in a Studio email's Unsubscribe link. It names a send and a place on that
// send's frozen list, never an address: `<send id>.<index>.<sig>`, where sig is an HMAC-SHA256 of
// `news:<send id>:<index>:<normalized email>` under STUDIO_TOKEN_SECRET (else SIG_TOKEN_SECRET).
// Verifying reads the address from the frozen list and recomputes the HMAC, so a token cannot be
// edited to name somebody else, and nothing personal ever sits in the URL.

import { createHmac, timingSafeEqual } from 'crypto'
import { Buffer } from 'node:buffer'
import process from 'node:process'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SIG_LEN = 32

export function newsSecret(env = process.env) {
  const s = env.STUDIO_TOKEN_SECRET || env.SIG_TOKEN_SECRET || ''
  return s.length >= 16 ? s : ''
}

const sigFor = (secret, sendId, index, normEmail) =>
  createHmac('sha256', secret).update(`news:${sendId}:${index}:${normEmail}`).digest('base64url').slice(0, SIG_LEN)

/** The token for one recipient, or '' when no secret is configured (then no link is offered). */
export function newsToken(secret, sendId, index, normEmail) {
  if (!secret || !UUID.test(String(sendId)) || !Number.isInteger(index) || index < 0 || !normEmail) return ''
  return `${sendId}.${index}.${sigFor(secret, sendId, index, normEmail)}`
}

/** { sendId, index, sig } or null. Shape only; verifyNewsToken decides whether it is genuine. */
export function parseNewsToken(token) {
  const m = /^([0-9a-f-]{36})\.(\d{1,5})\.([A-Za-z0-9_-]{32})$/i.exec(String(token || '').trim())
  if (!m || !UUID.test(m[1])) return null
  return { sendId: m[1].toLowerCase(), index: Number(m[2]), sig: m[3] }
}

/** True when the token was made for this address at this place on this send. */
export function verifyNewsToken(secret, parsed, normEmail) {
  if (!secret || !parsed || !normEmail) return false
  const want = Buffer.from(sigFor(secret, parsed.sendId, parsed.index, normEmail))
  const got = Buffer.from(parsed.sig)
  return want.length === got.length && timingSafeEqual(want, got)
}

/** "j•••@cshs.org": enough for a person to recognise their address, not enough to read it off. */
export function maskEmail(email) {
  const [user, domain] = String(email || '').split('@')
  if (!user || !domain) return ''
  return `${user[0]}${'•'.repeat(Math.min(3, Math.max(1, user.length - 1)))}@${domain}`
}
