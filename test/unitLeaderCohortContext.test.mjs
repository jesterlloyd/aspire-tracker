// Portal cohort polish, Commit 2: the Unit Leader cohort picker. It is context-aware, not a cosmetic
// global filter: it renders in the Nightfall header on Home and Students only (the genuinely
// cohort-scoped, roster-backed views), only when the authorized roster spans more than one cohort, and
// it narrows client-side WITHIN the server-authorized set (never widens it, never mutates cohorts).
// Pure-helper tests + source guards.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  rosterCohorts, unitCohortOptions, studentInCohort, UL_ALL, UL_ALL_CURRENT,
} from '../src/portal/unit/unitCohortScope.js'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')
const stripJs = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const portal = read('src/portal/UnitLeaderPortal.jsx')
const portalCode = stripJs(portal)

// Cohort metadata rides on each student row (unit-roster.js returns s.cohort = {id,name,status,...}).
const summer = { id: 'summer', name: 'Summer 2026', status: 'Active', start_date: '2026-06-01' }
const spring = { id: 'spring', name: 'Spring 2026', status: 'Active', start_date: '2026-01-01' }
const fall = { id: 'fall', name: 'Fall 2026', status: 'Planning', start_date: '2026-09-01' }
const fall25 = { id: 'fall25', name: 'Fall 2025', status: 'Completed', start_date: '2025-09-01' }
const students = [
  { id: 's1', cohort: summer }, { id: 's2', cohort: spring }, { id: 's3', cohort: fall },
  { id: 's4', cohort: fall25 }, { id: 's5', cohort: summer },
]

test('rosterCohorts derives the DISTINCT cohorts present, in canonical timeline order', () => {
  const ids = rosterCohorts(students).map(c => c.id)
  assert.deepEqual(ids, ['spring', 'summer', 'fall', 'fall25'])   // current(ASC) -> upcoming -> historical(DESC)
})

test('options: All Current only with >1 current; cohorts timeline-ordered; All Cohorts last', () => {
  const { options, cohortCount } = unitCohortOptions(students)
  assert.equal(options[0].id, UL_ALL_CURRENT)                     // two Active cohorts -> aggregate leads
  assert.deepEqual(options.slice(1).map(o => o.id), ['spring', 'summer', 'fall', 'fall25', UL_ALL])
  assert.equal(cohortCount, 4)
})

test('default is the newest Active cohort by start date', () => {
  const { defaultId } = unitCohortOptions(students)
  assert.equal(defaultId, 'summer')                              // Summer 2026 (06) > Spring 2026 (01)
})

test('a single-cohort roster yields cohortCount 1 (control hidden) and selects that cohort', () => {
  const one = [{ id: 'a', cohort: summer }, { id: 'b', cohort: summer }]
  const { defaultId, cohortCount, options } = unitCohortOptions(one)
  assert.equal(cohortCount, 1)
  assert.equal(defaultId, 'summer')
  assert.deepEqual(options.map(o => o.id), ['summer', UL_ALL])   // no All-Current aggregate
})

test('a roster with no Active cohort defaults to All Cohorts (historical never hidden)', () => {
  const historical = [{ id: 'h', cohort: fall25 }]
  const { defaultId } = unitCohortOptions(historical)
  assert.equal(defaultId, UL_ALL)
})

test('studentInCohort narrows within the authorized set: All, All Current, and a single cohort', () => {
  const { currentIds } = unitCohortOptions(students)
  const inScope = (opt) => students.filter(s => studentInCohort(s, opt, currentIds)).map(s => s.id)
  assert.deepEqual(inScope(UL_ALL).sort(), ['s1', 's2', 's3', 's4', 's5'])
  assert.deepEqual(inScope(UL_ALL_CURRENT).sort(), ['s1', 's2', 's5'])   // Active cohorts only
  assert.deepEqual(inScope('summer').sort(), ['s1', 's5'])
})

// ── Source guards: header placement + workspace-specific visibility ───────────

test('the cohort picker lives in the Nightfall header, gated to Home/Students with >1 cohort', () => {
  assert.match(portal, /import \{ unitCohortOptions, studentInCohort, UL_ALL \} from '\.\/unit\/unitCohortScope'/)
  assert.match(portalCode, /const UNIT_COHORT_SCOPED_VIEWS = \['home', 'students'\]/)
  assert.match(portalCode, /const showCohortPicker = cohortView && cohortCount > 1/)
  assert.match(portal, /<span className="ptl-header-ctl-label">Cohort<\/span>/)
  assert.match(portal, /<select aria-label="Cohort" value=\{cohortId\} onChange=\{e => setCohortSel\(e\.target\.value\)\}>/)
  // It shares the one header-controls slot with the multi-unit selector (no second launcher).
  assert.equal((portal.match(/<PortalHeaderControls>/g) || []).length, 1)
})

test('Placement Requests and Capacity are NOT cohort-scoped (they use the single accepting cohort)', () => {
  assert.ok(!/UNIT_COHORT_SCOPED_VIEWS = \[[^\]]*'placements'/.test(portalCode))
  assert.ok(!/UNIT_COHORT_SCOPED_VIEWS = \[[^\]]*'capacity'/.test(portalCode))
  // Home and Students receive the cohort-scoped roster; the other screens get the full unit set.
  assert.match(portal, /<HomeScreen \{\.\.\.shared\} students=\{cohortScopedStudents\} cohortNarrowed=\{cohortNarrowed\}/)
  assert.match(portal, /<StudentsScreen \{\.\.\.shared\} students=\{cohortScopedStudents\}/)
  assert.match(portal, /<PlacementScreen \{\.\.\.shared\} \/>/)
  assert.match(portal, /<CapacityScreen \{\.\.\.shared\} \/>/)
})

test('Messages gets no cohort picker, and the browser holds no cohort authority (server-derived scope)', () => {
  // cohortView is false for messages/evaluations/preceptors, so no picker and no roster narrowing.
  assert.ok(!/UNIT_COHORT_SCOPED_VIEWS = \[[^\]]*'messages'/.test(portalCode))
  assert.ok(!/UNIT_COHORT_SCOPED_VIEWS = \[[^\]]*'evaluations'/.test(portalCode))
  // No cohort mutation and no client-side authority store.
  assert.doesNotMatch(portalCode, /supabase\.from|service_role|localStorage/)
  const scope = read('src/portal/unit/unitCohortScope.js')
  assert.doesNotMatch(scope, /supabase|fetch\(|\.insert\(|\.update\(|\.upsert\(/)
})

test('the multi-unit authorization selector is unchanged and still gated to unit-scoped views', () => {
  assert.match(portalCode, /const UNIT_SCOPED_VIEWS = \['home', 'students', 'preceptors'\]/)
  assert.match(portalCode, /const showUnitPicker = unitKeys\.length > 1 && UNIT_SCOPED_VIEWS\.includes\(view\)/)
  assert.match(portal, /<span className="ptl-header-ctl-label">Viewing<\/span>/)
})
