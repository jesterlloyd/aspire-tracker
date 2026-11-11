// ACTIVITY-GATE-2 (Owner, 2026-11-10): Student's Feedback on ASPIRE asks about each support
// activity and lets the student say they did not take part, because the release now needs only
// one of the three recorded. "I did not take part" is stored as 'na' and left out of every mean.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  POST_ROTATION_CONTENT, ALL_ITEMS, validateResponses, NA_VALUE, NA_LABEL,
} from '../lib/server/evaluation/postRotationEvalContent.js'
import { instrumentBySlug, subscaleMean, buildBubbleSheet } from '../src/lib/evaluation/responsesPacketModel.js'
import { buildPreviewModel } from '../src/lib/evaluation/surveyPreviewModel.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = f => fs.readFileSync(path.join(root, f), 'utf8')

const SUPPORT_KEYS = ['support_resume_review', 'support_town_hall', 'support_interview_bootcamp']

function fullAnswers(over = {}) {
  const r = {}
  for (const i of ALL_ITEMS) {
    if (i.type === 'rating') r[i.key] = 4
    else if (i.type === 'yesno') r[i.key] = true
    else if (i.required) r[i.key] = 'Something.'
  }
  return { ...r, ...over }
}

test('the support section asks about each activity, required, with a did-not-take-part choice', () => {
  const sec = POST_ROTATION_CONTENT.sections.find(s => s.key === 'section_support')
  assert.ok(sec, 'the section exists')
  assert.equal(sec.title, 'ASPIRE Support Activities')
  assert.deepEqual(sec.items.map(i => i.key), SUPPORT_KEYS)
  for (const i of sec.items) { assert.equal(i.type, 'rating'); assert.equal(i.required, true); assert.equal(i.allowNa, true) }
  assert.equal(NA_LABEL, 'I did not take part')
  assert.equal(POST_ROTATION_CONTENT.naLabel, NA_LABEL)
  // It sits before Final Reflection, which stays last.
  assert.equal(POST_ROTATION_CONTENT.sections.at(-1).key, 'section5')
  // No other item offers it.
  assert.deepEqual(ALL_ITEMS.filter(i => i.allowNa).map(i => i.key), SUPPORT_KEYS)
})

test("validation accepts 'na' only where the item allows it, and still requires an answer", () => {
  assert.equal(validateResponses(fullAnswers()).valid, true)
  assert.equal(validateResponses(fullAnswers(Object.fromEntries(SUPPORT_KEYS.map(k => [k, NA_VALUE])))).valid, true)
  assert.equal(validateResponses(fullAnswers({ overall_valuable_learning_experience: NA_VALUE })).valid, false)
  const missing = fullAnswers(); delete missing.support_town_hall
  assert.equal(validateResponses(missing).valid, false)
  assert.equal(validateResponses(fullAnswers({ support_town_hall: 'skipped' })).valid, false)
})

test("the submit endpoint keeps 'na' and the page sends it", () => {
  const api = read('api/evaluation-post-rotation-submit.js')
  assert.match(api, /else if \(item\.allowNa && v === NA_VALUE\) out\[item\.key\] = NA_VALUE;/)
  const page = read('src/pages/PostRotationEvaluationPage.jsx')
  assert.match(page, /naLabel=\{item\.allowNa \?/)
  assert.match(page, /item\.allowNa && v === 'na'/)
})

test("'na' is left out of the section mean and shown on the bubble sheet", () => {
  const inst = instrumentBySlug('post_rotation_evaluation')
  const sa = inst.subscales.find(s => s.key === 'section_support')
  assert.equal(sa.short, 'SA')
  const response = { responses: { support_resume_review: 5, support_town_hall: NA_VALUE, support_interview_bootcamp: 3 } }
  assert.equal(subscaleMean(inst, sa, response), 4)
  assert.equal(subscaleMean(inst, sa, { responses: Object.fromEntries(SUPPORT_KEYS.map(k => [k, NA_VALUE])) }), null)
  const row = { timepoint: 'post_rotation', status: 'completed', assignment: { timepoint: 'post_rotation', evaluation_responses: [{ responses: response.responses }] } }
  const sheet = buildBubbleSheet(inst, row, null)
  const item = sheet.groups.find(g => g.key === 'section_support').items.find(i => i.code === 'support_town_hall')
  assert.equal(item.na, true); assert.equal(item.post, null)
})

test('the preview shows the extra choice by its words', () => {
  const m = buildPreviewModel('post_rotation_evaluation', null)
  const item = m.sections.find(s => s.key === 'section_support').items[0]
  assert.deepEqual(item.scale.at(-1), { value: 'na', label: NA_LABEL })
  assert.match(read('src/components/evaluation/SurveyPreviewDrawer.jsx'), /s\.value === 'na' \? s\.label/)
})
