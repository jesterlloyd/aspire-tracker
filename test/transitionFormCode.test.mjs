// TRANSITION-FORM-CODE-1 (Owner, 2026-10-29): a forwarded Transition Form link opens nothing
// without a one-time code emailed to the alumnus's own address.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  issueCode, checkCode, issueSession, checkSession, maskEmail, transitionCodeEmail, CODE_WINDOW_MINUTES,
} from '../lib/server/ngrpTransitionCode.js'
import { resolveStudentEmail } from '../src/lib/notifications/studentEmailLifecycle.js'

const KEY = 'test-secret'
const A = '11111111-1111-4111-8111-111111111111'
const H = 'a'.repeat(64)
const T0 = Date.UTC(2026, 9, 29, 20, 0, 30)
const W = CODE_WINDOW_MINUTES * 60 * 1000
const read = f => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8')

test('a code is six digits, works this window and the next, and then dies', () => {
  const code = issueCode(A, H, T0, KEY)
  assert.match(code, /^\d{6}$/)
  assert.equal(checkCode(code, A, H, T0, KEY), true)
  assert.equal(checkCode(code, A, H, T0 + W, KEY), true, 'at least ten minutes')
  assert.equal(checkCode(code, A, H, T0 + 2 * W, KEY), false)
  assert.equal(checkCode(`${code.slice(0, 3)} ${code.slice(3)}`, A, H, T0, KEY), true, 'spaces are ignored')
})

test('a code belongs to one link: another assignment or a reissued link refuses it', () => {
  const code = issueCode(A, H, T0, KEY)
  assert.equal(checkCode(code, '22222222-2222-4222-8222-222222222222', H, T0, KEY), false)
  assert.equal(checkCode(code, A, 'b'.repeat(64), T0, KEY), false)
  assert.equal(checkCode('', A, H, T0, KEY), false)
  assert.equal(checkCode('12345', A, H, T0, KEY), false)
})

test('a session lasts two hours and only for its own link', () => {
  const s = issueSession(A, H, T0, KEY)
  assert.equal(checkSession(s, A, H, T0 + 60_000, KEY), true)
  assert.equal(checkSession(s, A, H, T0 + 121 * 60_000, KEY), false)
  assert.equal(checkSession(s, A, 'b'.repeat(64), T0, KEY), false)
  assert.equal(checkSession(s.replace(/.$/, c => (c === 'A' ? 'B' : 'A')), A, H, T0, KEY), false)
  assert.equal(checkSession(null, A, H, T0, KEY), false)
})

test('the address is masked on screen and the email carries the code', () => {
  assert.equal(maskEmail('jordan.avery@example.com'), 'j••••••@example.com')
  assert.equal(maskEmail('ab@x.com'), 'a•••@x.com')
  assert.equal(maskEmail(''), null)
  const m = transitionCodeEmail({ code: '042517', firstName: 'Jordan' })
  assert.match(m.subject, /042517/)
  assert.match(m.html, /042517/)
  assert.match(m.html, /Hi Jordan/)
})

test('the code goes where the form went: personal once the rotation has ended', () => {
  const student = { status: 'Completed', school_email: 'j@school.edu', personal_email: 'jordan@gmail.com', rotation: { rotation_end_date: '2026-08-07' } }
  assert.equal(resolveStudentEmail(student, undefined, { now: new Date('2026-10-29T12:00:00Z') }).email, 'jordan@gmail.com')
  const api = read('api/ngrp-transition.js')
  assert.match(api, /email: resolveStudentEmail\(r\.data\)\.email/)
  assert.match(read('api/ngrp-transition-send.js'), /getStudentBulkEmailRoute\(r\)\.email/)
})

test('without a session the endpoint shows nothing and changes nothing', () => {
  const api = read('api/ngrp-transition.js')
  const gate = api.indexOf('if (!checkSession(body.session, assignment.id, tokenHash))')
  assert.ok(gate > 0)
  assert.ok(gate < api.indexOf("if (action === 'load') {"), 'the gate comes before load')
  assert.ok(gate < api.indexOf("if (action === 'save_draft') {"))
  assert.ok(gate < api.indexOf("if (action === 'submit') {"))
  assert.match(api, /return res\.status\(401\)\.json\(\{ error: 'verify_required' \}\)/)
  assert.match(api, /return res\.status\(200\)\.json\(\{ state: 'verify', maskedEmail: maskEmail\(routed\.email\), cycleName: cycle\.name \}\)/)
  assert.match(api, /bucketKey\('ngrp_transition_verify_link', tokenHash\)/)
})
