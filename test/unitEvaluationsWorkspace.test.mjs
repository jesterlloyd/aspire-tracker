// Commit 4: the activated Unit Leader Evaluations workspace. Display-logic tests plus source
// guards that the workspace stays role-safe (read-only, quantitative-only, no lifecycle, no
// identity), derives its unit picker from the authorized bootstrap set, and is wired into the
// portal lazily in place of the placeholder.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { instrumentMetricPaths, INSTRUMENT_METRIC_PATHS } from '../src/lib/unitEvaluationDisplay.js'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')
// Guard CODE only — the workspace's own comments describe what it must NOT do.
const code = (p) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')

const WS = 'src/portal/unit/UnitEvaluationsWorkspace.jsx'

test('per-instrument metric paths mirror the approved allowlist exactly', () => {
  assert.deepEqual(instrumentMetricPaths('student_preceptor_eval'), ['overall_experience.overall_rating'])
  assert.deepEqual(instrumentMetricPaths('preceptor_progress'), [
    'developmental_feedback.context.shifts_observed',
    'readiness_endorsement.transition_readiness',
    'readiness_endorsement.unit_endorsement_consideration',
    'readiness_endorsement.cedars_consideration_recommendation',
  ])
  // Five approved paths across exactly two instruments, no more.
  assert.equal(Object.values(INSTRUMENT_METRIC_PATHS).flat().length, 5)
  assert.deepEqual(Object.keys(INSTRUMENT_METRIC_PATHS).sort(), ['preceptor_progress', 'student_preceptor_eval'])
})

test('the workspace is read-only: no lifecycle, no staff console, no CSV', () => {
  const ws = code(WS)
  for (const bad of ['getReviewQueue', 'postReleaseAction', 'UnitEvaluationReleaseConsole',
    'evaluationReviewApi', 'unitEvaluationReleaseActions', 'moderate', 'revoke', 'rerelease',
    'moderation_state', 'release_state', 'ul_eval_moderate', 'csv', 'CSV', 'toCSV', 'exportCsv']) {
    assert.ok(!ws.includes(bad), `workspace must not reference ${bad}`)
  }
})

test('the workspace never surfaces identity, preceptor, timestamps, ids, or free text', () => {
  const ws = code(WS)
  for (const bad of ['student_name', 'first_name', 'last_name', 'email', 'preceptor',
    'evaluated_preceptor', 'response_id', 'released_at', 'revoked_at', 'submitted_at',
    'created_at', 'narrative', 'free_text', 'comment']) {
    assert.ok(!ws.includes(bad), `workspace must not reference ${bad}`)
  }
})

test('the workspace reads only the Unit Leader endpoint, with stale-request protection', () => {
  const ws = read(WS)
  assert.match(ws, /getUnitEvaluations/)
  assert.match(ws, /reqId/)                                  // stale-response guard
  assert.match(ws, /AbortController/)                        // abort on unmount / re-fetch
  // Two parallel reads (one per instrument), each returning summary + list together.
  assert.match(ws, /Promise\.all\(INSTRUMENT_SLUGS\.map/)
})

test('the unit picker options come from authorized unitKeys, never from response rows', () => {
  const ws = read(WS)
  assert.match(ws, /\[ALL_UNITS, 'All assigned units'\], \.\.\.unitKeys\.map/)
  // The effect refetches only on timepoint/unit change; instrument switch is in-memory.
  assert.match(ws, /\}, \[timepoint, localUnit\]\)/)
})

test('exactly the two approved instruments render, with the required privacy wording', () => {
  const ws = read(WS)
  assert.match(ws, /APPROVED_UL_INSTRUMENTS\.map/)
  assert.match(ws, /Results are released by the ASPIRE team after the rotation and include quantitative\s*\n?\s*responses only\./)
  // Must NOT claim anonymity.
  assert.ok(!/fully anonymous|guaranteed anonymous|unidentifiable/i.test(ws))
})

test('the portal mounts the workspace lazily in place of the placeholder', () => {
  const portal = read('src/portal/UnitLeaderPortal.jsx')
  assert.match(portal, /const UnitEvaluationsWorkspace = lazy\(\(\) => import\('\.\/unit\/UnitEvaluationsWorkspace'\)\)/)
  assert.match(portal, /<Suspense[\s\S]*?<UnitEvaluationsWorkspace unitKeys=\{unitKeys\} \/>[\s\S]*?<\/Suspense>/)
  // The placeholder is no longer imported or mounted.
  assert.ok(!portal.includes('UnitEvaluationsPlaceholder'))
})
