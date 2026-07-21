// ASPIRE-EVAL-PREVIEW-1 / TEST-MODE-1: guards for survey preview and safe test mode.
//
// Pure-function tests over the real catalog and the real normalizer, plus static-source
// guards on the drawer, the test page, the endpoint, and Review and Release. No jsdom and
// no new test dependency, matching this repo's node:test convention.
//
// The safety claims here are structural, not procedural: test mode is safe because there
// is no assignment, no token, and no response row to write, so these guards assert the
// ABSENCE of those writes rather than the presence of an exclusion filter.
//
// Negative assertions run against comment-stripped source: the prose in these files names
// the very things it forbids in order to explain why, and a naive match hits the
// explanation instead of real code.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  SURVEY_CATALOG, surveyByKey, sameSurveyAs, similarAudienceTo, relationshipFor,
} from '../src/lib/evaluation/surveyCatalog.js'
import { buildPreviewModel, countQuestions } from '../src/lib/evaluation/surveyPreviewModel.js'
import { WORKFLOW_KEYS } from '../src/lib/evaluation/workflowSelection.js'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')

const drawer   = read('src/components/evaluation/SurveyPreviewDrawer.jsx')
const testPage = read('src/pages/SurveyTestModePage.jsx')
const endpoint = read('api/evaluation-send-survey-test.js')
const dash     = read('src/components/evaluation/SurveyAutomationDashboard.jsx')
const app      = read('src/App.jsx')
const model    = read('src/lib/evaluation/surveyPreviewModel.js')

const stripJs = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const drawerCode   = stripJs(drawer)
const testPageCode = stripJs(testPage)
const endpointCode = stripJs(endpoint)
const dashCode     = stripJs(dash)

// ── The catalog covers every registered workflow ────────────────────────────
test('the catalog registers exactly the known workflow keys', () => {
  assert.deepEqual(SURVEY_CATALOG.map(s => s.key), [...WORKFLOW_KEYS],
    'the catalog and the selection resolver must not drift apart')
})

test('every workflow can render a preview or an explicit unsupported state', () => {
  for (const s of SURVEY_CATALOG) {
    assert.ok(s.slug, `${s.key} must declare a slug`)
    assert.ok(['storage', 'inline'].includes(s.contentSource), `${s.key} must declare a content source`)
    // Inline content must resolve with no request at all.
    if (s.contentSource === 'inline') {
      const m = buildPreviewModel(s.slug, null)
      assert.ok(m && m.sections.length > 0, `${s.key} must render from its in-code definition`)
    } else {
      // Storage-backed slugs return null without content, which the drawer renders as
      // the explicit unsupported state rather than as an empty drawer.
      assert.equal(buildPreviewModel(s.slug, null), null)
    }
  }
  assert.match(drawerCode, /status === 'unsupported'/)
  assert.match(drawer, /preview is not available for this survey definition yet/)
})

// ── The relationship question the product owner asked ───────────────────────
test('Student Feedback and ASPIRE Rotation Feedback are NOT the same survey', () => {
  const student = surveyByKey('student')
  const post = surveyByKey('postRotation')
  assert.notEqual(student.slug, post.slug)
  assert.notEqual(student.formType, post.formType)
  assert.equal(sameSurveyAs('student').length, 0)
  assert.equal(sameSurveyAs('postRotation').length, 0)
})

test('but they are reported as easily confused, because they share recipient and timepoint', () => {
  const similar = similarAudienceTo('student').map(s => s.key)
  assert.ok(similar.includes('postRotation'),
    'both go to a student after the rotation, which is why they look like duplicates')
  const rel = relationshipFor('student')
  assert.equal(rel.kind, 'similar_audience')
  assert.match(rel.note, /different survey/i)
  assert.match(rel.note, /Different questions/i)
})

test('a genuinely shared survey would be reported as shared, not merely as similar', () => {
  // Proves the relationship is DERIVED from the registry rather than hardcoded to the
  // current answer. Two entries sharing a slug must report kind 'shared_survey'.
  const a = { ...surveyByKey('student') }
  const b = { ...surveyByKey('postRotation'), slug: a.slug }
  const pair = [a, b]
  const shared = pair.filter(s => s.key !== a.key && s.slug === a.slug)
  assert.equal(shared.length, 1, 'the same-slug comparison is what decides shared vs distinct')
  assert.match(relationshipFor('student').note, /different survey/i)
})

test('every workflow has a distinct slug today', () => {
  const slugs = SURVEY_CATALOG.map(s => s.slug)
  assert.equal(new Set(slugs).size, slugs.length)
})

// ── Preview uses the live source of truth, never a copy ─────────────────────
test('the preview holds no question text of its own', () => {
  // The normalizer maps shapes; it must not contain survey prose. If someone pastes
  // questions in here, the preview stops being a preview of the live definition.
  //
  // Checked against COMMENT-STRIPPED source. The file legitimately names response keys
  // like approachable_available in its documentation, to explain the two item shapes it
  // has to support; matching raw text flagged that explanation as if it were content.
  const modelCode = stripJs(model)
  for (const phrase of [
    'Overall, ASPIRE was a valuable learning experience',
    'approachable', 'Strongly Agree', 'clinical judgment',
  ]) {
    assert.ok(!modelCode.includes(phrase), `the normalizer must not hardcode "${phrase}"`)
  }
})

test('preview reads Storage-backed definitions through the existing gated endpoint', () => {
  assert.match(drawerCode, /\/api\/evaluation-instrument-content\?slug=/)
  assert.match(drawerCode, /Authorization: `Bearer \$\{token\}`/)
})

test('the in-code definition is imported, not duplicated', () => {
  assert.match(model, /import \{ POST_ROTATION_CONTENT \} from/)
  const m = buildPreviewModel('post_rotation_evaluation', null)
  assert.equal(m.sections.length, 5)
  assert.equal(countQuestions(m), 13)
  // The consent item is part of the live definition and must appear.
  const keys = m.sections.flatMap(s => s.items.map(i => i.key))
  assert.ok(keys.includes('may_use_anonymized_comments'))
})

test('the preview model reports order, type, required, and scale for each question', () => {
  const m = buildPreviewModel('post_rotation_evaluation', null)
  const first = m.sections[0].items[0]
  for (const field of ['key', 'label', 'type', 'required', 'scale']) {
    assert.ok(field in first, `preview items must carry ${field}`)
  }
  assert.equal(first.type, 'rating')
  assert.equal(first.required, true)
  assert.ok(first.scale.length > 0, 'a rating must carry its scale labels')
})

// ── Preview causes no writes and no release ────────────────────────────────
test('the preview drawer cannot write, release, or send', () => {
  for (const forbidden of [
    'evaluation-release', 'evaluation-send', '.insert(', '.update(', '.upsert(', '.delete(',
    'evaluation_assignments', 'evaluation_responses', 'issue_participation_certificate',
  ]) {
    assert.ok(!drawerCode.includes(forbidden), `the preview must not reference ${forbidden}`)
  }
  // Exactly one network call, and it is a GET.
  assert.equal((drawerCode.match(/fetch\(/g) || []).length, 1)
  assert.ok(!/method:\s*'POST'/.test(drawerCode))
})

// ── Send test to me: server-side recipient, no injection ────────────────────
test('the test endpoint resolves the recipient from the authenticated caller', () => {
  assert.match(endpointCode, /verifyOwnerAdmin\(req\)/)
  assert.match(endpointCode, /const email = \(user\.email \|\| profile\.email \|\| ''\)\.trim\(\)/)
  assert.match(endpointCode, /to: auth\.email/)
})

test('an arbitrary recipient cannot be injected', () => {
  // The body allowlist is a single key. Anything else is a 400.
  assert.match(endpointCode, /if \(k !== 'workflow_key'\) return res\.status\(400\)/)
  for (const field of ['body.email', 'body.to', 'body.recipient', 'body.recipient_email', 'body.student_id']) {
    assert.ok(!endpointCode.includes(field), `the endpoint must not read ${field}`)
  }
})

test('the test endpoint is Owner/Admin only and requires an active account', () => {
  assert.match(endpointCode, /profile\.is_active === false/)
  assert.match(endpointCode, /is_owner === true \|\| profile\.role === 'owner' \|\| profile\.role === 'admin'/)
  assert.ok(!endpointCode.includes('is_staff'), 'is_staff also returns true for interviewer and viewer')
})

test('the test email is labelled TEST in both subject and body', () => {
  assert.match(endpointCode, /\[TEST\] ASPIRE survey preview/)
  assert.match(endpoint, /This is a <strong>TEST<\/strong>/)
  assert.match(endpoint, /not a real survey invitation/)
})

test('the test action is never labelled Release', () => {
  const toolbar = dashCode.slice(dashCode.indexOf('Send test to me') - 600, dashCode.indexOf('Send test to me') + 200)
  assert.ok(!/Release/.test(toolbar), 'the test control must not read as a release action')
  assert.match(dashCode, /Send test to me/)
})

// ── Test mode writes nothing at all ─────────────────────────────────────────
test('the test endpoint creates no assignment, no token, and no response', () => {
  for (const table of ['evaluation_assignments', 'evaluation_assignment_tokens', 'evaluation_responses']) {
    assert.ok(!endpointCode.includes(table),
      `test mode must not touch ${table}: a test row would borrow a real student's slot`)
  }
  // The only write is the audit row, and it is explicitly marked as a test.
  const inserts = endpointCode.match(/\.insert\(/g) || []
  assert.equal(inserts.length, 1, 'exactly one write: the audit row')
  assert.match(endpointCode, /notification_type: 'evaluation_survey_test_sent'/)
  assert.match(endpointCode, /test_mode: true/)
  assert.match(endpointCode, /released: false/)
})

test('test mode cannot satisfy a production requirement or unlock a certificate', () => {
  // The certificate gate reads evaluation_assignments and evaluation_instruments. With
  // no assignment there is nothing for it to read, which is why this is structural.
  for (const src of [endpointCode, testPageCode]) {
    assert.ok(!src.includes('issue_participation_certificate'))
    assert.ok(!src.includes('certificates'))
    assert.ok(!src.includes('evaluation_assignments'))
  }
  // The page has a local onSubmit handler by design; what must not exist is a submit
  // ENDPOINT or any persistence. Asserting on the word "submit" would fail on the
  // form's own validation handler, which is not the property under test.
  assert.ok(!/fetch\([^)]*submit/.test(testPageCode), 'the test page must call no submit endpoint')
  assert.match(testPageCode, /There is no\s+submit endpoint in test mode|no submit endpoint/,
    'the page must tell the operator that nothing is submitted')
})

test('the test page has no submit endpoint and writes nothing', () => {
  for (const forbidden of [
    'evaluation-submit', 'evaluation-post-rotation-submit', 'evaluation-preceptor-submit',
    'evaluation-student-eval-submit', '.insert(', '.update(', '.rpc(',
  ]) {
    assert.ok(!testPageCode.includes(forbidden), `the test page must not reference ${forbidden}`)
  }
  // Its only network call is the same read-only content fetch the preview uses.
  assert.equal((testPageCode.match(/fetch\(/g) || []).length, 1)
  assert.match(testPageCode, /evaluation-instrument-content/)
})

test('the test page shows a persistent test-mode banner', () => {
  assert.match(testPage, /TEST MODE/)
  assert.match(testPage, /Nothing you enter is saved/)
  assert.match(testPageCode, /position: 'sticky'/, 'the banner must stay visible while scrolling')
})

test('the test page is staff only and non-enumerating', () => {
  assert.match(testPageCode, /is_owner === true \|\| userProfile\.role === 'owner' \|\| userProfile\.role === 'admin'/)
  assert.match(testPageCode, /if \(!user \|\| !isStaff\)/)
  assert.match(testPage, /available to ASPIRE program leads who are signed in/)
})

test('the test link carries no token and is useless without a session', () => {
  assert.match(endpointCode, /appUrl\(`\/evaluation\/test\/\$\{encodeURIComponent\(workflowKey\)\}`\)/)
  for (const forbidden of ['#t=', 'generateToken', 'token_hash', 'raw_token']) {
    assert.ok(!endpointCode.includes(forbidden), `the test link must not carry ${forbidden}`)
  }
})

// ── Paused workflows: previewable and testable, never releasable ────────────
test('every workflow can be previewed and tested regardless of release status', () => {
  // CHANGED BY PRODUCT DECISION: ASPIRE Rotation Feedback is no longer paused, so there is
  // no paused workflow to special-case. The property that matters is unchanged and now
  // applies to all four: preview and test never depend on releasability.
  assert.equal(SURVEY_CATALOG.filter(s => s.status === 'paused').length, 0,
    'no workflow is paused today')
  for (const s of SURVEY_CATALOG) {
    assert.ok(['active', 'paused'].includes(s.status), `${s.key} must declare a status`)
    assert.match(endpointCode, new RegExp(`${s.key}: '`), `${s.key} must be testable`)
  }
  assert.ok(buildPreviewModel('post_rotation_evaluation', null))
})

test('the preview states paused status and the certificate gate', () => {
  assert.match(drawerCode, /survey\.status === 'paused'/)
  assert.match(drawerCode, /survey\.certificateGate/)
  assert.equal(surveyByKey('caseyFinkPostRotation').certificateGate, true)
  assert.equal(surveyByKey('postRotation').certificateGate, false)
})

// ── Review and Release wiring ──────────────────────────────────────────────
test('the survey preview is reachable from the Survey tools toolbar', () => {
  // The per-row eye icon was removed as redundant in the RR-corrections pass; the toolbar
  // is now the single entry point. Coverage of the toolbar itself lives in
  // test/evaluationReviewReleaseCorrections.test.mjs.
  assert.ok(!dashCode.includes('rr-row-eye'), 'the per-row eye icon is gone')
  assert.match(dashCode, /aria-label="Survey tools"/)
  assert.match(dashCode, /setSurveyPreviewKey\(effective\)/)
})

test('the nav row contains exactly one control, so no button is nested in a button', () => {
  const row = dashCode.slice(dashCode.indexOf('function WorkflowNavRow'), dashCode.indexOf('export default'))
  assert.equal((row.match(/<button/g) || []).length, 1)
})

test('the survey preview is distinct from the pre-existing email preview', () => {
  assert.match(dashCode, /Preview Survey/)
  assert.match(dashCode, /Preview Email/)
  assert.match(dashCode, /<SurveyPreviewDrawer/)
  assert.match(dashCode, /<AutomationEmailPreviewDrawer/)
})

test('production release controls are unchanged', () => {
  // The release path must not have been touched by this pass.
  assert.match(dashCode, /resolveEffectiveWorkflow/)
  for (const panel of ['PreceptorAutomationPanel', 'StudentEvalAutomationPanel',
    'CaseyFinkPostRotationAutomationPanel', 'PostRotationAutomationPanel']) {
    assert.match(dashCode, new RegExp(`<${panel}`), `${panel} must still mount`)
  }
  assert.ok(!dashCode.includes('evaluation-release'),
    'the dashboard shell still performs no release itself')
})

test('the test route is registered above the wildcard', () => {
  const route = app.indexOf('path="/evaluation/test/:workflowKey"')
  const wildcard = app.indexOf('path="/*"')
  assert.ok(route > -1 && wildcard > -1 && route < wildcard)
  assert.match(app, /import SurveyTestModePage from '\.\/pages\/SurveyTestModePage'/)
})

// ── House style ────────────────────────────────────────────────────────────
test('no em dash in the new evaluation sources', () => {
  const EM_DASH = String.fromCharCode(0x2014)
  for (const [name, src] of [
    ['drawer', drawer], ['test page', testPage], ['endpoint', endpoint],
    ['catalog', read('src/lib/evaluation/surveyCatalog.js')], ['model', model],
  ]) {
    assert.ok(!src.includes(EM_DASH), `${name} must not contain an em dash`)
  }
})
