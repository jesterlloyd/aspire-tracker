// ASPIRE-INSIGHTS-1, Phase 1: the metric layer. Every definition, the small-cell rule, the
// rotation-cohort exclusion, the completers-only cohorts, and each portal lock, at the model and
// at the API boundary.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  buildSnapshot, computeInsights, sanitizeFilters, rateOf, meanOf, stageOf, MIN_CELL,
} from '../src/lib/insights/insightsModel.js'
import { pipelineCounts } from '../src/lib/home/cyclePhase.js'
import { caseyFinkChanges, getInsights, clearInsightsCache, insightsSnapshot } from '../lib/server/insights/getInsights.js'
import { makeHandler, resolveViewer } from '../api/insights.js'
import { matchSchoolCohortScope } from '../api/lib/schoolScope.js'

// ── Fixture ──────────────────────────────────────────────────────────────────
// Summer 2026: finished, full record. Fall 2025: finished, completers only (an import).
// Fall 2026: still in rotation.
const COHORTS = [
  { id: 'c-su26', name: 'Summer 2026', finished: true },
  { id: 'c-fa25', name: 'Fall 2025', finished: true },
  { id: 'c-fa26', name: 'Fall 2026', finished: false },
]
const UNITS = [
  { id: 'u-6ne', unit_name: '6 NE', division: 'Medical-Surgical' },
  { id: 'u-4w', unit_name: '4 West', division: 'Critical Care' },
  { id: 'u-5n', unit_name: '5 North', division: 'Medical-Surgical' },
]

function fixture() {
  const students = []
  const matches = []
  const candidates = []
  const outcomes = []
  const submitted = []
  let n = 0
  const add = (o) => {
    n += 1
    const id = `s${n}`
    students.push({
      id, cohort_id: o.cohort, school: o.school, status: o.status,
      cs_affiliation: o.aff || 'No prior affiliation', matched_unit_id: o.unit || null,
      shift_assigned: o.shift || 'Day', hours_required: o.req ?? 0, approved_hours: o.hrs ?? 0,
    })
    if (o.unit) matches.push({ student_id: id, unit_id: o.unit, match_quality: o.choice || 'top_choice', shift_assigned: o.shift || 'Day' })
    if (o.form || o.applied || o.hired || o.offered) {
      const cid = `cand-${id}`
      candidates.push({ id: cid, student_id: id, application_status: o.applied ? 'confirmed' : 'not_confirmed' })
      if (o.form) submitted.push(cid)
      if (o.hired || o.offered) {
        outcomes.push({ candidate_id: cid, student_id: id, offer_extended_at: '2026-09-01T00:00:00Z', hired_at: o.hired ? '2026-10-01T00:00:00Z' : null, hired_unit: o.hiredUnit || null })
      }
    }
    return id
  }
  // Summer 2026, Valley State: 10 completed on 6 NE, 2 not proceeding.
  for (let i = 0; i < 10; i += 1) {
    add({ cohort: 'c-su26', school: 'Valley State', status: 'Completed', unit: 'u-6ne', req: 120, hrs: 120,
      aff: i < 5 ? 'Current Employee' : (i < 7 ? 'Volunteer' : 'No prior affiliation'),
      choice: i < 6 ? 'top_choice' : 'second_choice',
      form: i < 8, applied: i === 6 || i === 7, hired: i < 4, hiredUnit: i < 2 ? '6NE' : '4 West' })
  }
  add({ cohort: 'c-su26', school: 'Valley State', status: 'Not Proceeding' })
  add({ cohort: 'c-su26', school: 'Valley State', status: 'Not Proceeding' })
  // Summer 2026, Coast University: 6 completed on 4 West, 1 hired.
  for (let i = 0; i < 6; i += 1) {
    add({ cohort: 'c-su26', school: 'Coast University', status: 'Completed', unit: 'u-4w', req: 100, hrs: 80, shift: 'Night',
      choice: 'third_choice', form: i < 3, hired: i === 0, hiredUnit: '4 West' })
  }
  // Summer 2026, Mesa College: 6 completed on 5 North, 3 hired.
  for (let i = 0; i < 6; i += 1) {
    add({ cohort: 'c-su26', school: 'Mesa College', status: 'Completed', unit: 'u-5n', req: 100, hrs: 100, hired: i < 3, form: i < 3 })
  }
  // Fall 2025 completers only (no placement record), 5 Valley State, 1 hired.
  for (let i = 0; i < 5; i += 1) add({ cohort: 'c-fa25', school: 'Valley State', status: 'Completed', hired: i === 0 })
  // Fall 2026 in rotation: 6 Valley State on 6 NE. One already marked as applied must never count.
  for (let i = 0; i < 6; i += 1) add({ cohort: 'c-fa26', school: 'Valley State', status: 'Active Rotation', unit: 'u-6ne', applied: i === 0 })

  return {
    loadedAt: '2026-11-05T17:00:00.000Z',
    cohorts: COHORTS, students, matches, units: UNITS, unitAssignments: [],
    candidates, outcomes, submittedCandidateIds: submitted, caseyFinkChange: new Map(),
  }
}

const snap = () => buildSnapshot(fixture())
const staff = { kind: 'staff' }

// ── Definitions ──────────────────────────────────────────────────────────────

test('rates under MIN_CELL are withheld and keep their count', () => {
  assert.equal(MIN_CELL, 5)
  assert.deepEqual(rateOf(2, 4), { count: 2, n: 4, rate: null, suppressed: true })
  assert.deepEqual(rateOf(2, 5), { count: 2, n: 5, rate: 40, suppressed: false })
  assert.equal(meanOf([1, 2, 3, 4]).suppressed, true)
  assert.equal(meanOf([1, 2, 3, 4, 5]).mean, 3)
})

test('the applicant ladder is the Cohort pulse ladder', () => {
  const statuses = ['Pending Outreach', 'Form Sent', 'Form Received', 'Interview Scheduled', 'Interviewed', 'Placed', 'Active Rotation', 'Completed', 'Declined', 'Not Proceeding']
  const students = statuses.map(status => ({ status }))
  const pulse = Object.fromEntries(pipelineCounts(students).map(s => [s.key, s.count]))
  assert.equal(students.filter(s => stageOf(s.status) >= 0).length, pulse.applied)
  assert.equal(students.filter(s => stageOf(s.status) >= 1).length, pulse.interviewed)
  assert.equal(students.filter(s => stageOf(s.status) >= 2).length, pulse.placed)
})

test('residency rates count completed students in finished cohorts only', () => {
  const out = computeInsights(snap(), {}, staff)
  // Finished completed: 10 + 6 + 6 (Summer) + 5 (Fall 2025) = 27. Hired: 4 + 1 + 3 + 1 = 9.
  assert.equal(out.tiles.hired.n, 27)
  assert.equal(out.tiles.hired.count, 9)
  assert.equal(out.tiles.hired.rate, 33.3)
  // The rotation cohort's "applied" student is not counted anywhere in an outcome rate.
  // Applied = marked (2) or hired (9) = 11.
  assert.equal(out.tiles.applied.count, 11)
  // Measure defaults to Hired.
  assert.equal(out.filters.measure, 'hired')
  assert.deepEqual(out.tiles.measure, out.tiles.hired)
})

test('the Transition Form is its own step and is not Applied', () => {
  const out = computeInsights(snap(), {}, staff)
  assert.equal(out.tiles.transition.count, 8 + 3 + 3)
  const keys = out.pipeline.steps.map(s => s.key)
  assert.deepEqual(keys, ['applicants', 'interviewed', 'placed', 'completed', 'transition', 'applied', 'offered', 'hired'])
})

test('the rotation cohort counts toward Applicants and Placed, never toward an outcome', () => {
  const out = computeInsights(snap(), {}, staff)
  // Applicants: Summer 24 (2 Not Proceeding excluded), Fall 2026 6. Fall 2025 has no record.
  assert.equal(out.tiles.applicants.count, 22 + 6)
  assert.equal(out.tiles.placed.count, 22 + 6)
  assert.equal(out.tiles.inRotation.count, 6)
  assert.deepEqual(out.pipeline.excludedCohortIds, ['c-fa26'])
  // Pipeline is finished cohorts only.
  assert.equal(out.pipeline.steps.find(s => s.key === 'placed').count, 22)
})

test('completers-only cohorts join the funnel at Completed', () => {
  const out = computeInsights(snap(), {}, staff)
  const step = k => out.pipeline.steps.find(s => s.key === k)
  assert.equal(step('completed').count, 27)
  // Completed is measured against Placed on the cohorts that have both: 22 of 22.
  assert.equal(step('completed').ofPrior.rate, 100)
  assert.equal(out.cohorts.find(c => c.id === 'c-fa25').partial, true)
  assert.equal(out.trends.find(t => t.cohortId === 'c-fa25').placed, null)
})

test('internal is Current Employee only; volunteers are external', () => {
  const s = snap()
  const out = computeInsights(s, { pathway: 'internal' }, staff)
  assert.equal(out.tiles.completed.count, 5)
  assert.equal(out.pathway.internal.count, 5)
  assert.equal(s.students.filter(x => x.internal).length, 5)
})

test('a unit filter starts the funnel at Placed', () => {
  const out = computeInsights(snap(), { unit: '6NE' }, staff)
  assert.equal(out.tiles.applicants.na, true)
  assert.equal(out.tiles.applicants.count, null)
  assert.equal(out.pipeline.steps[0].count, null)
  assert.equal(out.tiles.placed.count, 16)
})

test('residency status filters the population', () => {
  const s = snap()
  assert.equal(computeInsights(s, { residencyStatus: 'hired' }, staff).tiles.completed.count, 9)
  assert.equal(computeInsights(s, { residencyStatus: 'applied_not_hired' }, staff).tiles.completed.count, 2)
  assert.equal(computeInsights(s, { residencyStatus: 'not_applied' }, staff).tiles.hired.count, 0)
})

test('school rates, unit yield and the 1st-choice association', () => {
  const out = computeInsights(snap(), {}, staff)
  const vs = out.bySchool.schools.find(x => x.school === 'Valley State')
  assert.equal(vs.n, 15)
  assert.equal(vs.count, 5)
  const ne = out.unitYield.units.find(u => u.unit === '6 NE')
  // Hosted in finished cohorts: 10; hired back onto 6 NE: 2 (the '6NE' spelling matches).
  assert.equal(ne.n, 10)
  assert.equal(ne.count, 2)
  // Placement is a fact of every placed cohort, the one in rotation included: 6 + 6 + 6.
  assert.equal(out.choice.buckets.find(b => b.key === 'top_choice').count, 18)
})

test('previous cohort needs exactly one cohort', () => {
  assert.equal(sanitizeFilters({ compare: 'previous' }).compare, 'off')
  assert.equal(sanitizeFilters({ compare: 'previous', cohortIds: ['a', 'b'] }).compare, 'off')
  const out = computeInsights(snap(), { compare: 'previous', cohortIds: ['c-fa26'] }, staff)
  assert.equal(out.compare.label, 'Summer 2026')
})

test('clinical hours by school', () => {
  const out = computeInsights(snap(), {}, staff)
  const cu = out.hoursBySchool.find(h => h.school === 'Coast University')
  assert.equal(cu.meanHours, 80)
  assert.equal(cu.pctOfRequirement, 80)
})

// ── Locks ────────────────────────────────────────────────────────────────────

const noIds = (out) => {
  const json = JSON.stringify(out)
  assert.ok(!/"s\d+"/.test(json), 'no student id leaves the service')
  assert.ok(!json.includes('rawSchool'), 'the stored school text never leaves the service')
}

function partnerViewer(scopes) {
  return { kind: 'partner', inSchoolScope: (school, cohortId) => matchSchoolCohortScope(scopes, school, cohortId) }
}

async function viaServer(viewer, filters = {}, raw = fixture()) {
  clearInsightsCache()
  return getInsights(filters, viewer, { dbFor: () => null, load: async () => raw })
}

test('a partner sees only their school, and asking for another changes nothing', async () => {
  const v = partnerViewer([{ school_key: 'Valley State', cohort_id: null }])
  const own = await viaServer(v)
  const probe = await viaServer(v, { schools: 'Coast University', school: 'Mesa College' })
  assert.deepEqual(probe.tiles, own.tiles)
  assert.equal(own.tiles.hired.count, 5)
  const json = JSON.stringify(own)
  assert.ok(!json.includes('Coast University') && !json.includes('Mesa College'))
  noIds(own)
})

test('the same filter gives the same figure on the full page and in the partner section', async () => {
  const v = partnerViewer([{ school_key: 'Valley State', cohort_id: null }])
  const partner = await viaServer(v)
  const page = await viaServer(staff, { schools: 'Valley State' })
  assert.deepEqual(partner.tiles.hired, page.tiles.hired)
  assert.deepEqual(partner.youVsProgram.you, page.tiles.hired)
})

test('the program average is hidden from a partner when fewer than 3 schools are in it', async () => {
  const v = partnerViewer([{ school_key: 'Valley State', cohort_id: null }])
  const three = await viaServer(v)
  assert.equal(three.youVsProgram.programHidden, false)
  assert.ok(three.youVsProgram.program)
  const raw = fixture()
  raw.students = raw.students.filter(s => s.school !== 'Mesa College')
  const two = await viaServer(v, {}, raw)
  assert.equal(two.youVsProgram.programHidden, true)
  assert.equal(two.youVsProgram.program, null)
})

test('a cohort-limited partner grant covers only that cohort', async () => {
  const v = partnerViewer([{ school_key: 'Valley State', cohort_id: 'c-fa26' }])
  const out = await viaServer(v)
  assert.equal(out.tiles.placed.count, 6)
  assert.equal(out.tiles.completed.count, 0)
})

test('a partner with no scope sees nobody, never everybody', async () => {
  const out = await viaServer(partnerViewer([]))
  assert.equal(out.tiles.placed.count, 0)
})

test('a unit leader sees their unit by name and other units only as an average', async () => {
  const out = await viaServer({ kind: 'unit', unitKeys: ['6 NE'] })
  assert.deepEqual(out.units, ['6 NE'])
  assert.equal(out.hosted.you, 16)
  assert.equal(out.hosted.averageUnit, 6)
  assert.equal(out.hiredBack.you.count, 2)
  const json = JSON.stringify(out)
  assert.ok(!json.includes('4 West') && !json.includes('5 North'))
  assert.ok(json.includes('Valley State'), 'schools feeding the unit may be named')
  noIds(out)
})

test('the Residency Portal sees program-level figures with no school or unit', async () => {
  const out = await viaServer({ kind: 'residency' }, { schools: 'Valley State', unit: '6NE' })
  assert.equal(out.tiles.hired.count, 9)
  const json = JSON.stringify(out)
  for (const name of ['Valley State', 'Coast University', 'Mesa College', '6 NE', '4 West']) assert.ok(!json.includes(name), name)
  noIds(out)
})

test('a portal viewer has the cohort filter only, and its measure is Hired', () => {
  const f = sanitizeFilters({ pathway: 'internal', unit: '6NE', measure: 'applied', compare: 'program', cohortIds: ['x'] }, { kind: 'partner' })
  assert.deepEqual(f.cohortIds, ['x'])
  assert.equal(f.pathway, 'all')
  assert.equal(f.unit, null)
  assert.equal(f.measure, 'hired')
  assert.equal(f.compare, 'off')
})

test('unknown viewer kinds throw', () => {
  assert.throws(() => computeInsights(snap(), {}, { kind: 'student' }), /unknown_viewer/)
})

test('the snapshot is reused for ten minutes and As of is its read time', async () => {
  clearInsightsCache()
  let loads = 0
  const load = async () => { loads += 1; return fixture() }
  await insightsSnapshot(() => null, false, { now: 0, load })
  await insightsSnapshot(() => null, false, { now: 9 * 60 * 1000, load })
  assert.equal(loads, 1)
  await insightsSnapshot(() => null, false, { now: 11 * 60 * 1000, load })
  assert.equal(loads, 2)
  await insightsSnapshot(() => null, true, { now: 11 * 60 * 1000, load })
  assert.equal(loads, 3, 'demo and real never share a snapshot')
  const out = await getInsights({}, staff, { dbFor: () => null, now: 11 * 60 * 1000, load })
  assert.equal(out.asOf, '2026-11-05T17:00:00.000Z')
})

test('Casey-Fink change is post minus pre on the packet pairing rule', () => {
  const a = (student_id, timepoint, v) => ({
    student_id, timepoint, status: 'completed', evaluation_instruments: { slug: 'casey_fink_readiness_2024' },
    evaluation_responses: { score_s1_clinical_problem_solving: v, score_s1_learning_activities: v, score_s1_practice_readiness: v, submitted_at: '2026-01-01' },
  })
  const m = caseyFinkChanges([a('x', 'baseline', 2), a('x', 'post_rotation', 3.5), a('y', 'baseline', 2)])
  assert.equal(m.get('x'), 1.5)
  assert.equal(m.has('y'), false)
})

// ── API boundary ─────────────────────────────────────────────────────────────

function fakeRes() {
  return {
    statusCode: 0, body: null, headers: {},
    status(c) { this.statusCode = c; return this },
    json(b) { this.body = b; return this },
    setHeader(k, v) { this.headers[k] = v },
    end() { return this },
  }
}

const deps = (extra = {}) => ({
  dbFor: () => null,
  load: async () => fixture(),
  verifyStaff: async () => ({ authenticated: true, profile: { role: 'co-lead' } }),
  verifyPartner: async () => ({ ok: true, scopes: [{ school_key: 'Valley State', cohort_id: null }] }),
  verifyUnit: async () => ({ ok: true, scopes: [{ unit_key: '6 NE', cohort_id: null }, { unit_key: '5 North', cohort_id: null }] }),
  verifyLeadership: async () => ({ ok: true }),
  verifyResidency: async () => ({ ok: true }),
  ...extra,
})

async function call(query, d = deps()) {
  clearInsightsCache()
  const res = fakeRes()
  await makeHandler(d)({ method: 'GET', query, headers: {} }, res)
  return res
}

test('API: a partner asking for another school gets their own', async () => {
  const res = await call({ surface: 'partner', school: 'Coast University' })
  assert.equal(res.statusCode, 200)
  assert.equal(res.body.viewer, 'partner')
  assert.equal(res.body.tiles.hired.count, 5)
  assert.ok(!JSON.stringify(res.body).includes('Coast University'))
})

test('API: a unit leader asking for a unit they do not hold gets nothing', async () => {
  const res = await call({ surface: 'unit', unit: '4 West' })
  assert.equal(res.statusCode, 200)
  assert.deepEqual(res.body.units, [])
  assert.equal(res.body.tiles.placed.count, 0)
  const own = await call({ surface: 'unit', unit: '6 NE' })
  assert.deepEqual(own.body.units, ['6 NE'])
})

test('API: staff without insights_view are refused', async () => {
  for (const role of ['interviewer', 'viewer', 'portal']) {
    const res = await call({ surface: 'staff' }, deps({ verifyStaff: async () => ({ authenticated: true, profile: { role } }) }))
    assert.equal(res.statusCode, 403, role)
  }
  const owner = await call({ surface: 'staff' }, deps({ verifyStaff: async () => ({ authenticated: true, profile: { role: 'interviewer', is_owner: true } }) }))
  assert.equal(owner.statusCode, 200)
})

test('API: a refused grant is refused, and an unknown surface is a 400', async () => {
  const no = async () => ({ ok: false, status: 403, reason: 'forbidden' })
  for (const [surface, key] of [['partner', 'verifyPartner'], ['unit', 'verifyUnit'], ['leadership', 'verifyLeadership'], ['residency', 'verifyResidency']]) {
    const res = await call({ surface }, deps({ [key]: no }))
    assert.equal(res.statusCode, 403, surface)
  }
  assert.equal((await call({ surface: 'student' })).statusCode, 400)
  const anon = await call({ surface: 'staff' }, deps({ verifyStaff: async () => ({ authenticated: false, status: 401 }) }))
  assert.equal(anon.statusCode, 401)
})

test('API: leadership gets the full page; residency gets program level', async () => {
  const lead = await call({ surface: 'leadership', measure: 'applied' })
  assert.equal(lead.body.viewer, 'leadership')
  assert.equal(lead.body.filters.measure, 'applied')
  assert.ok(Array.isArray(lead.body.bySchool.schools))
  const res = await call({ surface: 'residency' })
  assert.equal(res.body.bySchool, undefined)
  assert.equal(res.body.hostedByUnit, undefined)
})

test('resolveViewer never takes a lock from the query', async () => {
  const who = await resolveViewer({ query: { unit: '6 NE', unitKeys: '4 West' } }, 'unit', deps())
  assert.deepEqual(who.viewer.unitKeys, ['6 NE'])
})
