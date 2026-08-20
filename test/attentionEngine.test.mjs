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
  lastCompletedWeek, weekDates, isCountableShift,
} from '../src/lib/attention.js'
import {
  CONFIRMED_TYPE, CONFIRMED_STATUS, NOTIFICATION_TARGETS, NOTIFY_META,
} from '../src/lib/placementNotificationState.js'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')

const NOW = new Date('2026-07-18T12:00:00') // a Saturday; last completed week = Jul 5-11

// A rotation window comfortably enclosing the July fixture weeks, keyed to the
// default student school (student() sets none, so school_name matches undefined
// via ROT_OPEN.school_name = undefined -> use explicit school on both sides).
const ROT_OPEN = { school_name: 'CSUN', rotation_start_date: '2026-06-01', rotation_end_date: '2026-09-01', blackout_dates: [] }

const student = (id, over = {}) => ({
  id, cohort_id: 'co1', first_name: 'F' + id, last_name: 'L' + id, school: 'CSUN',
  status: 'Form Received', interview_scheduled_date: null,
  matched_unit_id: null, matched_preceptor: '', preceptor_id: null,
  badge_created: false, interview_outcome: 'Pending Interview',
  cs_cedars_status: null, cs_stage1_submitted: false, cs_stage1_complete: false,
  cs_link_requested: false, cs_link_complete: false,
  ...over,
})

test('unit-leader notification reads the PRIMARY unit\'s match, not the first by student', () => {
  // A multi-unit student: the OTHER placement's match is already notified, the
  // primary's is not. Ordering the notified row first would have satisfied the
  // old first-match-by-student lookup and silently hidden the task.
  const students = [student('k', { status: 'Placed', matched_unit_id: 'u-primary' })]
  const matches = [
    { id: 'm-other',   student_id: 'k', unit_id: 'u-other',   notification_sent: true },
    { id: 'm-primary', student_id: 'k', unit_id: 'u-primary', notification_sent: false },
  ]
  const eager = deriveEagerAttention({
    students, matches, communications: [], activeCohort: { id: 'co1', orientation_sent_at: null },
    canEdit: true, now: NOW, reminderDeliveries: [], deliveriesLoaded: true,
  })
  assert.deepEqual(eager.unitLeaderNotification.map(s => s.id), ['k'],
    'the task derives from the primary unit\'s own match row')
  // NEGATIVE CONTROL: once the PRIMARY match is notified, the task clears even
  // though an unnotified match exists on the other placement.
  const flipped = matches.map(m => ({ ...m, notification_sent: m.id === 'm-primary' }))
  const eager2 = deriveEagerAttention({
    students, matches: flipped, communications: [], activeCohort: { id: 'co1', orientation_sent_at: null },
    canEdit: true, now: NOW, reminderDeliveries: [], deliveriesLoaded: true,
  })
  assert.deepEqual(eager2.unitLeaderNotification, [])
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
  // UNIT-POOL-REFINEMENT-1: the predicate reads the match for the student's
  // PRIMARY unit (a multi-unit student's first match by student alone could be
  // another placement), so the fixture carries the unit_id a real row has.
  const matches = [
    { id: 'mc', student_id: 'c', unit_id: 'uc', preceptor_id: 'pc', preceptor_assigned: 'P, RN' },
    { id: 'm1', student_id: 'd', unit_id: 'u1', notification_sent: false },
  ]
  const eager = deriveEagerAttention({
    students, matches, communications: [], activeCohort: { id: 'co1', orientation_sent_at: null },
    canEdit: true, now: NOW,
    // ACTION-OWNERSHIP-1: student b's interview is TODAY, so the cron's send
    // window (yesterday) has passed with nothing delivered. That is a genuine
    // MISSED exception and still a human action.
    reminderDeliveries: [], deliveriesLoaded: true,
    placementNotifications: [], placementNotificationsLoaded: true,
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
    placementNotifications: [], placementNotificationsLoaded: true,
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

test('preceptor reminders use the same placement confirmation as Unit Pool', () => {
  const placed = student('p', {
    status: 'Placed', matched_unit_id: 'unit-a', matched_preceptor: 'Pat Preceptor', preceptor_id: 'prec-a',
  })
  const matches = [{
    id: 'match-a', student_id: 'p', unit_id: 'unit-a',
    preceptor_id: 'prec-a', preceptor_assigned: 'Pat Preceptor',
  }]
  const confirmed = [{
    id: 'notify-a', notification_type: CONFIRMED_TYPE, status: CONFIRMED_STATUS,
    sent_at: '2026-07-17T12:00:00.000Z',
    metadata: {
      [NOTIFY_META.target]: NOTIFICATION_TARGETS.PRECEPTOR,
      [NOTIFY_META.match]: 'match-a',
      [NOTIFY_META.student]: 'p',
      [NOTIFY_META.unit]: 'unit-a',
      [NOTIFY_META.preceptor]: 'prec-a',
      [NOTIFY_META.cohort]: 'co1',
    },
  }]

  const pending = deriveEagerAttention({
    students: [placed], matches, communications: [], activeCohort: { id: 'co1' }, canEdit: true,
    reminderDeliveries: [], deliveriesLoaded: true, now: NOW,
    placementNotifications: [], placementNotificationsLoaded: true,
  })
  assert.deepEqual(pending.preceptorWelcome.map(s => s.attentionMatchId), ['match-a'])

  const done = deriveEagerAttention({
    students: [placed], matches, communications: [], activeCohort: { id: 'co1' }, canEdit: true,
    reminderDeliveries: [], deliveriesLoaded: true, now: NOW,
    placementNotifications: confirmed, placementNotificationsLoaded: true,
  })
  assert.equal(done.preceptorWelcome.length, 0,
    'a Unit Pool Preceptor Notified confirmation retires the Action Center reminder')
  assert.equal(done.count, pending.count - 1, 'the closed bell count loses the same completed task')

  const loading = deriveEagerAttention({
    students: [placed], matches, communications: [], activeCohort: { id: 'co1' }, canEdit: true,
    reminderDeliveries: [], deliveriesLoaded: true, now: NOW,
    placementNotifications: [], placementNotificationsLoaded: false,
  })
  assert.equal(loading.preceptorWelcome.length, 0,
    'an unloaded ledger must not create a false reminder flash')
})

test('preceptor reminders stay placement-specific for multi-unit students', () => {
  const placed = student('multi', { status: 'Placed', matched_preceptor: 'Legacy Primary' })
  const matches = [
    { id: 'match-a', student_id: 'multi', unit_id: 'unit-a', preceptor_id: 'prec-a', preceptor_assigned: 'Pat A' },
    { id: 'match-b', student_id: 'multi', unit_id: 'unit-b', preceptor_id: 'prec-b', preceptor_assigned: 'Pat B' },
  ]
  const rows = [{
    id: 'notify-a', notification_type: CONFIRMED_TYPE, status: CONFIRMED_STATUS,
    sent_at: '2026-07-17T12:00:00.000Z',
    metadata: {
      [NOTIFY_META.target]: NOTIFICATION_TARGETS.PRECEPTOR,
      [NOTIFY_META.match]: 'match-a',
      [NOTIFY_META.preceptor]: 'prec-a',
    },
  }]
  const eager = deriveEagerAttention({
    students: [placed], matches, communications: [], activeCohort: { id: 'co1' }, canEdit: true,
    reminderDeliveries: [], deliveriesLoaded: true, now: NOW,
    placementNotifications: rows, placementNotificationsLoaded: true,
  })
  assert.deepEqual(eager.preceptorWelcome.map(s => s.attentionMatchId), ['match-b'],
    'confirming one placement must not hide a different unit preceptor')
})

test('lazy sets: loaded-flag gating prevents transient over-counts', () => {
  const students = [student('x', { status: 'Active Rotation' })]
  const notLoaded = deriveLazyAttention({ students, shiftLogsLoaded: false, canEdit: true, now: NOW })
  assert.equal(notLoaded.count, 0, 'no counting before logs load')

  // Loaded but empty, with a KNOWN rotation window that began before the
  // missed week: a student with zero shifts across a full in-rotation week
  // is exactly who the weekly rule exists to surface.
  const loaded = deriveLazyAttention({
    students, shiftLogs: [], shiftLogsLoaded: true,
    schoolRotations: [ROT_OPEN],
    dispositionLoaded: true, canEdit: true, now: NOW,
  })
  assert.equal(loaded.noShiftLastWeek.length, 1)
  assert.equal(loaded.noShiftLastWeek[0].lastShiftDay, null, 'no logs yet -> no last-shift day')
  assert.deepEqual(loaded.noShiftLastWeek[0].missedWeek, { start: '2026-07-05', end: '2026-07-11' })
})

test('retired task: a plain Pending Review shift log is NOT a required action', () => {
  const students = [student('x', { status: 'Active Rotation' })]
  const shiftLogs = [
    { id: 'l1', student_id: 'x', status: 'Pending Review', reviewed_at: null, submitted_at: NOW.toISOString(), shift_date: '2026-07-08' },
  ]
  const lazy = deriveLazyAttention({
    students, shiftLogs, shiftLogsLoaded: true, schoolRotations: [ROT_OPEN],
    dispositionLoaded: true, canEdit: true, now: NOW,
  })
  // The in-week log satisfies the weekly rule; nothing else may count it.
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
// ACTION-OWNERSHIP-2: these tests walk an AUTOMATION-OWNED reminder through its
// lifecycle, so the fixture must be one the cron can actually see: an
// interview_sessions row carrying a slot whose slot_date is the interview.
// (The cron never reads students.interview_scheduled_date. A staff-typed
// interview with no slot is a different case entirely and is covered in
// test/interviewReminderOwnership.test.mjs.)
const ivSessions = [{ id: 'sess-r1', student_id: 'r1', slot_id: 'slot-r1', cohort_id: 'co1' }]
const ivSlots    = [{ id: 'slot-r1', slot_date: IV_DATE, cohort_id: 'co1' }]
// canEdit:false deliberately: it empties every canEdit-gated set (CS-Link,
// badge, preceptor, ...) so `count` isolates the reminder's contribution.
// The reminder set is not role-gated, so it is unaffected.
const derive = (over = {}) => deriveEagerAttention({
  students: [ivStudent()], matches: [], communications: [],
  activeCohort: { id: 'co1' }, canEdit: false,
  reminderDeliveries: [], deliveriesLoaded: true,
  ivSessions, ivSlots,
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
  assert.ok(panelTypes.size >= 3, 'sanity: the panel still declares task types')

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

test('no literal escape sequences leak into Action Center JSX text', () => {
  // Shipped and caught in production QC: `·` written as JSX TEXT renders
  // as the six characters rather than a middot. Inside a JS string literal the
  // same sequence is fine, which is why it survived review - so this checks
  // text positions only: after a `}` or `>`, before a `{` or `<`.
  const src = read('src/components/ActionCenter.jsx')
  const offenders = []
  for (const line of src.split('\n')) {
    if (!/\\u[0-9a-fA-F]{4}/.test(line)) continue
    // Strip quoted strings, where an escape is legitimate.
    const unquoted = line.replace(/'[^']*'/g, "''").replace(/"[^"]*"/g, '""').replace(/`[^`]*`/g, '``')
    if (/\\u[0-9a-fA-F]{4}/.test(unquoted)) offenders.push(line.trim().slice(0, 110))
  }
  assert.deepEqual(offenders, [],
    'escape sequences in JSX text render literally; use the character itself')
})

// ── NO-SHIFT-WEEK-1: the missed-week canon ──────────────────────────────────
//
// The rule is a completed Sunday-Saturday calendar week with zero valid
// shifts, judged by shift_date - never a rolling days-since threshold and
// never submitted_at. 2026-08-02 is a Sunday; 2026-08-16 is the Sunday after
// the Aug 9-15 week closes.

const rotOpen = (over = {}) => ({ school_name: 'CSUN', rotation_start_date: '2026-06-01', rotation_end_date: '2026-09-01', blackout_dates: [], ...over })
const activeStudent = (over = {}) => student('w1', { status: 'Active Rotation', ...over })
const shiftOn = (date, over = {}) => ({ id: `sh-${date}`, student_id: 'w1', status: 'Approved', shift_date: date, submitted_at: `${date}T20:00:00Z`, lifecycle_state: 'completed', ...over })
const weekly = ({ now, logs = [], rots = [rotOpen()], stu = activeStudent() }) => deriveLazyAttention({
  students: [stu], shiftLogs: logs, shiftLogsLoaded: true, schoolRotations: rots,
  dispositionLoaded: true, canEdit: true, now,
}).noShiftLastWeek

test('weekly: Sunday last shift flags only once the following week closes', () => {
  const logs = [shiftOn('2026-08-02')] // Sunday
  // Saturday Aug 15: the Aug 9-15 week has not closed; the last completed
  // week (Aug 2-8) contains the Sunday shift. Not flagged.
  assert.equal(weekly({ now: new Date('2026-08-15T12:00:00'), logs }).length, 0)
  // Sunday Aug 16: Aug 9-15 is now the completed week and it is empty.
  const flagged = weekly({ now: new Date('2026-08-16T09:00:00'), logs })
  assert.equal(flagged.length, 1)
  assert.deepEqual(flagged[0].missedWeek, { start: '2026-08-09', end: '2026-08-15' })
  assert.equal(flagged[0].lastShiftDay, '2026-08-02')
})

test('weekly: Saturday last shift produces a different elapsed count, same rule', () => {
  // Last shift Saturday Aug 8 - only 8 elapsed days by Aug 16, yet the Aug
  // 9-15 week is empty, so it flags. The missing WEEK is the canon, not any
  // encoded day count.
  const logs = [shiftOn('2026-08-08')]
  assert.equal(weekly({ now: new Date('2026-08-16T09:00:00'), logs }).length, 1)
})

test('weekly: a midweek shift covers its week', () => {
  const logs = [shiftOn('2026-08-12')] // Wednesday of the Aug 9-15 week
  assert.equal(weekly({ now: new Date('2026-08-16T09:00:00'), logs }).length, 0)
})

test('weekly: a late past-shift entry fills the week it happened in', () => {
  // Logged through "Log a Past Shift" days later: shift_date sits in the
  // missed week even though submitted_at is after it. The old rule read
  // submitted_at and got this backwards in both directions.
  const logs = [shiftOn('2026-08-11', { submitted_at: '2026-08-18T22:00:00Z' })]
  assert.equal(weekly({ now: new Date('2026-08-20T09:00:00'), logs }).length, 0)
})

test('weekly: resumed logging clears the stale miss', () => {
  // Missed Aug 9-15 entirely but logged Tue Aug 18. The student is back;
  // surfacing last week would be outreach with nothing to act on.
  const logs = [shiftOn('2026-08-02'), shiftOn('2026-08-18')]
  assert.equal(weekly({ now: new Date('2026-08-20T09:00:00'), logs }).length, 0)
})

test('weekly: terminal statuses never flag, whatever the history says', () => {
  for (const status of ['Completed', 'Not Proceeding', 'Declined']) {
    const flagged = weekly({ now: new Date('2026-08-16T09:00:00'), logs: [], stu: activeStudent({ status }) })
    assert.equal(flagged.length, 0, `${status} is not expected to log shifts`)
  }
})

test('weekly: partial first and last rotation weeks never flag', () => {
  // Rotation starts Wednesday inside the Aug 9-15 week: not a full week owed.
  assert.equal(weekly({ now: new Date('2026-08-16T09:00:00'), rots: [rotOpen({ rotation_start_date: '2026-08-12' })] }).length, 0)
  // Rotation ended Thursday inside the week: the student was finishing, not absent.
  assert.equal(weekly({ now: new Date('2026-08-16T09:00:00'), rots: [rotOpen({ rotation_end_date: '2026-08-13' })] }).length, 0)
  // A week fully inside the window still flags.
  assert.equal(weekly({ now: new Date('2026-08-16T09:00:00'), rots: [rotOpen()] }).length, 1)
})

test('weekly: no shifts yet - known window flags, unknown window stays silent', () => {
  const now = new Date('2026-08-16T09:00:00')
  // Known window that began before the missed week: a zero-shift week is real.
  assert.equal(weekly({ now, logs: [] }).length, 1)
  // Sentinel window ("pending admin review") and no history: indistinguishable
  // from "has not started yet", so no flag is invented.
  assert.equal(weekly({ now, logs: [], rots: [rotOpen({ rotation_start_date: '1900-01-01', rotation_end_date: '1900-01-01' })] }).length, 0)
  // No rotation row at all, but prior shifts prove the rotation is underway.
  assert.equal(weekly({ now, logs: [shiftOn('2026-08-02')], rots: [] }).length, 1)
  // No rotation row and no history: silent.
  assert.equal(weekly({ now, logs: [], rots: [] }).length, 0)
})

test('weekly: rejected shifts cannot fill a week; unexpected lifecycles are ignored', () => {
  const now = new Date('2026-08-16T09:00:00')
  const rejected = [shiftOn('2026-08-11', { status: 'Rejected' })]
  assert.equal(weekly({ now, logs: rejected }).length, 1, 'a rejected log is not a valid shift')
  const weird = [shiftOn('2026-08-11', { lifecycle_state: 'discarded' })]
  assert.equal(weekly({ now, logs: weird }).length, 1, 'unknown lifecycle states are excluded defensively')
  const inProgress = [shiftOn('2026-08-11', { lifecycle_state: 'in_progress' })]
  assert.equal(weekly({ now, logs: inProgress }).length, 0, 'an open shift is still a real shift')
})

test('weekly: a fully blacked-out week is an approved break, not a miss', () => {
  const now = new Date('2026-08-16T09:00:00')
  const allWeek = ['2026-08-09','2026-08-10','2026-08-11','2026-08-12','2026-08-13','2026-08-14','2026-08-15']
  assert.equal(weekly({ now, rots: [rotOpen({ blackout_dates: allWeek })] }).length, 0)
  // A partial blackout does not excuse the whole week.
  assert.equal(weekly({ now, rots: [rotOpen({ blackout_dates: allWeek.slice(0, 3) })] }).length, 1)
  // Personal + school blackouts combine to cover the week.
  const flagged = weekly({
    now,
    rots: [rotOpen({ blackout_dates: allWeek.slice(0, 4) })],
    stu: activeStudent({ personal_blackout_dates: allWeek.slice(4) }),
  })
  assert.equal(flagged.length, 0)
})

test('weekly: the completed-week helper is Sunday-Saturday in local time', () => {
  // Sunday: the week that ended yesterday.
  assert.deepEqual(lastCompletedWeek(new Date('2026-08-16T00:30:00')), { start: '2026-08-09', end: '2026-08-15' })
  // Saturday: the current week has not closed; last completed ended a week ago.
  assert.deepEqual(lastCompletedWeek(new Date('2026-08-15T23:00:00')), { start: '2026-08-02', end: '2026-08-08' })
  assert.equal(weekDates({ start: '2026-08-09', end: '2026-08-15' }).length, 7)
  assert.ok(isCountableShift({ status: 'Pending Review' }))
})

test('weekly: the card and navigation follow the canon', () => {
  const panel = read('src/components/ActionCenter.jsx')
  assert.match(panel, /title:'No Shift Logged Last Week'/)
  assert.ok(!/Student Not Logged Recently/.test(panel), 'the vague title is retired')
  assert.match(panel, /actionType === 'no_shift_last_week'\) return 'View Rotation Activity'/)
  assert.match(panel, /onNavigateToActivityStudent\?\.\(item\.studentId\)/)
  const app = read('src/App.jsx')
  assert.match(app, /onNavigateToActivityStudent=\{id => \{ goToActivityStudent\(id\); setShowActionCenter\(false\) \}\}/)
  // The badge fetch now reads the day the shift HAPPENED, not just when it was entered.
  assert.match(app, /select\('student_id, status, reviewed_at, submitted_at, shift_date, lifecycle_state'\)/)
  assert.match(app, /from\('cohort_school_rotations'\)/)
})

// ── HOURS-COMPLETE-1: monitoring stops when the hours are done ───────────────
//
// Production 2026-08-10 showed five students carrying the green "Complete"
// badge in Rotation Activity (132/132, 108/108) while the Action Center still
// asked why they had not logged last week. Their administrative status was
// still 'Active Rotation', which is normal - it is the HOURS that say they are
// finished. The guard consumes hasCompletedRequiredHours, the same
// determination behind that badge, rather than a second formula.

const hoursStudent = (approved, required) => student('h1', {
  status: 'Active Rotation', approved_hours: approved, hours_required: required,
})
// A completed week with nothing logged, so only the hours guard can suppress.
const missedWeekFor = (stu) => deriveLazyAttention({
  students: [stu], shiftLogs: [], shiftLogsLoaded: true,
  schoolRotations: [rotOpen()], dispositionLoaded: true, canEdit: true,
  now: new Date('2026-08-16T09:00:00'),
})

test('hours: the exact production cases stop being monitored', () => {
  // Curd / Fuerte / De Leon / Tcheumani
  assert.equal(missedWeekFor(hoursStudent(132, 132)).noShiftLastWeek.length, 0, '132/132 is finished')
  // Peralta-Topete
  assert.equal(missedWeekFor(hoursStudent(108, 108)).noShiftLastWeek.length, 0, '108/108 is finished')
  // Mason - the contrasting case that must keep its item
  assert.equal(missedWeekFor(hoursStudent(96, 132)).noShiftLastWeek.length, 1, '96/132 still owes hours')
})

test('hours: the boundary is exact, and overage still suppresses', () => {
  assert.equal(missedWeekFor(hoursStudent(71, 72)).noShiftLastWeek.length, 1, 'one hour short is still monitored')
  assert.equal(missedWeekFor(hoursStudent(72, 72)).noShiftLastWeek.length, 0, 'exactly met is complete')
  assert.equal(missedWeekFor(hoursStudent(80, 72)).noShiftLastWeek.length, 0, 'over the requirement is complete')
})

test('hours: an unknown requirement never counts as completion', () => {
  // 0 / null / missing hours_required means the requirement is unknown, not
  // met. Suppression has to be earned by real data.
  assert.equal(missedWeekFor(hoursStudent(0, 0)).noShiftLastWeek.length, 1, 'zero required is unknown, not done')
  assert.equal(missedWeekFor(hoursStudent(12, null)).noShiftLastWeek.length, 1, 'null required stays monitored')
  const noFields = student('h1', { status: 'Active Rotation' })
  assert.equal(missedWeekFor(noFields).noShiftLastWeek.length, 1, 'missing fields stay monitored')
})

test('hours: the guard reuses the Rotation Activity badge determination', () => {
  // Not a second formula: the badge and the guard call the same function, and
  // the badge's own inline arithmetic is gone.
  const rot = read('src/components/RotationActivity.jsx')
  assert.match(rot, /import \{ hoursProgress \} from '\.\.\/lib\/clinicalHours'/)
  assert.match(rot, /hoursProgress\(s\)/)
  assert.ok(!/const pct = req > 0 \? Math\.min\(100, \(apv \/ req\) \* 100\) : 0/.test(rot),
    'the inline badge formula must not survive alongside the helper')
  assert.ok(!/complete: pct >= 100/.test(rot), 'complete comes from the helper')

  const engine = read('src/lib/attention.js')
  assert.match(engine, /import \{ hasCompletedRequiredHours \} from '\.\/clinicalHours\.js'/)
  assert.match(engine, /!hasCompletedRequiredHours\(s\)/)
  // The Action Center must not carry its own hours arithmetic either.
  const panel = read('src/components/ActionCenter.jsx')
  assert.ok(!/Number\(s\.approved_hours\)/.test(panel), 'the card reads the shared helper')
  assert.match(panel, /hoursProgress\(s\)/)
})

test('hours: badge determination matches complete/near/remaining semantics', async () => {
  const { hoursProgress, hasCompletedRequiredHours, NEARING_PCT } =
    await import('../src/lib/clinicalHours.js')
  const p = hoursProgress({ approved_hours: 96, hours_required: 132 })
  assert.equal(p.remaining, 36)
  assert.equal(p.complete, false)
  assert.equal(Math.round(p.pct), 73)
  // Over-requirement caps at 100% (the badge never read 110%).
  assert.equal(hoursProgress({ approved_hours: 80, hours_required: 72 }).pct, 100)
  assert.equal(hasCompletedRequiredHours({ approved_hours: 80, hours_required: 72 }), true)
  // Nearing band is preserved for the amber badge.
  assert.equal(NEARING_PCT, 85)
  assert.equal(hoursProgress({ approved_hours: 62, hours_required: 72 }).nearComplete, true)
  assert.equal(hoursProgress({ approved_hours: 72, hours_required: 72 }).nearComplete, false)
})

test('hours: the weekly canon is otherwise untouched for monitored students', () => {
  // A student who still owes hours keeps every existing resolution path.
  const stu = hoursStudent(96, 132)
  const withInWeekShift = deriveLazyAttention({
    students: [stu], shiftLogs: [{ ...shiftOn('2026-08-11'), student_id: 'h1' }], shiftLogsLoaded: true,
    schoolRotations: [rotOpen()], dispositionLoaded: true, canEdit: true,
    now: new Date('2026-08-16T09:00:00'),
  })
  assert.equal(withInWeekShift.noShiftLastWeek.length, 0, 'in-week shift still resolves')
  const flagged = missedWeekFor(stu).noShiftLastWeek
  assert.equal(flagged.length, 1)
  assert.deepEqual(flagged[0].missedWeek, { start: '2026-08-09', end: '2026-08-15' })
})
