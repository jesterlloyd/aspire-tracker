import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const read = path => readFileSync(join(here, '..', path), 'utf8')

test('Connect loads Post-Rotation eligibility from the canonical release endpoint', () => {
  const source = read('src/components/connect/OutreachView.jsx')
  assert.match(source, /POST_ROTATION_ROUTE = RELEASE_ROUTES\.caseyFinkPostRotation/)
  assert.match(source, /postRotationStudentEmail = student => \(student\?\.personal_email \|\| ''\)\.trim\(\) \|\| \(student\?\.school_email \|\| ''\)\.trim\(\)/,
    'Connect displays the same personal-first recipient that the server sends to')
  assert.match(source, /fetch\(`\$\{POST_ROTATION_ROUTE\.endpoint\}\?cohort_id=/)
  assert.match(source, /payload\.instrument_slug !== POST_ROTATION_ROUTE\.instrumentSlug/)
  assert.match(source, /payload\.timepoint !== POST_ROTATION_ROUTE\.timepoint/)
  assert.match(source, /postRotationEligibility\[s\.id\]\?\.actionable/)
})

test('single and bulk Post-Rotation sends use the same guarded per-student operation', () => {
  const source = read('src/components/connect/OutreachView.jsx')
  const occurrences = source.match(/fetch\(POST_ROTATION_ROUTE\.endpoint/g) || []
  assert.equal(occurrences.length, 2, 'single and bulk each call the canonical POST route')
  assert.match(source, /student_id: selectedStudent\.id[\s\S]*expected_instrument_slug: POST_ROTATION_ROUTE\.instrumentSlug/)
  assert.match(source, /student_id: studentId[\s\S]*expected_instrument_slug: POST_ROTATION_ROUTE\.instrumentSlug/)
  assert.match(source, /bulkSendPhrase !== 'SEND SURVEYS'/)
})

test('Baseline duplicate checks are scoped to Casey-Fink instead of any completed survey', () => {
  const source = read('src/components/connect/OutreachView.jsx')
  const check = source.slice(
    source.indexOf('// ── Prior-invitation pre-check'),
    source.indexOf('// ── Clear generated link'),
  )
  assert.match(check, /evaluation_instruments!inner \( slug \)/)
  assert.match(check, /\.eq\('evaluation_instruments\.slug', instrument\)/)
})

test('generic invitation endpoints refuse Post-Rotation Casey-Fink routing', () => {
  for (const file of [
    'api/evaluation-create-invitation.js',
    'api/evaluation-bulk-invitations.js',
    'api/evaluation-send-bulk-invitations.js',
  ]) {
    const source = read(file)
    assert.match(source, /use_casey_fink_post_rotation_release/, file)
    assert.match(source, /guarded release workflow/, file)
  }
})

test('canonical eligibility combines detector state, feedback prerequisite, and email', () => {
  const source = read('api/evaluation-release-casey-fink-post-rotation-survey.js')
  const block = source.slice(source.indexOf('async function getCohortEligibility'), source.indexOf('export default async function handler'))
  assert.match(block, /classifyCaseyFinkPostRotationCohort/)
  assert.match(block, /caseyFinkPrerequisite/)
  assert.match(block, /actionable: releaseState && prerequisite\.ok && row\.sendable/)
  assert.match(block, /instrument_slug: INSTRUMENT_SLUG/)
  assert.match(block, /timepoint: TIMEPOINT/)
})
