// Commit 1: Unit Leader + staff evaluation API adapters. Pure-logic unit tests, handler
// behavioral tests with injected mocks, and source guards for the safety invariants.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { APPROVED_INSTRUMENTS, QUANTITATIVE_PATHS, ALL_QUANTITATIVE_PATHS, RPC_STATUS, LIFECYCLE_ACTIONS } from '../lib/server/unitEvaluations/config.js'
import { validateUnitEvalQuery, validateLifecycleAction, validateQueueQuery } from '../lib/server/unitEvaluations/validation.js'
import { sanitizeQuantitative, serializeUnitLeaderEvaluations, assertUnitLeaderShape, serializeReviewQueueRow } from '../lib/server/unitEvaluations/serialize.js'
import { createUnitEvaluationsHandler } from '../api/portal/unit-evaluations.js'
import { createReleaseActionHandler } from '../api/evaluation-unit-release-action.js'
import { createReviewQueueHandler } from '../api/evaluation-unit-release-queue.js'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')

function makeRes() {
  const headers = {}
  return {
    statusCode: null, body: null, headers,
    setHeader(k, v) { headers[k] = v },
    status(c) { this.statusCode = c; return this },
    json(p) { this.body = p; return this },
    end() { return this },
  }
}
const okCaller = { ok: true, profile: { id: 'p1', role: 'owner' }, scopes: [{ unit_key: '6 NE', cohort_id: null }] }

// ── config ──────────────────────────────────────────────────────────────────
test('config: exactly the two approved instruments, excluded ones absent', () => {
  assert.deepEqual([...APPROVED_INSTRUMENTS].sort(), ['preceptor_progress', 'student_preceptor_eval'])
  assert.ok(!APPROVED_INSTRUMENTS.includes('casey_fink_readiness_2024'))
  assert.ok(!APPROVED_INSTRUMENTS.includes('post_rotation_evaluation'))
})
test('config: exactly the five allowlisted quantitative paths', () => {
  assert.deepEqual(QUANTITATIVE_PATHS.student_preceptor_eval, ['overall_experience.overall_rating'])
  assert.equal(QUANTITATIVE_PATHS.preceptor_progress.length, 4)
  assert.equal(ALL_QUANTITATIVE_PATHS.length, 5)
})
test('config: every RPC status is mapped and lifecycle actions map to the four RPCs', () => {
  for (const s of ['success', 'no_change', 'not_authorized', 'not_found', 'invalid_decision',
    'already_released', 'already_revoked', 'not_revoked', 'not_releasable_state',
    'revoked_requires_explicit_rerelease', 'snapshot_unverified', 'snapshot_incomplete',
    'not_yet_eligible', 'not_moderated']) {
    assert.ok(RPC_STATUS[s], `status ${s} mapped`)
  }
  assert.deepEqual(Object.keys(LIFECYCLE_ACTIONS).sort(), ['moderate', 'release', 'rerelease', 'revoke'])
})

// ── validation ───────────────────────────────────────────────────────────────
test('validateUnitEvalQuery: rejects excluded/invalid instruments, accepts approved', () => {
  assert.equal(validateUnitEvalQuery({ instrument: 'casey_fink_readiness_2024' }).ok, false)
  assert.equal(validateUnitEvalQuery({ instrument: '' }).ok, false)
  assert.equal(validateUnitEvalQuery({}).error, 'invalid_instrument')
  const ok = validateUnitEvalQuery({ instrument: 'preceptor_progress', timepoint: 'post_rotation', unit_key: '6 NE' })
  assert.deepEqual(ok.value, { instrument: 'preceptor_progress', timepoint: 'post_rotation', unitKey: '6 NE' })
  assert.equal(validateUnitEvalQuery({ instrument: 'preceptor_progress', timepoint: 'bogus' }).error, 'invalid_timepoint')
  assert.equal(validateUnitEvalQuery({ instrument: 'preceptor_progress' }).value.unitKey, null)
})
test('validateLifecycleAction: action + uuid + moderate decision', () => {
  const uuid = '11111111-2222-3333-4444-555555555555'
  assert.equal(validateLifecycleAction({ action: 'release', response_id: uuid }).ok, true)
  assert.equal(validateLifecycleAction({ action: 'bogus', response_id: uuid }).error, 'invalid_action')
  assert.equal(validateLifecycleAction({ action: 'release', response_id: 'not-a-uuid' }).error, 'invalid_response_id')
  assert.equal(validateLifecycleAction({ action: 'moderate', response_id: uuid }).error, 'invalid_decision')
  assert.equal(validateLifecycleAction({ action: 'moderate', response_id: uuid, decision: 'cleared' }).ok, true)
  assert.equal(validateLifecycleAction({ action: 'release', response_id: uuid, evil: 1 }).error, 'unexpected_field')
  assert.equal(validateLifecycleAction({ action: 'release', response_id: uuid, decision: 'cleared' }).error, 'unexpected_field')
})
test('validateQueueQuery: clamps unknown states, rejects excluded instrument', () => {
  assert.equal(validateQueueQuery({ instrument: 'casey_fink_readiness_2024' }).ok, false)
  const v = validateQueueQuery({ release_state: 'released', moderation_state: 'nope' })
  assert.equal(v.value.releaseState, 'released')
  assert.equal(v.value.moderationState, null)
})

// ── serialize / shape assertion ───────────────────────────────────────────────
test('sanitizeQuantitative keeps only allowlisted numeric paths', () => {
  const q = sanitizeQuantitative('preceptor_progress', {
    'readiness_endorsement.transition_readiness': 4,
    'developmental_feedback.narrative.strengths_observed': 'leaked text',   // free text -> dropped
    'evaluated_target.preceptor_id': 'abc',                                 // identity -> dropped
    'unknown.path': 9,                                                       // not allowlisted -> dropped
  })
  assert.deepEqual(q, { 'readiness_endorsement.transition_readiness': 4 })
})
test('serializeUnitLeaderEvaluations produces the exact safe shape and assertion passes', () => {
  const payload = serializeUnitLeaderEvaluations({
    instrument: 'student_preceptor_eval', timepoint: 'post_rotation', unitKey: null,
    summary: { released_response_count: 1, quantitative_averages: { 'overall_experience.overall_rating': { avg: 4.5, n: 1 } } },
    list: [{ anon_label: 'Response 1', timepoint: 'post_rotation', unit_key: '6 NE',
             quantitative: { 'overall_experience.overall_rating': 4.5,
                             'narrative.strengths': 'should never appear' } }],
  })
  assert.doesNotThrow(() => assertUnitLeaderShape(payload))
  assert.equal(payload.released_response_count, 1)         // n=1 shown, not suppressed
  assert.equal(payload.responses[0].position, 1)
  assert.deepEqual(payload.responses[0].quantitative, { 'overall_experience.overall_rating': 4.5 })
  // No prohibited field name appears anywhere in the JSON. (Tokens are specific field
  // names that cannot collide with the allowed slug/timepoint values, e.g. "student" is a
  // substring of the slug "student_preceptor_eval" and is therefore not a valid test token;
  // the exhaustive guarantee is the allowlist assertUnitLeaderShape above.)
  const json = JSON.stringify(payload)
  for (const bad of ['response_id', 'response_token', 'public_token', 'assignment_id',
    'student_id', 'student_name', 'first_name', 'last_name', 'email', 'headshot', 'hist_',
    'preceptor_label', 'submitted_at', 'released_at', 'revoked_at', 'moderated_at',
    'snapshot', 'evaluated_target', 'narrative', 'free_text']) {
    assert.ok(!json.includes(bad), `payload must not contain ${bad}`)
  }
})
test('assertUnitLeaderShape throws on any injected prohibited field (fail closed)', () => {
  const base = serializeUnitLeaderEvaluations({ instrument: 'student_preceptor_eval', timepoint: null, unitKey: null, summary: {}, list: [] })
  assert.throws(() => assertUnitLeaderShape({ ...base, student_name: 'Jane' }))
  assert.throws(() => assertUnitLeaderShape({ ...base, responses: [{ position: 1, response_id: 'x', quantitative: {} }] }))
  assert.throws(() => assertUnitLeaderShape({ ...base, quantitative_averages: { 'narrative.x': 3 } }))
})
test('serializeReviewQueueRow (staff) exposes identity + lifecycle for owner/admin only', () => {
  const row = serializeReviewQueueRow({
    response_id: 'r1', instrument_slug: 'preceptor_progress', timepoint: 'midpoint',
    hist_unit_key: '6 NE', hist_preceptor_label: 'A. Preceptor', hist_cohort_label: 'C1',
    hist_rotation_end: '2026-07-01T00:00:00Z', unit_leader_eligible_at: '2026-07-08T00:00:00Z',
    snapshot_source: 'submission_trigger', moderation_state: 'pending', release_state: 'pending',
    released_at: null, revoked_at: null,
  }, 'Jane Student')
  assert.equal(row.response_id, 'r1')          // response_id returned to staff for exact-row actions
  assert.equal(row.student_name, 'Jane Student')
  assert.equal(row.evaluated_preceptor, 'A. Preceptor')
})

// ── handler behavior: UL read ─────────────────────────────────────────────────
test('UL endpoint: rejects non-GET and sets no-store,private', async () => {
  const h = createUnitEvaluationsHandler({ verifyCaller: async () => okCaller })
  const res = makeRes()
  await h({ method: 'POST', query: {}, headers: {} }, res)
  assert.equal(res.statusCode, 405)
  assert.match(res.headers['Cache-Control'], /no-store/)
  assert.match(res.headers['Cache-Control'], /private/)
})
test('UL endpoint: unauthenticated caller is denied', async () => {
  const h = createUnitEvaluationsHandler({ verifyCaller: async () => ({ ok: false, status: 403, reason: 'unit_leader_role_required' }) })
  const res = makeRes()
  await h({ method: 'GET', query: { instrument: 'preceptor_progress' }, headers: {} }, res)
  assert.equal(res.statusCode, 403)
  assert.equal(res.body.error, 'unit_leader_role_required')
})
test('UL endpoint: invalid instrument is a 400', async () => {
  const h = createUnitEvaluationsHandler({ verifyCaller: async () => okCaller })
  const res = makeRes()
  await h({ method: 'GET', query: { instrument: 'casey_fink_readiness_2024' }, headers: {} }, res)
  assert.equal(res.statusCode, 400)
  assert.equal(res.body.error, 'invalid_instrument')
})
test('UL endpoint: empty scope returns an empty payload, not an error', async () => {
  const h = createUnitEvaluationsHandler({ verifyCaller: async () => ({ ok: true, profile: { id: 'p' }, scopes: [] }) })
  const res = makeRes()
  await h({ method: 'GET', query: { instrument: 'preceptor_progress' }, headers: {} }, res)
  assert.equal(res.statusCode, 200)
  assert.equal(res.body.released_response_count, 0)
  assert.deepEqual(res.body.responses, [])
})
test('UL endpoint: happy path calls the caller-JWT RPCs and returns the shaped payload', async () => {
  const calls = []
  const fakeUserDb = { rpc: async (name, params) => {
    calls.push({ name, params })
    if (name === 'ul_eval_dashboard_summary') {
      return { data: { instrument_slug: 'preceptor_progress', released_response_count: 1,
        quantitative_averages: { 'readiness_endorsement.transition_readiness': { avg: 4, n: 1 } } }, error: null }
    }
    return { data: [{ anon_label: 'Response 1', instrument_slug: 'preceptor_progress', timepoint: 'post_rotation',
      unit_key: '6 NE', quantitative: { 'readiness_endorsement.transition_readiness': 4 } }], error: null }
  } }
  const h = createUnitEvaluationsHandler({ verifyCaller: async () => okCaller, makeUserDb: () => fakeUserDb })
  const res = makeRes()
  await h({ method: 'GET', query: { instrument: 'preceptor_progress', unit_key: '6 NE' }, headers: {} }, res)
  assert.equal(res.statusCode, 200)
  assert.equal(res.body.released_response_count, 1)
  assert.equal(res.body.responses[0].position, 1)
  assert.deepEqual(res.body.responses[0].quantitative, { 'readiness_endorsement.transition_readiness': 4 })
  // Both RPCs were called with the narrowing params (unit_key preserved).
  assert.deepEqual(calls.map(c => c.name).sort(), ['ul_eval_dashboard_summary', 'ul_eval_response_list'])
  assert.equal(calls[0].params.p_unit_key, '6 NE')
})

// ── handler behavior: staff action ────────────────────────────────────────────
test('staff action: rejects non-POST', async () => {
  const h = createReleaseActionHandler({ verifyCaller: async () => okCaller })
  const res = makeRes()
  await h({ method: 'GET', headers: {}, body: {} }, res)
  assert.equal(res.statusCode, 405)
})
test('staff action: non-owner/admin denied 403', async () => {
  const h = createReleaseActionHandler({ verifyCaller: async () => ({ ok: false, status: 403, reason: 'owner_or_admin_required' }) })
  const res = makeRes()
  await h({ method: 'POST', headers: {}, body: { action: 'release', response_id: '11111111-2222-3333-4444-555555555555' } }, res)
  assert.equal(res.statusCode, 403)
})
test('staff action: maps RPC statuses to HTTP codes', async () => {
  const uuid = '11111111-2222-3333-4444-555555555555'
  const mk = (status, extra = {}) => createReleaseActionHandler({
    verifyCaller: async () => okCaller,
    makeUserDb: () => ({ rpc: async () => ({ data: { status, ...extra }, error: null }) }),
  })
  let res = makeRes()
  await mk('success')({ method: 'POST', headers: {}, body: { action: 'release', response_id: uuid } }, res)
  assert.equal(res.statusCode, 200); assert.equal(res.body.status, 'success')
  res = makeRes()
  await mk('not_yet_eligible', { eligible_at: '2026-07-08T00:00:00Z' })({ method: 'POST', headers: {}, body: { action: 'release', response_id: uuid } }, res)
  assert.equal(res.statusCode, 409); assert.equal(res.body.status, 'not_yet_eligible'); assert.equal(res.body.eligible_at, '2026-07-08T00:00:00Z')
  res = makeRes()
  await mk('not_authorized')({ method: 'POST', headers: {}, body: { action: 'revoke', response_id: uuid } }, res)
  assert.equal(res.statusCode, 403)
})
test('staff action: moderate without a decision is rejected before the DB', async () => {
  let rpcCalled = false
  const h = createReleaseActionHandler({ verifyCaller: async () => okCaller, makeUserDb: () => ({ rpc: async () => { rpcCalled = true; return { data: { status: 'success' }, error: null } } }) })
  const res = makeRes()
  await h({ method: 'POST', headers: {}, body: { action: 'moderate', response_id: '11111111-2222-3333-4444-555555555555' } }, res)
  assert.equal(res.statusCode, 400)
  assert.equal(res.body.error, 'invalid_decision')
  assert.equal(rpcCalled, false)
})

// ── handler behavior: staff queue ──────────────────────────────────────────────
test('staff queue: rejects non-GET and non-owner/admin', async () => {
  let h = createReviewQueueHandler({ verifyCaller: async () => okCaller })
  let res = makeRes()
  await h({ method: 'POST', headers: {}, query: {} }, res)
  assert.equal(res.statusCode, 405)
  h = createReviewQueueHandler({ verifyCaller: async () => ({ ok: false, status: 403, reason: 'owner_or_admin_required' }) })
  res = makeRes()
  await h({ method: 'GET', headers: {}, query: {} }, res)
  assert.equal(res.statusCode, 403)
})

// ── source guards ──────────────────────────────────────────────────────────────
test('endpoints use the caller-JWT client for RPCs, never the service role', () => {
  const ul = read('api/portal/unit-evaluations.js')
  const action = read('api/evaluation-unit-release-action.js')
  for (const src of [ul, action]) {
    assert.match(src, /getUserScopedDb/)
    assert.ok(!/getServiceDb/.test(src), 'RPC endpoints must not use the service-role client')
    assert.match(src, /Cache-Control', 'no-store, private/)
  }
  // The UL endpoint calls the two read RPCs and runs the shape assertion.
  assert.match(ul, /ul_eval_dashboard_summary/)
  assert.match(ul, /ul_eval_response_list/)
  assert.match(ul, /assertUnitLeaderShape/)
  // The action endpoint calls lifecycle RPCs by the config map, never a hardcoded service call.
  assert.match(action, /db\.rpc\(rpcName, params\)/)
})
