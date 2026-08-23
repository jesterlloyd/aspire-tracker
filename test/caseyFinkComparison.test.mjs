import test from 'node:test'
import assert from 'node:assert/strict'
import { buildCaseyFinkComparison } from '../src/lib/evaluation/caseyFinkComparison.js'

const CASEY_FINK = 'casey_fink_readiness_2024'

function assignment({
  studentId,
  timepoint,
  cps,
  la,
  pr,
  item1 = 1,
  status = 'completed',
  slug = CASEY_FINK,
  submittedAt = '2026-08-01T12:00:00Z',
}) {
  return {
    id: `${studentId}-${timepoint}-${submittedAt}`,
    timepoint,
    status,
    students: { id: studentId },
    evaluation_instruments: { slug },
    evaluation_responses: [{
      submitted_at: submittedAt,
      score_s1_clinical_problem_solving: cps,
      score_s1_learning_activities: la,
      score_s1_practice_readiness: pr,
      responses: {
        S1_Q01: item1,
        S1_Q02: 2,
        S1_Q03: 3,
        S1_Q04: 4,
        S1_Q05: 3,
        S1_Q06: 2,
        S1_Q07: 1,
        S1_Q08: 2,
        S1_Q09: 3,
        S1_Q10: 4,
        S1_Q11: 3,
        S1_Q12: 1,
        S1_Q13: 2,
        S1_Q14: 3,
        S1_Q15: 4,
      },
    }],
  }
}

test('pairs only the same student baseline and post-rotation responses', () => {
  const comparison = buildCaseyFinkComparison([
    assignment({ studentId: 'a', timepoint: 'baseline', cps: 2, la: 2.5, pr: 3, item1: 1 }),
    assignment({ studentId: 'a', timepoint: 'post_rotation', cps: 3, la: 3, pr: 4, item1: 3 }),
    assignment({ studentId: 'b', timepoint: 'early_rotation_baseline', cps: 3, la: 3.5, pr: 2, item1: 2 }),
    assignment({ studentId: 'b', timepoint: 'post_rotation', cps: 4, la: 3.5, pr: 3, item1: 4 }),
    assignment({ studentId: 'baseline-only', timepoint: 'baseline', cps: 4, la: 4, pr: 4 }),
    assignment({ studentId: 'post-only', timepoint: 'post_rotation', cps: 1, la: 1, pr: 1 }),
    assignment({ studentId: 'other-instrument', timepoint: 'baseline', cps: 4, la: 4, pr: 4, slug: 'preceptor_progress' }),
  ])

  assert.equal(comparison.matchedCount, 2)
  assert.equal(comparison.baselineOnlyCount, 1)
  assert.equal(comparison.postOnlyCount, 1)

  const [cps, la, pr] = comparison.metrics
  assert.equal(cps.preMean, 2.5)
  assert.equal(cps.postMean, 3.5)
  assert.equal(cps.delta, 1)
  assert.deepEqual(cps.changeCounts, { improved: 2, unchanged: 0, declined: 0 })
  assert.equal(la.preMean, 3)
  assert.equal(la.postMean, 3.25)
  assert.equal(la.delta, 0.25)
  assert.deepEqual(la.changeCounts, { improved: 1, unchanged: 1, declined: 0 })
  assert.equal(pr.preMean, 2.5)
  assert.equal(pr.postMean, 3.5)
  assert.equal(pr.delta, 1)
  assert.deepEqual(pr.changeCounts, { improved: 2, unchanged: 0, declined: 0 })
})

test('student-level changes expose cancellation hidden by an unchanged aggregate mean', () => {
  const comparison = buildCaseyFinkComparison([
    assignment({ studentId: 'improved', timepoint: 'baseline', cps: 3, la: 3.4, pr: 3 }),
    assignment({ studentId: 'improved', timepoint: 'post_rotation', cps: 3, la: 3.8, pr: 3 }),
    assignment({ studentId: 'declined', timepoint: 'baseline', cps: 3, la: 3.8, pr: 3 }),
    assignment({ studentId: 'declined', timepoint: 'post_rotation', cps: 3, la: 3.4, pr: 3 }),
    assignment({ studentId: 'unchanged', timepoint: 'baseline', cps: 3, la: 3.6, pr: 3 }),
    assignment({ studentId: 'unchanged', timepoint: 'post_rotation', cps: 3, la: 3.6, pr: 3 }),
  ])

  const learningActivities = comparison.metrics.find(metric => metric.key === 'learning_activities')
  assert.ok(Math.abs(learningActivities.preMean - 3.6) < 1e-12)
  assert.ok(Math.abs(learningActivities.postMean - 3.6) < 1e-12)
  assert.ok(Math.abs(learningActivities.delta) < 1e-12)
  assert.deepEqual(learningActivities.changeCounts, { improved: 1, unchanged: 1, declined: 1 })
})

test('question-level distributions use matched students only', () => {
  const comparison = buildCaseyFinkComparison([
    assignment({ studentId: 'a', timepoint: 'baseline', cps: 2, la: 2, pr: 2, item1: 1 }),
    assignment({ studentId: 'a', timepoint: 'post_rotation', cps: 3, la: 3, pr: 3, item1: 3 }),
    assignment({ studentId: 'b', timepoint: 'baseline', cps: 2, la: 2, pr: 2, item1: 2 }),
    assignment({ studentId: 'b', timepoint: 'post_rotation', cps: 4, la: 4, pr: 4, item1: 4 }),
    assignment({ studentId: 'post-only', timepoint: 'post_rotation', cps: 4, la: 4, pr: 4, item1: 4 }),
  ])

  const item1 = comparison.itemDistributions.find(item => item.itemCode === 'S1_Q01')
  assert.deepEqual(item1.pre, { counts: [1, 1, 0, 0], total: 2 })
  assert.deepEqual(item1.post, { counts: [0, 0, 1, 1], total: 2 })
})

test('a true baseline takes precedence over an early-rotation baseline', () => {
  const comparison = buildCaseyFinkComparison([
    assignment({
      studentId: 'a', timepoint: 'early_rotation_baseline', cps: 1, la: 1, pr: 1,
      submittedAt: '2026-07-01T12:00:00Z',
    }),
    assignment({
      studentId: 'a', timepoint: 'baseline', cps: 3, la: 3, pr: 3,
      submittedAt: '2026-07-02T12:00:00Z',
    }),
    assignment({ studentId: 'a', timepoint: 'post_rotation', cps: 4, la: 4, pr: 4 }),
  ])

  assert.equal(comparison.matchedCount, 1)
  assert.equal(comparison.metrics[0].preMean, 3)
  assert.equal(comparison.metrics[0].postMean, 4)
})

test('incomplete, invalid, and non-completed responses cannot enter a pair', () => {
  const comparison = buildCaseyFinkComparison([
    assignment({ studentId: 'invalid', timepoint: 'baseline', cps: 0, la: 3, pr: 3 }),
    assignment({ studentId: 'invalid', timepoint: 'post_rotation', cps: 4, la: 4, pr: 4 }),
    assignment({ studentId: 'opened', timepoint: 'baseline', cps: 3, la: 3, pr: 3, status: 'opened' }),
    assignment({ studentId: 'opened', timepoint: 'post_rotation', cps: 4, la: 4, pr: 4 }),
  ])

  assert.equal(comparison.matchedCount, 0)
  assert.equal(comparison.baselineOnlyCount, 0)
  assert.equal(comparison.postOnlyCount, 2)
})
