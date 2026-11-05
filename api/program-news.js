// api/program-news.js
//
// STUDIO-2 (Owner, 2026-11-05): the one "program news" switch behind every Studio email's
// Unsubscribe link. Public (the person may have no account), rate-limited, and it acts only on the
// address the token was made for: the token names a send and a place on its frozen list, and the
// address is read from that list and checked against the token's HMAC (lib/server/studio/newsToken.js).
// Nothing here ever returns more than a masked address.
//
//   POST { action: 'status' | 'unsubscribe' | 'resubscribe', token }
//        -> { email: 'j•••@cshs.org', optedOut }
//   POST ?t=<token> with "List-Unsubscribe=One-Click"   (RFC 8058, a mail client's own button)
//        -> 200
//
// Program news is Studio sends only. Transactional mail (forms, interviews, signatures, reminders)
// does not read this switch.

import supabaseAdmin from '../lib/server/evaluation/supabase_admin.js'
import { consumePublicRateLimit, TOO_MANY_REQUESTS } from './lib/publicRateLimit.js'
import { maskEmail } from '../lib/server/studio/newsToken.js'
import { NewsError, resolveNewsToken, setProgramNews, optedOut } from '../lib/server/studio/programNews.js'

const LIMITS = [
  { prefix: 'program-news-min', windowSeconds: 60, maxPerWindow: 20 },
  { prefix: 'program-news-hour', windowSeconds: 3600, maxPerWindow: 200 },
]
function readBody(req) {
  const b = req.body
  if (b && typeof b === 'object') return b
  if (typeof b === 'string') {
    try { return JSON.parse(b) } catch { return Object.fromEntries(new URLSearchParams(b)) }
  }
  return {}
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('X-Robots-Tag', 'noindex')
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const db = supabaseAdmin
  if (!(await consumePublicRateLimit(db, req, LIMITS))) return res.status(429).json({ error: TOO_MANY_REQUESTS })
  const body = readBody(req)
  try {
    // A mail client's one-click Unsubscribe: the token rides the URL the List-Unsubscribe header named.
    if (req.query?.t && body['List-Unsubscribe'] === 'One-Click') {
      const link = await resolveNewsToken(db, String(req.query.t))
      await setProgramNews(db, link, true)
      return res.status(200).json({ ok: true })
    }
    const link = await resolveNewsToken(db, String(body.token || ''))
    const action = String(body.action || 'status')
    let off
    if (action === 'status') off = await optedOut(db, link.normEmail)
    else if (action === 'unsubscribe') off = await setProgramNews(db, link, true)
    else if (action === 'resubscribe') off = await setProgramNews(db, link, false)
    else return res.status(400).json({ error: 'Unknown action.' })
    return res.status(200).json({ email: maskEmail(link.email), optedOut: off })
  } catch (e) {
    if (e instanceof NewsError) return res.status(e.status).json({ error: e.message })
    console.error('[program-news] failed:', e?.message || e)
    return res.status(500).json({ error: 'That did not work. Try again in a moment.' })
  }
}
