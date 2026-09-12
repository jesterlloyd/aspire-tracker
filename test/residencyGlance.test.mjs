// RESIDENCY-GLANCE-1: At a Glance reads like the Internship one. Owner
// decisions, 2026-09-11: a unified KPI card; Hiring Units (1st choice + top 3,
// Filled = assigned on the placement board); Applicants grouped by school with
// the ASPIRE cohort as a pill, submitted forms only; informational, no drawer;
// Seats and Scope and Rules removed; Cohort Timeline and Pipeline kept.
// Run: node --test test/residencyGlance.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { residencySnapshot, hiringUnitGroups, applicantsBySchool, submittedRows } from '../src/lib/ngrp/ngrpGlanceView.js'
import { loadApplicantsPayload } from '../lib/server/ngrpApplicants.js'

const here = dirname(fileURLToPath(import.meta.url))
const read = p => readFileSync(join(here, '..', p), 'utf8')

const UNITS = [
  { unit_name: '5 North', is_active: true, capacity: 3 },
  { unit_name: '6 South', is_active: true, capacity: 2 },
  { unit_name: 'CSICU', is_active: true, capacity: null },
  { unit_name: '4 West', is_active: false, capacity: 5 },
]
const row = (id, school, o = {}) => ({
  id, student: { id, first_name: id, last_name: 'Alum', school, aspire_cohort: 'Fall 2026' },
  // RESIDENCY-ROSTER-1: interest is part of the pool rule now, so the fixture
  // has to state it. These rows were written when application_status decided
  // who was on the board.
  form_status: 'submitted', interest: 'interested',
  application_status: 'not_confirmed', eligibility_calculated: 'eligible',
  assigned_unit: null, unit_preference_1: null, unit_preference_2: null, unit_preference_3: null, ...o,
})
const ROWS = [
  row('ana', 'CSUN', { unit_preference_1: '5 North', unit_preference_2: '6 South', application_status: 'confirmed', assigned_unit: '5 North' }),
  row('ben', 'CSUN', { unit_preference_1: '5 north', unit_preference_3: 'CSICU', application_status: 'confirmed' }),
  row('cal', 'APU', { unit_preference_1: '6 South', application_status: 'confirmed', assigned_unit: '6 South', outcome: { hired_at: '2026-10-01', hired_unit: '6 South' } }),
  row('dee', 'APU', { form_status: 'opened' }),
  row('eve', 'UCLA', { form_status: 'not_sent' }),
]
const STAGES = [
  { key: 'alumni', count: 5 }, { key: 'submitted', count: 3 }, { key: 'pool', count: 3 },
]

test('the snapshot: positions, applicants, in the pool, paired, open', () => {
  const s = residencySnapshot({ units: UNITS, rows: ROWS, stages: STAGES })
  assert.equal(s.activeUnits, 3, 'inactive units are not hiring')
  assert.equal(s.positions, 5, 'units with a number only')
  assert.equal(s.exact, false, 'CSICU has no number')
  assert.equal(s.open, null, 'Open is not claimed while a unit has no number')
  assert.equal(s.applicants, 3, 'the Pipeline\'s own submitted count')
  assert.equal(s.inPool, 3)
  assert.equal(s.paired, 2, 'matched to the unit that will interview them, which is not a hire')
  assert.equal(s.hired, 1)
  assert.equal(s.schools, 2, 'schools among submitters')
  const exact = residencySnapshot({ units: UNITS.slice(0, 2), rows: ROWS, stages: STAGES })
  assert.equal(exact.open, 3)
})

test('hiring units: 1st choice and top 3 from submitters, assigned, hired, open, by division', () => {
  const groups = hiringUnitGroups(UNITS, ROWS)
  const units = Object.fromEntries(groups.flatMap(g => g.units).map(u => [u.unit_name, u]))
  assert.deepEqual(Object.keys(units).sort(), ['5 North', '6 South', 'CSICU'])
  assert.deepEqual({ ...units['5 North'], division: undefined },
    { unit_name: '5 North', division: undefined, positions: 3, first: 2, top3: 2, assigned: 1, hired: 0, open: 2 })
  assert.equal(units['6 South'].first, 1)
  assert.equal(units['6 South'].top3, 2)
  assert.equal(units['6 South'].hired, 1)
  assert.equal(units.CSICU.positions, null)
  assert.equal(units.CSICU.open, null)
  assert.equal(units.CSICU.top3, 1)
})

test('applicants: submitters only, grouped by school A to Z, names in order', () => {
  assert.equal(submittedRows(ROWS).length, 3)
  const schools = applicantsBySchool(ROWS)
  assert.deepEqual(schools.map(g => g.school), ['APU', 'CSUN'])
  assert.deepEqual(schools[1].rows.map(r => r.id), ['ana', 'ben'])
  assert.equal(schools[1].inPool, 2)
  assert.equal(schools[1].paired, 1)
  assert.ok(!JSON.stringify(schools).includes('eve') && !JSON.stringify(schools).includes('dee'))
})

test('the page: snapshot, both tables, timeline and pipeline; Seats and Scope and Rules gone; no drawer', () => {
  const glance = read('src/components/ngrp/AtAGlanceTab.jsx')
  for (const t of ['Residency Snapshot', 'Hiring Units', 'Applicants']) assert.match(glance, new RegExp(`>${t}<`), t)
  for (const t of ['Cohort Timeline', 'Pipeline']) assert.match(glance, new RegExp(`title="${t}"`), t)
  assert.doesNotMatch(glance, /title="Seats"|title="Scope and Rules"|seatPressure|ruleSummaryLines|capacitySummary/)
  for (const h of ['1st Choice', 'Top 3', 'Assigned', 'Hired', 'Open']) assert.match(glance, new RegExp(`>${h}</th>`), h)
  assert.match(glance, /<KPICell value=\{snap\.paired\} label="Paired" sub="A unit will interview them"/)
  assert.match(glance, /className="ngrp-glance-cohort">\{r\.student\.aspire_cohort\}/, 'cohort pill')
  assert.doesNotMatch(glance, /ApplicantDrawer|onSelect|setDrawer/, 'informational: no row opens anything')
  assert.match(glance, /\{staffApp && \(\s*<div className=\{`ngrp-banner/, 'the send-readiness banner is staff-only')
})

test('the roster reads the assigned unit and interview back (they were written but never read)', async () => {
  const src = read('lib/server/ngrpApplicants.js')
  assert.match(src, /const PLACEMENT_FIELDS = 'assigned_unit, assigned_unit_at, interview_status, interview_at'/)
  assert.doesNotMatch(src.slice(src.indexOf('const PLACEMENT_FIELDS')), /^const PLACEMENT_FIELDS = '[^']*(by_profile_id|recorded_by)/m, 'no actor ids')
  // Behaviour: the full read is used; a missing column falls back to the base fields.
  const selects = []
  const fake = failFirst => {
    let calls = 0
    const table = name => ({
      select: (cols) => {
        selects.push({ name, cols })
        const chain = {
          eq: () => chain, in: () => chain, is: () => chain, not: () => chain, order: () => chain, limit: () => chain,
          maybeSingle: () => Promise.resolve({ data: name === 'ngrp_cycles' ? { id: 'cy1', name: 'W27' } : null, error: null }),
          then: (res, rej) => {
            if (name === 'ngrp_candidates') {
              calls += 1
              if (failFirst && calls === 1) return Promise.resolve({ data: null, error: { code: '42703', message: 'column ngrp_candidates.assigned_unit does not exist' } }).then(res, rej)
              return Promise.resolve({ data: [], error: null }).then(res, rej)
            }
            if (name === 'ngrp_cycle_source_cohorts') return Promise.resolve({ data: [{ cohort_id: 'c1', cohorts: { id: 'c1', name: 'Fall 2026', start_date: '2026-09-01' } }], error: null }).then(res, rej)
            return Promise.resolve({ data: [], error: null }).then(res, rej)
          },
        }
        return chain
      },
    })
    return { from: table }
  }
  const ok = await loadApplicantsPayload(fake(false), 'cy1')
  assert.equal(ok.state, 'ok')
  assert.ok(selects.some(s => s.name === 'ngrp_candidates' && /assigned_unit, assigned_unit_at, interview_status, interview_at/.test(s.cols)))
  selects.length = 0
  const fallback = await loadApplicantsPayload(fake(true), 'cy1')
  assert.equal(fallback.state, 'ok', 'a missing column degrades to the base fields, not an error')
  // RESIDENCY-ROSTER-1 added a third group, so the fallback drops ONE group at a
  // time, newest first: a cohort missing 20260916000000's columns still gets its
  // assigned unit and interview back rather than falling all the way to the base.
  const cand = selects.filter(s => s.name === 'ngrp_candidates')
  assert.equal(cand.length, 2)
  assert.match(cand[0].cols, /not_proceeding_reason/)
  assert.doesNotMatch(cand[1].cols, /not_proceeding_reason/)
  assert.match(cand[1].cols, /assigned_unit/)
})
