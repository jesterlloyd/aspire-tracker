// lib/server/studio/programNews.js
//
// STUDIO-2: the program-news switch, behind /api/program-news. A token names a send and a place on
// its frozen list; the address is read from that list and checked against the token's HMAC
// (newsToken.js), so a token can only ever act on the address it was made for.

import { newsSecret, parseNewsToken, verifyNewsToken } from './newsToken.js'

const MISSING = (e) => e && (['42P01', 'PGRST205', '42703'].includes(e.code) || /does not exist|schema cache/i.test(e.message || ''))
const BAD_LINK = 'This link does not work. Use the Unsubscribe link in the most recent email.'

export class NewsError extends Error { constructor(status, message) { super(message); this.status = status } }

/** The address a token was made for, with its send, or a NewsError. */
export async function resolveNewsToken(db, token, secret = newsSecret()) {
  const parsed = parseNewsToken(token)
  if (!parsed || !secret) throw new NewsError(404, BAD_LINK)
  const { data, error } = await db.from('studio_sends').select(`id, is_demo, entry:recipients->${parsed.index}`).eq('id', parsed.sendId).maybeSingle()
  if (error) { if (MISSING(error)) throw new NewsError(404, BAD_LINK); throw error }
  const normEmail = data?.entry?.normEmail
  if (!normEmail || !verifyNewsToken(secret, parsed, normEmail)) throw new NewsError(404, BAD_LINK)
  return { sendId: data.id, isDemo: data.is_demo === true, normEmail, email: data.entry.email || normEmail }
}

export async function optedOut(db, normEmail) {
  const { data, error } = await db.from('program_news_optouts').select('opted_out').eq('email_norm', normEmail).maybeSingle()
  if (error) throw error
  return data?.opted_out === true
}

export async function setProgramNews(db, link, off) {
  const at = new Date().toISOString()
  const row = off
    ? { email_norm: link.normEmail, opted_out: true, opted_out_at: at, studio_send_id: link.sendId, is_demo: link.isDemo, updated_at: at }
    : { email_norm: link.normEmail, opted_out: false, resubscribed_at: at, is_demo: link.isDemo, updated_at: at }
  const { error } = await db.from('program_news_optouts').upsert(row, { onConflict: 'email_norm' })
  if (error) throw error
  return off
}

