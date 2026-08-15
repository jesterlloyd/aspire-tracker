// EVALUATION-REMINDERS-1: when a reminder is owed, and for which survey.
//
// These are the rules that decide whether a real person receives another email.
// They are pure, so every one of them is proved directly rather than inferred
// from a source snapshot.
//
// Run: node --test test/evaluationReminderSchedule.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  REMINDER_DAY_OFFSETS, RESPONSE_WINDOW_DAYS, LIVE_STATUSES, REMINDER_WORKFLOWS,
  CERTIFICATE_KINDS, SKIP_REASONS, daysSince, reminderNumberForAge, workflowForSlug,
  certificateKindFor, classifyAssignment, selectReminderCandidates, tallyReasons,
} from '../src/lib/evaluation/reminderSchedule.js'

const NOW = new Date('2026-08-15T17:00:00.000Z')
const daysAgo = (n) => new Date(NOW.getTime() - n * 86400000).toISOString()
const daysAhead = (n) => new Date(NOW.getTime() + n * 86400000).toISOString()

const CASEY = { id: 'i-casey', slug: 'casey_fink_readiness_2024', permission_status: 'authorized' }
const POSTROT = { id: 'i-postrot', slug: 'post_rotation_evaluation', permission_status: 'authorized' }
const STUDENTEVAL = { id: 'i-studenteval', slug: 'student_preceptor_eval', permission_status: 'authorized' }
const PRECEPTOR = { id: 'i-preceptor', slug: 'preceptor_progress', permission_status: 'authorized' }

/** A live, day-7 assignment. Override anything per test. */
const assignment = (over = {}) => ({
  id: 'a-1',
  instrument_id: CASEY.id,
  student_id: 's-1',
  cohort_id: 'c-1',
  timepoint: 'post_rotation',
  respondent_type: 'student',
  status: 'sent',
  sent_at: daysAgo(7),
  expires_at: daysAhead(21),
  completed_at: null,
  revoked_at: null,
  ...over,
})

// ── The schedule: 7 / 14 / 21, and nothing at 28 ────────────────────────────

test('days 7, 14 and 21 each map to exactly one reminder number', () => {
  assert.deepEqual(REMINDER_DAY_OFFSETS, [7, 14, 21])
  assert.equal(reminderNumberForAge(7), 1)
  assert.equal(reminderNumberForAge(14), 2)
  assert.equal(reminderNumberForAge(21), 3)
})

test('each reminder number covers its own week and no other', () => {
  for (let d = 7; d <= 13; d++) assert.equal(reminderNumberForAge(d), 1, `day ${d}`)
  for (let d = 14; d <= 20; d++) assert.equal(reminderNumberForAge(d), 2, `day ${d}`)
  for (let d = 21; d <= 27; d++) assert.equal(reminderNumberForAge(d), 3, `day ${d}`)
})

test('NO DAY 28 REMINDER: the window closes instead of sending a fourth', () => {
  assert.equal(RESPONSE_WINDOW_DAYS, 28)
  for (const d of [28, 29, 35, 90, 400]) {
    assert.equal(reminderNumberForAge(d), null, `day ${d} must produce no reminder`)
  }
  const a = assignment({ sent_at: daysAgo(28), expires_at: daysAhead(1) })
  const v = classifyAssignment({ assignment: a, instrument: CASEY, now: NOW })
  assert.equal(v.due, false)
  assert.equal(v.reason, SKIP_REASONS.PAST_LAST_REMINDER)
})

test('nothing is sent before day 7', () => {
  for (const d of [0, 1, 3, 6]) assert.equal(reminderNumberForAge(d), null, `day ${d}`)
  const v = classifyAssignment({ assignment: assignment({ sent_at: daysAgo(6) }), instrument: CASEY, now: NOW })
  assert.equal(v.due, false)
  assert.equal(v.reason, SKIP_REASONS.TOO_EARLY)
})

test('the day count is anchored to the ORIGINAL send, not to now or to opening', () => {
  assert.equal(daysSince(daysAgo(14), NOW), 14)
  assert.equal(daysSince(null, NOW), null)
  const v = classifyAssignment({
    assignment: assignment({ sent_at: daysAgo(14), opened_at: daysAgo(1) }), instrument: CASEY, now: NOW,
  })
  assert.equal(v.reminderNumber, 2, 'a recent open does not reset the clock')
})

// ── Completion is the stop condition; opening is not ────────────────────────

test('COMPLETED ASSIGNMENTS NEVER SEND - by timestamp or by status', () => {
  for (const over of [{ completed_at: daysAgo(1) }, { status: 'completed' }]) {
    const v = classifyAssignment({ assignment: assignment(over), instrument: CASEY, now: NOW })
    assert.equal(v.due, false)
    assert.equal(v.reason, SKIP_REASONS.COMPLETED)
  }
})

test('completion outranks everything else that could be said about the row', () => {
  // Perfectly due in every other respect, and still suppressed.
  const v = classifyAssignment({
    assignment: assignment({ completed_at: daysAgo(2), status: 'opened', sent_at: daysAgo(21) }),
    instrument: CASEY, now: NOW,
  })
  assert.equal(v.reason, SKIP_REASONS.COMPLETED)
})

test('OPENED BUT INCOMPLETE REMAINS ELIGIBLE - a peek is not a submission', () => {
  const v = classifyAssignment({
    assignment: assignment({ status: 'opened', opened_at: daysAgo(5), completed_at: null }),
    instrument: CASEY, now: NOW,
  })
  assert.equal(v.due, true)
  assert.equal(v.reminderNumber, 1)
})

test('every live status is eligible, and reminder_due is one of them', () => {
  assert.deepEqual([...LIVE_STATUSES], ['sent', 'opened', 'reminder_due'])
  for (const status of LIVE_STATUSES) {
    assert.equal(classifyAssignment({ assignment: assignment({ status }), instrument: CASEY, now: NOW }).due, true, status)
  }
})

// ── The other stop conditions ───────────────────────────────────────────────

test('revoked, non-live, and window-closed assignments never send', () => {
  const cases = [
    [{ revoked_at: daysAgo(1) }, SKIP_REASONS.REVOKED],
    [{ status: 'revoked' }, SKIP_REASONS.REVOKED],
    [{ status: 'draft' }, SKIP_REASONS.NOT_LIVE_STATUS],
    [{ status: 'non_responder' }, SKIP_REASONS.NOT_LIVE_STATUS],
    [{ expires_at: daysAgo(1) }, SKIP_REASONS.WINDOW_CLOSED],
    [{ sent_at: null }, SKIP_REASONS.MISSING_SENT_AT],
  ]
  for (const [over, reason] of cases) {
    const v = classifyAssignment({ assignment: assignment(over), instrument: CASEY, now: NOW })
    assert.equal(v.due, false, JSON.stringify(over))
    assert.equal(v.reason, reason, JSON.stringify(over))
  }
})

test('an expires_at that closed early beats the nominal 28-day arithmetic', () => {
  // Day 10 by the calendar, but the window was shortened and has already shut.
  const v = classifyAssignment({
    assignment: assignment({ sent_at: daysAgo(10), expires_at: daysAgo(1) }), instrument: CASEY, now: NOW,
  })
  assert.equal(v.reason, SKIP_REASONS.WINDOW_CLOSED)
})

// ── Coverage is a registry whose default is nothing ─────────────────────────

test('the four named workflows are covered, by instrument classification', () => {
  assert.deepEqual(Object.keys(REMINDER_WORKFLOWS).sort(), [
    'casey_fink_readiness_2024', 'post_rotation_evaluation',
    'preceptor_progress', 'student_preceptor_eval',
  ])
  for (const inst of [CASEY, POSTROT, STUDENTEVAL, PRECEPTOR]) {
    assert.ok(workflowForSlug(inst.slug), inst.slug)
  }
})

test('AN UNREGISTERED INSTRUMENT IS NEVER REMINDED - the default is nothing', () => {
  const v = classifyAssignment({
    assignment: assignment(), instrument: { slug: 'some_future_survey', permission_status: 'authorized' }, now: NOW,
  })
  assert.equal(v.due, false)
  assert.equal(v.reason, SKIP_REASONS.UNREGISTERED_INSTRUMENT)
  assert.equal(workflowForSlug('some_future_survey'), null)
  // A missing instrument is equally inert.
  assert.equal(classifyAssignment({ assignment: assignment(), instrument: null, now: NOW }).due, false)
})

test('an instrument whose permission lapsed is not reminded (the link would be dead)', () => {
  for (const permission_status of ['pending', 'expired']) {
    const v = classifyAssignment({
      assignment: assignment(), instrument: { ...CASEY, permission_status }, now: NOW,
    })
    assert.equal(v.reason, SKIP_REASONS.INSTRUMENT_NOT_AUTHORIZED, permission_status)
  }
})

test('each workflow declares its own survey path and respondent', () => {
  assert.equal(REMINDER_WORKFLOWS.casey_fink_readiness_2024.surveyPath, '/evaluation/readiness')
  assert.equal(REMINDER_WORKFLOWS.post_rotation_evaluation.surveyPath, '/evaluation/post-rotation')
  assert.equal(REMINDER_WORKFLOWS.student_preceptor_eval.surveyPath, '/evaluation/experience')
  assert.equal(REMINDER_WORKFLOWS.preceptor_progress.surveyPath, '/evaluation/feedback')
  assert.equal(REMINDER_WORKFLOWS.preceptor_progress.respondent, 'preceptor')
})

// ── Certificate claims are gated to the surveys that issue one ──────────────

test('ONLY the two surveys that genuinely gate a certificate report one', () => {
  // Verified against issue_participation_certificate / issue_preceptor_certificate.
  assert.equal(certificateKindFor('casey_fink_readiness_2024', 'post_rotation'), CERTIFICATE_KINDS.STUDENT_COMPLETION)
  assert.equal(certificateKindFor('preceptor_progress', 'post_rotation'), CERTIFICATE_KINDS.PRECEPTOR_APPRECIATION)

  // The post-rotation evaluation stopped gating a certificate in July 2026.
  assert.equal(certificateKindFor('post_rotation_evaluation', 'post_rotation'), null)
  // The student's preceptor/unit feedback never gated anything.
  assert.equal(certificateKindFor('student_preceptor_eval', 'post_rotation'), null)
})

test('a certificate is only claimed at the timepoint that actually issues it', () => {
  for (const tp of ['baseline', 'early_rotation_baseline', 'midpoint', 'custom']) {
    assert.equal(certificateKindFor('casey_fink_readiness_2024', tp), null, `casey/${tp}`)
    assert.equal(certificateKindFor('preceptor_progress', tp), null, `preceptor/${tp}`)
  }
})

test('an unknown slug claims no certificate', () => {
  assert.equal(certificateKindFor('not_a_survey', 'post_rotation'), null)
})

// ── Batch selection ─────────────────────────────────────────────────────────

test('selection returns one candidate per due assignment and tallies the rest', () => {
  const assignments = [
    assignment({ id: 'due-1', sent_at: daysAgo(7) }),
    assignment({ id: 'due-2', instrument_id: PRECEPTOR.id, respondent_type: 'preceptor', sent_at: daysAgo(21) }),
    assignment({ id: 'done', completed_at: daysAgo(1) }),
    assignment({ id: 'early', sent_at: daysAgo(2) }),
    assignment({ id: 'closed', expires_at: daysAgo(1) }),
  ]
  const instrumentsById = new Map([[CASEY.id, CASEY], [PRECEPTOR.id, PRECEPTOR]])
  const { candidates, skipped } = selectReminderCandidates({ assignments, instrumentsById, now: NOW })

  assert.deepEqual(candidates.map(c => [c.assignment_id, c.reminder_number]), [['due-1', 1], ['due-2', 3]])
  const tally = tallyReasons(skipped)
  assert.equal(tally[SKIP_REASONS.COMPLETED], 1)
  assert.equal(tally[SKIP_REASONS.TOO_EARLY], 1)
  assert.equal(tally[SKIP_REASONS.WINDOW_CLOSED], 1)
})

test('selection never emits a candidate outside 1-3', () => {
  const assignments = Array.from({ length: 40 }, (_, i) => assignment({ id: `a${i}`, sent_at: daysAgo(i) }))
  const { candidates } = selectReminderCandidates({
    assignments, instrumentsById: new Map([[CASEY.id, CASEY]]), now: NOW,
  })
  assert.ok(candidates.length > 0)
  for (const c of candidates) assert.ok([1, 2, 3].includes(c.reminder_number), String(c.reminder_number))
})
