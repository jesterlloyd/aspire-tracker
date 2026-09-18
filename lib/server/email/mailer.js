/* global process */
// lib/server/email/mailer.js
//
// DEMO-MODE-1: the one door every outbound message leaves by.
//
// Before this, 31 files each constructed a Resend client and sent directly. That was
// fine while every recipient was a real person. It stops being fine the moment the seed
// creates fabricated students, because a cron does not know that the student it is
// about to email does not exist.
//
// WHY THE GUARD IS ON THE ADDRESS AND NOT ON A MODE
//
// Demo mode is a per-user browser preference. A Vercel function has no access to it and
// never will: the Friday digest fires on a schedule, with no user and no session. So
// the server cannot ask "are we in a demo?". It can only look at a recipient and decide.
// shared/demoIdentity.js makes that decidable by giving every fabricated person an
// address at a reserved domain that can never resolve.
//
// WHAT HELD MEANS
//
// A held message is not an error. Callers log data?.id, write it to notification_log,
// and some treat a missing id as a failure worth retrying. Returning an error would
// make a presentation look broken and would make crons retry forever. So a held message
// returns a well-formed success whose id begins with `demo_held_`, which is honest
// (nothing was delivered), greppable in the logs, and inert to every caller.
//
// This is also what makes "show the email without sending it" work: the message is
// composed in full, recorded exactly as a sent message would be, and simply never
// handed to the provider. The app's own message history is the preview.
import { Resend } from 'resend'
import { hasDemoRecipient } from '../../../shared/demoIdentity.js'

/** Counts held messages per process, purely so the id is unique within a cold start. */
let heldCount = 0

function heldResult(payload) {
  heldCount += 1
  const id = `demo_held_${Date.now()}_${heldCount}`
  // One line per held message. This is the record that proves, after a conference, that
  // nothing went out: grep the function logs for demo_held_ and the count should match
  // the number of sends the demo performed.
  console.log('[mailer] HELD demo message, not sent:', JSON.stringify({
    id,
    subject: payload?.subject || null,
    recipients: Array.isArray(payload?.to) ? payload.to.length : (payload?.to ? 1 : 0),
  }))
  return { data: { id }, error: null }
}

/**
 * Wrap a client's emails.send so fabricated recipients are held rather than delivered.
 *
 * Exported separately from createMailer so the guard can be proven against a stub,
 * with no network call and no API key. Production goes through createMailer.
 */
export function withDemoGuard(client) {
  const originalSend = client.emails.send.bind(client.emails)
  client.emails.send = async (payload, options) => {
    if (hasDemoRecipient(payload?.to, payload?.cc, payload?.bcc)) {
      return heldResult(payload)
    }
    return originalSend(payload, options)
  }
  return client
}

/**
 * A Resend client that refuses to deliver to fabricated people.
 *
 * Drop-in replacement for `new Resend(process.env.RESEND_API_KEY)`: the returned object
 * is the real client with `emails.send` wrapped. `emails.get` and everything else pass
 * through untouched.
 */
export function createMailer(apiKey = process.env.RESEND_API_KEY) {
  return withDemoGuard(new Resend(apiKey))
}
