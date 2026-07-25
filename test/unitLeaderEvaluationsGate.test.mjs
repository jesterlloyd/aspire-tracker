// The Unit Leader Evaluations gate.
//
// The original evaluations safety review found the schema lacked every safeguard a
// unit-leader-facing evaluation surface needs (release-to-unit, moderation, delayed
// release, stable historical attribution, unit-visibility consent, free-text redaction).
// See docs/UNIT_LEADER_EVALUATIONS_DIAGNOSTIC.md.
//
// Those safeguards were added by the Owner-gated release-gate migration (applied and
// verified before this branch), so the tab is now activated to a read-only,
// quantitative-only workspace. The invariant these guards now enforce is not "no UI
// exists" but "the activated surface reads only the caller-JWT endpoint, the retained
// placeholder rollback target stays inert, and the portal itself makes no eval call".

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

test('the Evaluations view now renders the activated read-only workspace', () => {
  // Activation era: the backend contract the placeholder was waiting for is applied and
  // verified, so the tab mounts the released workspace. The placeholder file is retained on
  // disk only as a rollback target, and the test below still proves it stays inert.
  assert.match(portal, /view === 'evaluations'[\s\S]*?<UnitEvaluationsWorkspace unitKeys=\{unitKeys\} \/>/)
  assert.match(portal, /const UnitEvaluationsWorkspace = lazy\(\(\) => import\('\.\/unit\/UnitEvaluationsWorkspace'\)\)/)
  assert.ok(!portal.includes('UnitEvaluationsPlaceholder'))
})

test('the retained placeholder (rollback target) reads no endpoint and derives nothing from evaluation data', () => {
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
