// KEITH-AUTO-1 (Owner, 2026-11-02): Keith scores every new résumé and assesses the Transition
// Form's statements on his own. These pin who is picked, what is never retried, that the sweep
// runs as 'system' with the Skills' own switches, and the cron itself.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { resumeTargets, assessmentTargets, RETRY_AFTER_MS, MAX_TRIES } from '../lib/server/keith/residencyAutoRun.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = p => readFileSync(join(root, p), 'utf8')
const NOW = Date.parse('2026-11-02T18:00:00Z')
const ago = ms => new Date(NOW - ms).toISOString()

test('résumés: a new one is scored, a failed one is retried later and only so often', () => {
  const statuses = {
    a: { key: 'unscored' },
    b: { key: 'scored', reviewId: 'rb' },
    c: { key: 'failed', reviewId: 'rc' },
    d: { key: 'failed', reviewId: 'rd' },
    e: { key: 'failed', reviewId: 're' },
    f: { key: 'none' },
    g: { key: 'scoring', reviewId: 'rg' },
  }
  const reviews = [
    { id: 'rc', document_version_id: 'vc', status: 'failed', error_reason: 'upstream_timeout', requested_at: ago(RETRY_AFTER_MS + 1) },
    { id: 'rd', document_version_id: 'vd', status: 'failed', error_reason: 'unreadable_pdf', requested_at: ago(RETRY_AFTER_MS + 1) },
    { id: 're', document_version_id: 've', status: 'failed', error_reason: 'upstream_error', requested_at: ago(60_000) },
  ]
  const out = resumeTargets({ studentIds: Object.keys(statuses), statuses, reviews, nowMs: NOW })
  assert.deepEqual(out, [{ studentId: 'a', reason: 'new' }, { studentId: 'c', reason: 'retry' }],
    'scored, none and scoring are left; an unreadable file is never retried; a fresh failure waits')

  const many = Array.from({ length: MAX_TRIES }, (_, i) => ({
    id: `r${i}`, document_version_id: 'vx', status: 'failed', error_reason: 'upstream_error', requested_at: ago(RETRY_AFTER_MS + 1 + i),
  }))
  assert.deepEqual(resumeTargets({ studentIds: ['x'], statuses: { x: { key: 'failed', reviewId: 'r0' } }, reviews: many, nowMs: NOW }), [],
    `${MAX_TRIES} failures on one file stop the retries`)
})

test('statements: submitted forms only, new or changed, and never while a résumé is about to be read', () => {
  const candidates = [
    { id: 'k1', student_id: 's1', assignment_id: 'a1', form_status: 'submitted' },
    { id: 'k2', student_id: 's2', assignment_id: 'a2', form_status: 'submitted' },
    { id: 'k3', student_id: 's3', assignment_id: 'a3', form_status: 'sent' },
    { id: 'k4', student_id: 's4', assignment_id: 'a4', form_status: 'submitted' },
    { id: 'k5', student_id: 's5', assignment_id: 'a5', form_status: 'submitted' },
    { id: 'k6', student_id: 's6', assignment_id: 'a6', form_status: 'submitted' },
    { id: 'k7', student_id: 's7', assignment_id: 'a7', form_status: 'submitted' },
  ]
  const scores = new Map([
    ['k1', {}],
    ['k2', { assessment: { stale: true } }],
    ['k3', {}],
    ['k4', { assessment: { stale: false } }],
    ['k5', { lastRun: { status: 'assessing' } }],
    ['k6', { lastRun: { status: 'failed', errorReason: 'form_not_submitted', requestedAt: ago(RETRY_AFTER_MS + 1) } }],
    ['k7', {}],
  ])
  const out = assessmentTargets({ candidates, scores, waitFor: new Set(['s7']), nowMs: NOW })
  assert.deepEqual(out, [{ candidateId: 'k1', reason: 'new' }, { candidateId: 'k2', reason: 'changed' }])
})

test('the sweep runs as system, under the Skills\' own switches, and stays on Sonnet', () => {
  const run = read('lib/server/keith/residencyAutoRun.js')
  assert.match(run, /scoringAvailability\(db, null, \{ system: true \}\)/)
  assert.match(run, /assessmentAvailability\(db, null, \{ system: true \}\)/)
  assert.match(run, /if \(!resumeOn\.available && !assessOn\.available\) return \{ \.\.\.counts, skipped: 'skills_off' \}/)
  assert.match(run, /scoreResumeVersion\(db, storage, \{ student, versionId: adopted\.versionId, system: true/)
  assert.match(run, /assessCandidate\(db, \{ cycleId: cycle\.id, candidateId: d\.candidateId, system: true/)
  assert.doesNotMatch(run, /model_route|claude-/, 'the route is the Skill row\'s, never named here')
  // A system run skips the caller's gate and nothing else.
  const rr = read('lib/server/resumeReview.js')
  assert.match(rr, /skillMode\(skill\) === 'off'\) return \{ available: false, reason: 'skill_off' \}\n    if \(system\) return \{ available: true \}/)
  assert.match(rr, /if \(!system\) \{\n    const gate = await authorizeStudentResumeAccess/)
  const cs = read('lib/server/ngrpCandidateScores.js')
  assert.match(cs, /system = false/)
})

test('the cron: every 10 minutes, real rows only, recorded in cron_runs', () => {
  const cron = read('api/cron/keith-residency-auto.js')
  assert.match(cron, /if \(!isAuthorizedCronRequest\(req\)\) return res\.status\(401\)/)
  assert.match(cron, /const db = populationDb\(createClient\(/)
  assert.match(cron, /startCronRun\(db, CRON_NAME\)/)
  const vercel = JSON.parse(read('vercel.json'))
  assert.ok(vercel.crons.some(c => c.path === '/api/cron/keith-residency-auto' && c.schedule === '5-59/10 * * * *'))
  assert.equal(vercel.functions['api/cron/keith-residency-auto.js'].maxDuration, 300)
})
