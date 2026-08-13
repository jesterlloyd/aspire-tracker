// STUDENT-BIRTHDAY-GREETING-1: eligibility, timing, idempotency, and privacy.
//
// The eligibility module is pure, so these drive the same code the cron runs.
// The cron handler itself, the template registration, and the Automations card
// are checked structurally where execution would need a live Supabase.
//
// Run: node --test test/birthdayGreetings.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  selectBirthdayRecipients, birthdayFallsOn, withinSendWindow, pacificDateString,
  pacificHour, alreadyGreetedThisYear, studentEmail, ALREADY_SENT_STATUSES,
} from '../src/lib/birthdayEligibility.js'
import { buildBirthdayGreetingEmail, birthdayGreetingText } from '../src/lib/notifications/templates/birthdayGreeting.js'
import { templates } from '../src/lib/notifications/templates/index.js'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')

// 2026-08-13 is a Thursday; 16:00 UTC is 09:00 PDT.
const NINE_AM_PDT = new Date('2026-08-13T16:00:00Z')
const EIGHT_AM_PDT = new Date('2026-08-13T15:00:00Z')

const student = (id, over = {}) => ({
  id, first_name: 'F' + id, last_name: 'L' + id, cohort_id: 'co1',
  status: 'Active Rotation', date_of_birth: '2001-08-13',
  school_email: `${id}@school.test`, personal_email: null, ...over,
})
const sentRow = (id, sent_at, status = 'sent') => ({ student_id: id, status, sent_at })

const run = (students, greetedLog = [], now = NINE_AM_PDT) =>
  selectBirthdayRecipients({ students, greetedLog, now })

// ── 1-4: the core eligibility rule ──────────────────────────────────────────

test('1. birthday today + Active Rotation -> one greeting', () => {
  const r = run([student('a')])
  assert.deepEqual(r.eligible.map(s => s.id), ['a'])
})

test('2. birthday today + completed rotation -> no send', () => {
  const r = run([student('a', { status: 'Completed' })])
  assert.equal(r.eligible.length, 0)
  assert.equal(r.skipped[0].reason, 'not_active_rotation')
})

test('3. birthday today + not proceeding/inactive -> no send', () => {
  for (const status of ['Not Proceeding', 'Declined', 'Placed', 'Interviewed']) {
    const r = run([student('a', { status })])
    assert.equal(r.eligible.length, 0, status)
  }
})

test('4. birthday tomorrow -> no send', () => {
  const r = run([student('a', { date_of_birth: '2001-08-14' })])
  assert.equal(r.eligible.length, 0)
  assert.equal(r.skipped[0].reason, 'not_birthday')
})

// ── 5-6: across all cohorts ─────────────────────────────────────────────────

test('5. a same-birthday student in another cohort is still considered', () => {
  const r = run([student('a', { cohort_id: 'co2' })])
  assert.deepEqual(r.eligible.map(s => s.id), ['a'], 'cohort is never a filter here')
})

test('6. two eligible students in two different cohorts -> both sent', () => {
  const r = run([student('a', { cohort_id: 'co1' }), student('b', { cohort_id: 'co2' })])
  assert.deepEqual(r.eligible.map(s => s.id).sort(), ['a', 'b'])
})

// ── 7-9: idempotency ────────────────────────────────────────────────────────

test('7. already sent this year -> skipped', () => {
  const r = run([student('a')], [sentRow('a', '2026-08-13T16:00:02Z')])
  assert.equal(r.eligible.length, 0)
  assert.equal(r.skipped[0].reason, 'already_sent_this_year')
})

test('7b. a webhook-advanced status still counts as sent', () => {
  for (const status of ALREADY_SENT_STATUSES) {
    const r = run([student('a')], [sentRow('a', '2026-08-13T16:00:02Z', status)])
    assert.equal(r.eligible.length, 0, `${status} must not re-send`)
  }
  // ...but a failed handoff or a queued row stays retryable.
  for (const status of ['failed', 'queued']) {
    const r = run([student('a')], [sentRow('a', '2026-08-13T16:00:02Z', status)])
    assert.equal(r.eligible.length, 1, `${status} must remain retryable`)
  }
})

test('8. a retry the same day sends nothing twice', () => {
  const first = run([student('a')])
  assert.equal(first.eligible.length, 1)
  // The first run logged a send; the 17:00 and 18:00 UTC runs see it.
  const log = [sentRow('a', '2026-08-13T16:00:02Z')]
  for (const later of ['2026-08-13T17:00:00Z', '2026-08-13T18:00:00Z']) {
    assert.equal(run([student('a')], log, new Date(later)).eligible.length, 0, later)
  }
})

test('8b. a FAILED first attempt is retried later the same day, not lost', () => {
  const log = [sentRow('a', '2026-08-13T16:00:02Z', 'failed')]
  const retry = run([student('a')], log, new Date('2026-08-13T17:00:00Z'))
  assert.equal(retry.eligible.length, 1, 'the owed greeting still goes out today')
})

test('9. next calendar year the student is eligible again', () => {
  const log = [sentRow('a', '2026-08-13T16:00:02Z')]
  const nextYear = run([student('a')], log, new Date('2027-08-13T16:00:00Z'))
  assert.equal(nextYear.eligible.length, 1)
})

test('9b. last year\'s greeting does not satisfy this year', () => {
  assert.equal(alreadyGreetedThisYear([sentRow('a', '2025-08-13T16:00:00Z')], 'a', 2026), false)
  assert.equal(alreadyGreetedThisYear([sentRow('a', '2026-08-13T16:00:00Z')], 'a', 2026), true)
})

// ── 10: Feb 29, using ASPIRE's existing annual-recurrence rule ──────────────

test('10. Feb 29 follows the existing annual rule: Feb 28 in a common year', () => {
  const dob = '2000-02-29'
  // 2027 is not a leap year -> the greeting lands on Feb 28.
  assert.equal(birthdayFallsOn(dob, '2027-02-28'), true)
  assert.equal(birthdayFallsOn(dob, '2027-03-01'), false, 'never Mar 1')
  // 2028 IS a leap year -> the real date.
  assert.equal(birthdayFallsOn(dob, '2028-02-29'), true)
  assert.equal(birthdayFallsOn(dob, '2028-02-28'), false, 'no early send in a leap year')
  // ...and a Feb 28 birthday is unaffected in both.
  assert.equal(birthdayFallsOn('2000-02-28', '2027-02-28'), true)
  assert.equal(birthdayFallsOn('2000-02-28', '2028-02-28'), true)
})

test('10b. the rule matches src/lib/aspireEvents.js rather than inventing one', () => {
  const events = read('src/lib/aspireEvents.js')
  assert.match(events, /Feb 29 -> Feb 28 in non-leap years/,
    'the precedent this reuses must still exist')
})

// ── 11: email validity ──────────────────────────────────────────────────────

test('11. missing or invalid email is skipped, not attempted', () => {
  const none = run([student('a', { school_email: null, personal_email: null })])
  assert.equal(none.skipped[0].reason, 'no_email')
  const junk = run([student('a', { school_email: 'not-an-address', personal_email: null })])
  assert.equal(junk.skipped[0].reason, 'no_email')
})

test('11b. school email is preferred, personal is the fallback', () => {
  assert.equal(studentEmail({ school_email: 's@x.test', personal_email: 'p@x.test' }), 's@x.test')
  assert.equal(studentEmail({ school_email: null, personal_email: 'p@x.test' }), 'p@x.test')
})

// ── 12: the DST gate ────────────────────────────────────────────────────────

test('12. the send window is 9:00 AM Pacific in BOTH PDT and PST', () => {
  // PDT (UTC-7): 16:00 UTC is 09:00 local.
  assert.equal(pacificHour(new Date('2026-08-13T16:00:00Z')), 9)
  assert.equal(withinSendWindow(new Date('2026-08-13T16:00:00Z')), true)
  assert.equal(withinSendWindow(new Date('2026-08-13T15:00:00Z')), false, '08:00 PDT is too early')

  // PST (UTC-8): 16:00 UTC is 08:00 local and must NOT send; 17:00 UTC is 09:00.
  assert.equal(pacificHour(new Date('2026-01-15T16:00:00Z')), 8)
  assert.equal(withinSendWindow(new Date('2026-01-15T16:00:00Z')), false)
  assert.equal(pacificHour(new Date('2026-01-15T17:00:00Z')), 9)
  assert.equal(withinSendWindow(new Date('2026-01-15T17:00:00Z')), true)
})

test('12b. "today" is the Pacific calendar date, not the UTC one', () => {
  // 2026-08-14T02:00Z is still Aug 13 in Pacific. A UTC-derived date would roll
  // the birthday over a day early - the off-by-one this codebase warns about.
  assert.equal(pacificDateString(new Date('2026-08-14T02:00:00Z')), '2026-08-13')
  assert.equal(pacificDateString(new Date('2026-08-13T16:00:00Z')), '2026-08-13')
})

test('12c. before the window nothing is selected regardless of eligibility', () => {
  // The cron checks withinSendWindow before it ever queries; this pins the gate.
  assert.equal(withinSendWindow(EIGHT_AM_PDT), false)
  const cron = read('api/cron/student-birthday-greetings.js')
  assert.match(cron, /if \(!withinSendWindow\(now\)\)/)
  assert.match(cron, /before_send_window/)
})

// ── 14: no DOB or age leakage ───────────────────────────────────────────────

test('14. the email carries no age, no birth date, and no year', () => {
  const email = buildBirthdayGreetingEmail({ firstName: 'Ana' })
  const all = `${email.subject} ${email.preheader} ${email.html} ${email.text}`
  assert.match(all, /Happy Birthday, Ana/)
  assert.doesNotMatch(all, /\b(19|20)\d{2}\b/, 'no year anywhere')
  assert.doesNotMatch(all, /\bage\b|\byears old\b|\bturning\b/i)
  assert.doesNotMatch(all, /date of birth|birthday is|born/i)
})

test('14b. the first name is HTML-escaped', () => {
  const email = buildBirthdayGreetingEmail({ firstName: '<script>x</script>' })
  assert.doesNotMatch(email.html, /<script>/)
  assert.match(email.html, /&lt;script&gt;/)
})

test('14c. a missing first name degrades politely', () => {
  assert.match(buildBirthdayGreetingEmail({}).html, /Happy Birthday, there/)
  assert.match(birthdayGreetingText(''), /Happy Birthday, there/)
})

test('14d. the cron never puts a date of birth into the notification context', () => {
  const cron = read('api/cron/student-birthday-greetings.js')
  const call = cron.slice(cron.indexOf('sendNotification(NOTIFICATION_TYPE'), cron.indexOf('sent.push'))
  assert.doesNotMatch(call, /date_of_birth|dateOfBirth|dob/i,
    'DOB must not reach the template or notification_log metadata')
  // ...and the run summary counts only, never a date.
  const summary = cron.slice(cron.indexOf('const summary'), cron.indexOf('console.log(`[birthday-greetings] SUMMARY'))
  assert.doesNotMatch(summary, /date_of_birth|dateOfBirth/i)
})

test('14e. the eligibility module returns no derived birthday value', () => {
  const r = run([student('a')])
  const keys = Object.keys(r.eligible[0])
  // date_of_birth passes through on the student row the caller already had, but
  // nothing NEW is derived from it - no age, no birth year, no formatted date.
  assert.ok(!keys.some(k => /age|birth_year|turning/i.test(k)), keys.join(','))
})

// ── 15 + registration ───────────────────────────────────────────────────────

test('15. a disabled automation sends nothing', () => {
  const cron = read('api/cron/student-birthday-greetings.js')
  const gateAt = cron.indexOf('isAutomationEnabled')
  const queryAt = cron.indexOf("from('students')")
  assert.ok(gateAt > -1 && gateAt < queryAt, 'the enable gate precedes any work')
  assert.match(cron, /automation_disabled/)
})

test('the notification type is registered end to end', () => {
  assert.ok(templates.birthday_greeting, 'template registered')
  assert.equal(typeof templates.birthday_greeting.student, 'function')
  const recipients = read('src/lib/notifications/recipients.js')
  assert.match(recipients, /case 'birthday_greeting':/, 'recipient resolver registered')
})

test('the automation is registered for scheduling and monitoring', () => {
  const vercel = JSON.parse(read('vercel.json'))
  const cron = vercel.crons.find(c => c.path === '/api/cron/student-birthday-greetings')
  assert.ok(cron, 'scheduled')
  assert.equal(cron.schedule, '0 16,17,18 * * *',
    'three UTC hours so one of them is 9:00 AM Pacific in both PST and PDT')
  // Existing schedules are untouched.
  assert.equal(vercel.crons.find(c => c.path === '/api/cron/interview-reminders').schedule, '0 17 * * *')

  const view = read('src/components/connect/AutomationView.jsx')
  assert.match(view, /id: 'student_birthday_greetings'/, 'appears in Connect > Automations')
  assert.match(view, /cron_name: 'student-birthday-greetings'/, 'health joins on the cron name')
  assert.match(view, /automation_key: 'student_birthday_greetings'/, 'enable toggle wired')
  assert.match(view, /scope: 'All cohorts'/)
})

test('it reuses the shared cron/notification infrastructure', () => {
  const cron = read('api/cron/student-birthday-greetings.js')
  assert.match(cron, /from '\.\.\/lib\/cronRuns\.js'/, 'run health via the shared helper')
  assert.match(cron, /from '\.\.\/lib\/automationSettings\.js'/, 'enable gate via the shared helper')
  assert.match(cron, /from '\.\.\/\.\.\/src\/lib\/notifications\/index\.js'/, 'sending via sendNotification')
  assert.doesNotMatch(cron, /new Resend\(|resend\.emails\.send/, 'no parallel mail path')
  assert.doesNotMatch(cron, /createSignedUrl|\.insert\(/, 'the cron writes no rows of its own')
})

test('eligibility uses the existing Active Rotation definition, not a new one', () => {
  const midpoint = read('api/cron/midpoint-checkin.js')
  assert.match(midpoint, /\.eq\('status', 'Active Rotation'\)/,
    'the house rule this reuses must still exist')
  const cron = read('api/cron/student-birthday-greetings.js')
  assert.match(cron, /ACTIVE_ROTATION_STATUS/)
  // No second, stricter window check was invented alongside it.
  assert.doesNotMatch(cron, /rotation_start_date|rotation_end_date/)
})
