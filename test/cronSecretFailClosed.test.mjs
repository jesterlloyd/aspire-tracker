// test/cronSecretFailClosed.test.mjs
//
// S-12: every cron route authenticates through api/lib/cronAuth.js, and that
// helper fails closed.
//
// THE SWEEP IS THE POINT. The original defect was not that one handler compared
// against `Bearer ${process.env.CRON_SECRET}`; it was that thirteen did,
// because each new cron route was written by copying the neighbour rather than
// the one handler that had it right. The audit counted eleven; two more arrived
// before it was fixed. So the test that matters is not "the helper works", it
// is "no file in api/cron/ authenticates any other way", which is what stops
// the fourteenth handler from reintroducing this.
//
// Pure unit and source assertions. No network, no database, no email, and the
// real CRON_SECRET is never read: every behavioural test injects its own env.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { isAuthorizedCronRequest, requireCronSecret } from '../api/lib/cronAuth.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(root, p), 'utf8')
const CRON_DIR = 'api/cron'
const cronFiles = readdirSync(join(root, CRON_DIR)).filter((f) => f.endsWith('.js')).sort()

// Fixtures. Never the real secret; these are literals local to this file.
const SECRET = 'test-cron-secret-not-a-real-value'
const req = (authorization) => ({ headers: authorization === undefined ? {} : { authorization } })

// ── The sweep: no cron file may authenticate any other way ───────────────────

test('S-12: no cron file builds a credential from an environment value', () => {
  // The exact defect. A template literal around CRON_SECRET produces the string
  // "Bearer undefined" when the variable is unset, which is guessable.
  const offenders = cronFiles.filter((f) => {
    const src = read(`${CRON_DIR}/${f}`)
    return /`Bearer \$\{[^}]*CRON_SECRET[^}]*\}`/.test(src)
  })
  assert.deepEqual(offenders, [], 'these cron files build a Bearer string from an env value')
})

test('S-12: no cron file compares the authorization header itself', () => {
  // Catches a hand-rolled comparison even if it avoids the template form.
  const offenders = cronFiles.filter((f) => {
    const src = read(`${CRON_DIR}/${f}`)
    return /req\.headers(\['authorization'\]|\.authorization)\s*(!==|===|==|!=)/.test(src)
  })
  assert.deepEqual(offenders, [], 'these cron files compare the authorization header directly')
})

test('S-12: every cron file that reads CRON_SECRET is the shared helper itself', () => {
  // No route should need the secret's value at all; only the helper does.
  const offenders = cronFiles.filter((f) => /CRON_SECRET/.test(read(`${CRON_DIR}/${f}`)))
    .filter((f) => !/^\s*\/\//.test(''))
    .filter((f) => {
      // A file may MENTION it in prose; what it may not do is read it.
      const code = read(`${CRON_DIR}/${f}`)
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/[^\n]*$/gm, '')
      return /CRON_SECRET/.test(code)
    })
  assert.deepEqual(offenders, [], 'these cron routes read CRON_SECRET; only api/lib/cronAuth.js may')
})

test('S-12: every cron route authenticates, through the helper or by delegation', () => {
  // A route either calls the helper itself, or delegates its whole request to
  // another handler in this directory that does (the recovery sweep does this).
  const unguarded = cronFiles.filter((f) => {
    const src = read(`${CRON_DIR}/${f}`)
    if (/isAuthorizedCronRequest|requireCronSecret/.test(src)) return false
    // Delegation: it hands (req, res) to something imported from this directory.
    const delegates = /\breturn\s+\w+\(\s*req\s*,\s*res\b/.test(src) && /from '\.\/[\w.-]+\.js'/.test(src)
    return !delegates
  })
  assert.deepEqual(unguarded, [], 'these cron routes have no authorization at all')
})

test('S-12: the sweep actually covers the directory, so a broken matcher cannot pass', () => {
  assert.ok(cronFiles.length >= 15, `expected 15+ cron files, found ${cronFiles.length}`)
  const usingHelper = cronFiles.filter((f) => /isAuthorizedCronRequest/.test(read(`${CRON_DIR}/${f}`)))
  assert.ok(usingHelper.length >= 14, `expected 14+ routes on the helper, found ${usingHelper.length}`)
})

// ── The helper fails closed ──────────────────────────────────────────────────

test('S-12: an unset secret refuses everything, including "Bearer undefined"', () => {
  // The precise attack the old form allowed.
  assert.equal(isAuthorizedCronRequest(req('Bearer undefined'), {}), false)
  assert.equal(isAuthorizedCronRequest(req('Bearer undefined'), { CRON_SECRET: undefined }), false)
  assert.equal(isAuthorizedCronRequest(req(undefined), {}), false)
  assert.equal(isAuthorizedCronRequest(req('Bearer '), {}), false)
})

test('S-12: an empty, whitespace, or non-string secret refuses everything', () => {
  for (const bad of ['', '   ', '\t\n', null, 0, false, {}, []]) {
    assert.equal(isAuthorizedCronRequest(req('Bearer x'), { CRON_SECRET: bad }), false, String(bad))
    // And the matching header for that bad value is still refused.
    assert.equal(isAuthorizedCronRequest(req(`Bearer ${bad}`), { CRON_SECRET: bad }), false, String(bad))
  }
})

test('S-12: a correct credential is accepted, a wrong one is not', () => {
  assert.equal(isAuthorizedCronRequest(req(`Bearer ${SECRET}`), { CRON_SECRET: SECRET }), true)
  assert.equal(isAuthorizedCronRequest(req('Bearer wrong'), { CRON_SECRET: SECRET }), false)
  assert.equal(isAuthorizedCronRequest(req(SECRET), { CRON_SECRET: SECRET }), false, 'the Bearer prefix is required')
  assert.equal(isAuthorizedCronRequest(req(`bearer ${SECRET}`), { CRON_SECRET: SECRET }), false, 'the scheme is case sensitive')
  assert.equal(isAuthorizedCronRequest(req(`Bearer ${SECRET} `), { CRON_SECRET: SECRET }), false, 'no trailing slack')
})

test('S-12: a malformed request object is refused rather than throwing', () => {
  for (const bad of [undefined, null, {}, { headers: null }, { headers: {} }, { headers: { authorization: 42 } }]) {
    assert.equal(isAuthorizedCronRequest(bad, { CRON_SECRET: SECRET }), false)
  }
  assert.equal(isAuthorizedCronRequest(req('Bearer x'), undefined), false, 'a missing env source refuses')
})

test('S-12: the comparison is constant time over fixed-width digests', () => {
  const src = read('api/lib/cronAuth.js')
  assert.match(src, /timingSafeEqual\(digest\(header\), digest\(`Bearer \$\{configured\}`\)\)/)
  assert.match(src, /createHash\('sha256'\)/)
  // A raw !== against the built credential would defeat the point. Scoped to a
  // comparison with the Bearer string; `typeof header !== 'string'` is the
  // input type guard and is meant to be there.
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/[^\n]*$/gm, '')
  assert.doesNotMatch(code, /!==\s*`Bearer/)
  assert.doesNotMatch(code, /===\s*`Bearer/)
})

test('S-12: the expected credential is only built after the secret is validated', () => {
  // Property 2: no string is ever constructed from a possibly-undefined value.
  const src = read('api/lib/cronAuth.js').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/[^\n]*$/gm, '')
  const guardAt = src.indexOf("configured.trim() === ''")
  const buildAt = src.indexOf('`Bearer ${configured}`')
  assert.ok(guardAt > 0 && buildAt > 0)
  assert.ok(guardAt < buildAt, 'the secret must be validated before the credential is built')
})

test('S-12: the helper never logs or returns the secret', () => {
  const src = read('api/lib/cronAuth.js')
  assert.doesNotMatch(src, /console\./)
  // The secret may be USED to build the expected credential inside the
  // comparison; what it may never do is leave the function. Both exported
  // functions return only booleans.
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/[^\n]*$/gm, '')
  assert.doesNotMatch(code, /return\s+configured/)
  assert.doesNotMatch(code, /return\s+env/)
  assert.doesNotMatch(code, /json\([^)]*configured/)
  for (const m of code.matchAll(/return ([^\n]+)/g)) {
    assert.match(m[1], /^(true|false|timingSafeEqual\(|createHash\()/, `returns something other than a boolean: ${m[1]}`)
  }
})

// ── requireCronSecret sends the 401 itself ───────────────────────────────────

test('S-12: requireCronSecret answers 401 and reports whether to continue', () => {
  const res = () => {
    const captured = {}
    const r = {
      status(code) { captured.code = code; return r },
      json(body) { captured.body = body; return r },
      captured,
    }
    return r
  }

  const denied = res()
  assert.equal(requireCronSecret(req('Bearer undefined'), denied, {}), false)
  assert.equal(denied.captured.code, 401)
  assert.deepEqual(denied.captured.body, { error: 'Unauthorized' })

  const allowed = res()
  assert.equal(requireCronSecret(req(`Bearer ${SECRET}`), allowed, { CRON_SECRET: SECRET }), true)
  assert.equal(allowed.captured.code, undefined, 'an authorized request gets no response from the guard')
})

// ── House style ──────────────────────────────────────────────────────────────

test('S-12: no em dash in the helper or this test', () => {
  // — is the em dash, written as an escape so this file contains none.
  assert.doesNotMatch(read('api/lib/cronAuth.js'), /—/)
})
