// test/ngrpTransitionCopy.test.mjs
//
// NGRP-TRANSITION-COPY-2: the Transition Form invitation's copy, signature, recipient
// routing, and the optional per-send revise-until date.
//
// Three of these are guards against regressions that would be INVISIBLE from inside the
// app, which is why they are worth pinning rather than eyeballing:
//
//   1. The recipient address. Sending an alumnus a link at a school mailbox that closed
//      when they graduated fails silently: the send reports success, the provider
//      accepts, and nobody learns anything until the student never appears.
//   2. The close date. An email that states a date the form does not enforce locks a
//      student out on a day they were told they still had.
//   3. The cohort name. It is interpolated, never written in; a literal here would
//      survive a cohort rename and mail the wrong one.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { buildTransitionEmail } from '../lib/server/email/ngrpTransitionEmail.js'
// parseFormCloseDate lives beside the close-date logic it coordinates with, not in the
// endpoint: importing the endpoint drags in the token module, which refuses to load
// without EVALUATION_TOKEN_PEPPER. Pure domain logic should be testable without secrets.
import { effectiveFormClose, pacificEndOfDay, parseFormCloseDate } from '../lib/server/ngrpTransition.js'
import { getStudentBulkEmailRoute } from '../src/lib/studentBulkEmail.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(root, p), 'utf8')
// Line comments FIRST: a path ending in a wildcard inside a // comment otherwise opens
// a false block comment and swallows the rest of the file.
const strip = (src) => src.replace(/^\s*\/\/[^\n]*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')

const BUILDER = 'lib/server/email/ngrpTransitionEmail.js'
const SENDER = 'lib/server/ngrpTransition.js'
const ENDPOINT = 'api/ngrp-transition-send.js'
const PANEL = 'src/components/connect/NgrpTransitionSendPanel.jsx'

const render = (over = {}) => buildTransitionEmail({
  student: { first_name: 'Jordan' },
  cycle: { name: 'Winter 2027' },
  url: 'https://aspireintelligence.app/ngrp/transition/#sample',
  closeText: '2026-11-06T07:59:59.999Z',
  ...over,
})

// ── The copy ─────────────────────────────────────────────────────────────────

test('the approved body copy renders', () => {
  const { html } = render()
  for (const phrase of [
    'Congratulations on completing ASPIRE',
    'As an alum',
    'New Graduate RN Residency Program (NGRP) application',
    'This link is personal to you, please do not forward it',
    'It is not an application to the\n      residency program. The ASPIRE team will guide the official application step separately',
    'If you have questions, email',
  ]) {
    assert.ok(html.includes(phrase), `missing: ${phrase}`)
  }
})

test('the superseded phrasings are gone', () => {
  const { html } = render()
  for (const gone of [
    'Congratulations again',        // there is no prior congratulations email
    'completed ASPIRE alumnus',     // gendered, to a mixed cohort
    'NGRP Transition Form</strong> below',
  ]) {
    assert.ok(!html.includes(gone), `still present: ${gone}`)
  }
})

test('the cohort name is interpolated, never written into the template', () => {
  assert.match(render({ cycle: { name: 'Winter 2027' } }).html, /Winter 2027/)
  assert.match(render({ cycle: { name: 'Summer 2028' } }).html, /Summer 2028/)
  assert.match(render({ cycle: {} }).html, /the upcoming residency cohort/)
  // A literal cohort would survive a rename and mail the wrong one.
  assert.doesNotMatch(strip(read(BUILDER)), /\b(January|Winter|Summer|Fall|Spring) 20\d\d\b/)
})

test('the cohort name is escaped, like every other interpolated value', () => {
  const { html } = render({ cycle: { name: '<script>x</script>' } })
  assert.ok(!html.includes('<script>x</script>'))
  assert.ok(html.includes('&lt;script&gt;'))
})

// ── The signature ────────────────────────────────────────────────────────────

test('the handwritten GIF signature, matching every comparable secure-link email', () => {
  const { html } = render()
  assert.match(html, /signature-jester\.gif/)
  assert.match(html, /Kind regards,/)
  assert.match(html, /Jester Lloyd Bautista, PhD, MSN, RN, NPD-BC, CCRN, SCRN/)
  assert.match(html, /Nursing Professional Development Practitioner/)
  assert.match(html, /Geri &amp; Richard Brawerman Nursing Institute/)
  assert.match(html, /Office: 310-248-8964/)
  // The typed-only signature is for the reply-able Messages and portal-feedback mail.
  assert.doesNotMatch(strip(read(BUILDER)), /aspireSystemSignature/)
})

test('one support address, not two: the footer names the same mailbox as the body', () => {
  const { html } = render()
  assert.match(html, /If you have questions, email <a href="mailto:aspire@cshs\.org"/)
  assert.match(html, /For questions, email the ASPIRE team at aspire@cshs\.org/)
  // The default shell footer sends the reader to a different address for the same
  // question; this template overrides it rather than printing both.
  assert.ok(!html.includes('email Jester at jesterlloyd.bautista@cshs.org'))
  // The sender's own address still appears once, in the signature, where it belongs.
  assert.equal(html.split('jesterlloyd.bautista@cshs.org').length - 1, 2, 'mailto href + link text')
})

// ── The button ───────────────────────────────────────────────────────────────

test('the call to action is left aligned, not centered', () => {
  const { html } = render()
  assert.ok(html.includes('style="margin:20px 0;"'))
  assert.ok(!html.includes('margin:20px auto'))
})

// ── The revise-until date ────────────────────────────────────────────────────

test('a blank date means the cohort deadline, exactly as before', () => {
  assert.deepEqual(parseFormCloseDate(undefined), { closeAt: null })
  assert.deepEqual(parseFormCloseDate(null), { closeAt: null })
  assert.deepEqual(parseFormCloseDate(''), { closeAt: null })
})

test('a supplied date resolves to Pacific end of day, the same instant kind as the cohort deadline', () => {
  const { closeAt } = parseFormCloseDate('2026-12-20', '2026-09-01T00:00:00.000Z')
  assert.equal(closeAt, pacificEndOfDay('2026-12-20'))
  // And the email formats that instant back to the SAME calendar date the sender typed,
  // never the UTC rollover date.
  assert.match(render({ closeText: closeAt }).html, /until <strong>December 20, 2026<\/strong>/)
})

test('a malformed or impossible date is refused, never coerced', () => {
  for (const bad of ['20-12-2026', '2026/12/20', 'soon', '2026-13-01', '2026-02-30', 42, {}]) {
    assert.equal(parseFormCloseDate(bad, '2026-09-01T00:00:00.000Z').error, 'invalid_form_close_date', `accepted: ${JSON.stringify(bad)}`)
  }
})

test('a past date is refused rather than clamped: the form would arrive closed', () => {
  const now = '2026-09-01T18:00:00.000Z'
  assert.equal(parseFormCloseDate('2026-08-31', now).error, 'form_close_date_in_past')
  assert.ok(parseFormCloseDate('2026-09-02', now).closeAt)
})

test('the per-send date overrides the cohort deadline for that assignment only', () => {
  const cycle = { application_deadline: '2026-11-05' }
  assert.equal(effectiveFormClose(cycle, null), pacificEndOfDay('2026-11-05'))
  const perSend = pacificEndOfDay('2026-12-20')
  assert.equal(effectiveFormClose(cycle, { deadline_at: perSend }), perSend)
})

test('the date reaches the assignment row, and a failure to write it stops the send', () => {
  const src = read(SENDER)
  assert.match(src, /deadline_at: formCloseAt,/, 'new assignments carry it')
  // A reused assignment adopts it too: the date the sender just chose is the date the
  // email will state, so the form has to enforce the same one.
  assert.match(src, /if \(formCloseAt && assignment\.deadline_at !== formCloseAt\)/)
  // FAIL CLOSED. Sending anyway would promise a date effectiveFormClose does not honor.
  assert.match(src, /return fail\('form_close_write_failed'\)/)
  // And it runs before any token exists, so a refusal costs nothing.
  const s = strip(src)
  assert.ok(s.indexOf("form_close_write_failed") < s.indexOf('const { raw, hash, hashPrefix } = generateToken()'))
})

test('the panel defaults to blank and only sends the field when set', () => {
  const src = read(PANEL)
  assert.match(src, /useState\(''\)/)
  assert.match(src, /\.\.\.\(closeDate \? \{ form_close_date: closeDate \} : \{\}\)/)
  assert.match(src, /Revise submitted forms until/)
  assert.match(src, /form_close_date_in_past: /, 'the refusal is explained, not swallowed')
})

// ── The recipient ────────────────────────────────────────────────────────────

test('alumni are addressed at their personal email, per the shared routing canon', () => {
  const alum = { status: 'Completed', school_email: 'j@school.edu', personal_email: 'j@gmail.com' }
  assert.equal(getStudentBulkEmailRoute(alum).email, 'j@gmail.com')
  assert.equal(getStudentBulkEmailRoute(alum).emailType, 'personal')
  // School remains the fallback when no personal address is on file.
  assert.equal(getStudentBulkEmailRoute({ ...alum, personal_email: '' }).email, 'j@school.edu')
  assert.equal(getStudentBulkEmailRoute({ ...alum, personal_email: '', school_email: '' }).emailType, 'missing')
})

test('the endpoint uses that canon instead of its own ordering', () => {
  const src = strip(read(ENDPOINT))
  assert.match(src, /email: getStudentBulkEmailRoute\(r\)\.email \|\| null,/)
  // The school-first expression this replaced must not come back.
  assert.doesNotMatch(src, /r\.school_email \|\| r\.personal_email/)
  // The request still contributes ids only.
  assert.match(src, /'email' in body \|\| 'to' in body/)
})

test('no em dash in anything this change touched', () => {
  const EM = String.fromCharCode(0x2014)
  for (const f of [BUILDER, SENDER, ENDPOINT, PANEL]) assert.ok(!read(f).includes(EM), `${f} contains an em dash`)
})
