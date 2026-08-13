// ACTION-OWNERSHIP-2: the interview-reminder card, judged against the
// automation's OWN view of the world.
//
// THE PRODUCTION DEFECT
// Victoria Marquez showed "Send Interview Reminder" under Due soon, described
// as "was not sent automatically and will not retry" - an accusation against a
// cron that was working correctly. The engine derived automation ownership from
// `students.interview_scheduled_date`, but api/cron/interview-reminders.js
// never reads that column: it selects interview_sessions rows that have a
// slot_id and matches interview_slots.slot_date against tomorrow (Pacific).
//
// An interview typed straight onto the student record (ScheduleInterviewModal /
// EditScheduleModal, neither of which creates a session) is therefore invisible
// to the cron. The engine still computed a send window for it, watched that
// invented window pass, and reported a miss.
//
// So these tests pin the distinction the fix introduces: MISSED means a cron
// that HAD the work did not do it; UNSCHEDULED means the cron never had it.
//
// Run: node --test test/interviewReminderOwnership.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { deriveEagerAttention } from '../src/lib/attention.js'
import { resolveAutomationState, requiresHuman, isPassiveStatus, STATE } from '../src/lib/automationOwnership.js'

// Interview on 2026-08-13 (Pacific). The cron's send moment is 17:00 UTC on
// 08-12, with 3h grace, so the deadline is 2026-08-12T20:00:00Z.
const INTERVIEW = '2026-08-13'
const BEFORE_WINDOW = new Date('2026-08-12T15:00:00Z') // before the 17:00Z send
const AFTER_WINDOW  = new Date('2026-08-12T21:00:00Z') // past the 20:00Z deadline

const student = (id, over = {}) => ({
  id, cohort_id: 'co1', first_name: 'F' + id, last_name: 'L' + id, school: 'CSUN',
  status: 'Interview Scheduled', interview_scheduled_date: INTERVIEW, ...over,
})

/** A student who booked through the scheduler: session + slot, like the cron sees. */
const booked = (studentId, slotDate = INTERVIEW) => ({
  sessions: [{ id: 'sess-' + studentId, student_id: studentId, slot_id: 'slot-' + studentId, cohort_id: 'co1' }],
  slots: [{ id: 'slot-' + studentId, slot_date: slotDate, cohort_id: 'co1' }],
})

const eagerWith = ({ students, ivSessions = [], ivSlots = [], deliveries = [], now, loaded = true }) =>
  deriveEagerAttention({
    students, matches: [], communications: [], activeCohort: { id: 'co1' },
    canEdit: true, now,
    reminderDeliveries: deliveries, deliveriesLoaded: loaded,
    ivSessions, ivSlots,
  })

// ── The reported card ───────────────────────────────────────────────────────

test('THE DEFECT: a staff-typed interview is no longer reported as an automation miss', () => {
  // Victoria's shape: an interview date on the student record, no booked slot.
  const victoria = student('victoria')
  const eager = eagerWith({ students: [victoria], now: AFTER_WINDOW })

  assert.equal(eager.interviewReminder.length, 1, 'a person does still own this reminder')
  assert.equal(eager.interviewReminder[0].automationState, STATE.UNSCHEDULED,
    'the cron never had this interview, so it did not MISS it')
  assert.notEqual(eager.interviewReminder[0].automationState, STATE.MISSED)
})

test('a staff-typed interview is never listed as handled automatically', () => {
  const eager = eagerWith({ students: [student('v')], now: BEFORE_WINDOW })
  assert.equal(eager.interviewReminderScheduled.length, 0,
    'claiming an automatic send that is never coming is the same lie in a quieter place')
  assert.equal(eager.interviewReminder.length, 0, 'and it raises nothing before its moment')
})

// ── Automation-owned reminders stay out of Action Needed ────────────────────

test('a booked interview inside its window is automation-owned, not an action', () => {
  const { sessions, slots } = booked('b')
  const eager = eagerWith({ students: [student('b')], ivSessions: sessions, ivSlots: slots, now: BEFORE_WINDOW })
  assert.equal(eager.interviewReminder.length, 0, 'the cron owns it')
  assert.equal(eager.interviewReminderScheduled.length, 1, 'shown as passive status only')
})

test('a delivered reminder disappears entirely', () => {
  const { sessions, slots } = booked('b')
  const eager = eagerWith({
    students: [student('b')], ivSessions: sessions, ivSlots: slots, now: AFTER_WINDOW,
    deliveries: [{ student_id: 'b', notification_type: 'interview_reminder', status: 'sent', sent_at: '2026-08-12T17:00:00Z' }],
  })
  assert.equal(eager.interviewReminder.length, 0)
  assert.equal(eager.interviewReminderScheduled.length, 0)
})

test('a booked interview the cron really did drop is still a MISS', () => {
  const { sessions, slots } = booked('b')
  const eager = eagerWith({ students: [student('b')], ivSessions: sessions, ivSlots: slots, now: AFTER_WINDOW })
  assert.equal(eager.interviewReminder.length, 1)
  assert.equal(eager.interviewReminder[0].automationState, STATE.MISSED,
    'the cron had this one and did not send: that is a genuine miss')
})

test('a failed send is still a failure', () => {
  const { sessions, slots } = booked('b')
  const eager = eagerWith({
    students: [student('b')], ivSessions: sessions, ivSlots: slots, now: AFTER_WINDOW,
    deliveries: [{ student_id: 'b', notification_type: 'interview_reminder', status: 'failed', sent_at: '2026-08-12T17:00:00Z' }],
  })
  assert.equal(eager.interviewReminder[0].automationState, STATE.FAILED)
})

// ── The window is computed from the date the cron matches on ────────────────

test('the booked slot date wins over the student record when they disagree', () => {
  // Rescheduled on the student row to next week, but the booked slot is still
  // tomorrow. The cron will act on the SLOT, so the window must follow it.
  const s = student('b', { interview_scheduled_date: '2026-08-20' })
  const { sessions, slots } = booked('b', INTERVIEW)
  const inWindow = eagerWith({ students: [s], ivSessions: sessions, ivSlots: slots, now: BEFORE_WINDOW })
  assert.equal(inWindow.interviewReminderScheduled.length, 1,
    'the reminder is due against the slot date, not the student column')
  const passed = eagerWith({ students: [s], ivSessions: sessions, ivSlots: slots, now: AFTER_WINDOW })
  assert.equal(passed.interviewReminder[0].automationState, STATE.MISSED)
})

test('a session without a slot is not a cron candidate', () => {
  // The cron requires a non-null slot_id; a session without one is skipped.
  const eager = eagerWith({
    students: [student('b')],
    ivSessions: [{ id: 'sess', student_id: 'b', slot_id: null, cohort_id: 'co1' }],
    ivSlots: [],
    now: AFTER_WINDOW,
  })
  assert.equal(eager.interviewReminder[0].automationState, STATE.UNSCHEDULED)
})

// ── Nothing surfaces before the automation's moment ─────────────────────────

test('no interview reminder can ever be an action before its send window', () => {
  const { sessions, slots } = booked('b')
  for (const now of [
    new Date('2026-08-10T12:00:00Z'),
    new Date('2026-08-12T16:59:00Z'),
    new Date('2026-08-12T19:59:00Z'), // inside the grace period
  ]) {
    const eager = eagerWith({ students: [student('b')], ivSessions: sessions, ivSlots: slots, now })
    assert.equal(eager.interviewReminder.length, 0, `must stay quiet at ${now.toISOString()}`)
  }
})

test('unloaded deliveries invent no work', () => {
  const { sessions, slots } = booked('b')
  const eager = eagerWith({
    students: [student('b')], ivSessions: sessions, ivSlots: slots,
    now: AFTER_WINDOW, loaded: false,
  })
  assert.equal(eager.interviewReminder.length, 0)
  assert.equal(eager.interviewReminderScheduled.length, 0)
})

// ── The state vocabulary ────────────────────────────────────────────────────

test('UNSCHEDULED is an exception, not passive status', () => {
  assert.equal(requiresHuman(STATE.UNSCHEDULED), true)
  assert.equal(isPassiveStatus(STATE.UNSCHEDULED), false)
})

test('automationScheduled only changes the reason, never the timing', () => {
  const common = {
    actionKey: 'interview_reminder', eventDate: INTERVIEW, todayDate: '2026-08-12',
    deliveries: [], manualLogs: [], deliveriesLoaded: true,
  }
  // Before the deadline both are passive; after it they differ only in reason.
  for (const scheduled of [true, false]) {
    const before = resolveAutomationState({ ...common, now: BEFORE_WINDOW, automationScheduled: scheduled })
    assert.equal(requiresHuman(before.state), false, `quiet before the window (scheduled=${scheduled})`)
  }
  assert.equal(resolveAutomationState({ ...common, now: AFTER_WINDOW, automationScheduled: true }).state, STATE.MISSED)
  assert.equal(resolveAutomationState({ ...common, now: AFTER_WINDOW, automationScheduled: false }).state, STATE.UNSCHEDULED)
})

test('a manual send resolves it whatever the automation did', () => {
  const eager = deriveEagerAttention({
    students: [student('v')], matches: [],
    communications: [{ student_id: 'v', type: 'interview_reminder' }],
    activeCohort: { id: 'co1' }, canEdit: true, now: AFTER_WINDOW,
    reminderDeliveries: [], deliveriesLoaded: true, ivSessions: [], ivSlots: [],
  })
  assert.equal(eager.interviewReminder.length, 0, 'marking it done clears the card')
})

// ── The top count and the Interview chip follow the classification ──────────

test('the badge count excludes automation-owned reminders and includes exceptions', () => {
  // The same student also trips unrelated tasks (CS-Link, badge), so the
  // reminder's own effect is measured as the DELTA against a baseline where the
  // reminder is already delivered. That isolates this classification instead of
  // asserting a total that other predicates share.
  const { sessions, slots } = booked('b')
  const scenario = (now, deliveries = []) =>
    eagerWith({ students: [student('b')], ivSessions: sessions, ivSlots: slots, now, deliveries })

  const delivered = scenario(AFTER_WINDOW, [{ student_id: 'b', notification_type: 'interview_reminder', status: 'sent' }])
  const baseline = delivered.count
  assert.equal(delivered.interviewReminder.length, 0, 'a delivered reminder is not work')

  const owned = scenario(BEFORE_WINDOW)
  assert.equal(owned.count, baseline, 'a reminder the cron owns adds nothing to the badge')
  assert.equal(owned.interviewReminderScheduled.length, 1, '...even though it is shown as status')

  const missed = scenario(AFTER_WINDOW)
  assert.equal(missed.count, baseline + 1, 'a genuine miss adds exactly one')

  // And the staff-typed case adds one too, but as UNSCHEDULED, not MISSED.
  const unscheduled = eagerWith({ students: [student('b')], now: AFTER_WINDOW })
  assert.equal(unscheduled.count, baseline + 1)
  assert.equal(unscheduled.interviewReminder[0].automationState, STATE.UNSCHEDULED)
})

test('the Interview chip counts exactly the reminder items that are actions', () => {
  // The chip is a category tally over the built items, and the reminder item is
  // only ever built from eager.interviewReminder - so the two cannot disagree.
  const ac = readFileSync(new URL('../src/components/ActionCenter.jsx', import.meta.url), 'utf8')
  const code = ac.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  assert.match(code, /const act3\s*=\s*eager\.interviewReminder/,
    'the item source is the counted set, never the passive one')
  assert.doesNotMatch(code, /act3\s*=\s*eager\.interviewReminderScheduled/)
  // The passive set reaches only the collapsed automated section, which is not
  // an action list and is not chip-counted.
  assert.match(code, /const actAuto\s*=\s*eager\.interviewReminderScheduled/)
  const chipItems = code.match(/actAuto\.map\(/g) || []
  assert.equal(chipItems.length, 0, 'passive rows are never mapped into action items')
})

test('both consumers feed the engine the same automation source', () => {
  // App.jsx (closed bell badge) and ActionCenter.jsx (open panel) must agree, or
  // the badge and the list disagree about the same card.
  for (const p of ['../src/App.jsx', '../src/components/ActionCenter.jsx']) {
    const src = readFileSync(new URL(p, import.meta.url), 'utf8')
    assert.match(src, /ivSessions,\s*ivSlots,/, `${p} must pass the cron's own rows`)
  }
})
