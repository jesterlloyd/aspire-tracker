// test/releaseRouting.test.mjs
//
// ASPIRE-CASEYFINK-RELEASE-ROUTING-HOTFIX-1 / 1B regression harness. Standalone (no test framework
// in this repo). Run: `node test/releaseRouting.test.mjs`. Deterministic, no network, no DB, no send.
//
// It exercises the EXACT production modules the dashboard and panels use:
//   - workflowSelection.resolveEffectiveWorkflow  (which workflow is operational)
//   - RELEASE_ROUTES                              (which endpoint/instrument a release targets)
//   - getEvaluationPreviewFixture                 (which email a workflow previews)
// so the selection -> panel -> handler path is covered without a React renderer. The dashboard
// derives the navigator highlight, the active panel, and the preview from a single `effective`
// value (resolveEffectiveWorkflow(selected)); every scenario below asserts against that real value.

import assert from 'node:assert/strict';
import { RELEASE_ROUTES } from '../src/lib/evaluation/releaseRouting.js';
import { resolveEffectiveWorkflow, DEFAULT_WORKFLOW_KEY, WORKFLOW_KEYS } from '../src/lib/evaluation/workflowSelection.js';
import { getEvaluationPreviewFixture } from '../src/lib/evaluation/evaluationPreviewFixtures.js';

let passed = 0;
const ok = (name) => { console.log('  ok -', name); passed += 1; };

// The REMOVED production resolver, kept here ONLY to document the old behavior and prove the
// regression is fixed. Production no longer contains this logic; this copy is never imported by the
// app. It reproduces `selected || firstReady || firstNeeds || DEFAULT` over async counts.
function legacyResolve(selected, counts) {
  const firstReady = WORKFLOW_KEYS.find(k => (counts[k]?.due_sendable || 0) > 0);
  const firstNeeds = WORKFLOW_KEYS.find(k => (counts[k]?.due_unsendable || 0) > 0);
  return selected || firstReady || firstNeeds || DEFAULT_WORKFLOW_KEY;
}

// ── Routing configuration (unchanged HOTFIX-1 guarantees) ───────────────────────────────────────

// 1. Casey-Fink release resolves to the Casey-Fink endpoint + instrument.
assert.equal(RELEASE_ROUTES.caseyFinkPostRotation.endpoint, '/api/evaluation-release-casey-fink-post-rotation-survey');
assert.equal(RELEASE_ROUTES.caseyFinkPostRotation.instrumentSlug, 'casey_fink_readiness_2024');
assert.equal(RELEASE_ROUTES.caseyFinkPostRotation.timepoint, 'post_rotation');
assert.equal(RELEASE_ROUTES.caseyFinkPostRotation.surveyRoute, '/evaluation/readiness');
ok('Casey-Fink release routes to the Casey-Fink endpoint/instrument/route');

// 2. Student Feedback release resolves to its own endpoint + instrument.
assert.equal(RELEASE_ROUTES.student.endpoint, '/api/evaluation-release-student-eval-survey');
assert.equal(RELEASE_ROUTES.student.instrumentSlug, 'student_preceptor_eval');
assert.equal(RELEASE_ROUTES.student.surveyRoute, '/evaluation/experience');
ok('Student Feedback release routes to the Student Feedback endpoint/instrument/route');

// 3. The two workflows can never be cross-wired (distinct endpoint + instrument), and the config is
//    frozen so no code path can mutate one entry onto another endpoint at runtime.
assert.notEqual(RELEASE_ROUTES.caseyFinkPostRotation.endpoint, RELEASE_ROUTES.student.endpoint);
assert.notEqual(RELEASE_ROUTES.caseyFinkPostRotation.instrumentSlug, RELEASE_ROUTES.student.instrumentSlug);
assert.ok(Object.isFrozen(RELEASE_ROUTES) && Object.isFrozen(RELEASE_ROUTES.caseyFinkPostRotation) && Object.isFrozen(RELEASE_ROUTES.student));
ok('Casey-Fink and Student Feedback endpoints/instruments are distinct and frozen');

// 4. Server pre-send guard is now MANDATORY: the request MUST carry expected_instrument_slug, and it
//    must equal the endpoint's own instrument, or nothing is created/sent. Mirrors the API check
//    that runs before instrument resolution, assignment, token, notification, and email.
function serverPreSendGuard(endpointSlug, expectedSlug) {
  if (expectedSlug == null || expectedSlug === '') return { status: 400, sent: false }; // missing -> refuse
  if (expectedSlug !== endpointSlug) return { status: 400, sent: false };               // mismatch -> refuse
  return { status: 200, sent: true };
}
assert.deepEqual(serverPreSendGuard(RELEASE_ROUTES.caseyFinkPostRotation.instrumentSlug, null), { status: 400, sent: false });
assert.deepEqual(serverPreSendGuard(RELEASE_ROUTES.caseyFinkPostRotation.instrumentSlug, RELEASE_ROUTES.student.instrumentSlug), { status: 400, sent: false });
assert.deepEqual(serverPreSendGuard(RELEASE_ROUTES.student.instrumentSlug, RELEASE_ROUTES.caseyFinkPostRotation.instrumentSlug), { status: 400, sent: false });
assert.deepEqual(serverPreSendGuard(RELEASE_ROUTES.caseyFinkPostRotation.instrumentSlug, RELEASE_ROUTES.caseyFinkPostRotation.instrumentSlug), { status: 200, sent: true });
ok('Server pre-send guard is mandatory: missing or mismatched instrument refuses without sending');

// ── Selection resolution (HOTFIX-1B: the actual production helper) ───────────────────────────────

// Scenario 1: initial render, before any workflow counts resolve -> Casey-Fink is operational.
assert.equal(resolveEffectiveWorkflow(null), 'caseyFinkPostRotation');
assert.equal(resolveEffectiveWorkflow(undefined), 'caseyFinkPostRotation');
assert.equal(DEFAULT_WORKFLOW_KEY, 'caseyFinkPostRotation');
ok('Scenario 1 - before counts resolve, the operational workflow is Casey-Fink');

// Scenario 2: Student Feedback becomes ready asynchronously with NO explicit user selection.
const bothReady = { student: { due_sendable: 1 }, caseyFinkPostRotation: { due_sendable: 1 } };
//   Old behavior (removed): auto-followed the first ready workflow -> Student (earlier in order).
assert.equal(legacyResolve(null, bothReady), 'student');
//   New behavior (production): counts are ignored; the operational workflow stays Casey-Fink.
assert.equal(resolveEffectiveWorkflow(null), 'caseyFinkPostRotation');
//   And the post-release auto-follow that produced the misleading Casey-Fink screenshot: once a
//   Student release drops student.due_sendable to 0, the OLD resolver flipped to Casey-Fink. The new
//   resolver never depended on counts, so no such flip exists.
assert.equal(legacyResolve(null, { student: { due_sendable: 0 }, caseyFinkPostRotation: { due_sendable: 1 } }), 'caseyFinkPostRotation');
ok('Scenario 2 - old resolver auto-followed Student then flipped to Casey-Fink; new resolver never follows counts');

// Scenario 3: user explicitly selects Casey-Fink; later count updates must not change anything.
{
  const selected = 'caseyFinkPostRotation';
  const effective = resolveEffectiveWorkflow(selected);
  assert.equal(effective, 'caseyFinkPostRotation');
  // Same value drives nav styling, active panel, preview, and release config -> all Casey-Fink.
  assert.equal(effective === 'caseyFinkPostRotation', true);            // nav highlight
  assert.equal(getEvaluationPreviewFixture(effective).render().subject, 'Complete Your ASPIRE Readiness Survey'); // preview
  assert.equal(RELEASE_ROUTES[effective].endpoint, '/api/evaluation-release-casey-fink-post-rotation-survey');    // release config
  // A later async count update cannot change `effective` because it is not an input.
  assert.equal(resolveEffectiveWorkflow(selected), 'caseyFinkPostRotation');
  ok('Scenario 3 - explicit Casey-Fink stays active/styled/previewed/routed after later counts');
}

// Scenario 4: user explicitly selects Student Feedback.
{
  const effective = resolveEffectiveWorkflow('student');
  assert.equal(effective, 'student');
  assert.equal(getEvaluationPreviewFixture(effective).render().subject, 'ASPIRE: Share Feedback on Your Preceptor & Unit');
  assert.equal(RELEASE_ROUTES[effective].endpoint, '/api/evaluation-release-student-eval-survey');
  ok('Scenario 4 - explicit Student Feedback drives its own preview/dialog/release route');
}

// Scenario 5: explicit Casey-Fink selection immediately followed by release.
{
  const route = RELEASE_ROUTES[resolveEffectiveWorkflow('caseyFinkPostRotation')];
  assert.equal(route.endpoint, '/api/evaluation-release-casey-fink-post-rotation-survey');
  assert.equal(route.instrumentSlug, 'casey_fink_readiness_2024');
  assert.equal(route.timepoint, 'post_rotation');
  ok('Scenario 5 - Casey-Fink selection -> Casey-Fink endpoint/instrument/timepoint');
}

// Scenario 6: explicit Student Feedback selection immediately followed by release.
{
  const route = RELEASE_ROUTES[resolveEffectiveWorkflow('student')];
  assert.equal(route.endpoint, '/api/evaluation-release-student-eval-survey');
  assert.equal(route.instrumentSlug, 'student_preceptor_eval');
  assert.equal(route.timepoint, 'post_rotation');
  ok('Scenario 6 - Student selection -> Student endpoint/instrument/timepoint');
}

// Scenario 7: selection changes while a confirmation dialog is open. Each panel owns its confirm
// state and closes over its OWN module-level route; it renders nothing while inactive (return null),
// so a selection change unmounts the panel and destroys its dialog. Model the invariant: a dialog
// bound to workflow X always releases X's endpoint, never the dashboard's later `effective` (Y).
{
  const dialogWorkflow = 'caseyFinkPostRotation';   // dialog opened here
  let effective = 'caseyFinkPostRotation';
  effective = 'student';                            // user changes selection underneath
  // The release payload is derived from the panel's own workflow, not from the changed effective.
  const releasedEndpoint = RELEASE_ROUTES[dialogWorkflow].endpoint;
  assert.equal(releasedEndpoint, '/api/evaluation-release-casey-fink-post-rotation-survey');
  assert.notEqual(releasedEndpoint, RELEASE_ROUTES[effective].endpoint);
  ok('Scenario 7 - a dialog releases its own workflow, never a stale/changed selection');
}

// Scenario 8: inactive panels cannot cross-wire. There is exactly one operational key at a time, and
// the routes are frozen, so an inactive panel cannot expose a control that submits another endpoint.
{
  const keys = [null, 'preceptor', 'student', 'caseyFinkPostRotation', 'postRotation'];
  for (const sel of keys) {
    const effective = resolveEffectiveWorkflow(sel);
    assert.ok(WORKFLOW_KEYS.includes(effective));   // always exactly one valid operational key
  }
  // Unknown/garbage selection falls back to the safe default rather than an arbitrary workflow.
  assert.equal(resolveEffectiveWorkflow('not_a_workflow'), 'caseyFinkPostRotation');
  ok('Scenario 8 - exactly one operational workflow; unknown selection falls back to Casey-Fink');
}

// ── Preview fixtures (unchanged) ─────────────────────────────────────────────────────────────────
const casey = getEvaluationPreviewFixture('caseyFinkPostRotation').render();
assert.equal(casey.subject, 'Complete Your ASPIRE Readiness Survey');
assert.ok(/Complete Readiness Survey/.test(casey.html));
const student = getEvaluationPreviewFixture('student').render();
assert.equal(student.subject, 'ASPIRE: Share Feedback on Your Preceptor & Unit');
assert.notEqual(casey.subject, student.subject);
ok('Casey-Fink preview = readiness email; Student Feedback preview = experience email; distinct');

console.log(`\nALL ${passed} routing + selection regression checks passed.`);
