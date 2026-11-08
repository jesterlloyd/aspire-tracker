// EVAL-OVERVIEW-LEADERSHIP-1 (Owner, 2026-11-07): the NE&L Portal's Evaluation page opens on the staff
// Evaluation Overview, read-only. The server sends aggregates only, groups under five withheld, and
// none of the follow-up figures; the grant gate is the comment themes' own.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { leadershipOverview, leadershipOptions } from '../src/lib/evaluation/leadershipOverviewModel.js'
import { annotate, buildOverview, filterOptions, EMPTY_FILTERS } from '../src/lib/evaluation/evaluationOverviewModel.js'
import { CASEY_FINK_SLUG } from '../src/lib/evaluation/responsesPacketModel.js'
import { cleanLeadershipFilters, leadershipOverviewFor } from '../lib/server/evaluation/leadershipOverview.js'
import { createAcademicsThemesHandler } from '../api/portal/academics-evaluation-themes.js'

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const NOW = Date.parse('2026-11-07T12:00:00Z')
const C1 = '11111111-1111-4111-8111-111111111111'

let seq = 0
const units = [{ id: 'u1', unit_name: '6 NE' }, { id: 'u2', unit_name: '5 North' }]
function row({ slug, tp = 'post_rotation', status = 'completed', school = 'UCLA', unit = 'u1', student, responses = null, scores = null, expires = null }) {
  seq += 1
  return {
    id: `a${seq}`, cohort_id: C1, timepoint: tp, status, expires_at: expires,
    students: { id: student || `s${seq}`, school, matched_unit_id: unit },
    evaluation_instruments: { slug },
    evaluation_responses: status === 'completed' ? [{ submitted_at: '2026-10-01', responses: responses || {}, ...(scores || {}) }] : [],
  }
}
const cf = (student, tp, v) => row({ slug: CASEY_FINK_SLUG, tp, student, scores: { score_s1_clinical_problem_solving: v, score_s1_learning_activities: v, score_s1_practice_readiness: v } })
function world() {
  const ans = { preceptor_support: { approachable_available: 5, clear_explanations: 4 }, comments: 'Rosa was great' }
  return {
    assignments: [
      ...['a', 'b', 'c', 'd', 'e'].flatMap(s => [cf(s, 'baseline', 2.5), cf(s, 'post_rotation', 3.25)]),
      ...Array.from({ length: 5 }, () => row({ slug: 'student_preceptor_eval', unit: 'u1', responses: ans })),
      ...Array.from({ length: 2 }, () => row({ slug: 'student_preceptor_eval', unit: 'u2', responses: ans, school: 'CSULB' })),
      row({ slug: 'post_rotation_evaluation', status: 'sent' }),
      row({ slug: 'post_rotation_evaluation', status: 'expired' }),
    ],
    units,
    cohorts: [{ id: C1, name: 'Fall 2025' }],
  }
}

test('the cut keeps the charts and drops the follow-up figures, withheld counts and withheld unit names', () => {
  const w = world()
  const o = buildOverview(annotate(w.assignments, w.units), EMPTY_FILTERS, NOW)
  const l = leadershipOverview(o)
  assert.deepEqual(Object.keys(l.tiles).sort(), ['completed', 'pairs', 'responseRate', 'sent'])
  assert.equal(l.tiles.pairs, 5)
  assert.equal(l.measure.measureWord, 'completed')
  const json = JSON.stringify(l)
  assert.doesNotMatch(json, /awaiting|reissuable|closed|"s\d+"|"a\d+"|Rosa|comments|student_id|"students"/i)
  assert.doesNotMatch(json, /5 North/, 'a unit under five is a count, never a name')
  assert.deepEqual(l.units.units.map(u => u.name), ['6 NE'])
  assert.equal(l.units.withheld, 1)
  const csulb = l.bySchool.find(s => s.label === 'CSULB')
  assert.deepEqual([csulb.suppressed, csulb.count, csulb.rate, csulb.n], [true, null, null, 2])
  assert.equal(l.readiness.sections.length, 3)
  assert.deepEqual(l.preceptor.competencies, [], 'no preceptor answers: withheld, no bands')
  const opts = leadershipOptions(filterOptions(annotate(w.assignments, w.units), w.cohorts))
  assert.deepEqual(opts.cohorts, [{ id: C1, name: 'Fall 2025' }])
  assert.deepEqual(opts.units.map(u => u.name), ['5 North', '6 NE'])
})

test('the filters: the Overview\'s own, legal values only, and never the status measure', () => {
  assert.deepEqual(cleanLeadershipFilters({ school: 'UCLA', status: 'closed' }), { ...EMPTY_FILTERS, school: 'UCLA' })
  assert.equal(cleanLeadershipFilters({ cohort: 'nope' }), null)
  assert.equal(cleanLeadershipFilters({ survey: 'anything' }), null)
  assert.equal(cleanLeadershipFilters({ timepoint: 'whenever' }), null)
  assert.equal(cleanLeadershipFilters({ school: ['a'] }), null)
  assert.equal(cleanLeadershipFilters({ cohort: C1, survey: CASEY_FINK_SLUG, timepoint: 'post_rotation' }).cohort, C1)
})

test('the server builds the figures for the filters asked, with Completed as the measure', async () => {
  const out = await leadershipOverviewFor(null, { ...EMPTY_FILTERS, status: 'closed', school: 'UCLA' }, { load: async () => world(), now: NOW })
  assert.equal(out.overview.measure.measureWord, 'completed')
  assert.ok(out.overview.bySchool.every(s => s.label === 'UCLA'))
  assert.ok(out.options.schools.includes('CSULB'), 'the choices come from every row, not the filtered ones')
})

const res = () => {
  const r = { code: 0, body: null, headers: {} }
  r.status = (c) => { r.code = c; return r }
  r.json = (b) => { r.body = b; return r }
  r.end = () => r
  r.setHeader = (k, v) => { r.headers[k] = v }
  return r
}
const fakeDb = () => ({ from: () => ({}) })

test('API: the comment themes\' gate, then the cut; a bad filter is refused', async () => {
  const h = (has) => createAcademicsThemesHandler({ verifyCaller: async () => ({ ok: true, grant: { id: 'g1' } }), makeDb: fakeDb, hasThemes: async () => has, loadOverview: async () => world() })
  let r = res(); await h(false)({ method: 'GET', query: { view: 'overview' }, headers: {} }, r)
  assert.equal(r.code, 403)
  r = res(); await h(true)({ method: 'GET', query: { view: 'overview', school: 'UCLA' }, headers: {} }, r)
  assert.equal(r.code, 200)
  assert.ok(r.body.overview && r.body.options)
  assert.doesNotMatch(JSON.stringify(r.body), /awaiting|reissuable|Rosa/)
  r = res(); await h(true)({ method: 'GET', query: { view: 'overview', cohort: 'x' }, headers: {} }, r)
  assert.equal(r.code, 400)
  assert.match(read('api/portal/academics-evaluation-themes.js'), /leadershipOverviewFor\(real,/, 'real rows only')
})

test('the page: the portal mounts the leadership Overview; staff-only parts stay staff-only', () => {
  const page = read('src/portal/na/AcademicsEvaluationView.jsx')
  assert.match(page, /<EvaluationOverview surface="leadership" loadLeadership=\{fetchAcademicsEvaluationOverview\}/)
  assert.ok(page.indexOf('<EvaluationOverview') < page.indexOf('<CommentThemesSection'), 'the Overview comes first')
  const view = read('src/components/evaluation/EvaluationOverview.jsx')
  assert.match(view, /\{!lead && <KeithRead /)
  assert.match(view, /if \(lead\) return undefined\s+let live = true\s+loadOverview\(\)/, 'leadership never reads the tables from the browser')
  assert.match(view, /acts=\{lead \? null : measureActs\}/)
  assert.match(view, /onPick=\{lead \? undefined :/)
  assert.match(view, /\{canManage && <ReadyToRelease/)
  assert.match(view, /\{canManage && <ThemesCard/)
})
