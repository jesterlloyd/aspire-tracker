// test/reviewReleaseQueue.test.mjs
//
// REVIEW-RELEASE-1: six workflows, one detection model, three states, one queue.
//
// What this pins, on OUTCOMES rather than on markup:
//   1. The catalog carries the six workflows in the Owner's order under the Owner's names,
//      with the old name beside each for one release cycle.
//   2. The Pre-Rotation Casey-Fink detects on ASPIRE status, not hours, and never on a
//      prerequisite; it is the same instrument at the `baseline` timepoint the schema has
//      always allowed, and the database refuses to issue a certificate for it.
//   3. Every adapter returns items in the shared shape: only the three states, a chain of
//      before/this/after nodes, exactly one blocker with exactly one action on a blocked
//      item, and a recipient on a ready one. Sent items are never rows.
//   4. The counts the rail shows are the counts the sections show.
//   5. Jump targets name the workflow and the item they point at.
//   6. The new endpoint carries every guard its model carries, in the same order.
//   7. A manual Remind is deliberately absent (Owner, 2026-09-19); a waiting card names
//      the next scheduled reminder from the ledger's own rule instead.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as fsSync from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { SURVEY_CATALOG, SURVEY_WORKFLOWS, surveyByKey, sharesInstrumentWith, relationshipFor } from '../src/lib/evaluation/surveyCatalog.js'
import { WORKFLOW_KEYS, DEFAULT_WORKFLOW_KEY, UNIT_LEADER_RELEASE_KEY } from '../src/lib/evaluation/workflowSelection.js'
import { RELEASE_ROUTES } from '../src/lib/evaluation/releaseRouting.js'
import {
  classifyCaseyFinkPreRotationCohort, PRE_ROTATION_ELIGIBLE_STATUSES, PRE_ROTATION_PENDING_STATUSES, PRE_ROTATION_TIMEPOINT,
} from '../src/lib/evaluation/caseyFinkPreRotationDueDetection.js'
import {
  adaptCaseyFinkPreRotation, adaptPreceptor, adaptStudentFeedback, adaptCaseyFinkPostRotation,
  adaptAspireFeedback, adaptUnitLeaderRelease, nextReminderAt,
} from '../src/lib/evaluation/reviewQueueAdapters.js'
import { ITEM_STATES, NODE_STATUSES, BLOCKER_ACTIONS, countsOf, sumCounts, whenLabel, submissionLabel } from '../src/lib/evaluation/reviewQueueShape.js'
import { ASPIRE_STATUSES } from '../src/lib/constants.js'
import { REMINDER_WORKFLOWS, REMINDER_DAY_OFFSETS } from '../src/lib/evaluation/reminderSchedule.js'
import { getEvaluationPreviewFixture } from '../src/lib/evaluation/evaluationPreviewFixtures.js'
import { buildCaseyFinkPreRotationInvitationEmail } from '../lib/server/evaluation/caseyFinkPreRotationEmailTemplates.js'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')
const stripJs = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const NOW = Date.parse('2026-09-19T17:00:00Z')
const daysAgo = (n) => new Date(NOW - n * 24 * 60 * 60 * 1000).toISOString()
const inst = (slug) => ({ evaluation_instruments: { slug } })
const asg = (o) => ({ id: `a-${Math.random().toString(36).slice(2, 8)}`, status: 'sent', revoked_at: null, completed_at: null,
  expires_at: daysAgo(-20), sent_at: daysAgo(3), created_at: daysAgo(3), notes: null, ...o })

// ── 1. The catalog ──────────────────────────────────────────────────────────

test('six workflows, in the Owner\'s order, under the Owner\'s names, composed from the one name map', () => {
  assert.deepEqual(SURVEY_CATALOG.map(s => s.key),
    ['caseyFinkPreRotation', 'preceptor', 'student', 'caseyFinkPostRotation', 'postRotation', 'unitLeaderRelease'])
  assert.deepEqual(SURVEY_CATALOG.map(s => s.label), [
    'Casey-Fink Readiness for Practice (Pre-Rotation)',
    "Preceptor's Assessment of Student Readiness",
    "Student's Feedback on Unit and Preceptor",
    'Casey-Fink Readiness for Practice (Post-Rotation)',
    "Student's Feedback on ASPIRE",
    "Release Student's Feedback on Unit and Preceptor to Unit Leaders",
  ])
  // SURVEY-NAMES-1: the old labels came out with the rename pass, and the catalog composes
  // every label and title from the one name map rather than spelling them itself.
  assert.ok(SURVEY_CATALOG.every(s => !('was' in s)), 'no catalog entry carries an old label')
  assert.match(read('src/lib/evaluation/surveyCatalog.js'), /from '\.\/surveyNames\.js'/)
  assert.deepEqual(SURVEY_CATALOG.map(s => s.group), ['survey', 'survey', 'survey', 'survey', 'survey', 'unitLeader'])
  assert.deepEqual(SURVEY_CATALOG.map(s => s.to), ['student', 'preceptor', 'student', 'student', 'student', 'unit leader'])
  for (const s of SURVEY_CATALOG) {
    assert.ok(s.trigger && s.gate, `${s.key} names its trigger and its gate`)
  }
})

test('the selection resolver and the routes follow the catalog, and the default is the first survey', () => {
  assert.deepEqual([...WORKFLOW_KEYS], SURVEY_WORKFLOWS.map(s => s.key))
  assert.equal(DEFAULT_WORKFLOW_KEY, 'caseyFinkPreRotation')
  assert.equal(UNIT_LEADER_RELEASE_KEY, 'unitLeaderRelease')
  for (const s of SURVEY_WORKFLOWS) assert.ok(RELEASE_ROUTES[s.key], `${s.key} routes`)
  assert.equal(RELEASE_ROUTES.caseyFinkPreRotation.endpoint, '/api/evaluation-release-casey-fink-pre-rotation-survey')
  assert.equal(RELEASE_ROUTES.caseyFinkPreRotation.instrumentSlug, 'casey_fink_readiness_2024')
  assert.equal(RELEASE_ROUTES.caseyFinkPreRotation.timepoint, 'baseline')
  // Same instrument, different timepoint: the pair is the point, and the routes stay distinct.
  assert.equal(RELEASE_ROUTES.caseyFinkPreRotation.instrumentSlug, RELEASE_ROUTES.caseyFinkPostRotation.instrumentSlug)
  assert.notEqual(RELEASE_ROUTES.caseyFinkPreRotation.endpoint, RELEASE_ROUTES.caseyFinkPostRotation.endpoint)
  assert.notEqual(RELEASE_ROUTES.caseyFinkPreRotation.timepoint, RELEASE_ROUTES.caseyFinkPostRotation.timepoint)
  assert.deepEqual(sharesInstrumentWith('caseyFinkPostRotation').map(s => s.key), ['caseyFinkPreRotation'])
  assert.equal(relationshipFor('caseyFinkPostRotation').kind, 'shared_instrument')
})

// ── 2. The Pre-Rotation Casey-Fink ──────────────────────────────────────────

test('workflow 1 detects on ASPIRE status: three eligible, four not yet, three never', () => {
  assert.deepEqual([...PRE_ROTATION_ELIGIBLE_STATUSES], ['Interviewed', 'Placed', 'Active Rotation'])
  assert.deepEqual([...PRE_ROTATION_PENDING_STATUSES], ['Pending Outreach', 'Form Sent', 'Form Received', 'Interview Scheduled'])
  // Every real status is accounted for, and the three that never appear are the ones
  // past the point of a baseline.
  const covered = new Set([...PRE_ROTATION_ELIGIBLE_STATUSES, ...PRE_ROTATION_PENDING_STATUSES])
  const never = ASPIRE_STATUSES.filter(s => !covered.has(s))
  assert.deepEqual(never, ['Completed', 'Declined', 'Not Proceeding'])
  assert.equal(PRE_ROTATION_TIMEPOINT, 'baseline')

  const students = ASPIRE_STATUSES.map((st, i) => ({ id: `s${i}`, first_name: 'A', last_name: st, status: st, personal_email: `s${i}@x.org` }))
  const { rows, summary } = classifyCaseyFinkPreRotationCohort({ students, assignments: [], nowMs: NOW })
  assert.equal(summary.due_sendable, 3)
  assert.equal(summary.not_due, 4)
  assert.equal(summary.out_of_scope, 3)
  assert.equal(rows.length, 7, 'out-of-scope students are not rows at all')
  // Hours are never an input.
  const src = stripJs(read('src/lib/evaluation/caseyFinkPreRotationDueDetection.js'))
  assert.ok(!/approved_hours|hours_required/.test(src), 'the pre-rotation detector must not read hours')
  assert.ok(!/certificate/i.test(src), 'and it reads no certificate')
})

test('workflow 1: a missing email blocks, a live survey is sent, an expired one is reissued', () => {
  const students = [
    { id: 'a', first_name: 'A', last_name: 'One', status: 'Placed' },                                        // no email
    { id: 'b', first_name: 'B', last_name: 'Two', status: 'Interviewed', personal_email: 'b@x.org' },      // live
    { id: 'c', first_name: 'C', last_name: 'Three', status: 'Active Rotation', school_email: 'c@x.org' }, // expired
  ]
  const assignments = [
    asg({ student_id: 'b', status: 'sent' }),
    asg({ student_id: 'c', status: 'expired', sent_at: daysAgo(40), expires_at: daysAgo(12) }),
  ]
  const { rows, summary } = classifyCaseyFinkPreRotationCohort({ students, assignments, nowMs: NOW })
  const by = Object.fromEntries(rows.map(r => [r.studentId, r]))
  assert.equal(by.a.status, 'eligible_for_review'); assert.equal(by.a.sendable, false)
  assert.equal(by.b.status, 'readiness_released')
  assert.equal(by.c.status, 'readiness_reissue')
  assert.equal(summary.due_unsendable, 1)
  assert.equal(summary.reissue_required, 1)
  assert.equal(summary.suppressed_existing, 1)
})

test('the pre-rotation email makes no certificate claim and says the questions come again', () => {
  const { subject, html } = buildCaseyFinkPreRotationInvitationEmail({ studentFirstName: 'Jayde', surveyUrl: 'https://x/evaluation/readiness#t=preview', expiresAtHuman: 'October 17, 2026' })
  assert.match(subject, /Before Your Rotation/)
  assert.ok(!/certificate/i.test(html), 'a baseline unlocks nothing and must not say otherwise')
  assert.match(html, /same questions again after your rotation/)
  assert.match(html, /Complete Readiness Survey/)
  // The preview drawer can render it, and it is not the post-rotation email.
  const pre = getEvaluationPreviewFixture('caseyFinkPreRotation').render()
  const post = getEvaluationPreviewFixture('caseyFinkPostRotation').render()
  assert.equal(pre.subject, subject)
  assert.notEqual(pre.subject, post.subject)
})

test('the reminder engine already knows a baseline earns no certificate', () => {
  const cf = REMINDER_WORKFLOWS.casey_fink_readiness_2024
  assert.equal(cf.certificateFor('baseline'), null)
  assert.notEqual(cf.certificateFor('post_rotation'), null)
  // And the database refuses to issue for any other timepoint.
  const gate = read('supabase/migrations/20260710000001_caseyfink_post_rotation_certificate_gate.sql')
  assert.match(gate, /v_assignment\.timepoint IS DISTINCT FROM 'post_rotation'/)
})

test('the pre-rotation endpoint carries every guard its model carries, in the same order', () => {
  const src = stripJs(read('api/evaluation-release-casey-fink-pre-rotation-survey.js'))
  assert.match(src, /const TIMEPOINT\s+= PRE_ROTATION_TIMEPOINT/)
  assert.match(src, /const NOTIF_TYPE\s+= 'casey_fink_pre_rotation_request_sent'/)
  assert.match(src, /const ALLOWED_KEYS = \['student_id', 'expected_instrument_slug'\]/)
  assert.match(src, /if \(body\.expected_instrument_slug == null \|\| body\.expected_instrument_slug === ''\) \{/)
  assert.match(src, /if \(body\.expected_instrument_slug !== INSTRUMENT_SLUG\) \{/)
  assert.match(src, /profile\.is_active === false/, 'S-05: a deactivated account is refused first')
  assert.match(src, /\['owner', 'admin'\]\.includes\(profile\.role\)/)
  assert.match(src, /permission_status !== 'authorized'/)
  // On the POST path the guard precedes every read and every write. (The GET path,
  // cohort eligibility, reads students on its own and returns before the guard, as the
  // post-rotation model does.)
  const post = src.slice(src.indexOf("if (req.method === 'GET') return getCohortEligibility(req, res);"))
  const guardAt = post.indexOf('expected_instrument_slug !== INSTRUMENT_SLUG')
  assert.ok(guardAt > 0)
  for (const later of [".from('students')", ".from('evaluation_assignments')", '.insert(', 'resend.emails.send']) {
    assert.ok(post.indexOf(later) > guardAt, `the guard must precede ${later}`)
  }
  // No prerequisite, no certificate, and the reissue claim is restored on every pre-send failure.
  assert.ok(!/caseyFinkPrerequisite|aspirePrerequisites/.test(src), 'a baseline has no prerequisite')
  assert.ok(!/from\('certificates'\)/.test(src), 'a baseline reads no certificate')
  assert.ok(!/issue_participation_certificate|certificate_sequences/.test(src))
  assert.ok((src.match(/restoreReissueClaim\(reissueRow\)/g) || []).length >= 5)
  assert.match(src, /idempotencyKey: `casey-fink-pre-release\/\$\{assignmentId\}:\$\{nowIso\}`/)
  // The response echoes both halves of the identity for the post-send tripwire.
  assert.match(src, /instrument_slug: INSTRUMENT_SLUG,\s*timepoint: TIMEPOINT,/)
  // Send test to me knows the new key.
  assert.match(stripJs(read('api/evaluation-send-survey-test.js')), /Object\.fromEntries\(SURVEY_WORKFLOWS\.map\(w => \[w\.key, w\.title\]\)\)/,
    'SURVEY-NAMES-1: the test-send allowlist is the catalog, titled from the one map')
})

// ── 3. The shared shape ─────────────────────────────────────────────────────

function assertShape(items, workflowId) {
  for (const it of items) {
    assert.equal(it.workflowId, workflowId)
    assert.ok(ITEM_STATES.includes(it.state), `${it.id} has a known state`)
    assert.ok(it.person?.name, `${it.id} names a person`)
    assert.ok(['ok', 'soon', 'late'].includes(it.stamp?.tone), `${it.id} has a stamp tone`)
    assert.ok(it.stamp?.text, `${it.id} has stamp text`)
    if (it.state === 'notEligible') { assert.deepEqual(it.chain, []); continue }
    assert.ok(it.chain.length >= 2, `${it.id} carries a chain`)
    for (const n of it.chain) {
      assert.ok(['before', 'this', 'after'].includes(n.role))
      assert.ok(NODE_STATUSES.includes(n.status))
      assert.ok(n.label)
    }
    if (it.state === 'ready') {
      assert.ok(it.sendTo, `${it.id} names who the release goes to`)
      assert.equal(it.blocker, undefined)
      assert.ok(it.chain.some(n => n.role === 'this' && n.status === 'this'), 'a ready item has a Now node')
    }
    if (it.state === 'blocked') {
      assert.ok(it.blocker, `${it.id} states its blocker`)
      assert.ok(it.blocker.text, 'in plain words')
      assert.ok(BLOCKER_ACTIONS.includes(it.blocker.action), 'with exactly one known action')
      assert.equal(it.sendTo, undefined)
      assert.ok(it.chain.some(n => n.status === 'fix' || n.status === 'waiting'), 'the chain shows the problem')
      if (it.blocker.action === 'jump') {
        assert.ok(it.blocker.target?.workflowId && it.blocker.target?.itemId && it.blocker.target?.label, 'a jump names its target')
      }
    }
  }
}

const STUDENTS = [
  { id: 's1', first_name: 'Priya', last_name: 'Raman', program_type: 'BSN', status: 'Active Rotation', approved_hours: 135, hours_required: 135, personal_email: 'p@x.org', preceptor_id: 'p1', matched_unit_name: '6 South' },
  { id: 's2', first_name: 'Ben', last_name: 'Ortega', program_type: 'ABSN', status: 'Placed', approved_hours: 0, hours_required: 90, preceptor_id: 'p2', matched_unit_name: '4 NW' },      // no email
  { id: 's3', first_name: 'Ethan', last_name: 'Cole', program_type: 'ABSN', status: 'Active Rotation', approved_hours: 112, hours_required: 108, personal_email: 'e@x.org', preceptor_id: 'p1', matched_unit_name: '5 NW' },
  { id: 's4', first_name: 'Zoe', last_name: 'Martin', program_type: 'BSN', status: 'Form Sent', approved_hours: 10, hours_required: 135, personal_email: 'z@x.org', preceptor_id: 'p1' },
  { id: 's5', first_name: 'Sofia', last_name: 'Alvarez', program_type: 'BSN', status: 'Active Rotation', approved_hours: 108, hours_required: 108, personal_email: 'so@x.org', preceptor_id: 'p3', matched_unit_name: '6 NW' },
]
const PRECEPTORS = [
  { id: 'p1', full_name: 'Romelyn Sanchez', email: 'r@x.org', unit_name: '6 South', is_active: true },
  { id: 'p2', full_name: 'Karen Ho', email: '', unit_name: '4 NW', is_active: true },            // no email
  { id: 'p3', full_name: 'Dana Whitfield', email: 'd@x.org', unit_name: '6 NW', is_active: true },
]
const displayName = (s) => `${s.first_name} ${s.last_name}`

test('adapters: Student Feedback ready, blocked on email, not yet eligible, and sent', () => {
  const assignments = [
    asg({ student_id: 's5', ...inst('student_preceptor_eval'), timepoint: 'post_rotation', status: 'completed', completed_at: daysAgo(7), sent_at: daysAgo(9) }),
  ]
  // s2 is AT threshold and has no email: the hours are not the problem, the address is.
  const students = STUDENTS.map(s => s.id === 's2' ? { ...s, approved_hours: 90 } : s)
  const { items, sent } = adaptStudentFeedback({ students, preceptors: PRECEPTORS, assignments, displayName, nowMs: NOW })
  assertShape(items, 'student')
  const by = Object.fromEntries(items.map(i => [i.studentId, i]))
  assert.equal(by.s1.state, 'ready'); assert.equal(by.s1.sendTo, 'p@x.org')
  assert.equal(by.s2.state, 'blocked'); assert.equal(by.s2.blocker.action, 'fix')
  assert.equal(by.s4.state, 'notEligible')
  assert.equal(by.s5, undefined, 'a sent item is not a row')
  assert.equal(sent.length, 1); assert.equal(sent[0].who, 'Sofia Alvarez'); assert.equal(sent[0].submission, 'submitted Sep 12')
  assert.deepEqual(countsOf(items), { ready: 2, blocked: 1, notEligible: 1 })
})

test('adapters: Casey-Fink post-rotation waits, jumps, or is ready, per the prerequisite', () => {
  // s1: feedback completed -> ready. s3: feedback sent 6d ago, not submitted -> waiting.
  // s5: feedback never released -> jump to the Student's Feedback on Unit and Preceptor stack.
  const feedbackDone = asg({ student_id: 's1', ...inst('student_preceptor_eval'), timepoint: 'post_rotation', status: 'completed', completed_at: daysAgo(2), sent_at: daysAgo(4) })
  const feedbackSent = asg({ student_id: 's3', ...inst('student_preceptor_eval'), timepoint: 'post_rotation', status: 'sent', sent_at: daysAgo(6) })
  const all = new Map([['s1', [feedbackDone]], ['s3', [feedbackSent]], ['s5', []]])
  const { items } = adaptCaseyFinkPostRotation({
    students: STUDENTS.filter(s => ['s1', 's3', 's5'].includes(s.id)), assignments: [], allAssignmentsByStudent: all,
    certificates: [], shiftMeta: new Map(), displayName, nowMs: NOW,
  })
  assertShape(items, 'caseyFinkPostRotation')
  const by = Object.fromEntries(items.map(i => [i.studentId, i]))
  assert.equal(by.s1.state, 'ready')
  assert.equal(by.s1.chain[0].detail, 'Submitted Sep 17')
  assert.equal(by.s3.state, 'blocked'); assert.equal(by.s3.blocker.action, 'remind')
  assert.equal(by.s3.stamp.text, 'Waiting 6d'); assert.equal(by.s3.stamp.tone, 'soon')
  assert.match(by.s3.blocker.text, /Ethan has had the feedback survey for 6 days\. Next reminder Sep 20\./)
  assert.equal(by.s5.state, 'blocked'); assert.equal(by.s5.blocker.action, 'jump')
  assert.deepEqual(by.s5.blocker.target, { workflowId: 'student', itemId: 'q:s5', label: "Release Student's Feedback on Unit and Preceptor for Sofia first" })
  assert.equal(by.s5.chain[0].status, 'waiting'); assert.equal(by.s5.chain[0].detail, 'Not released yet')
})

test('a prerequisite older than 7 days stamps late; the next reminder follows the ledger rule', () => {
  const feedbackSent = asg({ student_id: 's3', ...inst('student_preceptor_eval'), timepoint: 'post_rotation', status: 'sent', sent_at: daysAgo(9) })
  const { items } = adaptCaseyFinkPostRotation({
    students: STUDENTS.filter(s => s.id === 's3'), assignments: [], allAssignmentsByStudent: new Map([['s3', [feedbackSent]]]),
    certificates: [], shiftMeta: new Map(), displayName, nowMs: NOW,
  })
  assert.equal(items[0].stamp.tone, 'late')
  assert.equal(items[0].stamp.text, 'Waiting 9d')
  // 7 days have passed, so the next owed reminder is day 14.
  assert.equal(nextReminderAt(feedbackSent, NOW), daysAgo(9 - REMINDER_DAY_OFFSETS[1]))
  assert.equal(nextReminderAt(asg({ sent_at: daysAgo(30) }), NOW), null, 'nothing remains after the window closes')
  assert.equal(nextReminderAt(asg({ sent_at: daysAgo(22) }), NOW), null, 'nothing remains after the last reminder')
})

test('adapters: ASPIRE feedback is blocked on activities with a record action, never a fake Ready', () => {
  const feedbackDone = asg({ student_id: 's1', ...inst('student_preceptor_eval'), timepoint: 'post_rotation', status: 'completed', completed_at: daysAgo(8), sent_at: daysAgo(10) })
  const caseyDone = asg({ student_id: 's1', ...inst('casey_fink_readiness_2024'), timepoint: 'post_rotation', status: 'completed', completed_at: daysAgo(3), sent_at: daysAgo(6) })
  const acts = [{ id: 'x1', student_id: 's1', activity_key: 'town_hall', action: 'complete', completed_at: daysAgo(20), created_at: daysAgo(20), recorded_by_name: 'JB' }]
  const run = (activityByStudent, ledgerDown = false) => adaptAspireFeedback({
    students: STUDENTS.filter(s => s.id === 's1'), assignments: [], allAssignmentsByStudent: new Map([['s1', [feedbackDone, caseyDone]]]),
    activityByStudent, ledgerDown, shiftMeta: new Map(), displayName, nowMs: NOW,
  })
  const blocked = run(new Map([['s1', acts]])).items[0]
  assertShape([blocked], 'postRotation')
  assert.equal(blocked.state, 'blocked')
  assert.equal(blocked.blocker.action, 'activity')
  assert.equal(blocked.stamp.text, '2 activities to record')
  assert.match(blocked.blocker.text, /Résumé Review, Interview Bootcamp not recorded/)
  assert.equal(blocked.chain[1].detail, '1 of 3 recorded')
  assert.equal(blocked.activities.length, 3)
  // The ledger being down can never read as "activities complete".
  const down = run(new Map(), true).items[0]
  assert.equal(down.state, 'blocked'); assert.equal(down.blocker.action, 'fix'); assert.match(down.blocker.text, /not switched on/)
  // All three recorded -> ready.
  const allActs = ['town_hall', 'interview_bootcamp', 'resume_review'].map((k, i) => ({ id: `x${i}`, student_id: 's1', activity_key: k, action: 'complete', completed_at: daysAgo(20), created_at: daysAgo(20) }))
  const ready = run(new Map([['s1', allActs]])).items[0]
  assert.equal(ready.state, 'ready'); assert.equal(ready.chain[0].detail, 'Submitted Sep 16')
})

test('adapters: the preceptor workflow emits one item per student and blocks on a missing preceptor email', () => {
  const { items, sent } = adaptPreceptor({
    students: STUDENTS.filter(s => ['s1', 's2', 's3'].includes(s.id)).map(s => ({ ...s, approved_hours: s.id === 's3' ? 60 : s.approved_hours })),
    preceptors: PRECEPTORS,
    assignments: [asg({ student_id: 's1', ...inst('preceptor_progress'), timepoint: 'midpoint', respondent_type: 'preceptor', status: 'completed', completed_at: daysAgo(30), sent_at: daysAgo(40), notes: 'preceptor_progress:midpoint' })],
    displayName, nowMs: NOW,
  })
  assertShape(items, 'preceptor')
  const s1end = items.find(i => i.studentId === 's1' && i.period === 'end_of_rotation')
  assert.equal(s1end.state, 'ready'); assert.equal(s1end.release.period, 'end_of_rotation'); assert.equal(s1end.sendTo, 'Romelyn Sanchez')
  assert.equal(s1end.chain[2].detail, 'Certificate of Appreciation')
  const s3mid = items.find(i => i.studentId === 's3' && i.period === 'midpoint')
  assert.equal(s3mid.state, 'ready'); assert.equal(s3mid.hours.threshold, 54)
  const s2 = items.filter(i => i.studentId === 's2')
  assert.equal(s2.length, 1, 'one Not-yet row per student, not one per period')
  assert.equal(s2[0].state, 'notEligible'); assert.equal(s2[0].period, 'midpoint'); assert.equal(s2[0].nextGate, 'Midpoint at 45 h')
  assert.equal(items.filter(i => i.studentId === 's3').length, 1, 'a midpoint card already says what the end unlocks')
  assert.equal(sent.length, 1); assert.equal(sent[0].step, 'Midpoint')
  // A preceptor without an email blocks with a preceptor fix.
  const { items: blocked } = adaptPreceptor({
    students: [{ ...STUDENTS[1], approved_hours: 90 }], preceptors: PRECEPTORS, assignments: [], displayName, nowMs: NOW,
  })
  const end = blocked.find(i => i.period === 'end_of_rotation')
  assert.equal(end.state, 'blocked'); assert.equal(end.blocker.action, 'fix'); assert.equal(end.blocker.target.kind, 'preceptor')
  assert.equal(end.stamp.text, 'Email missing')
})

test('adapters: the Unit Leader release is moderation then release, seven days after the rotation', () => {
  const base = { instrument_slug: 'student_preceptor_eval', timepoint: 'post_rotation', unit_key: '6 NW', evaluated_preceptor: 'Dana Whitfield',
    rotation_end: daysAgo(10), eligible_at: daysAgo(3), snapshot_source: 'submission_trigger', released_at: null, revoked_at: null }
  const rows = [
    { ...base, response_id: 'r1', student_name: 'Jordan Reyes', moderation_state: 'cleared', release_state: 'moderated' },
    { ...base, response_id: 'r2', student_name: 'Ethan Cole', moderation_state: 'pending', release_state: 'pending' },
    { ...base, response_id: 'r3', student_name: 'Sofia Alvarez', moderation_state: 'cleared', release_state: 'pending', eligible_at: daysAgo(-4) },
    { ...base, response_id: 'r4', student_name: 'Liam Nguyen', moderation_state: 'cleared', release_state: 'released', released_at: daysAgo(1) },
    { ...base, response_id: 'r5', student_name: 'Mia C', moderation_state: 'cleared', release_state: 'pending', evaluated_preceptor: null },
  ]
  const { items, sent } = adaptUnitLeaderRelease({ rows, nowMs: NOW })
  assertShape(items, 'unitLeaderRelease')
  const by = Object.fromEntries(items.map(i => [i.responseId, i]))
  assert.equal(by.r1.state, 'ready'); assert.equal(by.r1.release.action, 'release'); assert.equal(by.r1.sendTo, '6 NW leader')
  assert.equal(by.r2.state, 'blocked'); assert.equal(by.r2.blocker.action, 'moderate')
  assert.equal(by.r3.state, 'notEligible'); assert.match(by.r3.stamp.text, /Eligible Sep 23/)
  assert.equal(by.r4, undefined, 'a released response is on the Sent log')
  assert.equal(by.r5.state, 'blocked'); assert.equal(by.r5.blocker.action, 'fix')
  assert.equal(sent.length, 1); assert.equal(sent[0].recipient, 'to 6 NW leader')
  assert.deepEqual(countsOf(items), { ready: 1, blocked: 2, notEligible: 1 })
})

test('adapters: ASPIRE feedback lists its Not-yet students, jumps to feedback first, and says a same-day send was sent today', () => {
  const run = (ids, byStudent) => adaptAspireFeedback({
    students: STUDENTS.filter(s => ids.includes(s.id)), assignments: [], allAssignmentsByStudent: byStudent,
    activityByStudent: new Map(), ledgerDown: false, shiftMeta: new Map(), displayName, nowMs: NOW,
  }).items
  // s4 is below hours: the classifier drops the row, the adapter still lists it.
  const [notYet] = run(['s4'], new Map())
  assert.equal(notYet.state, 'notEligible'); assert.deepEqual(notYet.hours, { approved: 10, required: 135, threshold: 135 })
  assert.equal(notYet.person.name, 'Zoe Martin'); assert.deepEqual(notYet.chain, [])
  // s1 has no feedback released: the chain waits on FEEDBACK, not on Casey-Fink.
  const [jump] = run(['s1'], new Map([['s1', []]]))
  assert.equal(jump.state, 'blocked'); assert.equal(jump.blocker.action, 'jump'); assert.equal(jump.blocker.target.workflowId, 'student')
  assert.equal(jump.chain[1].detail, 'Waits on feedback')
  // s5's feedback went out today.
  const today = asg({ student_id: 's5', ...inst('student_preceptor_eval'), timepoint: 'post_rotation', status: 'sent', sent_at: daysAgo(0) })
  const [waiting] = run(['s5'], new Map([['s5', [today]]]))
  assert.equal(waiting.stamp.text, 'Sent today'); assert.equal(waiting.stamp.tone, 'soon')
  assert.match(waiting.blocker.text, /^Sofia received the feedback survey today\. Next reminder Sep 26\.$/)
  assert.equal(waiting.chain[1].detail, 'Waits on feedback')
})

test('adapters: the pre-rotation queue names the status as the Before node and pairs with the post-rotation', () => {
  const { items } = adaptCaseyFinkPreRotation({ students: STUDENTS, assignments: [], displayName, nowMs: NOW })
  assertShape(items, 'caseyFinkPreRotation')
  const by = Object.fromEntries(items.map(i => [i.studentId, i]))
  assert.equal(by.s1.state, 'ready'); assert.equal(by.s1.hours, null); assert.equal(by.s1.chain[0].detail, 'Active Rotation')
  assert.equal(by.s1.chain[2].detail, 'Post-Rotation Casey-Fink at 100% hours')
  assert.equal(by.s2.state, 'blocked'); assert.equal(by.s2.blocker.action, 'fix'); assert.equal(by.s2.stamp.text, 'No student email')
  assert.equal(by.s4.state, 'notEligible'); assert.equal(by.s4.notEligibleDetail, 'Form Sent')
})

// ── 4 and 5. Counts agree; the shape's helpers ────────────────────────────────

test('the summary line is the sum of the rail badges, which are the sum of the sections', () => {
  const a = { items: [{ state: 'ready' }, { state: 'blocked' }, { state: 'notEligible' }, { state: 'ready' }] }
  const b = { items: [{ state: 'blocked' }] }
  const counts = { a: countsOf(a.items), b: countsOf(b.items) }
  assert.deepEqual(counts.a, { ready: 2, blocked: 1, notEligible: 1 })
  assert.deepEqual(sumCounts(counts), { ready: 2, blocked: 2, notEligible: 1 })
  assert.deepEqual(sumCounts({ a: counts.a, c: null }), counts.a, 'a workflow that has not loaded adds nothing')
})

test('the Sent log shows a time for today and a date for older releases', () => {
  assert.match(whenLabel(new Date(NOW).toISOString(), NOW), /\d{1,2}:\d{2} [AP]M/)
  assert.equal(whenLabel(daysAgo(7), NOW), 'Sep 12')
  assert.equal(submissionLabel(daysAgo(7), NOW), 'submitted Sep 12')
  assert.equal(submissionLabel(null, NOW), 'not yet submitted')
})

// ── 7. No manual Remind yet, by decision ─────────────────────────────────────

test('there is no manual Remind control; a waiting card names the next scheduled reminder instead', () => {
  const queue = stripJs(read('src/components/evaluation/ReviewReleaseQueue.jsx'))
  assert.ok(!/data-act="remind"|onRemind|Remind \w+<\/button>/.test(queue), 'no Remind button (Owner, 2026-09-19)')
  assert.match(read('src/components/evaluation/ReviewReleaseQueue.jsx'), /no manual Remind yet/)
  const adapters = stripJs(read('src/lib/evaluation/reviewQueueAdapters.js'))
  assert.match(adapters, /Next reminder \$\{shortDate\(next, nowMs\)\}/)
})

// ── The dashboard wiring, on outcomes ─────────────────────────────────────────

test('the dashboard loads every workflow whether or not it is selected, and releases through each workflow\'s own route', () => {
  const dash = stripJs(read('src/components/evaluation/SurveyAutomationDashboard.jsx'))
  assert.match(dash, /queryKey: \['review_release_evidence', cohortId\]/)
  assert.match(dash, /queryKey: \['review_release_unit_leader'\]/)
  assert.match(dash, /const route = RELEASE_ROUTES\[item\.workflowId\]/)
  assert.match(dash, /expected_instrument_slug: route\.instrumentSlug/)
  assert.match(dash, /payload\.timepoint !== route\.timepoint/, 'the post-send tripwire checks the timepoint, which is what tells the two Casey-Fink releases apart')
  assert.match(dash, /period: item\.release\?\.period/)
  assert.match(dash, /redirect_preceptor_id: redirectId/)
  // Jump: switch the rail, flash the target.
  assert.match(dash, /selectWorkflow\(target\.workflowId\)/)
  assert.match(dash, /setHighlightItemId\(target\.itemId \|\| null\)/)
  // The four panels are gone from the dashboard.
  for (const p of ['PreceptorAutomationPanel', 'StudentEvalAutomationPanel', 'CaseyFinkPostRotationAutomationPanel', 'PostRotationAutomationPanel']) {
    assert.ok(!dash.includes(p), `${p} no longer mounts`)
  }
})

test('no em dash in anything this change wrote', () => {
  const EM = String.fromCharCode(0x2014)
  for (const f of [
    'src/lib/evaluation/surveyCatalog.js', 'src/lib/evaluation/workflowSelection.js', 'src/lib/evaluation/releaseRouting.js',
    'src/lib/evaluation/caseyFinkPreRotationDueDetection.js', 'src/lib/evaluation/reviewQueueShape.js',
    'src/lib/evaluation/reviewQueueAdapters.js', 'src/lib/evaluation/reviewQueueLoaders.js',
    'src/components/evaluation/ReviewReleaseQueue.jsx', 'src/components/evaluation/SurveyAutomationDashboard.jsx',
    'api/evaluation-release-casey-fink-pre-rotation-survey.js', 'lib/server/evaluation/caseyFinkPreRotationEmailTemplates.js',
    'test/reviewReleaseQueue.test.mjs',
  ]) {
    assert.ok(!read(f).includes(EM), `${f} contains an em dash`)
  }
})

// ── The column guard (REVIEW-RELEASE-2) ──────────────────────────────────────
// Part 1 shipped selecting students.aspire_status, which does not exist (that name belongs to
// unit_preceptor_responses); production answered "column students.aspire_status does not
// exist" on every detection. The students table predates the tracked migrations, so the
// schema cannot be read here; what can be read is every explicit students select the rest
// of the code base makes. A column this workflow names must already be selected somewhere
// else, or it is a name someone invented.
test('every students column the loader and the endpoint select is one production already selects', () => {
  const { readdirSync, statSync } = fsSync
  const known = new Set()
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      if (/ \d+\.[a-z]+$/.test(name)) continue
      const p = join(here, '..', dir, name)
      const rel = join(dir, name)
      if (statSync(p).isDirectory()) { walk(rel); continue }
      if (!/\.(js|jsx)$/.test(name)) continue
      if (/reviewQueueLoaders|casey-fink-pre-rotation/.test(rel)) continue
      const text = readFileSync(p, 'utf8')
      for (const m of text.matchAll(/\.from\('students'\)\s*\.select\(\s*(['`])([^'`]+)\1/g)) {
        for (const col of m[2].split(',')) { const c = col.trim().split(/\s|\(/)[0]; if (/^[a-z_]+$/.test(c)) known.add(c) }
      }
    }
  }
  for (const dir of ['api', 'lib', 'src/lib', 'src/components']) walk(dir)
  assert.ok(known.has('status') && known.has('approved_hours'), 'the guard itself sees the real columns')
  assert.ok(!known.has('aspire_status'), 'no production select names students.aspire_status')
  const loader = read('src/lib/evaluation/reviewQueueLoaders.js').match(/const STUDENT_COLUMNS = \[([\s\S]*?)\]\.join/)[1].match(/'([a-z_]+)'/g).map(x => x.slice(1, -1))
  const endpoint = read('api/evaluation-release-casey-fink-pre-rotation-survey.js').match(/const STUDENT_COLUMNS = '([^']+)'/)[1].split(',').map(x => x.trim())
  for (const c of [...loader, ...endpoint]) assert.ok(known.has(c), `students.${c} is selected nowhere else in production code`)
})

test('adapters: a Support entry completes an activity on the slip, and the source travels with it', () => {
  const feedbackDone = asg({ student_id: 's1', ...inst('student_preceptor_eval'), timepoint: 'post_rotation', status: 'completed', completed_at: daysAgo(8), sent_at: daysAgo(10) })
  const caseyDone = asg({ student_id: 's1', ...inst('casey_fink_readiness_2024'), timepoint: 'post_rotation', status: 'completed', completed_at: daysAgo(3), sent_at: daysAgo(6) })
  const ledger = [{ id: 'x1', student_id: 's1', activity_key: 'town_hall', action: 'complete', completed_at: daysAgo(20), created_at: daysAgo(20), recorded_by_name: 'JB' }]
  const support = [{ student_id: 's1', activity: 'resume_review', occurred_on: '2026-09-03' }]
  const [it] = adaptAspireFeedback({
    students: STUDENTS.filter(s => s.id === 's1'), assignments: [], allAssignmentsByStudent: new Map([['s1', [feedbackDone, caseyDone]]]),
    activityByStudent: new Map([['s1', ledger]]), ledgerDown: false, supportByStudent: new Map([['s1', support]]), shiftMeta: new Map(), displayName, nowMs: NOW,
  }).items
  assert.equal(it.state, 'blocked'); assert.equal(it.stamp.text, '1 activity to record')
  assert.deepEqual(it.activities.map(a => [a.label, a.completed, a.source]), [['Résumé Review', true, 'support'], ['Town Hall', true, 'ledger'], ['Interview Bootcamp', false, null]])
  assert.equal(it.chain[1].detail, '2 of 3 recorded')
})
