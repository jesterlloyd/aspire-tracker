import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  classifyCaseyFinkPostRotationCohort,
  isCaseyFinkReissuableAssignment,
} from '../src/lib/evaluation/caseyFinkPostRotationDueDetection.js'

const here = dirname(fileURLToPath(import.meta.url))
const read = (path) => readFileSync(join(here, '..', path), 'utf8')
const NOW = Date.parse('2026-09-07T21:19:04.000Z')
const student = {
  id: 'student-1', first_name: 'Melissa', last_name: 'Rodriguez',
  approved_hours: 108, hours_required: 108, personal_email: 'student@example.com',
}

function classify(assignment) {
  return classifyCaseyFinkPostRotationCohort({
    students: [student], assignments: assignment ? [{ student_id: student.id, ...assignment }] : [],
    nowMs: NOW,
  })
}

test('a student with no assignment remains a first-time release', () => {
  const out = classify(null)
  assert.equal(out.rows[0].status, 'eligible_for_review')
  assert.equal(out.summary.due_sendable, 1)
  assert.equal(out.summary.reissue_required, 0)
})

test('an expired or revoked non-completed assignment is explicitly reissuable', () => {
  const cases = [
    { id: 'expired-date', status: 'sent', expires_at: '2026-09-01T00:00:00Z' },
    { id: 'expired-state', status: 'expired', expires_at: '2026-10-01T00:00:00Z' },
    { id: 'non-responder', status: 'non_responder', expires_at: '2026-09-01T00:00:00Z' },
    { id: 'revoked', status: 'revoked', revoked_at: '2026-09-01T00:00:00Z' },
  ]
  for (const assignment of cases) {
    assert.equal(isCaseyFinkReissuableAssignment(assignment, NOW), true, assignment.id)
    const out = classify(assignment)
    assert.equal(out.rows[0].status, 'readiness_reissue', assignment.id)
    assert.equal(out.summary.due_sendable, 1, assignment.id)
    assert.equal(out.summary.reissue_required, 1, assignment.id)
  }
})

test('an expired assignment is blocked when the student no longer meets the hours gate', () => {
  const belowHours = { ...student, approved_hours: 90 }
  const out = classifyCaseyFinkPostRotationCohort({
    students: [belowHours],
    assignments: [{ student_id: student.id, id: 'expired', status: 'expired' }],
    nowMs: NOW,
  })
  assert.equal(out.rows[0].status, 'not_eligible')
  assert.equal(out.summary.due_sendable, 0)
})

test('the exact expiry boundary is reissuable in both state and action detection', () => {
  const out = classify({ id: 'boundary', status: 'sent', expires_at: new Date(NOW).toISOString() })
  assert.equal(out.rows[0].status, 'readiness_reissue')
})

test('active, completed, and unknown assignments are never reissuable', () => {
  const active = { id: 'active', status: 'sent', expires_at: '2026-10-01T00:00:00Z' }
  const completed = { id: 'completed', status: 'completed', completed_at: '2026-09-02T00:00:00Z' }
  const draft = { id: 'draft', status: 'draft', expires_at: '2026-09-01T00:00:00Z' }
  assert.equal(classify(active).rows[0].status, 'readiness_released')
  assert.equal(classify(completed).rows[0].status, 'readiness_completed')
  assert.equal(classify(draft).rows[0].status, 'readiness_attention')
  for (const assignment of [active, completed, draft]) {
    assert.equal(isCaseyFinkReissuableAssignment(assignment, NOW), false, assignment.id)
  }
})

test('an uncertain provider outcome becomes support-review state, not a resend button', () => {
  const out = classify({
    id: 'uncertain', status: 'sent', expires_at: '2026-10-01T00:00:00Z',
    notes: 'casey_fink_readiness_2024:post_rotation:delivery_uncertain',
  })
  assert.equal(out.rows[0].status, 'readiness_attention')
  assert.match(out.rows[0].warnings.join(' '), /needs review/i)
  assert.equal(out.summary.due_sendable, 0)
  assert.equal(out.summary.due_unsendable, 1)
})

test('the endpoint reuses the terminal row and claims it before token mutation or email', () => {
  const source = read('api/evaluation-release-casey-fink-post-rotation-survey.js')
  const claimAt = source.indexOf(".update({ status: 'draft', revoked_at: null, notes: REISSUE_CLAIM_NOTE")
  const tokenAt = source.indexOf(".from('evaluation_assignment_tokens')", claimAt)
  const sendAt = source.indexOf('resend.emails.send', tokenAt)
  assert.ok(claimAt > -1)
  assert.ok(tokenAt > claimAt)
  assert.ok(sendAt > tokenAt)
  assert.match(source.slice(claimAt, tokenAt), /\.eq\('status', reissueRow\.status\)/,
    'the terminal status is the compare-and-set concurrency guard')
  assert.match(source.slice(claimAt, tokenAt), /revoked_at: null/,
    'a claimed revoked row cannot still look reissuable to a concurrent reader')
  assert.match(source, /assignmentId = activated\.id/)
  assert.match(source, /reissued: !!reissueRow/)
  assert.match(source, /\.eq\('student_id', studentId\)\s*\.eq\('cohort_id', cohortId\)/,
    'the endpoint cannot mutate a prior-cohort assignment')
})

test('reissue rotates one surviving token row and retires historical rows first', () => {
  const source = read('api/evaluation-release-casey-fink-post-rotation-survey.js')
  const tokenBlock = source.slice(
    source.indexOf('// Historical data may contain more than one token row'),
    source.indexOf('const { data: activated', source.indexOf('// Historical data may contain more than one token row')),
  )
  assert.match(tokenBlock, /const survivor = tokenRows\?\.\[0\]/)
  assert.match(tokenBlock, /obsoleteTokenIds[\s\S]*\.in\('id', obsoleteTokenIds\)/)
  assert.match(tokenBlock, /\.eq\('id', survivor\.id\)/,
    'only one token row receives the new unique hash')
  assert.doesNotMatch(tokenBlock, /\.update\([\s\S]*token_hash:[\s\S]*\.eq\('assignment_id', reissueRow\.id\)/,
    'never write the same unique hash to every historical token row')
})

test('every legacy invitation generator avoids updating multiple rows to one token hash', () => {
  for (const file of [
    'api/evaluation-create-invitation.js',
    'api/evaluation-bulk-invitations.js',
  ]) {
    const source = read(file)
    assert.match(source, /const survivor = tokenRows\?\.\[0\]/, file)
    assert.match(source, /\.in\('id', obsoleteTokenIds\)/, file)
    assert.match(source, /\.eq\('id', survivor\.id\)/, file)
    assert.doesNotMatch(source, /token_hash:[\s\S]{0,500}\.eq\('assignment_id', reissueRow\.id\)/,
      `${file} must not assign one unique hash to every historical token`)
  }
})

test('historical notification logs suppress only first-time release, not deliberate reissue', () => {
  const source = read('api/evaluation-release-casey-fink-post-rotation-survey.js')
  const dedup = source.slice(source.indexOf('// ── 6. notification_log dedup.'), source.indexOf('// ── 7.'))
  assert.match(dedup, /if \(!reissueRow\)/)
  assert.match(dedup, /from\('notification_log'\)/)
})

test('explicit rejection revokes safely while an uncertain outcome blocks blind retry', () => {
  const source = read('api/evaluation-release-casey-fink-post-rotation-survey.js')
  const uncertainAt = source.indexOf('if (deliveryUncertain)')
  const rejectionAt = source.indexOf('if (sendError)', uncertainAt)
  assert.ok(uncertainAt > -1 && rejectionAt > uncertainAt)
  const uncertain = source.slice(uncertainAt, rejectionAt)
  assert.match(uncertain, /delivery_uncertain/)
  assert.doesNotMatch(uncertain, /status: 'revoked'/)
  const rejection = source.slice(rejectionAt, source.indexOf('// ── 12.', rejectionAt))
  assert.match(rejection, /status: 'revoked'/)
  assert.match(source, /idempotencyKey: `casey-fink-release\/\$\{assignmentId\}:\$\{nowIso\}`/)
})

test('the panel exposes reissue and keeps the result beside the affected row', () => {
  const panel = read('src/components/evaluation/CaseyFinkPostRotationAutomationPanel.jsx')
  assert.match(panel, /Reissue Survey/)
  assert.match(panel, /Confirm & Reissue/)
  assert.match(panel, /data-testid="cf-row-release-result"/)
  assert.match(panel, /releaseMsg\?\.studentId === r\.studentId/)
  assert.match(panel, /expired or revoked link/)
})
