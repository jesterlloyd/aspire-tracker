// EVAL-OVERVIEW-1 (Owner, 2026-11-07): Evaluation > Overview.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  annotate, scopeRows, filterOptions, tilesFor, rateBySurvey, rateBySchool, readinessChange,
  preceptorRatings, unitFeedback, buildOverview, pickStatus, chipsFor, rateOf, MIN_N, EMPTY_FILTERS,
} from '../src/lib/evaluation/evaluationOverviewModel.js'
import { CASEY_FINK_SLUG, buildDistribution, instrumentBySlug } from '../src/lib/evaluation/responsesPacketModel.js'

const NOW = Date.parse('2026-11-07T12:00:00Z')
let seq = 0
const units = [{ id: 'u1', unit_name: '6 NE' }, { id: 'u2', unit_name: '6NE' }, { id: 'u3', unit_name: '5 North' }]
function row({ slug, tp = 'post_rotation', status = 'completed', school = 'UCLA', unit = 'u1', cohort = 'c1', student, responses = null, scores = null, expires = null }) {
  seq += 1
  return {
    id: `a${seq}`, cohort_id: cohort, timepoint: tp, status, expires_at: expires,
    students: { id: student || `s${seq}`, school, matched_unit_id: unit },
    evaluation_instruments: { slug },
    evaluation_responses: status === 'completed' ? [{ submitted_at: '2026-10-01', responses: responses || {}, ...(scores || {}) }] : [],
  }
}
const cf = (student, tp, a, b, c) => row({ slug: CASEY_FINK_SLUG, tp, student, scores: { score_s1_clinical_problem_solving: a, score_s1_learning_activities: b, score_s1_practice_readiness: c } })

test('a rate under five is withheld, never zero', () => {
  assert.deepEqual(rateOf(3, 4), { count: 3, n: 4, rate: null, suppressed: true })
  assert.equal(rateOf(4, 5).rate, 80)
  assert.equal(MIN_N, 5)
})

test('units compare by key, so 6NE and 6 NE are one unit, and options come from every row', () => {
  const rows = annotate([row({ slug: 'post_rotation_evaluation', unit: 'u1' }), row({ slug: 'post_rotation_evaluation', unit: 'u2', school: 'CSULB' })], units)
  const opts = filterOptions(rows, [{ id: 'c1', name: 'Fall 2025' }, { id: 'c9', name: 'Winter 2027' }])
  assert.deepEqual(opts.units, [{ key: '6ne', name: '6 NE' }])
  assert.deepEqual(opts.schools, ['CSULB', 'UCLA'])
  assert.deepEqual(opts.cohorts.map(c => c.id), ['c1'], 'a cohort with no surveys is not offered')
  assert.equal(scopeRows(rows, { ...EMPTY_FILTERS, unit: '6ne' }).length, 2)
  assert.equal(scopeRows(rows, { ...EMPTY_FILTERS, school: 'UCLA' }).length, 1)
})

test('the tiles count by the packet\'s own status rule, a lapsed link reads expired', () => {
  const rows = annotate([
    row({ slug: 'post_rotation_evaluation' }),
    row({ slug: 'post_rotation_evaluation', status: 'sent', expires: '2026-12-01' }),
    row({ slug: 'post_rotation_evaluation', status: 'sent', expires: '2026-10-01' }),
    row({ slug: 'post_rotation_evaluation', status: 'revoked' }),
  ], units)
  const t = tilesFor(rows, NOW)
  assert.deepEqual([t.sent, t.completed, t.awaiting, t.closed, t.reissuable], [4, 1, 1, 2, 2])
})

test('a KPI card picks what the rate cards measure, and again clears it', () => {
  const rows = annotate([
    ...Array.from({ length: 4 }, () => row({ slug: 'post_rotation_evaluation' })),
    row({ slug: 'post_rotation_evaluation', status: 'sent', expires: '2026-12-01' }),
  ], units)
  assert.equal(rateBySurvey(rows, '', NOW)[0].rate, 80)
  assert.equal(rateBySurvey(rows, 'awaiting', NOW)[0].rate, 20)
  assert.equal(rateBySchool(rows, 'completed', NOW)[0].rate, 80)
  const f = pickStatus(EMPTY_FILTERS, 'awaiting')
  assert.equal(f.status, 'awaiting')
  assert.equal(pickStatus(f, 'awaiting').status, '')
  assert.equal(pickStatus(f, '').status, '')
  assert.equal(buildOverview(rows, f, NOW).tiles.sent, 5, 'the tiles read every filter but the status')
})

test('a survey given twice names its timepoint; a survey given once does not', () => {
  const rows = annotate([cf('x', 'baseline', 2, 2, 2), cf('x', 'post_rotation', 3, 3, 3), row({ slug: 'post_rotation_evaluation' })], units)
  assert.deepEqual(rateBySurvey(rows, '', NOW).map(r => r.label), [
    'Casey-Fink Readiness for Practice, Pre-Rotation', 'Casey-Fink Readiness for Practice, Post-Rotation', "Student's Feedback on ASPIRE",
  ])
})

test('readiness change is the Casey-Fink comparison over matched pairs only', () => {
  const rows = annotate([
    ...['a', 'b', 'c', 'd', 'e'].flatMap(s => [cf(s, 'baseline', 2, 2.5, 3), cf(s, 'post_rotation', 3, 3, 3)]),
    cf('lonely', 'baseline', 1, 1, 1),
  ], units)
  const r = readinessChange(rows)
  assert.equal(r.pairs, 5)
  assert.equal(r.suppressed, false)
  assert.equal(r.sections[0].preMean, 2)
  assert.equal(r.sections[0].postMean, 3)
  assert.equal(r.sections[2].same, 5)
})

test('preceptor ratings read End of Rotation when it exists, and match the packet\'s bands', () => {
  const rating = v => ({ developmental_feedback: { competency: { clinical_judgment: { rating: v } } } })
  const rows = annotate([
    ...[5, 4, 3, 2, 1].map(v => row({ slug: 'preceptor_progress', tp: 'post_rotation', responses: rating(v) })),
    row({ slug: 'preceptor_progress', tp: 'midpoint', responses: rating(2) }),
  ], units)
  const p = preceptorRatings(rows, '', NOW)
  assert.equal(p.timepoint, 'post_rotation')
  const cj = p.competencies.find(c => c.key === 'clinical_judgment')
  assert.deepEqual([cj.up, cj.same, cj.down, cj.total], [2, 1, 1, 4], 'Not Observed (1) is left out')
  const inst = instrumentBySlug('preceptor_progress')
  const packet = buildDistribution(inst, rows.filter(a => a._tp === 'post_rotation'), null, null, NOW)
  assert.deepEqual(packet.subscales.find(s => s.key === 'clinical_judgment').up, cj.up)
  assert.equal(preceptorRatings(rows, 'midpoint', NOW).competencies[0].down, 1)
})

test('a unit with fewer than five responses is withheld', () => {
  const ans = { preceptor_support: { approachable_available: 5, clear_explanations: 4 } }
  const rows = annotate([
    ...Array.from({ length: 5 }, () => row({ slug: 'student_preceptor_eval', unit: 'u1', responses: ans })),
    ...Array.from({ length: 2 }, () => row({ slug: 'student_preceptor_eval', unit: 'u3', responses: ans })),
  ], units)
  const u = unitFeedback(rows, NOW)
  assert.deepEqual(u.units.map(x => [x.name, x.n, x.suppressed]), [['5 North', 2, true], ['6 NE', 5, false]])
  assert.equal(u.units[1].means.preceptor_support, 4.5)
  assert.equal(u.units[0].means, null)
})

test('chips name every filter that is on', () => {
  const opts = { cohorts: [{ id: 'c1', name: 'Fall 2025' }], units: [{ key: '6ne', name: '6 NE' }], surveys: [], timepoints: [] }
  assert.deepEqual(chipsFor({ ...EMPTY_FILTERS, status: 'closed', cohort: 'c1', unit: '6ne', timepoint: 'midpoint' }, opts).map(c => c.label),
    ['Expired or Revoked', 'Fall 2025', '6 NE', 'Midpoint'])
})

test('the model and the view read no names or comments, and the view reuses the Insights parts', () => {
  const code = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
  const model = code(readFileSync(new URL('../src/lib/evaluation/evaluationOverviewModel.js', import.meta.url), 'utf8'))
  assert.doesNotMatch(model, /first_name|last_name|comment/i)
  const view = readFileSync(new URL('../src/components/evaluation/EvaluationOverview.jsx', import.meta.url), 'utf8')
  assert.match(view, /from '\.\.\/insights\/InsightsCard'/)
  assert.match(view, /from '\.\.\/insights\/InsightsCharts'/)
  assert.doesNotMatch(view, /first_name|last_name/)
  const tab = readFileSync(new URL('../src/components/EvaluationTab.jsx', import.meta.url), 'utf8')
  assert.match(tab, /value: 'overview', label: 'Overview'/)
})
