// ASPIRE-CHART: confirm-gated Send Form workflow (approved semantics).
// Functional tests exercise lib/sendFormFlow.js across open, cancel,
// confirm, failure, and retry paths; source guards prove the compose
// handlers no longer write status and only the confirmation does.
// Run: node --test test/sendFormFlow.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  pendingOutreachStudents, buildSchoolSendPlan, buildStudentSendPlan, resolveSendResults,
} from '../src/lib/sendFormFlow.js'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')

const s = (id, status = 'Pending Outreach', email = `${id}@example.edu`) =>
  ({ id, status, school_email: email, first_name: 'F', last_name: id })

test('plans: only Pending Outreach students are ever affected', () => {
  const roster = [s('a'), s('b', 'Form Sent'), s('c', 'Placed'), s('d')]
  assert.deepEqual(pendingOutreachStudents(roster).map(x => x.id), ['a', 'd'])

  const plan = buildSchoolSendPlan('Example University', roster)
  assert.deepEqual(plan.students.map(x => x.id), ['a', 'd'])
  assert.deepEqual(plan.emails, ['a@example.edu', 'd@example.edu'])
  assert.match(plan.confirmTitle, /Mark 2 students as Form Sent\?/)
  assert.match(plan.confirmBody, /only if the form email to Example University was actually sent/)
  assert.match(plan.confirmBody, /Pending Outreach to Form Sent/)
  assert.match(plan.confirmBody, /Choose Not sent/)

  assert.equal(buildSchoolSendPlan('X', [s('b', 'Form Sent')]), null, 'nothing pending -> no plan')
})

test('single-student plan states exactly what will change', () => {
  const plan = buildStudentSendPlan(s('a'))
  assert.equal(plan.students.length, 1)
  assert.match(plan.confirmTitle, /Mark as Form Sent\?/)
  assert.match(plan.confirmBody, /Pending Outreach to Form Sent/)
  assert.equal(buildStudentSendPlan(null), null)
})

test('confirm: all writes succeed -> done, plan clears', () => {
  const plan = buildSchoolSendPlan('X', [s('a'), s('d')])
  const outcome = resolveSendResults(plan, plan.students.map(st => ({ student: st, error: null })))
  assert.equal(outcome.status, 'done')
  assert.equal(outcome.succeeded.length, 2)
  assert.equal(outcome.failed.length, 0)
})

test('failure + retry: only the failed students stay pending', () => {
  const plan = buildSchoolSendPlan('X', [s('a'), s('d'), s('e')])
  const outcome = resolveSendResults(plan, [
    { student: plan.students[0], error: null },
    { student: plan.students[1], error: { message: 'network' } },
    { student: plan.students[2], error: { message: 'network' } },
  ])
  assert.equal(outcome.status, 'retry')
  assert.deepEqual(outcome.failed.map(x => x.id), ['d', 'e'])
  assert.deepEqual(outcome.plan.students.map(x => x.id), ['d', 'e'], 'retry plan holds exactly the failures')
  assert.match(outcome.plan.confirmTitle, /Retry: mark 2 students/)
  assert.match(outcome.plan.confirmBody, /were not saved/)
  // A successful retry then completes.
  const retry = resolveSendResults(outcome.plan, outcome.plan.students.map(st => ({ student: st, error: null })))
  assert.equal(retry.status, 'done')
})

test('source: opening a draft never writes status; only confirmation does', async (t) => {
  const overview = read('src/components/OverviewTab.jsx')

  await t.test('compose handlers only open the draft and set the pending plan', () => {
    const sendSchool = overview.slice(overview.indexOf('const handleSendSchool'), overview.indexOf('const handleSendStudent'))
    const sendStudent = overview.slice(overview.indexOf('const handleSendStudent'), overview.indexOf('const handleConfirmFormSent'))
    for (const [name, src] of [['handleSendSchool', sendSchool], ['handleSendStudent', sendStudent]]) {
      assert.doesNotMatch(src, /onStudentUpdate/, `${name} must not write`)
      assert.doesNotMatch(src, /Form Sent'/, `${name} must not set status`)
      assert.match(src, /openMailto/, `${name} still opens the compose draft`)
      assert.match(src, /setSendFormPlan/, `${name} arms the confirmation`)
    }
  })

  await t.test('only the confirm handler writes, and cancel writes nothing', () => {
    const confirm = overview.slice(overview.indexOf('const handleConfirmFormSent'), overview.indexOf('const handleCancelFormSent'))
    assert.match(confirm, /onStudentUpdate\(s\.id, \{ status: 'Form Sent' \}\)/)
    assert.match(confirm, /resolveSendResults/)
    const cancelStart = overview.indexOf('const handleCancelFormSent')
    const cancel = overview.slice(cancelStart, cancelStart + 300)
    assert.doesNotMatch(cancel, /onStudentUpdate/)
    assert.match(cancel, /No status was changed/)
  })

  await t.test('the dialog is a real dialog and never claims send detection', () => {
    assert.match(overview, /role="dialog" aria-modal="true"/)
    assert.match(overview, /Mark as sent/)
    assert.match(overview, /Not sent/)
    // The copy asks the human; the app does not pretend to detect Outlook sends.
    const flow = read('src/lib/sendFormFlow.js')
    assert.match(flow, /cannot detect whether Outlook actually sent/)
  })
})
