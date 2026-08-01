// ASPIRE-EVAL-RR-CORRECTIONS: guards for the four Review and Release corrections.
//
//   1. test mode opens in-app, same origin, not through an isolated external link
//   2. Review and Release opens on the first workflow, not a hardcoded favourite
//   3. ASPIRE Rotation Feedback is active and releasable, and still not a certificate gate
//   4. the per-row eye icons are gone and the three actions live in one Survey tools toolbar
//
// node:test only, matching the repo convention. Negative assertions run against
// comment-stripped source, since the prose names the things it forbids.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  resolveInitialWorkflow, resolveEffectiveWorkflow, DEFAULT_WORKFLOW_KEY, WORKFLOW_KEYS,
  LAST_WORKFLOW_STORAGE_KEY,
} from '../src/lib/evaluation/workflowSelection.js'
import { RELEASE_ROUTES } from '../src/lib/evaluation/releaseRouting.js'
import { SURVEY_CATALOG, surveyByKey } from '../src/lib/evaluation/surveyCatalog.js'
import { classifyPostRotationCohort } from '../src/lib/evaluation/postRotationCertDueDetection.js'
import { buildPreviewModel } from '../src/lib/evaluation/surveyPreviewModel.js'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')

const dash     = read('src/components/evaluation/SurveyAutomationDashboard.jsx')
const panel    = read('src/components/evaluation/PostRotationAutomationPanel.jsx')
const endpoint = read('api/evaluation-release-post-rotation-survey.js')
const content  = read('lib/server/evaluation/postRotationEvalContent.js')
const testApi  = read('api/evaluation-send-survey-test.js')

const stripJs = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const dashCode     = stripJs(dash)
const panelCode    = stripJs(panel)
const endpointCode = stripJs(endpoint)

// ── 1. Test mode opens in-app, same origin ─────────────────────────────────
test('Open test now navigates inside the SPA, not to an external tab', () => {
  assert.match(dashCode, /onClick=\{\(\) => navigate\(testState\.url\)\}/,
    'the primary path must be same-origin SPA navigation')
  // The old anchor opened a new tab against an absolute URL, which is what the
  // organization's URL isolation intercepted.
  assert.ok(!/target="_blank"[^>]*Open test now/s.test(dash))
  assert.ok(!dashCode.includes('rel="noopener noreferrer"'),
    'no external anchor should remain for the test path')
})

test('the test path is reduced to a relative route and origin-checked', () => {
  assert.match(dashCode, /new URL\(body\?\.test_url \|\| '', window\.location\.origin\)/)
  assert.match(dashCode, /u\.origin === window\.location\.origin/,
    'a cross-origin URL must never be navigated to')
  assert.match(dashCode, /path = `\$\{u\.pathname\}\$\{u\.search\}`/)
})

test('Copy test link stays same-origin and still needs a session', () => {
  assert.match(dashCode, /navigator\.clipboard\?\.writeText\(`\$\{window\.location\.origin\}\$\{testState\.url\}`\)/)
  // The link carries no credential of its own.
  for (const forbidden of ['#t=', 'token', 'generateLink']) {
    assert.ok(!testApi.includes(`test_url: \`${forbidden}`), 'the test URL must carry no token')
  }
})

test('the emailed link remains a secondary convenience and says so', () => {
  assert.match(dashCode, /Use Open test now/)
  assert.match(dashCode, /may isolate that link/,
    'the operator should be told why the emailed link can fail')
})

// ── 2. Deterministic default selection ─────────────────────────────────────
test('the first visit opens Preceptor Readiness, the first workflow in order', () => {
  assert.equal(resolveInitialWorkflow({}), 'preceptor')
  assert.equal(DEFAULT_WORKFLOW_KEY, WORKFLOW_KEYS[0])
  assert.equal(DEFAULT_WORKFLOW_KEY, 'preceptor')
  assert.equal(SURVEY_CATALOG[0].key, 'preceptor', 'display order must agree with the default')
})

test('a subsequent visit restores the last valid selection', () => {
  assert.equal(resolveInitialWorkflow({ storedKey: 'student' }), 'student')
  assert.equal(resolveInitialWorkflow({ storedKey: 'postRotation' }), 'postRotation')
})

test('a URL workflow key outranks the stored selection', () => {
  assert.equal(
    resolveInitialWorkflow({ urlKey: 'caseyFinkPostRotation', storedKey: 'student' }),
    'caseyFinkPostRotation')
})

test('an invalid stored or URL key falls through to the first workflow', () => {
  assert.equal(resolveInitialWorkflow({ storedKey: 'nope' }), 'preceptor')
  assert.equal(resolveInitialWorkflow({ urlKey: '', storedKey: null }), 'preceptor')
  assert.equal(resolveInitialWorkflow({ urlKey: 'not_a_workflow' }), 'preceptor')
})

test('selection still ignores detection counts', () => {
  // The 1B regression this module exists to prevent: a resolver that followed whichever
  // workflow's counts arrived first. Counts are not a parameter of either resolver.
  // Passing count-shaped data must change nothing: neither resolver reads counts.
  const counts = { preceptor: { due_sendable: 0 }, student: { due_sendable: 99 } }
  assert.equal(resolveInitialWorkflow({ counts }), 'preceptor', 'a hot count must not select a workflow')
  assert.equal(resolveInitialWorkflow({ storedKey: 'postRotation', counts }), 'postRotation')
  assert.equal(resolveEffectiveWorkflow('preceptor', counts), 'preceptor')
  const src = read('src/lib/evaluation/workflowSelection.js')
  assert.ok(!/due_sendable|due_unsendable|counts\[/.test(stripJs(src)),
    'the selection module must not reference detection counts at all')
})

test('the dashboard persists and deep-links the selection', () => {
  assert.match(dashCode, /localStorage\.getItem\(LAST_WORKFLOW_STORAGE_KEY\)/)
  assert.match(dashCode, /localStorage\.setItem\(LAST_WORKFLOW_STORAGE_KEY, key\)/)
  assert.match(dashCode, /n\.set\('workflow', key\)/)
  assert.match(dashCode, /\{ replace: true \}/, 'switching workflows must not flood the back stack')
  // The URL wins during render, so back and forward move the selection.
  // EVAL-RR-UNIFIED-NAV-1: the derivation now runs over the nav-key SUPERSET (survey
  // workflows + Release to Unit Leaders); the same deterministic, counts-free rule.
  assert.match(dashCode, /const current = isReviewReleaseNavKey\(urlKey\) \? urlKey : selected/)
  assert.equal(LAST_WORKFLOW_STORAGE_KEY, 'aspire.evaluation.lastWorkflow')
})

// ── 3. ASPIRE Rotation Feedback is active ──────────────────────────────────
test('the workflow is active in the canonical catalog', () => {
  const s = surveyByKey('postRotation')
  assert.equal(s.status, 'active')
  assert.equal(s.certificateGate, false, 'it must never become a certificate gate')
  assert.ok(!/paused/i.test(s.trigger))
})

test('it has a real release route again', () => {
  const r = RELEASE_ROUTES.postRotation
  assert.ok(r, 'the paused workflow previously had no route at all')
  assert.equal(r.endpoint, '/api/evaluation-release-post-rotation-survey')
  assert.equal(r.instrumentSlug, 'post_rotation_evaluation')
  assert.equal(r.timepoint, 'post_rotation')
})

test('detection reports releasable counts instead of hard zeroes', () => {
  const students = [
    { id: 'a', first_name: 'A', last_name: 'One', approved_hours: 120, hours_required: 120, personal_email: 'a@example.com' },
    { id: 'b', first_name: 'B', last_name: 'Two', approved_hours: 120, hours_required: 120 }, // no email
    { id: 'c', first_name: 'C', last_name: 'Three', approved_hours: 10, hours_required: 120, personal_email: 'c@example.com' },
  ]
  const { summary } = classifyPostRotationCohort({ students, assignments: [], nowMs: Date.now() })
  assert.equal(summary.due_sendable, 1, 'an eligible student with an email is ready to release')
  assert.equal(summary.due_unsendable, 1, 'an eligible student without an email is blocked on the address')
  assert.equal(summary.not_due, 1)
  assert.equal(summary.eligible_for_review, 2)
})

test('the panel offers a human-approved release with a confirmation step', () => {
  assert.match(panelCode, /Release Survey/)
  assert.match(panelCode, /setConfirm\(r\)/, 'release must go through a confirmation, never one click')
  assert.match(panelCode, /Confirm & Send/)
  assert.match(panelCode, /doRelease\(confirm\)/)
  // The paused UI is gone.
  assert.ok(!panelCode.includes('Release paused'))
  assert.ok(!/disabled\s*\n\s*title="Casey-Fink post-rotation is now/.test(panel))
})

test('release sends the pre-send workflow guard the server now requires', () => {
  assert.match(panelCode, /expected_instrument_slug: ROUTE\.instrumentSlug/)
  // This endpoint was the only one of the four without the guard, which did not matter
  // while it was paused and mattered immediately once it was not.
  // Assert the CONDITION, not just the error message. An earlier version of this test
  // matched only the message text, which meant disabling the guard with `if (false && ...)`
  // still passed. A static test cannot prove reachability, so match the exact predicate.
  assert.match(endpointCode,
    /if \(body\.expected_instrument_slug == null \|\| body\.expected_instrument_slug === ''\) \{/,
    'the required-field guard must be present and not short-circuited')
  assert.match(endpointCode,
    /if \(body\.expected_instrument_slug !== INSTRUMENT_SLUG\) \{/,
    'the mismatch guard must be present and not short-circuited')
  assert.match(endpointCode, /expected_instrument_slug is required\. Nothing was sent\./)
  assert.match(endpointCode, /Workflow mismatch: this endpoint releases/)
  // Both guards must run BEFORE any student load, assignment insert, token, or send.
  const guardAt = endpointCode.indexOf('expected_instrument_slug !== INSTRUMENT_SLUG')
  for (const later of ['.from(\'students\')', '.insert(', 'resend.emails.send']) {
    const at = endpointCode.indexOf(later)
    if (at > -1) assert.ok(at > guardAt, `the guard must precede ${later}`)
  }
  assert.match(endpointCode, /const ALLOWED_KEYS = \['student_id', 'expected_instrument_slug'\]/)
})

test('the release still re-checks authorization, recipient, instrument, and eligibility', () => {
  assert.match(endpointCode, /\['owner', 'admin'\]\.includes\(profile\.role\)/)
  assert.match(endpointCode, /permission_status !== 'authorized'/)
  assert.match(endpointCode, /personal_email/, 'recipient is resolved server side')
  assert.match(endpointCode, /classifyPostRotationCohort|eligible_for_review/,
    'eligibility is re-derived on the server, not trusted from the client')
})

test('the workflow cannot unlock a certificate', () => {
  // Structural: the RPC that used to issue was replaced in migration 20260710000000, and
  // nothing in this workflow references certificate issuance.
  for (const [name, src] of [['endpoint', endpointCode], ['panel', panelCode]]) {
    assert.ok(!src.includes('issue_participation_certificate'), `${name} must not issue a certificate`)
    // The endpoint READS certificate state to decide eligibility, which is correct. What must
    // not exist is a write: no insert into certificates and no sequence consumption.
    assert.ok(!/\.from\('certificates'\)[\s\S]{0,80}\.insert/.test(src),
      `${name} must never write a certificate row`)
    assert.ok(!src.includes('certificate_sequences'), `${name} must not consume a sequence`)
  }
  assert.equal(surveyByKey('postRotation').certificateGate, false)
  assert.equal(surveyByKey('caseyFinkPostRotation').certificateGate, true,
    'the Casey-Fink gate must be preserved')
})

test('the stale certificate promise is gone from the survey copy', () => {
  assert.ok(!content.includes('Certificate of Participation'),
    'the intro promised a certificate this survey no longer issues')
  const model = buildPreviewModel('post_rotation_evaluation', null)
  assert.ok(!JSON.stringify(model).includes('Certificate of Participation'))
  // And the rest of the definition is untouched.
  assert.equal(model.sections.length, 5)
})

test('it remains a separate survey from Student Feedback', () => {
  const post = surveyByKey('postRotation')
  const student = surveyByKey('student')
  assert.notEqual(post.slug, student.slug)
  assert.notEqual(post.formType, student.formType)
  assert.notEqual(RELEASE_ROUTES.postRotation.endpoint, RELEASE_ROUTES.student.endpoint)
  assert.notEqual(RELEASE_ROUTES.postRotation.instrumentSlug, RELEASE_ROUTES.student.instrumentSlug)
})

test('every workflow now has a release route', () => {
  for (const s of SURVEY_CATALOG) {
    assert.ok(RELEASE_ROUTES[s.key], `${s.key} must have a release route`)
    assert.equal(RELEASE_ROUTES[s.key].instrumentSlug, s.slug,
      `${s.key} route and catalog slug must agree`)
  }
})

// ── 4. One Survey tools toolbar, no per-row eye icons ──────────────────────
test('the per-row eye icon is gone', () => {
  assert.ok(!dashCode.includes('rr-row-eye'))
  // Match the PROP, not the bare word: "onPreview" is a substring of
  // getEvaluationPreviewFixture, which is a legitimate and unrelated import.
  assert.ok(!/onPreview=/.test(dashCode), 'the row must no longer take a preview handler')
  assert.ok(!/onPreview\b\s*[,}]/.test(dashCode.replace(/getEvaluationPreviewFixture/g, '')))
  assert.ok(!/Preview the \$\{w\.label\} survey questions/.test(dashCode))
})

test('the nav row is a single button again', () => {
  const row = dashCode.slice(dashCode.indexOf('function WorkflowNavRow'), dashCode.indexOf('export default'))
  assert.equal((row.match(/<button/g) || []).length, 1, 'exactly one control per row')
})

test('the three actions live in one labelled Survey tools group', () => {
  assert.match(dashCode, /role="group" aria-label="Survey tools"/)
  assert.match(dashCode, /className="rr-tools-label">Survey tools/)
  for (const action of ['Preview Survey', 'Preview Email', 'Send test to me']) {
    assert.equal((dashCode.match(new RegExp(action, 'g')) || []).length, 1,
      `${action} must appear exactly once, not be duplicated elsewhere`)
  }
})

test('Preview Survey has the strongest visual priority', () => {
  const tools = dashCode.slice(dashCode.indexOf('aria-label="Survey tools"'), dashCode.indexOf('Send test to me') + 60)
  const survey = tools.indexOf('Preview Survey')
  const email = tools.indexOf('Preview Email')
  assert.ok(survey > -1 && email > survey, 'Preview Survey must come first')
  assert.match(tools.slice(0, survey), /rr-tool-primary/)
  assert.match(tools.slice(survey, email), /rr-tool-secondary/)
})

test('Send test to me is styled distinctly from a production release', () => {
  assert.match(dashCode, /className="rr-tool-test"/)
  // A dashed amber control, deliberately not the solid green Release treatment.
  assert.match(dash, /\.rr-tool-test \{[^}]*border:1px dashed/)
  const tools = dashCode.slice(dashCode.indexOf('aria-label="Survey tools"'), dashCode.indexOf('</div>', dashCode.indexOf('Send test to me')))
  assert.ok(!/Release/.test(tools), 'the toolbar must contain no release control')
})

test('the toolbar stays usable on a phone', () => {
  assert.match(dash, /@media \(max-width: 640px\)/)
  assert.match(dash, /\.rr-tool-primary, \.rr-tool-secondary, \.rr-tool-test \{ flex:1 1 auto/)
  assert.match(dash, /flex-wrap:wrap/)
})

// ── House style ────────────────────────────────────────────────────────────
test('no em dash in the changed evaluation sources', () => {
  const EM_DASH = String.fromCharCode(0x2014)
  for (const [name, src] of [['dashboard', dash], ['panel', panel], ['endpoint', endpoint],
    ['content', content], ['routing', read('src/lib/evaluation/releaseRouting.js')]]) {
    assert.ok(!src.includes(EM_DASH), `${name} must not contain an em dash`)
  }
})
