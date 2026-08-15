// PRECEPTOR-CERT-1 regression: the reconciliation path, executed END TO END.
//
// WHY THIS FILE EXISTS
// The first production click of "Reconcile certificates" returned Internal
// error. Root cause: generateToken() returns an OBJECT { raw, hash, hashPrefix }
// and the endpoint used its return value as if it were the raw token string,
// then re-hashed it - crypto rejected the object and threw, 500'ing the run.
// Every certificate test that shipped was a SOURCE GUARD, so the endpoint's
// loop body had never actually executed. This file executes it.
//
// HOW: the handler's own source is loaded and its import specifiers are
// rewritten to local fakes (supabase, Resend, appUrl). The handler's logic
// runs verbatim - only its dependencies are substituted - so no database is
// touched, no certificate is issued, no sequence is consumed, and no email is
// sent. The token helpers are deliberately NOT faked: hashing is the thing
// that broke.
// Run: node --test test/preceptorCertificateReconcile.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'

const here = dirname(fileURLToPath(import.meta.url))
const repo = join(here, '..')

// tokens.js requires this at import time; any value works for hashing.
process.env.EVALUATION_TOKEN_PEPPER ||= 'test-pepper-not-a-secret'

const COHORT = '11111111-1111-4111-8111-111111111111'
const ASSIGN = '22222222-2222-4222-8222-222222222222'
const PRECEP = '33333333-3333-4333-8333-333333333333'

// A minimal PostgREST-shaped fake: every builder method returns `this`, and the
// terminal awaits resolve from a per-table script. Captures every write.
function makeFakeSupabase({ certRows = [], rpcResult, sends }) {
  const state = { certRows: [...certRows], tokenInserts: [], logInserts: [], updates: [], rpcCalls: [] }

  // Per-table payloads. `single()`/`maybeSingle()` yield the single shape;
  // awaiting the builder directly yields the list shape - matching how the
  // endpoint and the unlock module each read their tables.
  const single = (t) => ({
    evaluation_instruments: { id: 'inst-1' },
    user_profiles: { role: 'owner' },
    preceptors: { full_name: 'Kelly Tran', email: 'kelly@cshs.org' },
  }[t] ?? null)
  const list = (t) => ({
    evaluation_assignments: [{ id: ASSIGN, respondent_preceptor_id: PRECEP }],
    preceptor_certificates: state.certRows,
  }[t] ?? [])

  const q = (table) => {
    const b = {
      select() { return b }, eq() { return b }, is() { return b },
      not() { return b }, in() { return b }, order() { return b }, limit() { return b },
      maybeSingle: () => Promise.resolve({ data: single(table), error: null }),
      single: () => Promise.resolve({ data: single(table), error: null }),
      insert(row) {
        if (table === 'evaluation_assignment_tokens') state.tokenInserts.push(row)
        if (table === 'notification_log') state.logInserts.push(row)
        return Promise.resolve({ data: null, error: null })
      },
      update(patch) {
        return {
          eq: (_k, id) => ({
            // Claim-first: the conditional update only matches an unclaimed row.
            is: () => ({
              select: () => {
                const row = state.certRows.find(r => r.id === id && r.notified_at == null)
                state.updates.push({ patch, id, claimed: !!row })
                if (row) row.notified_at = patch.notified_at
                return Promise.resolve({ data: row ? [row] : [], error: null })
              },
            }),
            // Release path (no .is()): awaited directly.
            then: (resolve) => { state.updates.push({ patch, id, release: true }); return resolve({ data: null, error: null }) },
          }),
        }
      },
      then: (resolve) => resolve({ data: list(table), error: null }),
    }
    return b
  }

  return {
    state,
    from: (t) => q(t),
    rpc: (name, args) => { state.rpcCalls.push({ name, args }); return Promise.resolve({ data: rpcResult, error: null }) },
    auth: { getUser: async () => ({ data: { user: { id: 'auth-1' } }, error: null }) },
    _sends: sends,
  }
}

// Build a runnable copy of the handler + unlock module with fakes linked in.
function buildHarness(fake) {
  const dir = mkdtempSync(join(tmpdir(), 'precept-recon-'))
  globalThis.__FAKE__ = fake

  writeFileSync(join(dir, 'fake-supabase.mjs'),
    `export default globalThis.__FAKE__;\nexport const createClient = () => globalThis.__FAKE__;\n`)
  writeFileSync(join(dir, 'fake-appurl.mjs'),
    `export const emailBaseUrl = () => 'https://aspireintelligence.app';\n`)
  writeFileSync(join(dir, 'fake-resend.mjs'),
    `export class Resend { constructor() {} get emails() { return { send: async (m) => { globalThis.__FAKE__._sends.push(m); return { data: { id: 'mock-email' }, error: null } } } } }\n`)
  writeFileSync(join(dir, 'fake-message-archive.mjs'),
    `export const archiveSentMessage = async () => ({ status: 'archived' });\n`)

  // unlockPreceptorCertificate: real logic, faked Resend + email template path.
  let unlockSrc = readFileSync(join(repo, 'lib/server/certificates/unlockPreceptorCertificate.js'), 'utf8')
  unlockSrc = unlockSrc.replace("from 'resend'", "from './fake-resend.mjs'")
    .replace("from '../evaluation/preceptorCertificateEmail.js'",
             `from ${JSON.stringify(pathToFileURL(join(repo, 'lib/server/evaluation/preceptorCertificateEmail.js')).href)}`)
    .replace("from '../../../api/lib/messageArchive.js'", "from './fake-message-archive.mjs'")
  writeFileSync(join(dir, 'unlock.mjs'), unlockSrc)

  // The endpoint under test: real source, substituted imports. tokens.js stays REAL.
  let src = readFileSync(join(repo, 'api/certificate-preceptor-reconcile.js'), 'utf8')
  src = src.replace("from '@supabase/supabase-js'", "from './fake-supabase.mjs'")
    .replace("from '../lib/server/evaluation/supabase_admin.js'", "from './fake-supabase.mjs'")
    .replace("from '../lib/server/appUrl.js'", "from './fake-appurl.mjs'")
    .replace("from '../lib/server/certificates/unlockPreceptorCertificate.js'", "from './unlock.mjs'")
    .replace("from '../lib/server/evaluation/tokens.js'",
             `from ${JSON.stringify(pathToFileURL(join(repo, 'lib/server/evaluation/tokens.js')).href)}`)
  writeFileSync(join(dir, 'handler.mjs'), src)
  return dir
}

function fakeRes() {
  const r = { statusCode: 0, body: null, headers: {} }
  r.setHeader = (k, v) => { r.headers[k] = v }
  r.status = (c) => { r.statusCode = c; return r }
  r.json = (b) => { r.body = b; return r }
  return r
}
const req = { method: 'POST', headers: { authorization: 'Bearer x' }, body: { cohort_id: COHORT } }

test('reconcile runs end to end: issues, notifies once, mints a VALID token', async () => {
  const sends = []
  const fake = makeFakeSupabase({
    certRows: [{ id: 'cert-1', preceptor_id: PRECEP, qualifying_assignment_id: ASSIGN, notified_at: null }],
    rpcResult: { status: 'issued', certificate_id: 'cert-1', certificate_number: 'ASPIRE-2026-01' },
    sends,
  })
  const dir = buildHarness(fake)
  try {
    const { default: handler } = await import(pathToFileURL(join(dir, 'handler.mjs')).href)
    const res = fakeRes()
    await handler(req, res)

    // THE REGRESSION: this returned 500 in production.
    assert.equal(res.statusCode, 200, `expected 200, got ${res.statusCode}: ${JSON.stringify(res.body)}`)
    assert.equal(res.body.success, true)
    assert.equal(res.body.summary.newly_issued, 1)
    assert.equal(res.body.summary.notifications_sent, 1)

    // The minted token must be a STRING hash at rest, not an object.
    assert.equal(fake.state.tokenInserts.length, 1)
    const tok = fake.state.tokenInserts[0]
    assert.equal(typeof tok.token_hash, 'string')
    assert.match(tok.token_hash, /^[0-9a-f]{64}$/, 'token_hash must be a hex HMAC digest')
    assert.equal(typeof tok.token_hash_prefix, 'string')
    assert.equal(tok.token_hash_prefix, tok.token_hash.slice(0, 8))

    // The emailed link must carry the RAW token, in the form the page accepts.
    assert.equal(sends.length, 1, 'exactly one certificate-ready email')
    const link = /#t=([^"'\s<]+)/.exec(sends[0].html)
    assert.ok(link, 'the email carries a tokenized link')
    assert.match(link[1], /^[A-Za-z0-9_-]{43}$/,
      'the link must contain the raw 43-char token the survey page validates - not [object Object]')
    // And that raw token must hash to what was stored.
    const { hashToken } = await import(pathToFileURL(join(repo, 'lib/server/evaluation/tokens.js')).href)
    assert.equal(hashToken(link[1]), tok.token_hash, 'stored hash must match the emailed raw token')

    // Issuance went through the RPC with the assignment id, nothing else.
    assert.deepEqual(fake.state.rpcCalls.map(c => c.name), ['issue_preceptor_certificate'])
    assert.equal(fake.state.rpcCalls[0].args.p_assignment_id, ASSIGN)
  } finally { rmSync(dir, { recursive: true, force: true }); delete globalThis.__FAKE__ }
})

test('reconcile is idempotent: an already-notified certificate re-sends nothing', async () => {
  const sends = []
  const fake = makeFakeSupabase({
    certRows: [{ id: 'cert-1', preceptor_id: PRECEP, qualifying_assignment_id: ASSIGN, notified_at: '2026-08-10T00:00:00Z' }],
    rpcResult: { status: 'already_issued', certificate_id: 'cert-1', certificate_number: 'ASPIRE-2026-01' },
    sends,
  })
  const dir = buildHarness(fake)
  try {
    const { default: handler } = await import(pathToFileURL(join(dir, 'handler.mjs')).href + '?v=2')
    const res = fakeRes()
    await handler(req, res)
    assert.equal(res.statusCode, 200)
    assert.equal(res.body.summary.already_issued, 1)
    assert.equal(res.body.summary.newly_issued, 0)
    assert.equal(sends.length, 0, 'a settled certificate must never re-notify')
    // Settled rows are skipped before any token is minted.
    assert.equal(fake.state.tokenInserts.length, 0)
    assert.equal(fake.state.rpcCalls.length, 0, 'no RPC call for a fully settled certificate')
  } finally { rmSync(dir, { recursive: true, force: true }); delete globalThis.__FAKE__ }
})

test('the token contract that broke production is asserted directly', async () => {
  const { generateToken, hashToken, isWellFormedRawToken } =
    await import(pathToFileURL(join(repo, 'lib/server/evaluation/tokens.js')).href)
  const t = generateToken()
  // generateToken returns an OBJECT - using it as a string is the bug.
  assert.equal(typeof t, 'object')
  assert.ok(isWellFormedRawToken(t.raw))
  assert.match(t.hash, /^[0-9a-f]{64}$/)
  assert.equal(t.hashPrefix, t.hash.slice(0, 8))
  // Re-hashing the object is exactly what threw in production.
  assert.throws(() => hashToken(t), /must be of type string|Received an instance of Object/)
})

test('the endpoint destructures generateToken and never re-hashes it', () => {
  const src = readFileSync(join(repo, 'api/certificate-preceptor-reconcile.js'), 'utf8')
  assert.match(src, /const \{ raw: rawToken, hash: tokenHash, hashPrefix: tokenHashPrefix \} = generateToken\(\)/)
  assert.ok(!/hashToken\(/.test(src), 'the endpoint must not re-hash an already-hashed token')
  assert.match(src, /token_hash:\s+tokenHash/)
  assert.match(src, /#t=\$\{rawToken\}/)
})
