// ALUMNUS-EMAIL-1 (Owner, 2026-11-05): Transition Forms went to school addresses because the
// imported Spring 2026 alumni have no rotation row, so "rotation has ended" was false. Every
// residency send to an alumnus is personal-first now, whatever the rotation dates say.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { ALUMNUS_ROUTE, resolveStudentEmail } from '../src/lib/notifications/studentEmailLifecycle.js'
import { getStudentBulkEmailRoute } from '../src/lib/studentBulkEmail.js'

const alum = { status: 'Completed', school_email: 'a@school.edu', personal_email: 'a@gmail.com', rotation: null }

test('an alumnus with no rotation row is personal-first under ALUMNUS_ROUTE', () => {
  assert.equal(resolveStudentEmail(alum).email, 'a@school.edu') // the general rule is unchanged
  assert.equal(resolveStudentEmail(alum, undefined, ALUMNUS_ROUTE).email, 'a@gmail.com')
  assert.equal(getStudentBulkEmailRoute(alum, ALUMNUS_ROUTE).email, 'a@gmail.com')
  assert.equal(getStudentBulkEmailRoute(alum, ALUMNUS_ROUTE).emailType, 'personal')
})

test('school is only the fallback, and a current student is not affected', () => {
  const noPersonal = { ...alum, personal_email: '' }
  const r = resolveStudentEmail(noPersonal, undefined, ALUMNUS_ROUTE)
  assert.equal(r.email, 'a@school.edu'); assert.equal(r.fallbackUsed, true)
  assert.equal(resolveStudentEmail({ ...alum, status: 'Placed' }, undefined, ALUMNUS_ROUTE).email, 'a@school.edu')
})

test('a hired resident still gets the Cedars-Sinai address first', () => {
  const hired = { ...alum, residency_outcomes: [{ hired_at: '2026-08-14', separated_at: null, cs_email: 'a@cshs.org' }] }
  assert.equal(resolveStudentEmail(hired, undefined, ALUMNUS_ROUTE).email, 'a@cshs.org')
})

test('every Transition Form path routes through ALUMNUS_ROUTE', () => {
  for (const f of ['api/ngrp-transition-send.js', 'api/ngrp-transition.js',
    'lib/server/ngrpTransitionActions.js', 'lib/server/ngrpTransitionReminders.js']) {
    const src = readFileSync(new URL(`../${f}`, import.meta.url), 'utf8')
    const calls = src.match(/(resolveStudentEmail|getStudentBulkEmailRoute)\([^)]*\)/g) || []
    assert.ok(calls.length, f)
    for (const c of calls) assert.match(c, /ALUMNUS_ROUTE/, `${f}: ${c}`)
  }
})
