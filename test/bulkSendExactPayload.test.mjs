// BULK-EXACT-RECIPIENTS-1 (P0): the bulk send endpoint, EXECUTED.
//
// The real /api/connect-send-bulk-message handler runs with its Resend and
// Supabase clients substituted, so these assertions are about behaviour: what
// the provider was actually asked to send, for exactly which recipients. The
// allowlist guard (api/lib/bulkRecipientAllowlist.js) runs REAL - and the
// negative control below re-runs the same incident payload through a tampered
// handler whose guard passes everything, proving the guard is what blocks the
// unintended recipients.
//
// Nothing is sent and no database is touched.
// Run: node --test test/bulkSendExactPayload.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'

const here = dirname(fileURLToPath(import.meta.url))
const repo = join(here, '..')
const read = (p) => readFileSync(join(repo, p), 'utf8')
const abs  = (p) => JSON.stringify(pathToFileURL(join(repo, p)).href)

// supabase_admin-style env is unused (the client is substituted) but appUrl guards on env shape.
process.env.SUPABASE_URL ||= 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-key-not-a-secret'
process.env.RESEND_API_KEY ||= 'test-key-not-a-secret'

// ── The substituted world ───────────────────────────────────────────────────
const dir = mkdtempSync(join(tmpdir(), 'bulk-exact-'))
test.after(() => rmSync(dir, { recursive: true, force: true }))

writeFileSync(join(dir, 'fake.mjs'), `
  export let sends = [], logInserts = [], archives = [];
  export function __reset() { sends = []; logInserts = []; archives = []; }

  export class Resend {
    constructor() {
      this.emails = { send: async (p) => { sends.push(p); return { data: { id: 're_' + sends.length }, error: null }; } };
    }
  }

  // The auth-side client (bearer-token validation).
  export function createClient() {
    return { auth: { getUser: async () => ({ data: { user: { id: 'auth-user-1' } }, error: null }) } };
  }

  // The service-role database. Students/contacts mirror the incident SHAPE with synthetic identities.
  const STUDENTS = {
    'aaaaaaaa-0000-4000-8000-000000000001': { id: 'aaaaaaaa-0000-4000-8000-000000000001', first_name: 'WcuOne',   last_name: 'Student', school_email: 'wcu1@student.example.edu', personal_email: null, status: 'Placed' },
    'aaaaaaaa-0000-4000-8000-000000000002': { id: 'aaaaaaaa-0000-4000-8000-000000000002', first_name: 'WcuTwo',   last_name: 'Student', school_email: 'wcu2@student.example.edu', personal_email: null, status: 'Placed' },
    'aaaaaaaa-0000-4000-8000-000000000003': { id: 'aaaaaaaa-0000-4000-8000-000000000003', first_name: 'WcuThree', last_name: 'Student', school_email: 'wcu3@student.example.edu', personal_email: null, status: 'Active Rotation' },
    'aaaaaaaa-0000-4000-8000-000000000009': { id: 'aaaaaaaa-0000-4000-8000-000000000009', first_name: 'WcuNP',    last_name: 'Student', school_email: 'np@student.example.edu',   personal_email: null, status: 'Not Proceeding' },
    'cccccccc-0000-4000-8000-000000000001': { id: 'cccccccc-0000-4000-8000-000000000001', first_name: 'Csulb',    last_name: 'Student', school_email: 'csulb1@student.example.edu', personal_email: null, status: 'Interviewed' },
  };
  const CONTACTS = {
    'bbbbbbbb-0000-4000-8000-000000000001': { id: 'bbbbbbbb-0000-4000-8000-000000000001', full_name: 'Coordinator One', email: 'coordinator1@example.org', is_active: true },
    'bbbbbbbb-0000-4000-8000-000000000002': { id: 'bbbbbbbb-0000-4000-8000-000000000002', full_name: 'Coordinator Two', email: 'coordinator2@example.org', is_active: true },
  };
  const PROFILE = { id: 'staff-1', role: 'owner', email: 'owner@example.org', full_name: 'Test Owner', connect_signature: null, is_owner: true };

  const admin = {
    from(table) {
      const q = { table, filters: [] };
      const api = {
        select() { return api },
        eq(f, v) { q.filters.push([f, v]); return api },
        filter(f, _op, v) { q.filters.push([f, v]); return api },
        limit() { return Promise.resolve({ data: [], error: null }) },
        insert(row) {
          if (q.table === 'notification_log') logInserts.push(row);
          return { select: () => ({ single: async () => ({ data: { id: 'log-' + logInserts.length }, error: null }) }) };
        },
        upsert: async (row) => { archives.push(row); return { error: null }; },
        single() {
          if (q.table === 'user_profiles') return Promise.resolve({ data: PROFILE, error: null });
          const id = (q.filters.find(([f]) => f === 'id') || [])[1];
          const row = q.table === 'students' ? STUDENTS[id] : q.table === 'contacts' ? CONTACTS[id] : null;
          return Promise.resolve(row ? { data: row, error: null } : { data: null, error: { message: 'not found' } });
        },
      };
      return api;
    },
  };
  export default admin;
`)

// A pass-everything guard for the NEGATIVE CONTROL: what the world looks like
// if the exact-recipient validation is removed.
writeFileSync(join(dir, 'no-guard.mjs'), `
  import { normalizeEmailForLookup } from ${abs('src/lib/emailUtils.js')};
  export async function validateBulkRecipients({ recipients }) {
    return {
      cleared: recipients.map((r, index) => ({
        index, source: r.source, rawEmail: String(r.email || '').trim(),
        normEmail: normalizeEmailForLookup(String(r.email || '')),
        recipientId: r.studentId || r.contactId || null,
        recipientName: r.name || null, emailSource: null,
        firstName: r.firstName || null, school: r.school || null,
      })),
      rejected: [],
    };
  }
`)

function instrument(guardHref) {
  return read('api/connect-send-bulk-message.js')
    .replace(/from '@supabase\/supabase-js'/, `from ${JSON.stringify(pathToFileURL(join(dir, 'fake.mjs')).href)}`)
    .replace(/from 'resend'/, `from ${JSON.stringify(pathToFileURL(join(dir, 'fake.mjs')).href)}`)
    .replace(/from '\.\.\/lib\/server\/evaluation\/supabase_admin\.js'/, `from ${JSON.stringify(pathToFileURL(join(dir, 'fake.mjs')).href)}`)
    .replace(/from '\.\.\/lib\/server\/connect\/emailTemplates\.js'/, `from ${abs('lib/server/connect/emailTemplates.js')}`)
    .replace(/from '\.\.\/src\/lib\/notifications\/studentRecipient\.js'/, `from ${abs('src/lib/notifications/studentRecipient.js')}`)
    .replace(/from '\.\.\/src\/lib\/recipientParse\.js'/, `from ${abs('src/lib/recipientParse.js')}`)
    .replace(/from '\.\.\/src\/lib\/htmlEscape\.js'/, `from ${abs('src/lib/htmlEscape.js')}`)
    .replace(/from '\.\.\/src\/lib\/notifications\/templates\/signatures\.js'/, `from ${abs('src/lib/notifications/templates/signatures.js')}`)
    .replace(/from '\.\/lib\/messageArchive\.js'/, `from ${abs('api/lib/messageArchive.js')}`)
    // OUTREACH-ATTACHMENTS-1: point at the real resolver so the payload test
    // keeps exercising the shipped attachment path rather than a stub.
    .replace(/from '\.\/lib\/outreachAttachments\.js'/, `from ${abs('api/lib/outreachAttachments.js')}`)
    .replace(/from '\.\/lib\/bulkRecipientAllowlist\.js'/, `from ${guardHref}`)
    // No pacing in tests: the 300ms inter-send sleep would slow nothing but the runner.
    .replace(/const SEND_DELAY_MS\s*=\s*300;/, 'const SEND_DELAY_MS = 0;')
}

writeFileSync(join(dir, 'handler-real.mjs'), instrument(abs('api/lib/bulkRecipientAllowlist.js')))
writeFileSync(join(dir, 'handler-tampered.mjs'), instrument(JSON.stringify(pathToFileURL(join(dir, 'no-guard.mjs')).href)))

const fakes = await import(pathToFileURL(join(dir, 'fake.mjs')).href)
const { default: realHandler } = await import(pathToFileURL(join(dir, 'handler-real.mjs')).href)
const { default: tamperedHandler } = await import(pathToFileURL(join(dir, 'handler-tampered.mjs')).href)

function makeRes() {
  const res = { statusCode: null, body: null, headers: {} }
  res.setHeader = (k, v) => { res.headers[k] = v }
  res.status = (c) => { res.statusCode = c; return res }
  res.json = (b) => { res.body = b; return res }
  res.end = () => res
  return res
}
const post = (body) => ({ method: 'POST', headers: { authorization: 'Bearer test-token' }, body })

const BATCH = '99999999-1111-4222-8333-444444444444'
const baseSend = {
  confirmation: 'SEND MESSAGES', batch_id: BATCH,
  template_key: 'announcement_broadcast', template_label: 'Announcement / Broadcast',
  subject: 'Orientation - Monday', body: 'Dear [First Name], welcome.',
  body_format: 'text', include_signature: true,
}

const INTENDED_SIX = [
  { source: 'student', studentId: 'aaaaaaaa-0000-4000-8000-000000000001', email: 'wcu1@student.example.edu', emailType: 'school', name: 'WcuOne Student', firstName: 'WcuOne', school: 'WCU-NH' },
  { source: 'student', studentId: 'aaaaaaaa-0000-4000-8000-000000000002', email: 'wcu2@student.example.edu', emailType: 'school', name: 'WcuTwo Student', firstName: 'WcuTwo', school: 'WCU-NH' },
  { source: 'student', studentId: 'aaaaaaaa-0000-4000-8000-000000000003', email: 'wcu3@student.example.edu', emailType: 'school', name: 'WcuThree Student', firstName: 'WcuThree', school: 'WCU-NH' },
  { source: 'contact', contactId: 'bbbbbbbb-0000-4000-8000-000000000001', email: 'coordinator1@example.org', name: 'Coordinator One', firstName: 'Coordinator' },
  { source: 'contact', contactId: 'bbbbbbbb-0000-4000-8000-000000000002', email: 'coordinator2@example.org', name: 'Coordinator Two', firstName: 'Coordinator' },
  { source: 'manual', email: 'krystal@example.org', name: 'Krystal Sophia Rodriguez', firstName: 'Krystal' },
]

// Entries with the incident's failure shapes: stale email claims, an unknown
// contact, a duplicate, and an unacknowledged Not Proceeding student.
const UNINTENDED = [
  { source: 'student', studentId: 'cccccccc-0000-4000-8000-000000000001', email: 'someoneelse@student.example.edu', emailType: 'school', name: 'Stale Claim' },
  { source: 'contact', contactId: 'bbbbbbbb-0000-4000-8000-00000000dead', email: 'ghost@example.org', name: 'Ghost Contact' },
  { source: 'manual', email: 'coordinator1@example.org', name: 'Duplicate Coordinator' },
  { source: 'student', studentId: 'aaaaaaaa-0000-4000-8000-000000000009', email: 'np@student.example.edu', emailType: 'school', name: 'WcuNP Student' },
]

// ── The exact-recipient contract, executed ──────────────────────────────────

test('the reviewed six - and ONLY the reviewed six - reach the provider', async () => {
  fakes.__reset()
  const res = makeRes()
  await realHandler(post({ ...baseSend, recipients: INTENDED_SIX }), res)
  assert.equal(res.statusCode, 200)
  assert.equal(res.body.summary.sent, 6)
  assert.equal(res.body.summary.skipped, 0)
  assert.deepEqual(
    fakes.sends.map(s => s.to).flat().sort(),
    INTENDED_SIX.map(r => r.email).sort(),
    'the provider recipient set is byte-identical to the reviewed payload',
  )
  assert.equal(fakes.logInserts.length, 6, 'one notification_log row per sent recipient')
  assert.equal(fakes.archives.length, 6, 'one archive snapshot per sent recipient')
})

test('INCIDENT REGRESSION: stale, unknown, duplicate and Not Proceeding entries never reach the provider', async () => {
  fakes.__reset()
  const res = makeRes()
  await realHandler(post({ ...baseSend, recipients: [...INTENDED_SIX, ...UNINTENDED] }), res)
  assert.equal(res.statusCode, 200)
  assert.equal(res.body.summary.sent, 6, 'only the six verifiable recipients sent')
  assert.equal(res.body.summary.skipped, 4, 'every unintended entry rejected')
  assert.deepEqual(res.body.skipped.map(s => s.reason).sort(),
    ['contact_not_found', 'duplicate', 'email_mismatch', 'not_proceeding_not_acknowledged'])
  const delivered = new Set(fakes.sends.map(s => s.to).flat())
  assert.ok(!delivered.has('someoneelse@student.example.edu'))
  assert.ok(!delivered.has('ghost@example.org'))
  assert.ok(!delivered.has('np@student.example.edu'))
  assert.equal(fakes.sends.length, 6, 'provider called exactly once per cleared recipient')
})

test('a Review-acknowledged Not Proceeding student sends; unacknowledged never does', async () => {
  fakes.__reset()
  const np = { source: 'student', studentId: 'aaaaaaaa-0000-4000-8000-000000000009', email: 'np@student.example.edu', emailType: 'school', status_ack: true }
  const res = makeRes()
  await realHandler(post({ ...baseSend, recipients: [np] }), res)
  assert.equal(res.body.summary.sent, 1)
  assert.deepEqual(fakes.sends[0].to, ['np@student.example.edu'])
})

test('the provider set can never exceed or diverge from the request payload (no expansion)', async () => {
  fakes.__reset()
  const res = makeRes()
  const payload = [...INTENDED_SIX, ...UNINTENDED]
  await realHandler(post({ ...baseSend, recipients: payload }), res)
  const payloadEmails = new Set(payload.map(r => String(r.email).toLowerCase()))
  const deliveredAll = fakes.sends.map(s => s.to).flat()
  assert.ok(deliveredAll.length <= payload.length)
  for (const e of deliveredAll) {
    assert.ok(payloadEmails.has(e.toLowerCase()), `provider was asked to mail ${e}, which the client never sent`)
  }
})

test('top-level recipient overrides and a wrong confirmation are rejected with ZERO provider calls', async () => {
  for (const bad of [
    { ...baseSend, recipients: INTENDED_SIX, to: 'attacker@example.com' },
    { ...baseSend, recipients: INTENDED_SIX, confirmation: 'send messages' },
  ]) {
    fakes.__reset()
    const res = makeRes()
    await realHandler(post(bad), res)
    assert.equal(res.statusCode, 400)
    assert.equal(fakes.sends.length, 0)
  }
})

test('per-recipient personalization reaches the provider (merge is per recipient, not batch)', async () => {
  fakes.__reset()
  const res = makeRes()
  await realHandler(post({ ...baseSend, recipients: INTENDED_SIX.slice(0, 2) }), res)
  assert.match(fakes.sends[0].html, /WcuOne/)
  assert.match(fakes.sends[1].html, /WcuTwo/)
  assert.doesNotMatch(fakes.sends[0].html, /WcuTwo/)
})

// ── NEGATIVE CONTROL ────────────────────────────────────────────────────────

test('NEGATIVE CONTROL: with the allowlist guard removed, the unintended recipients WOULD send', async () => {
  fakes.__reset()
  const res = makeRes()
  await tamperedHandler(post({ ...baseSend, recipients: [...INTENDED_SIX, ...UNINTENDED] }), res)
  // The tampered handler mails the stale claim, the ghost, and the
  // unacknowledged Not Proceeding student - 6 + 3 (the duplicate manual entry
  // collapses into coordinator1's within-request norm... it does NOT: the
  // no-guard variant performs no dedupe either, so ALL 10 distinct provider
  // calls happen). The real guard is therefore the load-bearing protection.
  const delivered = new Set(fakes.sends.map(s => s.to).flat())
  assert.ok(delivered.has('someoneelse@student.example.edu'), 'tampered handler mails the stale claim')
  assert.ok(delivered.has('np@student.example.edu'), 'tampered handler mails the Not Proceeding student')
  assert.ok(fakes.sends.length > 6, 'strictly more mail than the reviewed six - the guard is what prevents this')
})
