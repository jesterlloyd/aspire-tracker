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

test('the Unit Leader evaluation endpoint is activated and uses the caller JWT, not service role', () => {
  // The follow-on backend-ui branch activates the read surface. The invariant now is that
  // the endpoint calls the SECURITY DEFINER RPCs with the caller's JWT client
  // (getUserScopedDb), which preserves auth.uid(), and NEVER the service-role client.
  const ul = read('api/portal/unit-evaluations.js')
  assert.match(ul, /getUserScopedDb/)
  assert.ok(!/getServiceDb/.test(ul), 'the read RPCs must not be called with the service-role client')
  assert.match(ul, /ul_eval_dashboard_summary/)
  assert.match(ul, /ul_eval_response_list/)
  assert.match(ul, /Cache-Control', 'no-store, private/)
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
