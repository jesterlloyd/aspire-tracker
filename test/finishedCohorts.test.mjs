// FINISHED-COHORTS-1 (Owner, 2026-10-08): a Completed or Archived cohort shows only its
// evaluations in the Action Center; placement and interviews end with the cohort.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { isFinishedCohort } from '../src/lib/actionCenter/queueModel.js'

const read = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

test('Completed, Archived or a completion date is finished; Planning and Active are not', () => {
  assert.equal(isFinishedCohort({ status: 'Completed' }), true)
  assert.equal(isFinishedCohort({ status: 'Archived' }), true)
  assert.equal(isFinishedCohort({ status: 'Active', completed_at: '2026-08-18' }), true)
  assert.equal(isFinishedCohort({ status: 'Active' }), false)
  assert.equal(isFinishedCohort({ status: 'Planning' }), false)
  assert.equal(isFinishedCohort(null), false)
})

test('the queue skips placement and interviews for a finished cohort, in scope or not, and keeps Review & Release', () => {
  const hook = read('src/hooks/useActionCenterQueue.js')
  assert.match(hook, /finished \? Promise\.resolve\(null\) : loadRotationWindows/)
  assert.match(hook, /finished \? Promise\.resolve\(null\) : loadTodaysInterviews/)
  assert.match(hook, /if \(other\.rotations\) otherGroups\.push\(placementGroup/)
  assert.match(hook, /if \(qIv\.data && !activeFinished\)/)
  assert.match(hook, /if \(qRot\.data && !activeFinished\)/)
  assert.match(hook, /if \(other\.review\) otherGroups\.push\(reviewReleaseGroup/)
})
