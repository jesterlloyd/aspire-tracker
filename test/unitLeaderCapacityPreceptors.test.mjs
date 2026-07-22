// UL-WORKFLOW: canonical Capacity, actual assigned shift, and the Preceptor(s) column.
//
// Three corrections, all no-SQL:
//   1. More -> Capacity submits the canonical /unit-form workflow (units +
//      unit_cohort_responses), which the staff At a Glance -> Placement Capacity reads.
//   2. The Shift column shows the deployed shift (primary preceptor's shift_type), never
//      the student's shift_availability preference.
//   3. Primary Preceptor becomes Preceptor(s): every active assignment with a role pill.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { normalizeAssignedShift } from '../api/lib/normalizeAssignedShift.js'
import {
  SHIFT_PREFERENCE_OPTIONS, validateParticipation, buildParticipationBody, emptyParticipation,
} from '../src/lib/unitParticipationForm.js'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')
const stripJs = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const roster    = read('api/portal/unit-roster.js')
const detail    = read('api/portal/unit-student-detail.js')
const rosterCode = stripJs(roster)
const detailCode = stripJs(detail)
const portal    = read('src/portal/UnitLeaderPortal.jsx')
const portalCode = stripJs(portal)
const precList  = read('src/portal/unit/PreceptorList.jsx')
const unitForm  = read('src/components/UnitFormPage.jsx')
const shared    = read('src/lib/unitParticipationForm.js')
const api       = read('src/portal/unit/unitLeaderApi.js')
const submitEp  = read('api/portal/unit-participation-submit.js')
const overview  = read('src/components/OverviewTab.jsx')

// ── 1. Capacity uses the SAME canonical form definition as /unit-form ────────
test('both /unit-form and the portal Capacity screen import the shared definition', () => {
  assert.match(unitForm, /from '\.\.\/lib\/unitParticipationForm'/)
  assert.match(portal, /from '\.\.\/lib\/unitParticipationForm'/)
  // Both consume the same options and validation, so they cannot drift.
  for (const src of [unitForm, portalCode]) {
    assert.ok(src.includes('SUBMITTER_ROLES'), 'uses shared roles')
    assert.ok(src.includes('SHIFT_PREFERENCE_OPTIONS'), 'uses shared shift options')
    assert.ok(src.includes('validateParticipation'), 'uses shared validation')
    assert.ok(src.includes('PARTICIPATION_TEXT'), 'uses shared labels')
  }
})

test('the canonical shift PREFERENCE set is the /unit-form set, not the old portal set', () => {
  assert.deepEqual(SHIFT_PREFERENCE_OPTIONS,
    ['Day Shift', 'Night Shift', 'Mid Shift', 'Either / No Preference'])
  // The divergent old capacity shift vocabulary is gone from the screen.
  const cap = portalCode.slice(portalCode.indexOf('function CapacityScreen'), portalCode.indexOf('function PreceptorScreen'))
  assert.ok(!cap.includes("'evening'") && !cap.includes("'weekend'"), 'the old any/evening/weekend set is gone')
})

test('portal validation and body omit identity (server derives it from the profile)', () => {
  const form = { ...emptyParticipation(), unit_name: '7 West', submitter_role: 'Charge Nurse', slots_offered: '2', hiring_ngrp: true }
  assert.equal(validateParticipation(form, { requireIdentity: false }), null, 'valid without name/email')
  const body = buildParticipationBody(form, { includeIdentity: false })
  assert.ok(!('submitter_name' in body) && !('submitter_email' in body), 'no identity keys in the portal body')
  // The public form still requires and includes identity.
  assert.match(validateParticipation({ ...form, submitter_name: '', submitter_email: '' }, { requireIdentity: true }) || '', /name/)
  assert.ok('submitter_name' in buildParticipationBody(form, { includeIdentity: true }))
})

// ── 2. Capacity writes the model At a Glance -> Placement Capacity reads ──────
test('the Capacity screen submits through the canonical participation endpoint', () => {
  assert.match(api, /submitParticipation = \(body\) =>\s*apiFetch\('\/api\/portal\/unit-participation-submit'/)
  const cap = portalCode.slice(portalCode.indexOf('function CapacityScreen'), portalCode.indexOf('function PreceptorScreen'))
  assert.ok(cap.includes('submitParticipation('), 'the screen calls submitParticipation')
  assert.ok(!cap.includes('submitCapacity('), 'the old unit_capacity_submissions write is gone from the screen')
})

test('participation endpoint and At a Glance converge on unit_cohort_responses', () => {
  // The endpoint writes via the shared canonical helper.
  assert.match(submitEp, /performUnitResponseUpsert/)
  // The staff At a Glance -> Placement Capacity panel reads unit_cohort_responses.
  assert.match(overview, /from\('unit_cohort_responses'\)/)
  assert.match(overview, /Placement Capacity/)
})

test('an unauthorized unit cannot be submitted (server scope check, fail closed)', () => {
  const ep = stripJs(submitEp)
  assert.match(ep, /getActiveUnitScopes\(db, auth\.profile\.id\)/)
  assert.match(ep, /s\.unit_key === unitName/)
  assert.match(ep, /if \(!scoped\) \{[\s\S]{0,120}403/)
})

// ── 3. Shift is the actual assigned shift, never the preference ──────────────
test('normalizeAssignedShift maps only real shifts; a preference never survives', () => {
  assert.equal(normalizeAssignedShift('Night'), 'Night')
  assert.equal(normalizeAssignedShift('Day'), 'Day')
  assert.equal(normalizeAssignedShift('Mid'), 'Mid')
  // The preference vocabulary and the non-committal shift_type all resolve to null.
  for (const pref of ['No Preference', 'Either / No Preference', 'Variable', 'Day Shift Preferred', '']) {
    assert.equal(normalizeAssignedShift(pref), null, `${pref} must not become a deployed shift`)
  }
})

test('the roster derives shift from the primary preceptor shift_type, not shift_availability', () => {
  assert.ok(!rosterCode.includes('shift: s.shift_availability'), 'the preference field is no longer the shift source')
  assert.match(rosterCode, /preceptors \( full_name, shift_type \)/)
  assert.match(rosterCode, /shift: normalizeAssignedShift\(primaryShiftByStudent\[s\.id\]\)/)
  // Same correction in the detail endpoint.
  assert.ok(!detailCode.includes('shift: s.shift_availability'))
  assert.match(detailCode, /shift: preceptor\.shift/)
})

test('the table shows a clear Not assigned fallback rather than a preference', () => {
  const row = portalCode.slice(portalCode.indexOf('function StudentRow'), portalCode.indexOf('function PreceptorScreen'))
  assert.match(row, /\{s\.shift \|\| 'Not assigned'\}/)
})

// ── 4. Preceptor(s): all active assignments with role pills, ended excluded ──
test('the roster returns EVERY active assignment, not a single collapsed name', () => {
  // Active only (ended/removed excluded) and grouped into an array with role and dates.
  assert.match(rosterCode, /\.eq\('status', 'active'\)/)
  assert.match(rosterCode, /start_date, end_date, preceptors \( full_name, shift_type \)/)
  assert.match(rosterCode, /assignmentsByStudent\[a\.student_id\] \|\|= \[\]/)
  assert.match(rosterCode, /preceptors: assignmentsByStudent\[s\.id\] \|\| \[\]/)
  // Primary is preserved as the single-name projection.
  assert.match(rosterCode, /preceptor_name: primaryNameOf\(s\.id\) \|\| s\.preceptor_name/)
})

test('the column is renamed Preceptor(s) and rendered by the shared PreceptorList', () => {
  assert.match(portalCode, /<th scope="col">Preceptor\(s\)<\/th>/)
  assert.ok(!portalCode.includes('Primary preceptor'), 'the old column header is gone')
  assert.match(portalCode, /<PreceptorList assignments=\{s\.preceptors\}/)
  // The drawer reuses the same component, so the two cannot drift.
  assert.match(read('src/portal/unit/StudentDetailDrawer.jsx'), /<PreceptorList assignments=\{d\.preceptors\}/)
})

test('role pills render Primary, Secondary, and Coverage', () => {
  assert.match(precList, /primary: 'Primary', secondary: 'Secondary', coverage: 'Coverage'/)
  assert.match(precList, /className=\{`ptl-prec-pill ptl-prec-\$\{a\.role\}`\}/)
  const css = read('src/portal/portal.css')
  for (const role of ['primary', 'secondary', 'coverage']) {
    assert.match(css, new RegExp(`\\.ptl-prec-${role}\\b`), `pill style for ${role}`)
  }
})

test('ended assignments are never in the active list (status filter, no date math)', () => {
  // The only liveness signal is status = active; nothing includes ended/removed rows.
  assert.ok(!rosterCode.includes("'ended'") && !rosterCode.includes("'removed'"),
    'the roster never selects ended or removed assignments')
})

// ── 5. No SQL, no permission expansion ───────────────────────────────────────
test('no permission widening: the roster still authorizes through the same helper', () => {
  assert.match(rosterCode, /verifyPortalUnitLeaderCaller\(req\)/)
  // The added assignment fields are name/role/dates/shift_type, all already the same
  // data class; no students-table allowlist change and no new scope.
  assert.ok(!rosterCode.includes('UL_STUDENT_COLUMNS'), 'the students allowlist is untouched here')
})

test('the parked nomination migration is neither applied nor built upon this pass', () => {
  // Item 4: do not build on 20260721000000. Nothing in these changes references it.
  for (const src of [rosterCode, detailCode, portalCode, shared, api, stripJs(submitEp)]) {
    assert.ok(!src.includes('proposed_shift') && !src.includes('20260721000000'),
      'this pass does not touch the parked nomination migration')
  }
})

test('no em dash in the changed sources', () => {
  const emDash = String.fromCharCode(0x2014)
  for (const src of [roster, detail, portal, precList, shared, unitForm, api]) {
    assert.ok(!src.includes(emDash), 'no em dash')
  }
})
