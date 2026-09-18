// shared/demoIdentity.js
//
// DEMO-MODE-1: how a DEMO PERSON is recognised, importable by both src/ (the Vite
// frontend) and api/ (the Vercel functions), living at the repo root for the same
// reason shared/dateUtils.js does.
//
// THE PROBLEM THIS SOLVES
//
// Demo mode is a per-user browser preference. The server has no idea it exists. A cron
// firing at 16:00 on a Friday does not know that someone is standing on a stage in
// Orlando, and it must not email a fabricated student either way. So the server cannot
// ask "are we in demo mode?"; it has to be able to look at a single recipient and know.
//
// The answer is to make it legible from the address itself. Every fabricated person the
// seed creates gets an address at DEMO_EMAIL_DOMAIN, and that is the whole protocol:
// stateless, no lookup, no shared session, correct in a cron, in an endpoint, and in a
// message sent by hand from Connect.
//
// TWO INDEPENDENT DEFENCES, because one is not enough for something that sends mail:
//
//   1. THE ADDRESS CANNOT RESOLVE. `.invalid` is reserved by RFC 2606 precisely so that
//      it can never be delegated in the real DNS root. Even a message that escaped every
//      check in this repository has nowhere to be delivered.
//
//   2. NOTHING HANDS IT TO THE PROVIDER. lib/server/email/mailer.js refuses any
//      recipient matching this rule before Resend is called at all, so no delivery is
//      ever attempted and no bounce is ever generated against our sending domain.
//
// Defence 2 is the one that does the work. Defence 1 is there for the day someone adds
// a 32nd send path and forgets the mailer.

/**
 * The reserved domain every fabricated person's address ends with.
 *
 * Do not change this to a domain that could ever resolve, and do not use a real
 * Cedars-Sinai domain "just for realism". A demo address that can receive mail is a
 * demo address that will eventually receive mail.
 */
export const DEMO_EMAIL_DOMAIN = 'demo.aspire.invalid'

const SUFFIX = `@${DEMO_EMAIL_DOMAIN}`

/**
 * Is this address a fabricated demo recipient?
 *
 * Deliberately total: null, undefined, a number, and a malformed string all answer
 * false rather than throwing. This sits in the path of every outbound email in the
 * application, and a guard that can throw is a guard that takes down sending.
 */
export function isDemoEmail(address) {
  if (typeof address !== 'string') return false
  return address.trim().toLowerCase().endsWith(SUFFIX)
}

/**
 * Does any recipient in this list belong to a demo person?
 *
 * Accepts the shapes Resend accepts: a string, an array of strings, or undefined. A
 * message is treated as a demo message when ANY recipient is a demo person, never when
 * only all of them are. A real address and a fabricated one on the same message is a
 * seeding mistake, and the safe reading of a mistake is to hold the message rather than
 * to deliver it to the half that happens to be real.
 */
export function hasDemoRecipient(to, cc, bcc) {
  const all = []
  for (const field of [to, cc, bcc]) {
    if (!field) continue
    if (Array.isArray(field)) all.push(...field)
    else all.push(field)
  }
  return all.some(isDemoEmail)
}

/**
 * Build a demo address from a person's name. Used only by the seed.
 *
 * Produces first.last@demo.aspire.invalid, lowercased, with anything that is not a
 * letter or a digit collapsed to a dot, so a fabricated name with an apostrophe or an
 * accent still yields a clean address.
 */
export function demoEmailFor(name, discriminator = '') {
  const slug = String(name || 'demo')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.+|\.+$/g, '')
  const tail = discriminator ? `.${discriminator}` : ''
  return `${slug || 'demo'}${tail}${SUFFIX}`
}
