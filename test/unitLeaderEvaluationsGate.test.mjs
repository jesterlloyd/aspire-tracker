// Commit 4: the Unit Leader Evaluations gate.
//
// The evaluations safety review found that the schema lacks every safeguard a
// unit-leader-facing evaluation surface needs (release-to-unit, moderation, delayed
// release, stable historical attribution, small-cohort threshold, unit-visibility
// consent, free-text redaction). See docs/UNIT_LEADER_EVALUATIONS_DIAGNOSTIC.md.
//
// Until an Owner-gated migration adds those, the Evaluations tab MUST stay a
// placeholder and MUST NOT read any evaluation data or simulate a safeguard in the
// browser. These guards fail loudly if a future change activates the surface without
// the backend contract in place.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const read = (p) => readFileSync(join(root, p), 'utf8')

const portal = read('src/portal/UnitLeaderPortal.jsx')
const placeholder = read('src/portal/unit/UnitEvaluationsPlaceholder.jsx')

test('the Evaluations view still renders the honest placeholder', () => {
  assert.match(portal, /view === 'evaluations' && <UnitEvaluationsPlaceholder \/>/)
  assert.match(portal, /import UnitEvaluationsPlaceholder from '\.\/unit\/UnitEvaluationsPlaceholder'/)
})

test('the placeholder reads no endpoint and derives nothing from evaluation data', () => {
  // It must not fetch, must hold no counts, and must not import a data client.
  assert.ok(!/fetch\(|apiFetch|getShiftActivity|getRoster|useEndpoint/.test(placeholder))
  assert.ok(!/supabase/.test(placeholder))
  assert.match(placeholder, /reads no endpoint/)
  // The safeguard list the review confirmed is still missing stays user-visible.
  for (const term of ['Consent', 'Moderation', 'Delayed release', 'Stable attribution', 'Small-cohort', 'Free-text']) {
    assert.ok(placeholder.includes(term), `placeholder must still name the ${term} safeguard`)
  }
})

test('no Unit Leader evaluation endpoint exists (no service-role read was added)', () => {
  const portalApi = readdirSync(join(root, 'api', 'portal'))
  const evalEndpoints = portalApi.filter(f => /eval/i.test(f))
  assert.deepEqual(evalEndpoints, [], `no api/portal evaluation endpoint may exist yet, found: ${evalEndpoints.join(', ')}`)
})

test('the Unit Leader portal makes no evaluation data call', () => {
  assert.ok(!/evaluation_assignments|evaluation_responses|getEvaluation|unit-evaluation/i.test(portal),
    'the unit portal must not read evaluation data')
})

test('the diagnostic and migration contract is recorded', () => {
  assert.ok(existsSync(join(root, 'docs', 'UNIT_LEADER_EVALUATIONS_DIAGNOSTIC.md')))
  const doc = read('docs/UNIT_LEADER_EVALUATIONS_DIAGNOSTIC.md')
  assert.match(doc, /SQL is definitely needed/)
  assert.match(doc, /Proposed migration contract/)
})

test('the staff Evaluation Dashboard is unchanged by this branch (still owner/admin, browser-read)', () => {
  const evalTab = read('src/components/EvaluationTab.jsx')
  assert.match(evalTab, /from\('evaluation_assignments'\)/)
  assert.match(evalTab, /Review & Release|Responses/)
})
