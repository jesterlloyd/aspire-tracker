// test/postRotationSequence.test.mjs
//
// POST-ROTATION-SEQUENCED-RELEASE-1.
//
// The sequence:
//   1. Student Feedback: Preceptor & Unit  (student_preceptor_eval)
//   2. Casey-Fink Post-Rotation Survey     (casey_fink_readiness_2024)
//   3. ASPIRE Post-Rotation Evaluation     (post_rotation_evaluation)
//
// What matters most here is what CANNOT unlock a step: a released-but-unfinished
// assignment, an expired one, a revoked one, a delivered or opened email, a
// passed date, or a completion belonging to a different workflow or timepoint.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  STEP_SLUGS, POST_ROTATION_TIMEPOINT, REQUIRED_ACTIVITY_KEYS,
  completionState, stepCompletion, caseyFinkPrerequisite, aspirePrerequisites, currentActivityState,
  prerequisiteSummary, PREREQ_REASONS,
} from '../src/lib/evaluation/postRotationSequence.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = f => fs.readFileSync(path.join(root, f), 'utf8')

const asg = (slug, over = {}) => ({
  id: `a-${slug}-${over.tag || '1'}`,
  student_id: 'stu-1',
  timepoint: POST_ROTATION_TIMEPOINT,
  status: 'sent',
  completed_at: null,
  revoked_at: null,
  evaluation_instruments: { slug },
  ...over,
})
const done = (slug, at = '2026-08-01T10:00:00Z', over = {}) =>
  asg(slug, { status: 'completed', completed_at: at, ...over })

const allActivities = (at = '2026-08-02T10:00:00Z') =>
  REQUIRED_ACTIVITY_KEYS.map(k => ({ activity_key: k, completed_at: at }))

// ── Canonical completion evidence ───────────────────────────────────────────

test('completion means completed_at or status completed, and revoked wins', () => {
  assert.equal(completionState({ completed_at: '2026-08-01T00:00:00Z' }), 'completed')
  assert.equal(completionState({ status: 'completed' }), 'completed')
  assert.equal(completionState({ status: 'sent' }), 'other')
  assert.equal(completionState({ status: 'opened' }), 'other')
  assert.equal(completionState({ status: 'expired' }), 'other')
  assert.equal(completionState(null), 'other')
  // Revoked is checked FIRST, so a revoked-but-stamped row is never completed.
  assert.equal(completionState({ status: 'revoked', completed_at: '2026-08-01T00:00:00Z' }), 'revoked')
  assert.equal(completionState({ revoked_at: '2026-08-01T00:00:00Z', completed_at: '2026-08-01T00:00:00Z' }), 'revoked')
})

test('a completed Student Feedback assignment reports its timestamp', () => {
  const r = stepCompletion([done(STEP_SLUGS.feedback, '2026-07-30T12:00:00Z')], STEP_SLUGS.feedback)
  assert.equal(r.completed, true)
  assert.equal(r.completedAt, '2026-07-30T12:00:00Z')
  assert.equal(r.hasAssignment, true)
})

test('the EARLIEST completion is reported when several exist', () => {
  const r = stepCompletion([
    done(STEP_SLUGS.feedback, '2026-08-05T00:00:00Z', { tag: 'b' }),
    done(STEP_SLUGS.feedback, '2026-07-28T00:00:00Z', { tag: 'a' }),
  ], STEP_SLUGS.feedback)
  assert.equal(r.completedAt, '2026-07-28T00:00:00Z', 'the moment the requirement was first satisfied')
})

test('completion never crosses workflows or timepoints', () => {
  // A completed Casey-Fink cannot satisfy the feedback step.
  assert.equal(stepCompletion([done(STEP_SLUGS.caseyFink)], STEP_SLUGS.feedback).completed, false)
  // A completed feedback assignment at another timepoint does not count.
  const baseline = done(STEP_SLUGS.feedback, '2026-01-01T00:00:00Z', { timepoint: 'baseline' })
  assert.equal(stepCompletion([baseline], STEP_SLUGS.feedback).completed, false)
  assert.equal(stepCompletion([baseline], STEP_SLUGS.feedback).hasAssignment, false)
})

// ── Step 2: Casey-Fink ──────────────────────────────────────────────────────

test('a completed Student Feedback unlocks Casey-Fink', () => {
  const r = caseyFinkPrerequisite([done(STEP_SLUGS.feedback, '2026-07-30T12:00:00Z')])
  assert.equal(r.ok, true)
  assert.equal(r.reason, null)
  assert.equal(r.feedback.completedAt, '2026-07-30T12:00:00Z')
})

test('nothing short of completion unlocks Casey-Fink', () => {
  // Missing entirely.
  const missing = caseyFinkPrerequisite([])
  assert.equal(missing.ok, false)
  assert.equal(missing.code, 'feedback_missing')
  assert.match(missing.reason, /has not been released/)

  // Released but unfinished - including a delivered/opened email.
  for (const status of ['sent', 'delivered', 'opened', 'reminder_due', 'expired']) {
    const r = caseyFinkPrerequisite([asg(STEP_SLUGS.feedback, { status })])
    assert.equal(r.ok, false, `${status} must not unlock Casey-Fink`)
    assert.equal(r.code, 'feedback_incomplete')
  }

  // Revoked, even with a completion stamp.
  const revoked = caseyFinkPrerequisite([
    asg(STEP_SLUGS.feedback, { status: 'revoked', completed_at: '2026-08-01T00:00:00Z' }),
  ])
  assert.equal(revoked.ok, false)

  // A different workflow's completion.
  assert.equal(caseyFinkPrerequisite([done(STEP_SLUGS.caseyFink)]).ok, false)
  assert.equal(caseyFinkPrerequisite([done(STEP_SLUGS.aspire)]).ok, false)
})

// ── Step 3: ASPIRE Post-Rotation ────────────────────────────────────────────

test('ASPIRE unlocks only when feedback, Casey-Fink AND every activity are complete', () => {
  const full = aspirePrerequisites(
    [done(STEP_SLUGS.feedback), done(STEP_SLUGS.caseyFink)],
    allActivities(),
  )
  assert.equal(full.ok, true)
  assert.deepEqual(full.unmet, [])
  assert.equal(full.activities.length, REQUIRED_ACTIVITY_KEYS.length)
  assert.ok(full.activities.every(a => a.completed))
})

test('Casey-Fink completion alone does NOT unlock ASPIRE', () => {
  const r = aspirePrerequisites([done(STEP_SLUGS.caseyFink)], allActivities())
  assert.equal(r.ok, false)
  assert.ok(r.unmet.some(u => u.code === 'feedback_missing'))
})

test('every missing prerequisite produces its own specific reason', () => {
  const none = aspirePrerequisites([], [])
  assert.equal(none.ok, false)
  // feedback + casey-fink + one per required activity
  assert.equal(none.unmet.length, 2 + REQUIRED_ACTIVITY_KEYS.length)
  for (const u of none.unmet) {
    assert.ok(u.reason && u.reason.length > 10, `${u.code} needs a usable reason`)
  }
  assert.ok(none.unmet.some(u => u.reason.includes('Town Hall')))
  assert.ok(none.unmet.some(u => u.reason.includes('Interview Bootcamp')))
  assert.ok(none.unmet.some(u => u.reason.includes('Résumé Review')))
  // The reasons are distinguishable, not one repeated string.
  assert.equal(new Set(none.unmet.map(u => u.reason)).size, none.unmet.length)
})

test('a partially complete checklist still blocks, and says which one', () => {
  const partial = aspirePrerequisites(
    [done(STEP_SLUGS.feedback), done(STEP_SLUGS.caseyFink)],
    [{ activity_key: 'town_hall', completed_at: '2026-08-02T00:00:00Z' },
     { activity_key: 'interview_bootcamp', completed_at: '2026-08-02T00:00:00Z' }],
  )
  assert.equal(partial.ok, false)
  assert.equal(partial.unmet.length, 1)
  assert.match(partial.unmet[0].reason, /Résumé Review/)
  assert.equal(partial.activities.find(a => a.key === 'resume_review').completed, false)
  assert.equal(partial.activities.find(a => a.key === 'town_hall').completed, true)
})

test('an activity row without a completion date does not count', () => {
  const r = aspirePrerequisites(
    [done(STEP_SLUGS.feedback), done(STEP_SLUGS.caseyFink)],
    REQUIRED_ACTIVITY_KEYS.map(k => ({ activity_key: k, completed_at: null })),
  )
  assert.equal(r.ok, false)
  assert.equal(r.unmet.length, REQUIRED_ACTIVITY_KEYS.length)
})

test('an unrelated activity key cannot satisfy a required one', () => {
  const r = aspirePrerequisites(
    [done(STEP_SLUGS.feedback), done(STEP_SLUGS.caseyFink)],
    [{ activity_key: 'something_else', completed_at: '2026-08-02T00:00:00Z' }],
  )
  assert.equal(r.ok, false)
  assert.equal(r.unmet.length, REQUIRED_ACTIVITY_KEYS.length)
})

test('the summary line is usable for a queue row', () => {
  assert.equal(prerequisiteSummary(aspirePrerequisites(
    [done(STEP_SLUGS.feedback), done(STEP_SLUGS.caseyFink)], allActivities())), 'All prerequisites complete')
  assert.match(prerequisiteSummary(aspirePrerequisites([], [])), /prerequisites outstanding/)
})

test('null safety', () => {
  assert.equal(caseyFinkPrerequisite(null).ok, false)
  assert.equal(aspirePrerequisites(null, null).ok, false)
  assert.equal(stepCompletion(null, STEP_SLUGS.feedback).completed, false)
  assert.deepEqual(stepCompletion([null, undefined], STEP_SLUGS.feedback).count, 0)
})

// ── The endpoints must recheck independently ───────────────────────────────

test('the Casey-Fink endpoint rechecks BEFORE any write or send', () => {
  const src = read('api/evaluation-release-casey-fink-post-rotation-survey.js')
  const gate = src.indexOf('const prereq = caseyFinkPrerequisite(')
  assert.ok(gate > -1, 'the endpoint runs its own prerequisite check')

  for (const later of [
    "from('notification_log')",       // dedup
    "from('evaluation_assignments')\n    .insert",  // assignment creation
    'resend.emails.send',             // the send
  ]) {
    const at = src.indexOf(later)
    if (at === -1) continue
    assert.ok(gate < at, `the gate must run before ${later.slice(0, 30)}`)
  }
  // And it returns rather than falling through.
  const block = src.slice(gate, gate + 700)
  assert.match(block, /if \(!prereq\.ok\)[\s\S]{0,400}return res\.status/)
  assert.match(block, /released: false/)
})

test('the ASPIRE endpoint rechecks all three prerequisites before any write or send', () => {
  const src = read('api/evaluation-release-post-rotation-survey.js')
  const gate = src.indexOf('aspirePrerequisites(')
  assert.ok(gate > -1)
  for (const later of ["from('notification_log')", 'resend.emails.send']) {
    const at = src.indexOf(later)
    if (at === -1) continue
    assert.ok(gate < at, `the gate must run before ${later}`)
  }
  const block = src.slice(gate, gate + 800)
  assert.match(block, /if \(!prereq\.ok\)[\s\S]{0,500}return res\.status/)
  assert.match(block, /released: false/)
})

test('the ASPIRE endpoint FAILS CLOSED when the activity ledger is unavailable', () => {
  const src = read('api/evaluation-release-post-rotation-survey.js')
  const at = src.indexOf('activity_ledger_unavailable')
  assert.ok(at > -1, 'an unreadable ledger is handled explicitly')
  const block = src.slice(at - 700, at + 300)
  assert.match(block, /released: false/, 'it refuses rather than releasing')
  assert.match(block, /if \(actErr\)/, 'triggered by the read error, not ignored')
  // NEGATIVE CONTROL: it must not treat a failed read as an empty-but-fine list.
  assert.doesNotMatch(block, /activityRows = \[\];\s*\n\s*\}\s*\n\s*const prereq/,
    'a failed read must not fall through to an empty checklist')
})

test('neither endpoint can release the wrong instrument or timepoint', () => {
  for (const [f, slug] of [
    ['api/evaluation-release-casey-fink-post-rotation-survey.js', 'casey_fink_readiness_2024'],
    ['api/evaluation-release-post-rotation-survey.js', 'post_rotation_evaluation'],
    ['api/evaluation-release-student-eval-survey.js', 'student_preceptor_eval'],
  ]) {
    const src = read(f)
    assert.match(src, new RegExp(`INSTRUMENT_SLUG\\s*=\\s*'${slug}'`), `${f} pins its slug`)
    assert.match(src, /TIMEPOINT\s*=\s*'post_rotation'/, `${f} pins its timepoint`)
    // The pre-send workflow guard still refuses a mismatched caller.
    assert.match(src, /expected_instrument_slug !== INSTRUMENT_SLUG/, `${f} keeps the workflow guard`)
  }
})

test('the existing safety rails are untouched', () => {
  for (const f of [
    'api/evaluation-release-casey-fink-post-rotation-survey.js',
    'api/evaluation-release-post-rotation-survey.js',
  ]) {
    const src = read(f)
    assert.match(src, /\['owner', 'admin'\]\.includes\(profile\.role\)/, 'Owner/Admin only')
    assert.match(src, /from\('notification_log'\)/, 'dedup preserved')
    assert.match(src, /student\.cohort_id/, 'cohort resolved server-side from the student')
  }
})

test('certificate semantics are unchanged', () => {
  // Casey-Fink remains the certificate gate; ASPIRE stays decoupled.
  const cf = read('src/lib/evaluation/caseyFinkPostRotationDueDetection.js')
  assert.match(cf, /certificate-gating workflow/)
  const pr = read('src/lib/evaluation/postRotationCertDueDetection.js')
  assert.match(pr, /decoupled from the Certificate of Completion/)
  assert.doesNotMatch(pr, /from\('certificates'\)/)
  // This feature reads no certificate data at all.
  // Code lines only: the header and JSDoc explain the certificate boundary, and
  // a naive scan would match its own explanation. Strip //, /* and * lines.
  const seq = read('src/lib/evaluation/postRotationSequence.js')
    .split('\n').filter(l => !/^\s*(\/\/|\/\*|\*)/.test(l)).join('\n')
  assert.doesNotMatch(seq, /certificate/i)
})

test('the sequence module is pure: no I/O, no sending, no writes', () => {
  const seq = read('src/lib/evaluation/postRotationSequence.js')
    .split('\n').filter(l => !/^\s*(\/\/|\/\*|\*)/.test(l)).join('\n')
  assert.doesNotMatch(seq, /supabase|fetch\(|resend|insert\(|update\(|delete\(/i)
})

test('the required checklist is exactly the three confirmed activities', () => {
  // Residency > Support's order (Owner, 2026-09-20): Résumé Review, Town Hall, Interview Bootcamp.
  assert.deepEqual([...REQUIRED_ACTIVITY_KEYS], ['resume_review', 'town_hall', 'interview_bootcamp'])
  // The migration's CHECK must allow exactly these and no more.
  const mig = read('supabase/migrations/20260822000000_student_activity_completions.sql')
  for (const k of REQUIRED_ACTIVITY_KEYS) assert.match(mig, new RegExp(`'${k}'`))
  // Append-only model: correction is a NEW row, so there is deliberately NO
  // UNIQUE(student, activity) - that would make a correction an overwrite.
  assert.doesNotMatch(mig, /uq_sac_student_activity UNIQUE/)
  assert.match(mig, /REVOKE UPDATE, DELETE ON student_activity_completions FROM service_role/,
    'append-only is enforced by the database, not by application code')
  assert.match(mig, /chk_sac_action_shape/,
    'a completion carries a date; a reversal carries a reason')
})

test('the activity ledger is not a parallel evaluation status system', () => {
  const mig = read('supabase/migrations/20260822000000_student_activity_completions.sql')
    .split('\n').filter(l => !/^\s*--/.test(l)).join('\n')
  for (const forbidden of [/assignment_id/, /instrument_id/, /\bstatus\b/, /token/]) {
    assert.doesNotMatch(mig, forbidden, `the ledger must not carry ${forbidden}`)
  }
})

// ── Panel wiring ────────────────────────────────────────────────────────────

test('the Casey-Fink slip carries the Student Feedback verdict and never offers Release while blocked', () => {
  // REVIEW-RELEASE-2: the panels are retired; the adapter carries the verdict and the
  // queue renders a blocked slip with one action (a jump or a wait), never a Release.
  const src = read('src/lib/evaluation/reviewQueueAdapters.js')
  assert.match(src, /caseyFinkPrerequisite\(/, 'each row carries the verdict')
  assert.match(src, /node\('before', 'waiting', 'Student feedback', 'Not released yet'\)/)
  const queue = read('src/components/evaluation/ReviewReleaseQueue.jsx')
  const blocked = queue.slice(queue.indexOf("{b?.action === 'jump'"), queue.indexOf('no manual Remind yet'))
  assert.doesNotMatch(blocked, /onRelease\(/, 'a blocked slip has no Release control')
})

test('the ASPIRE feedback slip shows all three prerequisites separately, and records the activities on the slip', () => {
  const src = read('src/lib/evaluation/reviewQueueAdapters.js')
  assert.match(src, /aspirePrerequisites\(all, activityByStudent\.get\(r\.studentId\) \|\| \[\], undefined, supportByStudent\.get\(r\.studentId\) \|\| \[\]\)/, 'rows carry the verdict, from the ledger AND Support')
  assert.match(src, /'Student feedback'/)
  assert.match(src, /'Casey-Fink'/)
  assert.match(src, /activities: prereq\.activities \|\| \[\],/, 'each required activity travels with the item')
  const queue = read('src/components/evaluation/ReviewReleaseQueue.jsx')
  assert.match(queue, /data-testid="pr-activity-area"/)
  assert.match(queue, /\(item\.activities \|\| \[\]\)\.map\(a => \{/, 'each required activity renders on its own line')
})

test('an unavailable activity ledger can never read as complete on the slip', () => {
  const src = read('src/lib/evaluation/reviewQueueAdapters.js')
  // The display fallback forces ok:false rather than an empty (satisfied) list.
  assert.match(src, /ledgerDown \? \{ \.\.\.pre, ok: false, ledgerUnavailable: true \} : pre/)
  assert.match(src, /Activities unverifiable/)
  // NEGATIVE CONTROL: the loader marks the ledger down, never an empty satisfied map.
  const loader = read('src/lib/evaluation/reviewQueueLoaders.js')
  assert.match(loader, /activityByStudent = new Map\(\)\s*\n\s*ledgerDown = true/)
})

test('the dashboard never sends: it only calls the release endpoints with their workflow declared', () => {
  const src = read('src/components/evaluation/SurveyAutomationDashboard.jsx')
  assert.doesNotMatch(src, /resend|emails\.send/i, 'the dashboard must not send')
  assert.match(src, /expected_instrument_slug: route\.instrumentSlug/, 'every release declares its workflow')
})

test('release stays manual and per student: no automatic sending was introduced', () => {
  for (const f of [
    'api/evaluation-release-casey-fink-post-rotation-survey.js',
    'api/evaluation-release-post-rotation-survey.js',
  ]) {
    const src = read(f)
    // Single-student endpoints: the body allowlist admits one student id only.
    assert.match(src, /ALLOWED_KEYS = \['student_id', 'expected_instrument_slug'\]/)
    assert.doesNotMatch(src, /student_ids|for \(const s of students\)/, `${f} must not batch`)
  }
  // Nothing schedules a release.
  const seq = read('src/lib/evaluation/postRotationSequence.js')
  assert.doesNotMatch(seq, /setTimeout|setInterval|cron/i)
})

// ── Deterministic ordering + concurrency ────────────────────────────────────

test('tied timestamps resolve DETERMINISTICALLY, whatever order rows arrive in', () => {
  const T = '2026-08-17T12:00:00.000Z'
  const complete = { id: '11111111-1111-4111-8111-111111111111', activity_key: 'town_hall', action: 'complete', completed_at: T, created_at: T }
  const reverse  = { id: '22222222-2222-4222-8222-222222222222', activity_key: 'town_hall', action: 'reverse',  completed_at: null, created_at: T }

  const a = currentActivityState([complete, reverse]).get('town_hall')
  const b = currentActivityState([reverse, complete]).get('town_hall')
  assert.equal(a.completed, b.completed,
    'PostgreSQL returns tied rows in arbitrary order; the verdict must not depend on it')
  // The higher id wins the tie, so the outcome is also PREDICTABLE, not just stable.
  assert.equal(a.completed, false, 'the reverse (higher id) is the latest event')
})

test('two concurrent identical completions converge on one effective state', () => {
  // The endpoint reads-then-appends, so a true race can append twice. That is
  // harmless by construction: two 'complete' events reduce to ONE completed
  // state, and the earlier completion date is the one reported.
  const rows = [
    { id: 'aaaa1111-1111-4111-8111-111111111111', activity_key: 'town_hall', action: 'complete', completed_at: '2026-08-17T12:00:00.000Z', created_at: '2026-08-17T12:00:00.000Z' },
    { id: 'bbbb2222-2222-4222-8222-222222222222', activity_key: 'town_hall', action: 'complete', completed_at: '2026-08-17T12:00:00.000Z', created_at: '2026-08-17T12:00:00.000Z' },
  ]
  const st = currentActivityState(rows).get('town_hall')
  assert.equal(st.completed, true)
  const pre = aspirePrerequisites(
    [done(STEP_SLUGS.feedback), done(STEP_SLUGS.caseyFink)],
    [...rows,
     { id: 'c1', activity_key: 'interview_bootcamp', action: 'complete', completed_at: '2026-08-17T12:00:00.000Z', created_at: '2026-08-17T12:00:00.000Z' },
     { id: 'c2', activity_key: 'resume_review', action: 'complete', completed_at: '2026-08-17T12:00:00.000Z', created_at: '2026-08-17T12:00:00.000Z' }],
  )
  assert.equal(pre.ok, true, 'a duplicated completion does not double-count or corrupt the gate')
  assert.equal(pre.activities.filter(a => a.key === 'town_hall').length, 1, 'one checklist line, not two')
})

test('every reader selects what the reducer needs to be correct', () => {
  // NEGATIVE CONTROL for a real defect found in QC: the old panel originally selected
  // no `action` column, so a REVERSED activity still reduced to completed=true. The
  // loader that replaced it must select the same.
  const loader = read('src/lib/evaluation/reviewQueueLoaders.js')
  const sel = loader.slice(loader.indexOf("from('student_activity_completions')"), loader.indexOf("from('student_activity_completions')") + 260)
  for (const col of ['id', 'action', 'completed_at', 'created_at']) {
    assert.match(sel, new RegExp(`\\b${col}\\b`), `the loader must select ${col} or its reducer is wrong`)
  }
  const ep = read('api/student-activity-completion.js')
  const esel = ep.slice(ep.indexOf("from('student_activity_completions')"), ep.indexOf("from('student_activity_completions')") + 520)
  for (const col of ['id', 'action', 'created_at']) {
    assert.match(esel, new RegExp(`\\b${col}\\b`), `the endpoint must select ${col}`)
  }
  assert.match(esel, /\.order\('id'/, 'and order deterministically on ties')
})

test('a reversed activity reduces to NOT complete', () => {
  const rows = [
    { id: 'a1', activity_key: 'town_hall', action: 'complete', completed_at: '2026-08-01T00:00:00Z', created_at: '2026-08-01T00:00:00Z' },
    { id: 'a2', activity_key: 'town_hall', action: 'reverse', completed_at: null, created_at: '2026-08-02T00:00:00Z' },
  ]
  const pre = aspirePrerequisites([done(STEP_SLUGS.feedback), done(STEP_SLUGS.caseyFink)], rows)
  assert.equal(pre.ok, false)
  assert.equal(pre.activities.find(a => a.key === 'town_hall').completed, false)
})

// ── REVIEW-RELEASE-2 (Owner, 2026-09-20): Support's entries count too ────────────
function fullAssignments() { return [done(STEP_SLUGS.feedback), done(STEP_SLUGS.caseyFink)] }
test('an activity recorded under Residency > Support counts, a voided one does not, and the source is named', () => {
  const ledger = [{ activity_key: 'town_hall', action: 'complete', completed_at: '2026-09-01T18:00:00Z', created_at: '2026-09-01T18:00:00Z' }]
  const support = [
    { activity: 'resume_review', occurred_on: '2026-09-03' },
    { activity: 'resume_review', occurred_on: '2026-09-10' },
    { activity: 'interview_bootcamp', occurred_on: '2026-09-05', voided_at: '2026-09-06T00:00:00Z' },
  ]
  const r = aspirePrerequisites(fullAssignments(), ledger, undefined, support)
  const by = Object.fromEntries(r.activities.map(a => [a.key, a]))
  assert.equal(by.resume_review.completed, true); assert.equal(by.resume_review.source, 'support')
  assert.equal(by.resume_review.completedAt, '2026-09-10', 'the most recent Support date'); assert.equal(by.resume_review.supportCount, 2)
  assert.equal(by.town_hall.completed, true); assert.equal(by.town_hall.source, 'ledger')
  assert.equal(by.interview_bootcamp.completed, false, 'a voided entry never counts'); assert.equal(by.interview_bootcamp.source, null)
  assert.equal(r.ok, false); assert.deepEqual(r.unmet.map(u => u.label), ['Interview Bootcamp'])
  // Display order is Support's.
  assert.deepEqual(r.activities.map(a => a.label), ['Résumé Review', 'Town Hall', 'Interview Bootcamp'])
  // Both records agree: source says so.
  const both = aspirePrerequisites(fullAssignments(), ledger, undefined, [{ activity: 'town_hall', occurred_on: '2026-09-02' }])
  assert.equal(both.activities.find(a => a.key === 'town_hall').source, 'both')
})

test('the release endpoint reads Support before the gate, as the secondary source, and the support API serves it to the team only', () => {
  const src = read('api/evaluation-release-post-rotation-survey.js')
  const sup = src.indexOf(".from('ngrp_support_entries')"), gate = src.indexOf('aspirePrerequisites(rawAssignments')
  assert.ok(sup > -1 && sup < gate, 'Support is read before the gate runs')
  assert.match(src, /\.in\('activity', REQUIRED_ACTIVITY_KEYS\)\s*\.is\('voided_at', null\)/)
  assert.match(src, /if \(!supErr\) supportRows = sup \|\| \[\];/, 'a failed Support read leaves the ledger alone to decide')
  assert.match(src, /aspirePrerequisites\(rawAssignments \|\| \[\], activityRows, REQUIRED_ACTIVITY_KEYS, supportRows\)/)
  const api = read('api/ngrp-support.js')
  assert.match(api, /const TEAM_ONLY = new Set\(\[\.\.\.WRITES, 'reflection_view', 'entries_for_students'\]\)/)
  assert.match(api, /\.in\('activity', \['resume_review', 'town_hall', 'interview_bootcamp'\]\)\s*\.is\('voided_at', null\)/)
  const loader = read('src/lib/evaluation/reviewQueueLoaders.js')
  assert.match(loader, /postNgrpSupport\('entries_for_students', \{ student_ids: studentIds \}\)/)
  assert.match(loader, /supportDown = true/)
})
