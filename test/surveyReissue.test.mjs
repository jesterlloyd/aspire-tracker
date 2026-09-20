// test/surveyReissue.test.mjs
//
// SURVEY-REISSUE-2 (Owner, 2026-09-20): an expired or revoked survey can be sent again from
// every workflow, not only the two Casey-Fink ones, and the Responses roster hands the reader
// to the slip where that happens.
//
// What this pins, on OUTCOMES where it can and on source where the outcome is a server path:
//   1. One rule. Every detector and endpoint reads isReissuableAssignment; the Casey-Fink
//      name is an alias of it, not a second copy.
//   2. The three detectors that used to suppress an expired row now offer it for reissue,
//      only while the trigger still holds, and never a completed or live row.
//   3. The adapters carry the reissue onto a Ready card whose button says Reissue and whose
//      stamp says why; a completed row is still a Sent line, never a card.
//   4. The three endpoints reuse the row through the shared helper, skip the historical
//      send dedup for a reissue, scope the row to the student's current cohort, and echo
//      `reissued`. The preceptor core excludes the reissue row from its own idempotency check.
//   5. The roster's Send again opens Review & Release on the right workflow and slip, and
//      sends nothing itself.
// Run: node --test test/surveyReissue.test.mjs

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { isReissuableAssignment, reissueReason } from '../src/lib/evaluation/assignmentReissue.js'
import { isCaseyFinkReissuableAssignment, classifyCaseyFinkPostRotationCohort } from '../src/lib/evaluation/caseyFinkPostRotationDueDetection.js'
import { classifyCohort } from '../src/lib/evaluation/preceptorDueDetection.js'
import { classifyStudentEvalCohort } from '../src/lib/evaluation/studentEvalDueDetection.js'
import { classifyPostRotationCohort } from '../src/lib/evaluation/postRotationCertDueDetection.js'
import { adaptPreceptor, adaptStudentFeedback, adaptAspireFeedback, adaptCaseyFinkPostRotation } from '../src/lib/evaluation/reviewQueueAdapters.js'
import { reissueTarget } from '../src/lib/evaluation/responsesPacketModel.js'
import { RELEASE_ROUTES } from '../src/lib/evaluation/releaseRouting.js'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')
const stripJs = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const NOW = Date.parse('2026-09-20T17:00:00Z')
const daysAgo = (n) => new Date(NOW - n * 24 * 60 * 60 * 1000).toISOString()
const inst = (slug) => ({ evaluation_instruments: { slug } })
const asg = (o) => ({ id: `a-${Math.random().toString(36).slice(2, 8)}`, status: 'sent', revoked_at: null, completed_at: null,
  expires_at: daysAgo(-20), sent_at: daysAgo(3), created_at: daysAgo(3), notes: null, ...o })

const EXPIRED = { status: 'expired', sent_at: daysAgo(40), expires_at: daysAgo(12) }
const LAPSED  = { status: 'sent', sent_at: daysAgo(40), expires_at: daysAgo(1) }   // live status, window passed
const REVOKED = { status: 'revoked', revoked_at: daysAgo(5), sent_at: daysAgo(9), expires_at: daysAgo(-19) }
const LIVE    = { status: 'opened', sent_at: daysAgo(3), expires_at: daysAgo(-25) }
const DONE    = { status: 'completed', completed_at: daysAgo(2), sent_at: daysAgo(6) }

// ── 1. One rule ───────────────────────────────────────────────────────────────

test('one reissue rule: expired, lapsed, revoked and non-responder rows qualify; completed, live and draft never do', () => {
  for (const a of [EXPIRED, LAPSED, REVOKED, { status: 'non_responder', expires_at: daysAgo(3) }]) {
    assert.equal(isReissuableAssignment(asg(a), NOW), true, a.status)
  }
  for (const a of [LIVE, DONE, { status: 'draft', expires_at: daysAgo(3) }, { status: 'expired', completed_at: daysAgo(1) }]) {
    assert.equal(isReissuableAssignment(asg(a), NOW), false, a.status)
  }
  assert.equal(isReissuableAssignment(asg({ status: 'sent', expires_at: new Date(NOW).toISOString() }), NOW), true, 'the boundary instant counts as passed')
  assert.equal(reissueReason(asg(REVOKED)), 'revoked')
  assert.equal(reissueReason(asg(EXPIRED)), 'expired')
  assert.equal(reissueReason(asg(LAPSED)), 'expired')
  // The Casey-Fink name is the same function, not a second copy of the rule.
  assert.equal(isCaseyFinkReissuableAssignment, isReissuableAssignment)
  const cf = stripJs(read('src/lib/evaluation/caseyFinkPostRotationDueDetection.js'))
  assert.doesNotMatch(cf, /export function isCaseyFinkReissuableAssignment/)
  for (const f of ['preceptorDueDetection', 'studentEvalDueDetection', 'postRotationCertDueDetection', 'caseyFinkPostRotationDueDetection']) {
    assert.match(read(`src/lib/evaluation/${f}.js`), /from '\.\/assignmentReissue\.js'/, `${f} reads the shared rule`)
  }
})

// ── 2. The three detectors ────────────────────────────────────────────────────

const STUDENT = { id: 's1', first_name: 'Priya', last_name: 'Raman', program_type: 'BSN', approved_hours: 135, hours_required: 135,
  personal_email: 'p@x.org', preceptor_id: 'p1', matched_unit_name: '6 South' }
const PRECEPTOR = { id: 'p1', full_name: 'Romelyn Sanchez', email: 'r@x.org', unit_name: '6 South', is_active: true }

test('preceptor detector: an expired or revoked request is due again while the period still is; completed and live still suppress', () => {
  const run = (a, student = STUDENT) => classifyCohort({
    students: [student], preceptors: [PRECEPTOR], nowMs: NOW,
    assignments: a ? [asg({ student_id: 's1', ...inst('preceptor_progress'), timepoint: 'post_rotation', respondent_type: 'preceptor', notes: 'preceptor_progress:end_of_rotation', ...a })] : [],
  })
  for (const a of [EXPIRED, LAPSED, REVOKED]) {
    const { rows, summary } = run(a)
    const end = rows.find(r => r.period === 'end_of_rotation')
    assert.equal(end.classification, 'due_sendable', a.status)
    assert.equal(end.reissue.state, a.status === 'revoked' ? 'revoked' : 'expired')
    assert.ok(end.reissue.assignmentId, 'the row to reuse is named')
    assert.equal(end.suppressing, null)
    assert.match(end.reason, /may be reissued/)
    assert.equal(summary.reissue_required, 1); assert.equal(summary.due_sendable, 1); assert.equal(summary.suppressed_existing, 1, 'the midpoint is superseded by the end row')
  }
  for (const a of [LIVE, DONE]) {
    const end = run(a).rows.find(r => r.period === 'end_of_rotation')
    assert.equal(end.classification, 'suppressed_existing', a.status)
    assert.equal(end.reissue, null)
  }
  // No preceptor email: the reissue is named but blocked on the address.
  const { rows } = classifyCohort({ students: [STUDENT], preceptors: [{ ...PRECEPTOR, email: '' }], nowMs: NOW,
    assignments: [asg({ student_id: 's1', timepoint: 'post_rotation', respondent_type: 'preceptor', notes: 'preceptor_progress:end_of_rotation', ...EXPIRED })] })
  const blocked = rows.find(r => r.period === 'end_of_rotation')
  assert.equal(blocked.classification, 'due_unsendable'); assert.equal(blocked.reissue.state, 'expired')
  // An expired MIDPOINT is not reissued once the end threshold is reached: the end supersedes it.
  const mid = run({ ...EXPIRED, timepoint: 'midpoint', notes: 'preceptor_progress:midpoint' }).rows.find(r => r.period === 'midpoint')
  assert.equal(mid.classification, 'suppressed_existing'); assert.match(mid.reason, /End threshold reached/)
  // An expired midpoint at midpoint hours IS reissued.
  const midDue = run({ ...EXPIRED, timepoint: 'midpoint', notes: 'preceptor_progress:midpoint' }, { ...STUDENT, approved_hours: 80 }).rows.find(r => r.period === 'midpoint')
  assert.equal(midDue.classification, 'due_sendable'); assert.equal(midDue.reissue.state, 'expired')
})

test('student feedback detector: an expired request is due again at threshold, not below it; completed still suppresses', () => {
  const run = (a, student = STUDENT) => classifyStudentEvalCohort({ students: [student], preceptors: [PRECEPTOR], nowMs: NOW,
    assignments: a ? [asg({ student_id: 's1', ...inst('student_preceptor_eval'), timepoint: 'post_rotation', ...a })] : [] })
  for (const a of [EXPIRED, LAPSED, REVOKED]) {
    const { rows, summary } = run(a)
    assert.equal(rows[0].classification, 'due_sendable', a.status)
    assert.equal(rows[0].reissue.state, a.status === 'revoked' ? 'revoked' : 'expired')
    assert.equal(rows[0].suppressing, null)
    assert.equal(summary.reissue_required, 1)
  }
  assert.equal(run(DONE).rows[0].classification, 'suppressed_existing')
  assert.equal(run(LIVE).rows[0].classification, 'suppressed_existing')
  const below = run(EXPIRED, { ...STUDENT, approved_hours: 100 }).rows[0]
  assert.equal(below.classification, 'not_due'); assert.equal(below.reissue, null)
  const noEmail = run(EXPIRED, { ...STUDENT, personal_email: '', school_email: '' }).rows[0]
  assert.equal(noEmail.classification, 'due_unsendable'); assert.equal(noEmail.reissue.state, 'expired')
})

test('ASPIRE feedback detector: an expired evaluation reads evaluation_reissue, and is counted as ready, not as a new release', () => {
  const run = (a, student = STUDENT) => classifyPostRotationCohort({ students: [student], nowMs: NOW,
    assignments: a ? [asg({ student_id: 's1', ...inst('post_rotation_evaluation'), timepoint: 'post_rotation', ...a })] : [] })
  for (const a of [EXPIRED, LAPSED, REVOKED]) {
    const { rows, summary } = run(a)
    assert.equal(rows[0].status, 'evaluation_reissue', a.status)
    assert.equal(rows[0].reissue.state, a.status === 'revoked' ? 'revoked' : 'expired')
    assert.match(rows[0].warnings.join(' '), a.status === 'revoked' ? /was revoked/ : /expired/)
    assert.deepEqual([summary.eligible_for_review, summary.reissue_required, summary.due_sendable, summary.suppressed_existing], [1, 1, 1, 0])
  }
  assert.equal(run(DONE).rows[0].status, 'evaluation_completed')
  assert.equal(run(LIVE).rows[0].status, 'evaluation_released')
  // Below the hours gate the expired row is blocked, not reissued, and not listed.
  const { rows, summary } = run(EXPIRED, { ...STUDENT, approved_hours: 100 })
  assert.equal(rows.length, 0); assert.equal(summary.not_due, 1); assert.equal(summary.reissue_required, 0)
  // A first-time release is unchanged.
  assert.equal(run(null).rows[0].status, 'eligible_for_review'); assert.equal(run(null).rows[0].reissue, null)
})

// ── 3. The adapters ───────────────────────────────────────────────────────────

const displayName = (s) => `${s.first_name} ${s.last_name}`

test('adapters: a reissue is a Ready card that says Reissue and why; a completed row is still only a Sent line', () => {
  const pre = adaptPreceptor({ students: [STUDENT], preceptors: [PRECEPTOR], displayName, nowMs: NOW,
    assignments: [asg({ student_id: 's1', ...inst('preceptor_progress'), timepoint: 'post_rotation', respondent_type: 'preceptor', notes: 'preceptor_progress:end_of_rotation', ...REVOKED })] })
  const end = pre.items.find(i => i.period === 'end_of_rotation')
  assert.equal(end.state, 'ready'); assert.equal(end.release.reissue, true); assert.equal(end.release.period, 'end_of_rotation')
  assert.equal(end.stamp.text, 'Link revoked'); assert.equal(end.stamp.tone, 'ok')
  assert.equal(end.chain.find(n => n.role === 'this').detail, 'Reissue now')

  const stu = adaptStudentFeedback({ students: [STUDENT], preceptors: [PRECEPTOR], displayName, nowMs: NOW,
    assignments: [asg({ student_id: 's1', ...inst('student_preceptor_eval'), timepoint: 'post_rotation', ...EXPIRED })] })
  assert.equal(stu.items[0].state, 'ready'); assert.equal(stu.items[0].release.reissue, true); assert.equal(stu.items[0].stamp.text, 'Link expired')
  assert.equal(stu.sent.length, 0, 'an expired link is a card to act on, not a Sent line')

  const done = adaptStudentFeedback({ students: [STUDENT], preceptors: [PRECEPTOR], displayName, nowMs: NOW,
    assignments: [asg({ student_id: 's1', ...inst('student_preceptor_eval'), timepoint: 'post_rotation', ...DONE })] })
  assert.equal(done.items.length, 0); assert.equal(done.sent.length, 1)

  // ASPIRE feedback: with every prerequisite met, the expired evaluation is a Reissue card.
  const feedbackDone = asg({ student_id: 's1', ...inst('student_preceptor_eval'), timepoint: 'post_rotation', ...DONE })
  const caseyDone = asg({ student_id: 's1', ...inst('casey_fink_readiness_2024'), timepoint: 'post_rotation', ...DONE })
  const acts = ['town_hall', 'interview_bootcamp', 'resume_review'].map((k, i) => ({ id: `x${i}`, student_id: 's1', activity_key: k, action: 'complete', completed_at: daysAgo(20), created_at: daysAgo(20) }))
  const asp = adaptAspireFeedback({ students: [STUDENT], displayName, nowMs: NOW,
    assignments: [asg({ student_id: 's1', ...inst('post_rotation_evaluation'), timepoint: 'post_rotation', ...EXPIRED })],
    allAssignmentsByStudent: new Map([['s1', [feedbackDone, caseyDone]]]), activityByStudent: new Map([['s1', acts]]), ledgerDown: false, shiftMeta: new Map() })
  assert.equal(asp.items[0].state, 'ready'); assert.equal(asp.items[0].release.reissue, true); assert.equal(asp.items[0].stamp.text, 'Link expired')
  assert.equal(asp.items[0].chain.find(n => n.role === 'this').detail, 'Reissue now')
  // With a prerequisite missing, an expired row is blocked like any other, never a fake Ready.
  const held = adaptAspireFeedback({ students: [STUDENT], displayName, nowMs: NOW,
    assignments: [asg({ student_id: 's1', ...inst('post_rotation_evaluation'), timepoint: 'post_rotation', ...EXPIRED })],
    allAssignmentsByStudent: new Map([['s1', [feedbackDone, caseyDone]]]), activityByStudent: new Map(), ledgerDown: false, shiftMeta: new Map() })
  assert.equal(held.items[0].state, 'blocked'); assert.equal(held.items[0].blocker.action, 'activity')

  // Casey-Fink post-rotation wears the same stamp.
  const cfp = adaptCaseyFinkPostRotation({ students: [STUDENT], displayName, nowMs: NOW, certificates: [], shiftMeta: new Map(),
    assignments: [asg({ student_id: 's1', ...inst('casey_fink_readiness_2024'), timepoint: 'post_rotation', ...EXPIRED })],
    allAssignmentsByStudent: new Map([['s1', [feedbackDone]]]) })
  assert.equal(cfp.items[0].state, 'ready'); assert.equal(cfp.items[0].release.reissue, true); assert.equal(cfp.items[0].stamp.text, 'Link expired')
  const { rows } = classifyCaseyFinkPostRotationCohort({ students: [STUDENT], nowMs: NOW, certificates: [],
    assignments: [asg({ student_id: 's1', timepoint: 'post_rotation', ...REVOKED })] })
  assert.deepEqual(rows[0].reissue.state, 'revoked')
})

// ── 4. The endpoints ──────────────────────────────────────────────────────────

test('the shared server helper claims, rotates one surviving token, then activates, and restores on every failure', () => {
  const src = read('lib/server/evaluation/assignmentReissue.js')
  const claimAt = src.indexOf(".update({ status: 'draft', revoked_at: null, notes: claimNote, updated_at: nowIso })")
  const tokensAt = src.indexOf(".from('evaluation_assignment_tokens')", claimAt)
  const activateAt = src.indexOf("status: 'sent', revoked_at: null, updated_at: nowIso", tokensAt)
  assert.ok(claimAt > -1 && tokensAt > claimAt && activateAt > tokensAt, 'claim, then tokens, then activate')
  assert.match(src.slice(claimAt, tokensAt), /\.eq\('status', row\.status\)/, 'the terminal status is the compare-and-set guard')
  assert.match(src, /const survivor = tokenRows\?\.\[0\]/)
  assert.match(src, /\.in\('id', obsoleteTokenIds\)/)
  assert.match(src, /\.eq\('id', survivor\.id\)/)
  assert.doesNotMatch(src, /token_hash:[\s\S]{0,500}\.eq\('assignment_id', row\.id\)/, 'never one hash on every historical token')
  assert.match(src.slice(activateAt), /\.eq\('status', 'draft'\)\s*\.eq\('notes', claimNote\)/, 'activation is guarded by the claim')
  assert.ok((src.match(/restoreReissueClaim\(db, row, claimNote/g) || []).length >= 2)
  assert.match(src, /classification: 'release_in_progress'/)
})

test('the three endpoints reuse the named row, scope it to the current cohort, skip the historical dedup for a reissue, and echo reissued', () => {
  const files = {
    student: 'api/evaluation-release-student-eval-survey.js',
    postRotation: 'api/evaluation-release-post-rotation-survey.js',
  }
  for (const [key, f] of Object.entries(files)) {
    const src = stripJs(read(f))
    assert.equal(RELEASE_ROUTES[key].endpoint, `/${f.replace(/\.js$/, '')}`)
    assert.match(src, /import \{ isReissuableAssignment \} from '\.\.\/src\/lib\/evaluation\/assignmentReissue\.js'/, f)
    assert.match(src, /import \{ reissueAssignment \} from '\.\.\/lib\/server\/evaluation\/assignmentReissue\.js'/, f)
    assert.match(src, /a\.cohort_id === cohortId && isReissuableAssignment\(a, Date\.now\(\)\)/, `${f} scopes the reissue row to the current cohort`)
    assert.match(src, /classification: 'reissue_unavailable'/, f)
    assert.match(src, /if \(!reissueRow\) \{[\s\S]{0,200}from\('notification_log'\)/, `${f} skips the historical dedup only for a reissue`)
    assert.match(src, /reissued: !!reissueRow/, f)
    assert.match(src, /cohort_id, status, revoked_at, completed_at, expires_at, sent_at, created_at, notes,/, `${f} loads what a restore needs`)
    // Token first, then the helper, and the insert path still stores its own token.
    const mintAt = src.indexOf('generateToken()')
    const helperAt = src.indexOf('await reissueAssignment({', mintAt)
    const insertAt = src.indexOf(".from('evaluation_assignments')\n      .insert({", helperAt)
    assert.ok(mintAt > -1 && helperAt > mintAt && insertAt > helperAt, `${f}: mint, reissue branch, then the insert branch`)
    assert.doesNotMatch(src, /assignment\.id\b(?!;)/, `${f} addresses the row by assignmentId on both paths`)
  }
  // The preceptor endpoint names the row and hands it to the shared core, which excludes it
  // from its own idempotency check and reissues instead of inserting.
  const rel = stripJs(read('api/evaluation-release-preceptor-survey.js'))
  assert.match(rel, /a\.cohort_id === student\.cohort_id && isReissuableAssignment\(a, Date\.now\(\)\)/)
  assert.match(rel, /classification: 'reissue_unavailable'/)
  assert.match(rel, /reissueRow,\s*logPrefix:\s*'\[preceptor-release\]'/)
  assert.match(rel, /reissued: !!reissueRow/)
  const core = stripJs(read('lib/server/evaluation/preceptorSend.js'))
  assert.match(core, /if \(reissueRow\) dupQuery = dupQuery\.neq\('id', reissueRow\.id\)/)
  assert.match(core, /claimNote: `preceptor_progress:\$\{period\}:reissue_claim`/)
  assert.match(core, /reissued:\s+!!reissueRow/)
  const guardAt = core.indexOf("dupQuery.neq('id', reissueRow.id)")
  const helperAt = core.indexOf('await reissueAssignment({')
  assert.ok(guardAt > -1 && helperAt > guardAt, 'the idempotency check still runs before a reissue')
  // The Casey-Fink endpoints are untouched by this change and keep their inline copy.
  for (const f of ['api/evaluation-release-casey-fink-pre-rotation-survey.js', 'api/evaluation-release-casey-fink-post-rotation-survey.js']) {
    assert.doesNotMatch(read(f), /assignmentReissue\.js'/, `${f} keeps its pinned inline reissue`)
  }
})

// ── 5. The roster's Send again ────────────────────────────────────────────────

test('reissueTarget names the workflow and slip for an expired row of every instrument, and nothing for a live, done or manual one', () => {
  const base = { student_id: 'u1', students: { id: 'u1' } }
  const t = (slug, timepoint, state) => reissueTarget(asg({ ...base, ...inst(slug), timepoint, ...state }), NOW)
  assert.deepEqual(t('casey_fink_readiness_2024', 'baseline', EXPIRED), { workflowId: 'caseyFinkPreRotation', itemId: 'q:u1' })
  assert.deepEqual(t('casey_fink_readiness_2024', 'early_rotation_baseline', REVOKED), { workflowId: 'caseyFinkPreRotation', itemId: 'q:u1' })
  assert.deepEqual(t('casey_fink_readiness_2024', 'post_rotation', LAPSED), { workflowId: 'caseyFinkPostRotation', itemId: 'q:u1' })
  assert.deepEqual(t('preceptor_progress', 'midpoint', EXPIRED), { workflowId: 'preceptor', itemId: 'q:u1:midpoint' })
  assert.deepEqual(t('preceptor_progress', 'post_rotation', EXPIRED), { workflowId: 'preceptor', itemId: 'q:u1:end_of_rotation' })
  assert.equal(t('preceptor_progress', 'custom', EXPIRED), null, 'Other / Interim is a manual send')
  assert.deepEqual(t('student_preceptor_eval', 'post_rotation', EXPIRED), { workflowId: 'student', itemId: 'q:u1' })
  assert.deepEqual(t('post_rotation_evaluation', 'post_rotation', REVOKED), { workflowId: 'postRotation', itemId: 'q:u1' })
  assert.equal(t('student_preceptor_eval', 'post_rotation', LIVE), null)
  assert.equal(t('student_preceptor_eval', 'post_rotation', DONE), null)
  assert.equal(reissueTarget(asg({ ...inst('student_preceptor_eval'), timepoint: 'post_rotation', ...EXPIRED }), NOW), null, 'no student, no slip')
  // Every target is a workflow the routes know.
  for (const key of ['caseyFinkPreRotation', 'caseyFinkPostRotation', 'preceptor', 'student', 'postRotation']) assert.ok(RELEASE_ROUTES[key], key)
})

test('Send again lives in the expanded detail, opens Review & Release through the ?workflow deep link, flashes the slip, and sends nothing', () => {
  const tab = read('src/components/EvaluationTab.jsx')
  const bs = read('src/components/evaluation/BubbleSheet.jsx')
  const dash = read('src/components/evaluation/SurveyAutomationDashboard.jsx')
  assert.match(bs, /onSendAgain/)
  assert.match(bs, /Send again\s*<\/button>/)
  assert.match(tab, /const resend = reissueTarget\(a\)/)
  assert.match(tab, /onSendAgain=\{resend \? \(\) => sendAgain\(resend\) : null\}/)
  assert.match(tab, /n\.set\('workflow', target\.workflowId\)/, 'the same deep-link mechanism the rail uses')
  assert.match(tab, /setRrArrival\(\{ itemId: target\.itemId \}\)/)
  assert.match(tab, /setActiveSubTab\('automation'\)/)
  assert.match(tab, /arriveAt=\{rrArrival\}/)
  assert.match(tab, /onClick=\{\(\) => \{ setRrArrival\(null\); setActiveSubTab\('automation'\) \}\}/, 'a stale arrival never flashes twice')
  assert.match(dash, /useState\(\(\) => arriveAt\?\.itemId \|\| null\)/, 'the arrival is read once, at mount')
  assert.match(dash, /highlightItemId=\{highlightItemId \|\| \(arrived \? arrivalId : null\)\}/)
  assert.match(dash, /el\?\.scrollIntoView\(\{ block: 'center'/)
  // The roster never calls a release endpoint itself.
  assert.doesNotMatch(stripJs(tab), /evaluation-release-|RELEASE_ROUTES|reissueAssignment/)
  assert.doesNotMatch(stripJs(bs), /fetch\(/)
})
