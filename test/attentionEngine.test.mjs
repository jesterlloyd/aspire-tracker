// ASPIRE-CHART: the canonical attention engine. Functional tests exercise
// lib/attention.js directly (the same code both the closed bell badge and
// the open Action Center panel consume), and source guards prove neither
// consumer keeps a private predicate copy - the drift the four-copy
// architecture allowed cannot recur.
// Run: node --test test/attentionEngine.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
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
  })
  assert.equal(eager.interviewReminder.length, 0, 'reminder already sent')
  assert.equal(eager.preceptorWelcome.length, 0, 'welcome already sent')
  assert.equal(eager.orientationDue, false, 'orientation logged in communications')

  const viewer = deriveEagerAttention({
    students, matches: [], communications: [], activeCohort: { id: 'co1' }, canEdit: false, now: NOW,
  })
  assert.equal(viewer.sendStudentForm.length, 0, 'canEdit-gated set empty for non-editors')
  assert.equal(viewer.csLinkNotStarted.length, 0)
  assert.equal(viewer.orientationDue, false)
  // Always-visible sets still count for non-editors (matches the panel).
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
