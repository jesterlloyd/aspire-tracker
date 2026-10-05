// RESUME-FEEDBACK-1 (Owner, 2026-10-05): an alumnus sees Keith's review in the Residency tab once
// it was sent, in WORDS ("show words not the number"), with each area's change since the review
// shared before ("ASPIRE Positioning: Developing → Solid").
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { studentFeedback, levelFor, stripScores } from '../src/lib/documents/studentFeedbackModel.js'
import { resumeFeedback } from '../lib/server/alumnusResidency.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = p => readFileSync(join(root, p), 'utf8')
const cats = (a, note = 'Clear structure.') => Object.fromEntries(['ats', 'alignment', 'aspire', 'clinical', 'leadership', 'competitiveness'].map((k, i) => [k, { score: a[i], note }]))
const review = (scores, extra = {}) => ({
  status: 'sent', categories: cats(scores, extra.note), readiness: extra.readiness || 'Competitive', summary: 'Strong start; undersold ASPIRE. Scored 58 overall.',
  strengths: ['Bilingual', 'BLS and ACLS current (8/10 here)'], top_fixes: [{ fix: 'Name the unit.', quote: 'x' }], missing_info: ['graduation_date'],
  full_report: { rewritten_bullets: [{ original: 'Helped nurses', rewrite: 'Collaborated with [unit name] RNs.' }], keywords: ['SBAR'], section_review: [], recruiter_perspective: 'Reads clean. 58 of 100.', recommendations: { before_submitting: ['Fix dates'] } },
  score: 58, model_score: 90, draft_body: 'SECRET DRAFT', resume_text: 'SECRET TEXT', provenance_id: 'p', sent_at: extra.sent_at || '2026-10-05T18:00:00Z',
})

test('levels are words from the rubric anchors', () => {
  assert.deepEqual([9, 7, 6, 5, 4, 0].map(n => levelFor(n).label), ['Strong', 'Solid', 'Developing', 'Developing', 'Needs work', 'Needs work'])
})

test('no number reaches the student, from any field Keith wrote', () => {
  const fb = studentFeedback([review([8, 6, 5, 8, 7, 8], { note: 'Strong scan (8/10); rated 8 out of 10.' })])
  const json = JSON.stringify(fb)
  assert.doesNotMatch(json, /\b(58|90)\b|\d\s*\/\s*10|out of 10|of 100/, json)
  for (const k of ['draft', 'draft_body', 'resume_text', 'provenance_id', 'score', 'model_score', 'categories']) assert.ok(!(k in fb), `${k} never leaves`)
  assert.ok(!JSON.stringify(fb).includes('SECRET'))
  assert.equal(fb.areas.find(a => a.key === 'aspire').level, 'Developing')
  assert.match(fb.next, /To reach Highly Competitive/)
  assert.deepEqual(fb.missing, ['Graduation date'])
  assert.equal(stripScores('Clean layout (7/10). Scored 58 of 100 overall. Lists 120 clinical hours on 5 North.'), 'Clean layout. Lists 120 clinical hours on 5 North.')
  assert.equal(fb.summary, 'Strong start; undersold ASPIRE.', 'a sentence that states a score is dropped whole')
})

test('each area shows its change since the review shared before: Developing → Solid', () => {
  const now = review([8, 7, 7, 8, 7, 8], { readiness: 'Competitive', sent_at: '2026-10-05T18:00:00Z' })
  const before = review([8, 6, 5, 8, 7, 8], { readiness: 'Needs Improvement', sent_at: '2026-09-12T18:00:00Z' })
  const fb = studentFeedback([now, before])
  const aspire = fb.areas.find(a => a.key === 'aspire')
  assert.deepEqual([aspire.was, aspire.level, aspire.direction], ['Developing', 'Solid', 'up'])
  assert.equal(fb.areas.find(a => a.key === 'ats').was, null, 'an unchanged area shows no change')
  assert.equal(fb.readiness_was, 'Needs Improvement')
  assert.equal(studentFeedback([]), null, 'nothing sent, nothing shown')
})

test('only a SENT review is shared, and the portal reads nothing else of it', async () => {
  const calls = []
  const db = { from(t) { const q = { select(c) { calls.push(['select', t, c]); return q }, eq(k, v) { calls.push(['eq', k, v]); return q }, order() { return q }, limit() { return Promise.resolve({ data: [], error: null }) } }; return q } }
  await resumeFeedback(db, 's1')
  assert.ok(calls.some(c => c[0] === 'eq' && c[1] === 'status' && c[2] === 'sent'), 'the send is the release')
  const cols = calls.find(c => c[0] === 'select')[2]
  assert.doesNotMatch(cols, /draft|resume_text|provenance|score\b|model_score/, cols)
  const drawer = read('src/components/documents/ResumeReviewDrawer.jsx')
  assert.match(drawer, /Include readiness/)
  assert.match(read('lib/server/resumeReview.js'), /status: 'scored', include_score: false/, 'the readiness sentence starts off')
})

test('one card for both places: the portal and the staff preview render the same component', () => {
  const portal = read('src/portal/StudentResidency.jsx')
  const drawer = read('src/components/documents/ResumeReviewDrawer.jsx')
  assert.match(portal, /import ResumeFeedbackCard from '\.\.\/components\/documents\/ResumeFeedbackCard'/)
  assert.match(drawer, /import ResumeFeedbackCard from '\.\/ResumeFeedbackCard'/)
  assert.match(drawer, /studentFeedback\(\[\{ \.\.\.r, sent_at: r\.sent_at \|\| null, scored_at: r\.sent_at \? r\.scored_at : null \}, before\]/, 'the preview is the same words-only shape')
  assert.match(drawer, /Nothing is shared until then/)
  // A review not sent yet carries no shared date, so the card says "Shared when sent".
  const unsent = studentFeedback([{ ...review([8, 7, 7, 8, 7, 8]), sent_at: null, scored_at: null }])
  assert.equal(unsent.shared_at, null)
})
