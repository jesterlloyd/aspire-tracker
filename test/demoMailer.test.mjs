// test/demoMailer.test.mjs
//
// DEMO-MODE-1: the outbound side of the boundary.
//
// The client wrapper stops a real student's name being DRAWN. This stops a fabricated
// student's address being MAILED, which is a different failure with a longer tail: a
// message that leaves is gone, and a bounce against a reserved domain is a deliverability
// problem for the real sending domain.
//
// The structural test at the bottom is the one that keeps working after everyone has
// forgotten this file exists. Guarding 31 call sites is worth nothing if the 32nd
// constructs Resend directly, so the test simply refuses to let a 32nd exist.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative } from 'node:path'

import {
  DEMO_EMAIL_DOMAIN, isDemoEmail, hasDemoRecipient, demoEmailFor,
} from '../shared/demoIdentity.js'
import { withDemoGuard } from '../lib/server/email/mailer.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

// ─────────────────────────────────────────────────────────────────────
// 1. Recognising a fabricated person
// ─────────────────────────────────────────────────────────────────────
test('the demo domain is reserved and cannot resolve', () => {
  // RFC 2606 reserves .invalid precisely so it can never be delegated. If this ever
  // becomes a domain that could receive mail, the second line of defence is gone.
  assert.ok(DEMO_EMAIL_DOMAIN.endsWith('.invalid'),
    'the demo domain must sit under a reserved TLD that can never resolve')
})

test('isDemoEmail recognises fabricated addresses and nothing else', () => {
  assert.equal(isDemoEmail(`ada.chen@${DEMO_EMAIL_DOMAIN}`), true)
  assert.equal(isDemoEmail(`ADA.CHEN@${DEMO_EMAIL_DOMAIN.toUpperCase()}`), true, 'case must not matter')
  assert.equal(isDemoEmail(`  ada@${DEMO_EMAIL_DOMAIN}  `), true, 'stray whitespace must not matter')

  assert.equal(isDemoEmail('student@csun.edu'), false)
  assert.equal(isDemoEmail('jester@cshs.org'), false)

  // A near miss must NOT be treated as demo: this address belongs to a real domain that
  // merely contains the demo domain as a substring.
  assert.equal(isDemoEmail(`real@notdemo.aspire.invalid.example.com`), false)

  // Total by design. This runs in the path of every outbound email in the app, so it
  // must never throw on a malformed value.
  for (const bad of [null, undefined, 42, {}, [], NaN]) {
    assert.equal(isDemoEmail(bad), false, `isDemoEmail(${String(bad)}) must not throw`)
  }
})

test('a message is held when ANY recipient is fabricated', () => {
  const demo = `ada@${DEMO_EMAIL_DOMAIN}`
  const real = 'coordinator@csun.edu'

  assert.equal(hasDemoRecipient(demo), true)
  assert.equal(hasDemoRecipient([demo]), true)
  assert.equal(hasDemoRecipient([real, demo]), true, 'one fabricated recipient is enough')
  assert.equal(hasDemoRecipient(real, demo), true, 'cc counts')
  assert.equal(hasDemoRecipient(real, null, demo), true, 'bcc counts')

  assert.equal(hasDemoRecipient(real), false)
  assert.equal(hasDemoRecipient([real, 'other@ucla.edu']), false)
  assert.equal(hasDemoRecipient(undefined, undefined, undefined), false)
})

test('demoEmailFor produces a clean address from a fabricated name', () => {
  assert.equal(demoEmailFor('Ada Chen'), `ada.chen@${DEMO_EMAIL_DOMAIN}`)
  assert.equal(demoEmailFor("Renée O'Brien"), `renee.o.brien@${DEMO_EMAIL_DOMAIN}`)
  assert.equal(demoEmailFor('Ada Chen', '2'), `ada.chen.2@${DEMO_EMAIL_DOMAIN}`)
  assert.ok(isDemoEmail(demoEmailFor('Anyone At All')),
    'anything this builds must be recognised by the guard that blocks it')
})

// ─────────────────────────────────────────────────────────────────────
// 2. The guard, against a stub rather than the network
// ─────────────────────────────────────────────────────────────────────
function stubClient() {
  const sent = []
  const client = { emails: { send: async (payload) => { sent.push(payload); return { data: { id: 'real_1' }, error: null } } } }
  return { client: withDemoGuard(client), sent }
}

test('a fabricated recipient is never handed to the provider', async () => {
  const { client, sent } = stubClient()

  const res = await client.emails.send({
    from: 'aspire@cshs.org',
    to: [`ada@${DEMO_EMAIL_DOMAIN}`],
    subject: 'Your rotation starts Monday',
    html: '<p>hello</p>',
  })

  assert.equal(sent.length, 0, 'the underlying send must not be called at all')
  assert.equal(res.error, null, 'a held message is not an error; callers must not see a failure')
  assert.match(res.data.id, /^demo_held_/, 'the id says plainly that nothing was delivered')
})

test('a real recipient still goes out untouched', async () => {
  const { client, sent } = stubClient()

  const payload = {
    from: 'aspire@cshs.org',
    to: ['coordinator@csun.edu'],
    subject: 'Placement confirmation',
    html: '<p>hello</p>',
  }
  const res = await client.emails.send(payload)

  assert.equal(sent.length, 1)
  assert.deepEqual(sent[0], payload, 'the payload must reach the provider unmodified')
  assert.equal(res.data.id, 'real_1')
})

test('a mixed message is held, not half-delivered', async () => {
  const { client, sent } = stubClient()

  // A real coordinator CC'd on a fabricated student's message. Delivering to the half
  // that happens to be real would send a stranger a message about a person who does not
  // exist, so the safe reading of the mistake is to hold the whole thing.
  const res = await client.emails.send({
    to: [`ada@${DEMO_EMAIL_DOMAIN}`],
    cc: ['coordinator@csun.edu'],
    subject: 'Midpoint check-in',
  })

  assert.equal(sent.length, 0)
  assert.match(res.data.id, /^demo_held_/)
})

// ─────────────────────────────────────────────────────────────────────
// 3. The structural guard: there is no way around the door
// ─────────────────────────────────────────────────────────────────────
function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (full.endsWith('.js')) out.push(full)
  }
  return out
}

test('nothing constructs Resend directly except the mailer itself', () => {
  const offenders = []
  // src/ too: src/lib/notifications/index.js is server code that lives there, and it was
  // the one send site this sweep could not see (DEMO-DATA-2).
  for (const base of ['api', 'lib', 'src']) {
    for (const file of walk(join(root, base))) {
      const rel = relative(root, file)
      if (rel === join('lib', 'server', 'email', 'mailer.js')) continue
      if (/new Resend\s*\(/.test(readFileSync(file, 'utf8'))) offenders.push(rel)
    }
  }

  assert.deepEqual(offenders, [],
    'These construct Resend directly and so bypass the demo recipient guard entirely. ' +
    "Import { createMailer } from lib/server/email/mailer.js and call createMailer() instead. " +
    'Guarding 31 send sites is worth nothing if a 32nd goes around them.')
})

test('a send site either builds its client through the mailer, or is handed one', () => {
  // These four never construct a client. They take `resend` as a parameter and their
  // callers supply it, and the test above guarantees every client anyone can construct
  // came from createMailer. They are listed rather than pattern-matched so that a FIFTH
  // module going this route has to be looked at by a person, which is the point.
  const INJECTED = new Set([
    join('lib', 'server', 'messages', 'deliveryService.js'),
    join('lib', 'server', 'staffNotifications', 'deliveryService.js'),
    join('lib', 'server', 'portalFeedback', 'deliveryService.js'),
    join('lib', 'server', 'evaluation', 'reminderSend.js'),
    // SIGNATURES-PHASE2: handed createMailer() by api/sig-signer.js, api/sig-staff.js and
    // api/cron/sig-maintenance.js (asserted below).
    join('lib', 'server', 'signatures', 'engine.js'),
    // FORMS-PHASE3: handed createMailer() by api/form-staff.js, api/form-respond.js and
    // api/cron/form-maintenance.js (asserted below).
    join('lib', 'server', 'forms', 'engine.js'),
  ])

  const unaccounted = []
  for (const base of ['api', 'lib']) {
    for (const file of walk(join(root, base))) {
      const rel = relative(root, file)
      if (rel === join('lib', 'server', 'email', 'mailer.js')) continue
      const src = readFileSync(file, 'utf8')
      if (!/\.emails\.send\s*\(/.test(src)) continue
      if (/createMailer/.test(src) || INJECTED.has(rel)) continue
      unaccounted.push(rel)
    }
  }

  assert.deepEqual(unaccounted, [],
    'This sends mail with a client of unknown origin. Either call createMailer(), or, ' +
    'if it is genuinely handed a client by its caller, add it to INJECTED here and ' +
    'confirm every caller passes createMailer().')
})

test('every injected client is built by the mailer', () => {
  // The other half of the same argument: the four modules above are only safe while
  // every caller hands them a guarded client.
  const bad = []
  for (const base of ['api', 'lib']) {
    for (const file of walk(join(root, base))) {
      const rel = relative(root, file)
      const src = readFileSync(file, 'utf8')
      // `resend:` as an object property, which is how every delivery service is wired.
      for (const m of src.matchAll(/resend:\s*([A-Za-z_$][\w$]*)\s*\(/g)) {
        if (!['createMailer', 'makeResend'].includes(m[1])) bad.push(`${rel}: resend: ${m[1]}()`)
      }
    }
  }
  assert.deepEqual(bad, [],
    'An injected resend client is built by something other than createMailer, so the ' +
    'delivery service it reaches would send to fabricated recipients.')
})

test('the signature engine is only ever handed a mailer built by createMailer', () => {
  // SIGNATURES-PHASE2: engine.js sends through the `mailer` its callers pass. Every caller
  // builds that client with createMailer(), so the demo recipient guard holds.
  const callers = ['api/sig-signer.js', 'api/sig-staff.js', 'api/cron/sig-maintenance.js']
  for (const rel of callers) {
    const src = readFileSync(join(root, rel), 'utf8')
    assert.match(src, /import \{ createMailer \} from '[./]+lib\/server\/email\/mailer\.js'/, `${rel} imports createMailer`)
    assert.match(src, /mailer(: |\s*=\s*)createMailer\(\)/, `${rel} builds its mailer with createMailer()`)
    assert.doesNotMatch(src, /new Resend\(/, `${rel} never builds a Resend client itself`)
  }
  // And nothing else in the tree imports the engine's senders.
  const importers = []
  for (const base of ['api', 'lib']) {
    for (const file of walk(join(root, base))) {
      const rel = relative(root, file)
      if (/signatures\/engine\.js['"]/.test(readFileSync(file, 'utf8'))) importers.push(rel)
    }
  }
  assert.deepEqual(importers.sort(), callers.map(c => join(...c.split('/'))).sort())
})

test('the forms engine is only ever handed a mailer built by createMailer', () => {
  const callers = ['api/form-staff.js', 'api/form-respond.js', 'api/cron/form-maintenance.js']
  for (const rel of callers) {
    const src = readFileSync(join(root, rel), 'utf8')
    assert.match(src, /import \{ createMailer \} from '[./]+lib\/server\/email\/mailer\.js'/, `${rel} imports createMailer`)
    assert.match(src, /mailer: createMailer\(\)/, `${rel} passes createMailer()`)
    assert.doesNotMatch(src, /new Resend\(/)
  }
  const importers = []
  for (const base of ['api', 'lib']) {
    for (const file of walk(join(root, base))) {
      if (/forms\/engine\.js['"]/.test(readFileSync(file, 'utf8'))) importers.push(relative(root, file))
    }
  }
  assert.deepEqual(importers.sort(), callers.map(c => join(...c.split('/'))).sort())
})

// OUTREACH-FORM-BUTTON-1: the Outreach form-button module imports the forms engine to make
// links, never to mail. The Outreach endpoints send the email through their own createMailer().
test('the Outreach form-button module makes links only and never mails', () => {
  const src = readFileSync(join(root, 'lib/server/forms/outreachButtons.js'), 'utf8')
  assert.doesNotMatch(src, /mailer|sendForm|remind\(/i)
  for (const rel of ['api/connect-send-bulk-message.js', 'api/connect-send-direct-email.js']) {
    assert.match(readFileSync(join(root, rel), 'utf8'), /createMailer\(\)/, `${rel} mails through createMailer`)
  }
})
