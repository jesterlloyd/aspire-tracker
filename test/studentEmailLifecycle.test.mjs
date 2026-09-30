import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveStudentCorrespondenceRecipient as route } from '../src/lib/notifications/studentRecipient.js'
import { getStudentBulkEmailRoute } from '../src/lib/studentBulkEmail.js'
import { classifyStudentEvalCohort } from '../src/lib/evaluation/studentEvalDueDetection.js'
import { visibleStudentContacts, messagingPhone, copyVisibleStudentContacts } from '../src/lib/connect/copyStudentContacts.js'
import { currentResidencyOutcome } from '../src/lib/notifications/residencyEmail.js'

const now = '2026-09-30T12:00:00Z'
const student = { id: 's1', status: 'Completed', school_email: ' School@example.edu ', personal_email: ' Personal@example.com ', rotation: { rotation_end_date: '2026-09-29' } }
const resolve = (s, date = now) => route(s, undefined, { now: date })

test('personal requires both Completed and a valid linked end date strictly before the Pacific day', () => {
  for (const status of ['Pending Outreach', 'Form Sent', 'Form Received', 'Interview Scheduled', 'Interviewed', 'Placed', 'Active Rotation', 'Declined', 'Not Proceeding']) {
    assert.equal(resolve({ ...student, status }).type, 'school', status)
  }
  assert.equal(resolve(student).type, 'personal')
  for (const end of [null, '', '1900-01-01', '2026-02-30', '2026-09-30', '2026-10-01', 'bad']) {
    assert.equal(resolve({ ...student, rotation: { rotation_end_date: end } }).type, 'school', String(end))
  }
  assert.equal(resolve({ ...student, rotation: null, rotation_end_date: '2026-01-01', term_dates: 'Jan 1 - Jan 2, 2026' }).type, 'school')
  assert.equal(resolve(student, '2026-09-30T06:59:59Z').type, 'school', 'still the end date in Pacific')
  assert.equal(resolve(student, '2026-09-30T07:00:00Z').type, 'personal')
  assert.equal(resolve({ ...student, rotation: [{ rotation_end_date: '2026-09-29' }] }).type, 'personal')
})

test('fallback validates both addresses and reports the direction; neither usable yields missing', () => {
  const personalFallback = resolve({ ...student, status: 'Placed', school_email: 'invalid' })
  assert.equal(personalFallback.type, 'personal')
  assert.equal(personalFallback.fallbackUsed, true)
  assert.match(personalFallback.warning, /School email missing or invalid/)
  const schoolFallback = resolve({ ...student, personal_email: '   ' })
  assert.equal(schoolFallback.type, 'school')
  assert.match(schoolFallback.warning, /Personal email missing or invalid/)
  assert.equal(resolve({ ...student, school_email: 'invalid', personal_email: null }).type, 'missing')
  assert.equal(route(student, undefined, { overrideEmail: 'chosen@example.com', now }).email, 'chosen@example.com')
  assert.equal(route(student, undefined, { emailSource: 'school', now }).email, 'School@example.edu')
  assert.equal(route({ ...student, school_email: '' }, undefined, { emailSource: 'school', now }).email, null, 'an explicit source never silently falls back')
})

test('durable hire beats student status, uses Cedars then personal, never school; separation exits the hire rule', () => {
  const hired = { hired_at: '2026-09-20T12:00:00Z', cs_email: ' Resident@cshs.org ', separated_at: null }
  const resident = { ...student, status: 'Active Rotation', residency_outcomes: [hired] }
  assert.equal(resolve(resident).email, 'Resident@cshs.org')
  assert.equal(resolve({ ...resident, residency_outcomes: [{ ...hired, cs_email: 'invalid' }] }).preferredType, 'cedars')
  assert.equal(resolve({ ...resident, residency_outcomes: [{ ...hired, cs_email: null }] }).fallbackUsed, true)
  assert.equal(resolve({ ...resident, personal_email: null, residency_outcomes: [{ ...hired, cs_email: null }] }).email, null)
  assert.equal(resolve({ ...resident, residency_outcomes: [{ ...hired, separated_at: '2026-09-29' }] }).type, 'school')
  assert.equal(resolve({ ...student, status: 'Placed', ngrp_outcome: 'Hired' }).type, 'school', 'legacy label is not employment evidence')
  assert.equal(currentResidencyOutcome([hired, { ...hired, hired_at: '2027-01-01', separated_at: '2027-02-01' }]), null)
})

test('bulk selection, survey detection, and copying agree with correspondence routing', () => {
  const s = { ...student, first_name: 'Test', approved_hours: 100, hours_required: 100 }
  assert.equal(getStudentBulkEmailRoute(s, { now }).email, resolve(s).email)
  const detected = classifyStudentEvalCohort({ students: [s], nowMs: Date.parse(now) }).rows[0]
  assert.equal(detected.studentEmail, resolve(s).email)
  assert.deepEqual(visibleStudentContacts([s], 'email', { now }).values, [resolve(s).email])
})

test('copying uses only supplied filtered students, dedupes case-insensitively, and counts invalid and fallback rows', () => {
  const result = visibleStudentContacts([
    student, { ...student, personal_email: 'personal@EXAMPLE.com' },
    { ...student, personal_email: '', school_email: 'fallback@example.edu' },
    { ...student, personal_email: '', school_email: '' },
  ], 'email', { now })
  assert.deepEqual(result, { values: ['Personal@example.com', 'fallback@example.edu'], skipped: 1, fallbacks: 1, duplicates: 1 })
})

test('phone copying normalizes one number at a time and refuses extensions and concatenated numbers', () => {
  for (const v of ['(310) 555-0123', '310.555.0123', '1 310 555 0123', '+1 310-555-0123']) assert.equal(messagingPhone(v), '+13105550123')
  assert.equal(messagingPhone('+44 20 7946 0958'), '+442079460958')
  for (const v of ['', null, '310-555-0123 ext 12', '3105550123,8185550123', '555-0123', '0000000000', 'call 3105550123']) assert.equal(messagingPhone(v), null)
  assert.deepEqual(visibleStudentContacts([{ phone: '(310) 555-0123' }, { phone: '+13105550123' }, { phone: '' }], 'phone'), {
    values: ['+13105550123'], skipped: 1, duplicates: 1, fallbacks: 0,
  })
})

test('clipboard success, denial, and empty results never report a false success', async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  const notices = [], copied = []
  const toast = Object.fromEntries(['success', 'info', 'error'].map(kind => [kind, (...args) => notices.push([kind, ...args])]))
  try {
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { clipboard: { writeText: async text => copied.push(text) } } })
    await copyVisibleStudentContacts([{ phone: '3105550123' }, { phone: '8185550123' }], 'phone', toast)
    assert.deepEqual(copied, ['+13105550123,+18185550123'])
    assert.equal(notices.at(-1)[0], 'success')
    navigator.clipboard.writeText = async () => { throw new Error('denied') }
    await copyVisibleStudentContacts([student], 'email', toast, { now })
    assert.equal(notices.at(-1)[0], 'error')
    await copyVisibleStudentContacts([], 'email', toast)
    assert.equal(notices.at(-1)[0], 'info')
  } finally {
    if (previous) Object.defineProperty(globalThis, 'navigator', previous)
    else delete globalThis.navigator
  }
})
