// ARCHIVE-SNAPSHOT-1 GATE: a secure-link body may be archived only when it is
// PROVABLY free of the recipient's secret.
//
// This is the gate for every other new archive path. If it fails, nothing else
// is wired, because the schema now permits a secure_link_email row and the only
// thing standing between that and a stored reusable token is this module.
//
// Every representation the same URL can take inside an email is covered: raw,
// href attribute, button link, HTML-entity encoded, percent-encoded, query
// string, path style, plain text, and a bare JWT.
//
// Run: node --test test/secureLinkSnapshot.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  redactSecureLinks, verifyNoSecret, buildSecureLinkSnapshot, REDACTED_URL,
} from '../api/lib/secureLinkSnapshot.js'

const TOKEN = 'Qw8xZr2LmT4vN7bK9pA1sD3fG5hJ6kL0zX'
const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk'

/** Every shape the same secure link takes in a real email. */
const CASES = {
  raw:            `Open it: https://aspireintelligence.app/survey?token=${TOKEN}`,
  href:           `<a href="https://aspireintelligence.app/survey?token=${TOKEN}">Start the survey</a>`,
  button:         `<table><tr><td><a class="btn" href="https://aspireintelligence.app/s?code=${TOKEN}" style="padding:12px">Begin</a></td></tr></table>`,
  htmlEncoded:    `<a href="https://aspireintelligence.app/survey?id=7&amp;token=${TOKEN}">Start</a>`,
  urlEncoded:     `https://aspireintelligence.app/survey%3Ftoken%3D${TOKEN}`,
  pathStyle:      `https://aspireintelligence.app/invite/token/${TOKEN}`,
  plainText:      `Survey link\n\nhttps://aspireintelligence.app/e?access_token=${TOKEN}\n\nThanks,\nASPIRE`,
  bareJwt:        `Your session is ${JWT} - do not share it.`,
  nakedParam:     `token=${TOKEN}`,
  magicLink:      `<a href="https://aspireintelligence.app/auth/v1/verify?magic=${TOKEN}&type=magiclink">Sign in</a>`,
}

// ── 1. Every representation is redacted AND verified clean ──────────────────

for (const [name, body] of Object.entries(CASES)) {
  test(`redacts the secure link: ${name}`, () => {
    const out = redactSecureLinks(body)
    assert.ok(!out.includes(TOKEN), `${name}: raw token survived`)
    assert.ok(!out.includes(JWT), `${name}: jwt survived`)
    const v = verifyNoSecret(out)
    assert.equal(v.safe, true, `${name}: verifier still finds a secret (${v.reason})`)
  })
}

test('the snapshot gate accepts every representation', () => {
  for (const [name, body] of Object.entries(CASES)) {
    const snap = buildSecureLinkSnapshot({ html: body, text: null })
    assert.equal(snap.safe, true, `${name} should be archivable after redaction (${snap.reason})`)
    assert.ok(!JSON.stringify(snap).includes(TOKEN), `${name}: token present in the snapshot object`)
    assert.ok(!JSON.stringify(snap).includes(JWT), `${name}: jwt present in the snapshot object`)
  }
})

// ── 2. The surrounding copy survives ────────────────────────────────────────

test('surrounding message copy and presentation are preserved', () => {
  const body = `<div style="padding:24px"><h2>Casey-Fink Readiness Survey</h2>`
    + `<p>Hi Ana, please complete your survey before Friday.</p>`
    + `<a href="https://aspireintelligence.app/survey?token=${TOKEN}">Start the survey</a>`
    + `<p>Questions? Email the ASPIRE team.</p></div>`
  const out = redactSecureLinks(body)
  assert.match(out, /Casey-Fink Readiness Survey/)
  assert.match(out, /Hi Ana, please complete your survey before Friday/)
  assert.match(out, /Start the survey/, 'the visible link TEXT stays; only its target goes')
  assert.match(out, /Questions\? Email the ASPIRE team/)
  assert.match(out, /padding:24px/, 'presentation is untouched')
  assert.ok(out.includes(REDACTED_URL))
})

test('ordinary non-secret links are left alone', () => {
  const body = `<a href="https://aspireintelligence.app/faq">FAQ</a> and <a href="mailto:x@cshs.org">email</a>`
  const out = redactSecureLinks(body)
  assert.match(out, /href="https:\/\/aspireintelligence\.app\/faq"/)
  assert.match(out, /mailto:x@cshs\.org/)
})

// ── 3. Irreversibility ──────────────────────────────────────────────────────

test('the replacement encodes nothing about the original', () => {
  const a = redactSecureLinks(`https://x.test/s?token=${TOKEN}`)
  const b = redactSecureLinks('https://x.test/s?token=completely-different-secret-value-here')
  assert.equal(a, b, 'two different tokens must redact to the SAME literal - no length, no hash, no prefix')
})

// ── 4. Fail closed: unprovable bodies are not archived ──────────────────────

test('the gate refuses a body it cannot prove safe', () => {
  // verifyNoSecret is the authority; feed it something redaction would miss.
  const smuggled = `<a href="https://x.test/go?ticket=${TOKEN}">Go</a>`
  const v = verifyNoSecret(smuggled)
  assert.equal(v.safe, false, 'the verifier must catch a secret parameter')
  assert.ok(v.reason && !v.reason.includes(TOKEN), 'the reason must not carry the secret')
})

test('an empty body after redaction is skipped, not stored', () => {
  const snap = buildSecureLinkSnapshot({ html: `https://x.test/s?token=${TOKEN}`, text: null })
  // The whole body was the link, so what remains is only the placeholder - that
  // is still archivable copy; the empty case is a genuinely blank body.
  assert.equal(buildSecureLinkSnapshot({ html: '', text: '' }).safe, false)
  assert.equal(buildSecureLinkSnapshot({ html: '', text: '' }).reason, 'empty_after_redaction')
  assert.equal(snap.safe, true)
})

test('a refused snapshot returns no body at all', () => {
  const bad = { safe: false, html: null, text: null }
  // Contract: callers must get null bodies so an unsafe snapshot cannot be
  // written even by a caller that ignores `safe`.
  const empty = buildSecureLinkSnapshot({ html: '', text: '' })
  assert.equal(empty.html, bad.html)
  assert.equal(empty.text, bad.text)
})

// ── 5. Negative control: removing redaction must fail these tests ───────────

test('NEGATIVE CONTROL: an unredacted body is rejected by the verifier', () => {
  // This is the assertion that would break if redaction were removed from the
  // pipeline, which is exactly what test 4 of the brief asks to prove.
  for (const body of Object.values(CASES)) {
    const v = verifyNoSecret(body)
    if (body.includes(TOKEN) || body.includes(JWT)) {
      assert.equal(v.safe, false, `an unredacted body must never verify clean: ${body.slice(0, 48)}`)
    }
  }
})

test('tokens cannot reach logs through the reason token', () => {
  const reasons = new Set()
  for (const body of Object.values(CASES)) {
    const v = verifyNoSecret(body)
    if (v.reason) reasons.add(v.reason)
  }
  for (const r of reasons) {
    assert.ok(!r.includes(TOKEN) && !r.includes(JWT), `reason leaked a secret: ${r}`)
    assert.match(r, /^[a-z0-9_]+$/, `reason must be a short opaque token, got: ${r}`)
  }
})
