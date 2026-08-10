// ASPIRE-CHART: the canonical attention engine. Functional tests exercise
// lib/attention.js directly (the same code both the closed bell badge and
// the open Action Center panel consume), and source guards prove neither
// consumer keeps a private predicate copy - the drift the four-copy
// architecture allowed cannot recur.
// Run: node --test test/attentionEngine.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  deriveEagerAttention, deriveLazyAttention, attentionBadgeTotal, fmtLocalDate,
} from '../src/lib/attention.js'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')

const NOW = new Date('2026-07-18T12:00:00')

const student = (id, over = {}) => ({
  id, cohort_id: 'co1', first_name: 'F' + id, last_name: 'L' + id,
  status: 'Form Received', interview_scheduled_date: null,
  matched_unit_id: null, matched_preceptor: '', preceptor_id: null,
  badge_created: false, interview_outcome: 'Pending Interview',
  cs_cedars_status: null, cs_stage1_submitted: false, cs_stage1_complete: false,
  cs_link_requested: false, cs_link_complete: false,
  ...over,
})

test('eager sets: each predicate fires on its exact condition', () => {
  const students = [
    student('a'),                                                            // scheduling link
    student('b', { interview_scheduled_date: fmtLocalDate(NOW), status: 'Interview Scheduled' }), // reminder (today)
    student('c', { status: 'Placed', matched_preceptor: 'P, RN' }),          // preceptor welcome (+ badge + cs-link)
    student('d', { status: 'Placed', matched_unit_id: 'u1' }),               // unit leader notification (+ no preceptor)
    student('e', { status: 'Pending Outreach' }),                            // send form
    student('f', { status: 'Interviewed', interview_outcome: 'Do Not Recommend' }), // selection decision
    student('g', { status: 'Completed' }),                                   // nothing
  ]
  const matches = [{ id: 'm1', student_id: 'd', notification_sent: false }]
  const eager = deriveEagerAttention({
    students, matches, communications: [], activeCohort: { id: 'co1', orientation_sent_at: null },
    canEdit: true, now: NOW,
    // ACTION-OWNERSHIP-1: student b's interview is TODAY, so the cron's send
    // window (yesterday) has passed with nothing delivered. That is a genuine
    // MISSED exception and still a human action.
    reminderDeliveries: [], deliveriesLoaded: true,
  })
  assert.deepEqual(eager.schedulingLink.map(s => s.id), ['a'])
  assert.deepEqual(eager.interviewReminder.map(s => s.id), ['b'])
  assert.deepEqual(eager.preceptorWelcome.map(s => s.id), ['c'])
  assert.deepEqual(eager.sendStudentForm.map(s => s.id), ['e'])
  assert.deepEqual(eager.unitLeaderNotification.map(s => s.id), ['d'])
  assert.deepEqual(eager.selectionDecision.map(s => s.id), ['f'])
  assert.deepEqual(eager.badgeNotCreated.map(s => s.id).sort(), ['c', 'd'])
  assert.deepEqual(eager.noPreceptor.map(s => s.id), ['d'])
  // CS-Link not started uses the canonical whitelist (a, b, c, d, f qualify by status)
  assert.deepEqual(eager.csLinkNotStarted.map(s => s.id).sort(), ['a', 'b', 'c', 'd', 'f'])
  assert.equal(eager.orientationDue, true, 'placed students + no orientation sent')
  assert.equal(
    eager.count,
    1 + 1 + 1 + 1 + 1 + 1 + 2 + 1 + 5 + 1,
    'count equals the sum of every set plus orientation',
  )
})

test('eager sets: sent communications and role gating suppress correctly', () => {
  const students = [
    student('b', { interview_scheduled_date: fmtLocalDate(NOW) }),
    student('c', { status: 'Placed', matched_preceptor: 'P, RN' }),
    student('e', { status: 'Pending Outreach' }),
  ]
  const communications = [
    { student_id: 'b', type: 'interview_reminder' },
    { student_id: 'c', type: 'preceptor_welcome' },
    { student_id: null, type: 'orientation_email' },
  ]
  const eager = deriveEagerAttention({
    students, matches: [], communications, activeCohort: { id: 'co1' }, canEdit: true, now: NOW,
    reminderDeliveries: [], deliveriesLoaded: true,
  })
  assert.equal(eager.interviewReminder.length, 0, 'reminder already sent (manual communications row)')
  assert.equal(eager.preceptorWelcome.length, 0, 'welcome already sent')
  assert.equal(eager.orientationDue, false, 'orientation logged in communications')

  const viewer = deriveEagerAttention({
    students, matches: [], communications: [], activeCohort: { id: 'co1' }, canEdit: false, now: NOW,
    reminderDeliveries: [], deliveriesLoaded: true,
  })
  assert.equal(viewer.sendStudentForm.length, 0, 'canEdit-gated set empty for non-editors')
  assert.equal(viewer.csLinkNotStarted.length, 0)
  assert.equal(viewer.orientationDue, false)
  // Always-visible sets still count for non-editors (matches the panel). The
  // interview is today with no delivery, so it is a MISSED exception.
  assert.equal(viewer.interviewReminder.length, 1)
})

test('lazy sets: loaded-flag gating prevents transient over-counts', () => {
  const students = [student('x', { status: 'Active Rotation' })]
  const notLoaded = deriveLazyAttention({ students, shiftLogsLoaded: false, canEdit: true, now: NOW })
  assert.equal(notLoaded.count, 0, 'no counting before logs load')

  const loaded = deriveLazyAttention({
    students, shiftLogs: [], shiftLogsLoaded: true,
    dispositionLoaded: true, canEdit: true, now: NOW,
  })
  assert.equal(loaded.notLoggedRecently.length, 1)
  assert.equal(loaded.notLoggedRecently[0].daysSince, null, 'no logs yet -> null daysSince')
})

test('retired task: a plain Pending Review shift log is NOT a required action', () => {
  const students = [student('x', { status: 'Active Rotation' })]
  const shiftLogs = [
    { id: 'l1', student_id: 'x', status: 'Pending Review', reviewed_at: null, submitted_at: NOW.toISOString() },
  ]
  const lazy = deriveLazyAttention({
    students, shiftLogs, shiftLogsLoaded: true, dispositionLoaded: true, canEdit: true, now: NOW,
  })
  // The recent log satisfies "logged recently"; nothing else may count it.
  assert.equal(lazy.count, 0, 'submitted logs are informational, not tasks')
})

test('disposition follow-ups: only rows whose disposition is still active', () => {
  const students = [student('x'), student('y')]
  const lazy = deriveLazyAttention({
    students, shiftLogs: [], shiftLogsLoaded: true,
    dispositionFollowups: [
      { id: 'f1', student_id: 'x', disposition_id: 'd-active' },
      { id: 'f2', student_id: 'x', disposition_id: 'd-active' },
      { id: 'f3', student_id: 'y', disposition_id: 'd-cleared' },
    ],
    activeDispositionIds: ['d-active'],
    dispositionLoaded: true, canEdit: true, now: NOW,
  })
  assert.equal(lazy.dispositionFollowup.length, 1, 'grouped per student; orphaned rows skipped')
  assert.equal(lazy.dispositionFollowup[0].followups.length, 2)
  const viewer = deriveLazyAttention({
    students, shiftLogs: [], shiftLogsLoaded: true,
    dispositionFollowups: [{ id: 'f1', student_id: 'x', disposition_id: 'd-active' }],
    activeDispositionIds: ['d-active'], dispositionLoaded: true, canEdit: false, now: NOW,
  })
  assert.equal(viewer.dispositionFollowup.length, 0, 'owner/admin only')
})

test('the badge total adds support exactly once', () => {
  const eager = { count: 3 }
  const lazy = { count: 2 }
  assert.equal(attentionBadgeTotal({ eager, lazy, supportUnreadCount: 4 }), 9)
  assert.equal(attentionBadgeTotal({ eager, lazy }), 5)
  assert.equal(attentionBadgeTotal({}), 0)
})

test('consumers share the engine - no private predicate copies remain', async (t) => {
  const app = read('src/App.jsx')
  const ac = read('src/components/ActionCenter.jsx')

  await t.test('App.jsx derives the closed badge from the module', () => {
    assert.match(app, /import \{ deriveEagerAttention, deriveLazyAttention, attentionBadgeTotal \} from '\.\/lib\/attention'/)
    assert.match(app, /attentionBadgeTotal\(\{ eager: eagerAttention, lazy: lazyAttention, supportUnreadCount \}\)/)
    assert.doesNotMatch(app, /Keep the two in sync/)
    assert.doesNotMatch(app, /eagerActionBadgeCount|lazyActionBadgeCount/)
    assert.doesNotMatch(app, /'Pending Review'/, 'no local shift-review predicate')
  })

  await t.test('ActionCenter derives its items from the module', () => {
    assert.match(ac, /import \{ deriveEagerAttention, deriveLazyAttention \} from '\.\.\/lib\/attention'/)
    assert.match(ac, /const eager = deriveEagerAttention\(/)
    assert.match(ac, /const lazy = deriveLazyAttention\(/)
    // No local re-implementations of the eager filters.
    assert.doesNotMatch(ac, /students\.filter\(s => s\.status === 'Form Received'/)
    assert.doesNotMatch(ac, /getCsLinkStatus\(s\) === 'not_started'/)
  })

  await t.test('the Shift Log Needs Review task is retired', () => {
    // The title may survive in the retirement comment, never as a rendered task.
    assert.doesNotMatch(ac, /title:\s*'Shift Log Needs Review'/)
    assert.doesNotMatch(ac, /const act13\s*=/)
    assert.doesNotMatch(ac, /\.\.\.act13\.map/)
  })

  await t.test('support requests stay out of the Messages unread count', () => {
    const polling = read('src/lib/messages/messagesPolling.js')
    assert.doesNotMatch(polling, /support/i)
  })
})

test('Connect icon honors its badge (approved destination behavior)', () => {
  const ha = read('src/components/Header/HeaderActions.jsx')
  assert.match(ha, /if \(canUseMessages && messagesUnread > 0\) \{\s*\n\s*navigate\('\/connect\/messages'\)/)
  assert.match(ha, /\? \['contacts', 'outreach', 'broadcasts', 'messages'\]/)
  assert.match(ha, /: \['contacts', 'outreach', 'broadcasts'\]/)
  // The bell's accessible name carries the true count.
  assert.match(ha, /Action Center, \$\{actionBadgeCount\} open action/)
})

// ── ACTION-OWNERSHIP-1: automation-owned vs human-owned work ────────────────
//
// The defect: "Send Interview Reminder" was shown as an unresolved manual task
// for work api/cron/interview-reminders.js performs. It was unresolvable, not
// merely noisy - the cron records sends in notification_log while the predicate
// only read communications, so an automated send could never clear the card and
// it outlived the interview itself.
//
// The cron sends at 17:00 UTC on the day BEFORE an interview, and only ever
// targets "tomorrow", so a student it misses is never retried. These tests fix
// `now` and walk one interview through every state.

const IV_DATE = '2026-07-20'                       // interview date under test
const beforeCronRun = new Date('2026-07-19T12:00:00Z') // 19th, before 17:00 UTC
const afterCronRun  = new Date('2026-07-19T21:00:00Z') // 19th, past send + grace
const dayOfIv       = new Date('2026-07-20T15:00:00Z') // interview day
const afterIv       = new Date('2026-07-22T15:00:00Z') // interview has passed

const ivStudent = () => student('r1', {
  interview_scheduled_date: IV_DATE, status: 'Interview Scheduled',
})
const reminderRow = (over = {}) => ({
  student_id: 'r1', notification_type: 'interview_reminder', status: 'sent',
  sent_at: '2026-07-19T17:00:05Z', ...over,
})
// canEdit:false deliberately: it empties every canEdit-gated set (CS-Link,
// badge, preceptor, ...) so `count` isolates the reminder's contribution.
// The reminder set is not role-gated, so it is unaffected.
const derive = (over = {}) => deriveEagerAttention({
  students: [ivStudent()], matches: [], communications: [],
  activeCohort: { id: 'co1' }, canEdit: false,
  reminderDeliveries: [], deliveriesLoaded: true,
  ...over,
})

test('ownership: upcoming interview, reminder not yet due, cron healthy', () => {
  // Two days out: the cron has not reached this interview's send moment.
  const e = derive({ now: new Date('2026-07-18T12:00:00Z') })
  assert.equal(e.interviewReminder.length, 0, 'automation owns it - not a task')
  assert.equal(e.interviewReminderScheduled.length, 1, 'shown as passive status')
  assert.equal(e.interviewReminderScheduled[0].automationState, 'not_due')
})

test('ownership: reminder due and cron scheduled to send', () => {
  const e = derive({ now: beforeCronRun })
  assert.equal(e.interviewReminder.length, 0, 'still automation-owned')
  assert.equal(e.interviewReminderScheduled[0].automationState, 'scheduled')
})

test('ownership: reminder successfully sent by the cron', () => {
  // The exact case the old predicate could not see: delivery recorded in
  // notification_log, nothing in communications.
  const e = derive({ now: dayOfIv, reminderDeliveries: [reminderRow()] })
  assert.equal(e.interviewReminder.length, 0, 'no action remains once sent')
  assert.equal(e.interviewReminderScheduled.length, 0, 'sent is not passive status either')
})

test('ownership: reminder send FAILED - a real human action with fallback', () => {
  const e = derive({ now: dayOfIv, reminderDeliveries: [reminderRow({ status: 'failed' })] })
  assert.equal(e.interviewReminder.length, 1, 'a failed send needs a person')
  assert.equal(e.interviewReminder[0].automationState, 'failed')
})

test('ownership: reminder OVERDUE - window passed with no send, no retry', () => {
  const e = derive({ now: afterCronRun })
  assert.equal(e.interviewReminder.length, 1, 'missed sends need a person')
  assert.equal(e.interviewReminder[0].automationState, 'missed')
  assert.equal(e.interviewReminderScheduled.length, 0)
})

test('ownership: a past interview raises nothing at all', () => {
  // The screenshot defect: completed interviews still read "Reminder not sent."
  const e = derive({ now: afterIv })
  assert.equal(e.interviewReminder.length, 0, 'a past interview needs no reminder')
  assert.equal(e.interviewReminderScheduled.length, 0)
  assert.equal(e.count, 0, 'and contributes nothing to the badge')
})

test('ownership: a legitimate manual resend resolves the item', () => {
  const e = derive({
    now: afterCronRun,
    communications: [{ student_id: 'r1', type: 'interview_reminder' }],
  })
  assert.equal(e.interviewReminder.length, 0, 'manual send clears the exception')
})

test('ownership: automation switched OFF makes it human-owned again', () => {
  const e = derive({ now: beforeCronRun, interviewRemindersEnabled: false })
  assert.equal(e.interviewReminder.length, 1, 'nobody but a person will send it')
  assert.equal(e.interviewReminder[0].automationState, 'disabled')
})

test('ownership: unloaded deliveries never manufacture an action', () => {
  // Mirrors the shiftLogsLoaded gate: missing data must not read as "not sent".
  const e = derive({ now: afterCronRun, deliveriesLoaded: false })
  assert.equal(e.interviewReminder.length, 0, 'no work invented from missing data')
  assert.equal(e.interviewReminderScheduled.length, 0)
  assert.equal(e.count, 0)
})

test('ownership: healthy automation is excluded from the Action Needed count', () => {
  const scheduled = derive({ now: beforeCronRun })
  assert.equal(scheduled.count, 0, 'passive status must not inflate the badge')
  assert.equal(scheduled.interviewReminderScheduled.length, 1, 'but is still visible')

  // Only the exception contributes.
  const missed = derive({ now: afterCronRun })
  assert.equal(missed.count, 1)

  // And the badge total agrees with the panel.
  assert.equal(attentionBadgeTotal({ eager: scheduled, lazy: { count: 0 } }), 0)
  assert.equal(attentionBadgeTotal({ eager: missed, lazy: { count: 0 } }), 1)
})

test('ownership: the sent state comes from notification_log, not communications', () => {
  // Source guard for the root cause. If the engine ever goes back to reading
  // only communications for this task, the cron can never clear it again.
  const engine = read('src/lib/attention.js')
  const code = engine.split('\n').filter(l => !l.trim().startsWith('//')).join('\n')
  assert.match(code, /resolveAutomationState/, 'ownership is resolved, not guessed')
  assert.ok(!/hasSent\(communications, s\.id, 'interview_reminder'\)/.test(code),
    'the communications-only reminder predicate must not return')
  assert.match(code, /reminderDeliveries/, 'notification_log deliveries feed the engine')
})

test('ownership: withdrawn and completed students raise no reminder work', () => {
  // A stale interview date on a student who is no longer proceeding is not a
  // reason to ask the Owner to send anything.
  for (const status of ['Not Proceeding', 'Declined', 'Completed']) {
    const e = deriveEagerAttention({
      students: [student('r1', { interview_scheduled_date: IV_DATE, status })],
      matches: [], communications: [], activeCohort: { id: 'co1' }, canEdit: false,
      reminderDeliveries: [], deliveriesLoaded: true, now: afterCronRun,
    })
    assert.equal(e.interviewReminder.length, 0, `${status} needs no reminder action`)
    assert.equal(e.interviewReminderScheduled.length, 0, `${status} needs no reminder status`)
  }
  // A booked student at any live stage is still covered.
  const live = derive({ now: afterCronRun })
  assert.equal(live.interviewReminder.length, 1)
})

test('audit: interview_reminder is the ONLY cron-owned Action Center task type', () => {
  // The audit this work is built on, pinned so a future automation cannot
  // quietly take over a task the Action Center still presents as manual.
  // Every markDone type in the panel is cross-checked against every type any
  // cron actually sends; the intersection must be exactly interview_reminder.
  const panel = read('src/components/ActionCenter.jsx')
  const panelTypes = new Set(
    [...panel.matchAll(/markDonePayload:\{type:'([a-z_]+)'/g)].map(m => m[1])
  )
  assert.ok(panelTypes.size >= 4, 'sanity: the panel still declares task types')

  const cronDir = join(here, '..', 'api', 'cron')
  const cronSent = new Set()
  for (const f of readdirSync(cronDir)) {
    if (!f.endsWith('.js')) continue
    const src = readFileSync(join(cronDir, f), 'utf8')
    for (const m of src.matchAll(/sendNotification\('([a-z_]+)'/g)) cronSent.add(m[1])
  }
  assert.ok(cronSent.has('interview_reminder'), 'sanity: a cron still sends reminders')

  const overlap = [...panelTypes].filter(t => cronSent.has(t)).sort()
  assert.deepEqual(overlap, ['interview_reminder'],
    `a cron now also sends ${overlap.filter(t => t !== 'interview_reminder').join(', ')} - ` +
    'that task must move onto the ownership model in lib/automationOwnership.js ' +
    'instead of staying a manual Action Center card')
})
