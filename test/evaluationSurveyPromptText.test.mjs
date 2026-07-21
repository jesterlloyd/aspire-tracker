// ASPIRE-EVAL-PROMPT-TEXT: guards that respondent-facing question text is real prose.
//
// THE DEFECT. Preview and Test mode rendered internal response keys such as
// approachable_available as if they were questions. The canonical Storage content was
// correct all along and the production survey was never affected: the normalizer read
// def.label, but this survey stores each item as a plain STRING, so `'text'.label` was
// undefined and it fell back to the key.
//
// These tests use the COMMITTED content fixtures under lib/server/evaluation/content/ as
// stand-ins for the Storage objects. That is a real limitation worth naming: those files
// are not what the runtime reads, so they prove the normalizer handles the shape, not that
// Storage and the repo agree. The shape-agreement guard below is what protects against the
// class of bug, and the manual check is what confirms the live bytes.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { buildPreviewModel } from '../src/lib/evaluation/surveyPreviewModel.js'
import { surveyByKey } from '../src/lib/evaluation/surveyCatalog.js'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')
const json = (p) => JSON.parse(read(p))

const studentContent = json('lib/server/evaluation/content/student_preceptor_eval.json')
const preceptorContent = json('lib/server/evaluation/content/preceptor_progress.json')
const model = buildPreviewModel('student_preceptor_eval', studentContent)
const renderer = read('src/pages/StudentEvaluationPage.jsx')
const normalizer = read('src/lib/evaluation/surveyPreviewModel.js')
const panel = read('src/components/evaluation/PostRotationAutomationPanel.jsx')
const rotationSurveyPage = read('src/pages/PostRotationEvaluationPage.jsx')

const stripJs = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

/** Every rendered item, excluding prefilled context fields. */
const askedItems = model.sections.flatMap(s => s.items.filter(i => i.type !== 'display'))

// The exact keys reported as leaking in the acceptance review.
const REPORTED_KEYS = [
  'approachable_available', 'clear_explanations', 'useful_feedback', 'skill_development',
  'included_in_care', 'welcoming_unit', 'practice_opportunities', 'workflow_supported_learning',
]

// ── Internal keys must never be respondent-facing text ─────────────────────
test('no rendered question text is an internal response key', () => {
  for (const it of askedItems) {
    assert.notEqual(it.label, it.key, `${it.key} rendered its own key as the question`)
    assert.ok(!/^[a-z0-9]+(_[a-z0-9]+)+$/.test(it.label.trim()),
      `${it.key} rendered a snake_case identifier as the question: "${it.label}"`)
  }
})

test('every key from the acceptance review now renders real prose', () => {
  for (const key of REPORTED_KEYS) {
    const it = askedItems.find(i => i.key === key)
    assert.ok(it, `${key} must still exist as a question`)
    assert.notEqual(it.label, key)
    assert.ok(it.label.length > 20, `${key} must have a full prompt, got "${it.label}"`)
  }
})

test('every asked item has a non-empty human-readable prompt', () => {
  assert.ok(askedItems.length >= 17, 'the survey should carry its full item set')
  for (const it of askedItems) {
    assert.ok(it.label && it.label.trim().length > 0, `${it.key} has no prompt`)
    assert.ok(/[a-z]/.test(it.label), `${it.key} prompt has no lowercase prose: "${it.label}"`)
    assert.ok(/\s/.test(it.label.trim()), `${it.key} prompt is a single token: "${it.label}"`)
  }
})

test('rating prompts read as complete statements', () => {
  const ratings = askedItems.filter(i => i.type === 'rating')
  assert.ok(ratings.length >= 14)
  for (const it of ratings) {
    const words = it.label.trim().split(/\s+/)
    assert.ok(words.length >= 4, `${it.key} is too short to be a rating statement: "${it.label}"`)
    assert.match(it.label.trim(), /^[A-Z]/, `${it.key} should start capitalized: "${it.label}"`)
  }
})

// ── Response keys are untouched ────────────────────────────────────────────
test('the internal response keys are unchanged', () => {
  // The whole point: fix what is shown, never what is stored.
  const rendered = new Set(askedItems.map(i => i.key))
  for (const key of REPORTED_KEYS) assert.ok(rendered.has(key), `${key} must be preserved`)
  for (const section of ['section1', 'section2', 'section3', 'section4']) {
    for (const key of Object.keys(studentContent[section]?.items || {})) {
      assert.ok(rendered.has(key), `${key} must survive normalization`)
    }
  }
})

test('the form type and slug are unchanged', () => {
  const s = surveyByKey('student')
  assert.equal(s.slug, 'student_preceptor_eval')
  assert.equal(s.formType, 'student_preceptor_eval')
  assert.equal(studentContent.slug, 'student_preceptor_eval')
})

// ── Preview, Test mode, and production share one source ────────────────────
test('the normalizer reads the same value the production renderer reads', () => {
  // Production: Object.entries(items).map(([code, text]) => <LikertItem text={text} />)
  assert.match(renderer, /Object\.entries\(items\)\.map\(\(\[code, text\]\) =>/)
  assert.match(renderer, /text=\{text\}/)
  // Preview: the string value IS the label.
  assert.match(stripJs(normalizer), /const isString = typeof def === 'string'/)
  assert.match(stripJs(normalizer), /const label = \(isString \? def : def\?\.label\) \|\| ''/)
})

test('for every item, the preview prompt equals the canonical content value', () => {
  for (const section of ['section1', 'section2', 'section3', 'section4']) {
    for (const [key, value] of Object.entries(studentContent[section]?.items || {})) {
      const it = askedItems.find(i => i.key === key)
      const canonical = typeof value === 'string' ? value : value.label
      assert.equal(it.label, canonical,
        `${key} must show the canonical text, not a second copy`)
    }
  }
})

test('the preview holds no question text of its own', () => {
  // A handwritten copy would drift from Storage silently.
  for (const it of askedItems.slice(0, 6)) {
    assert.ok(!normalizer.includes(it.label), 'question text must never be hardcoded in the normalizer')
  }
})

test('the other content shape still resolves, so the fix did not trade one bug for another', () => {
  // preceptor_progress stores { label, prompt } objects rather than strings.
  const m = buildPreviewModel('preceptor_progress', preceptorContent)
  const asked = m.sections.flatMap(s => s.items.filter(i => i.type !== 'display'))
  for (const it of asked) {
    assert.notEqual(it.label, it.key, `${it.key} fell back to its key`)
    assert.ok(it.label.trim().length > 0)
  }
  const judgment = asked.find(i => i.key === 'clinical_judgment')
  assert.equal(judgment.label, 'Clinical Judgment')
  assert.ok(judgment.helper.length > 20, 'the descriptive prompt is kept as helper text')
})

test('an item with no resolvable text is dropped, never shown as its key', () => {
  const broken = JSON.parse(JSON.stringify(studentContent))
  broken.section1.items.approachable_available = ''
  broken.section1.items.clear_explanations = { label: '   ' }
  const m = buildPreviewModel('student_preceptor_eval', broken)
  const keys = m.sections.flatMap(s => s.items.map(i => i.key))
  assert.ok(!keys.includes('approachable_available'), 'an empty prompt must not render as the key')
  assert.ok(!keys.includes('clear_explanations'))
  assert.ok(keys.includes('useful_feedback'), 'the rest of the section still renders')
})

// ── Required and optional behavior is unchanged ────────────────────────────
test('optional comment fields remain optional', () => {
  for (const key of ['preceptor_support_comment', 'learning_environment_comment']) {
    const it = askedItems.find(i => i.key === key)
    assert.ok(it, `${key} must exist`)
    assert.equal(it.required, false, `${key} must stay optional`)
    assert.equal(it.type, 'text')
  }
  for (const key of ['strengths', 'suggestions', 'open_comment']) {
    const it = askedItems.find(i => i.key === key)
    if (it) assert.equal(it.required, false, `${key} must stay optional`)
  }
})

test('required rating items remain required and keep their scale', () => {
  const ratings = askedItems.filter(i => i.type === 'rating')
  for (const it of ratings) {
    assert.equal(it.required, true, `${it.key} must stay required`)
    assert.ok(it.scale.length > 0, `${it.key} must carry its rating scale`)
  }
  // The canonical scale, including the N/A option, is preserved.
  const domain = askedItems.find(i => i.key === 'approachable_available')
  assert.equal(domain.scale.length, studentContent.ratingScale.length)
})

// ── ASPIRE Rotation Feedback: no certificate explanation ───────────────────
test('the student-facing thank-you screen contains no certificate explanation', () => {
  // This sentence survived two earlier passes because they targeted the staff panel and the
  // survey intro. It was the last student-facing place where a non-gating survey explained
  // another workflow's certificate gate.
  const code = stripJs(rotationSurveyPage)
  assert.equal((code.match(/[Cc]ertificate/g) || []).length, 0,
    'no rendered text on this page may mention a certificate')
  assert.ok(!code.includes('Casey-Fink'),
    'this survey must not name another workflow to the respondent')
  // The rest of the thank-you screen is intact.
  assert.match(code, /Thank you for completing the ASPIRE Post-Rotation Evaluation\./)
  assert.match(code, /Your feedback has been submitted\./)
})

test('every other thank-you and error state on that page is unchanged', () => {
  const code = stripJs(rotationSurveyPage)
  for (const state of [
    'This evaluation has already been submitted\.',
    'This evaluation link is no longer valid\.',
    'Too many requests\.',
  ]) {
    assert.match(code, new RegExp(state), `the ${state} state must survive`)
  }
})

test('the Rotation Feedback survey page still submits through the same path', () => {
  const code = stripJs(rotationSurveyPage)
  assert.match(code, /\/api\/evaluation-post-rotation-submit/,
    'the submit path must be untouched')
  assert.ok(!code.includes('issue_participation_certificate'))
})

test('the Rotation Feedback panel no longer explains the certificate', () => {
  assert.ok(!panel.includes('Certificate of Participation'))
  assert.ok(!panel.includes('certificate gate'))
  assert.ok(!/does NOT unlock a\s+certificate/.test(panel))
})

test('but the workflow is still active, releasable, and not gated', () => {
  const s = surveyByKey('postRotation')
  assert.equal(s.status, 'active')
  assert.equal(s.certificateGate, false)
  assert.match(stripJs(panel), /Release Survey/)
  assert.match(stripJs(panel), /setConfirm\(r\)/, 'release still requires human confirmation')
  assert.match(stripJs(panel), /expected_instrument_slug: ROUTE\.instrumentSlug/)
})

test('Casey-Fink remains the only certificate-gated workflow', () => {
  const gated = ['preceptor', 'student', 'caseyFinkPostRotation', 'postRotation']
    .filter(k => surveyByKey(k).certificateGate)
  assert.deepEqual(gated, ['caseyFinkPostRotation'])
})

test('the rest of the Rotation Feedback survey is untouched', () => {
  const m = buildPreviewModel('post_rotation_evaluation', null)
  assert.equal(m.sections.length, 5)
  const keys = m.sections.flatMap(s => s.items.map(i => i.key))
  assert.ok(keys.includes('may_use_anonymized_comments'))
  assert.ok(keys.includes('overall_valuable_learning_experience'))
})

// ── No release or response behavior changed ────────────────────────────────
test('no release, submit, or response path was touched by this pass', () => {
  // The normalizer is presentation only.
  const code = stripJs(normalizer)
  for (const forbidden of [
    'evaluation-release', 'evaluation-submit', '.insert(', '.update(', '.rpc(', 'fetch(',
    'evaluation_responses', 'evaluation_assignments',
  ]) {
    assert.ok(!code.includes(forbidden), `the normalizer must not reference ${forbidden}`)
  }
})

// ── House style ────────────────────────────────────────────────────────────
test('no em dash in the changed sources', () => {
  const EM_DASH = String.fromCharCode(0x2014)
  for (const [name, src] of [['normalizer', normalizer], ['panel', panel]]) {
    assert.ok(!src.includes(EM_DASH), `${name} must not contain an em dash`)
  }
})
