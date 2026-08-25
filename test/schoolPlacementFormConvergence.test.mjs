// AP Placement Requests, Commit 1: the public /school-form and (Commit 2) the authenticated Academic
// Partner placement-request form share ONE canonical definition (src/lib/schoolPlacementForm.js), so
// copy, field order, validation, soft warnings, and payload cannot drift. Modeled on the
// /unit-form <-> Capacity convergence (test/unitLeaderCapacityPreceptors.test.mjs).
//
// Pure-function tests exercise the shared rules directly; source guards prove the public form was
// refactored onto the shared module (no second hardcoded copy of the validation or payload).

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  MIN_HOURS_REQUIRED, SCHOOL_PLACEMENT_TEXT, PLACEMENT_PAGE_TITLE,
  validatePlacementForm, collectPlacementSoftWarnings, buildPlacementBody,
  placementSubmitLabel, newStudentRow, PROGRAM_TYPES,
} from '../src/lib/schoolPlacementForm.js'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')
const stripJs = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const publicForm = read('src/components/SchoolFormPage.jsx')
const publicCode = stripJs(publicForm)
const apForm = read('src/portal/ap/PlacementRequestsView.jsx')

const validForm = () => ({
  coordinator: { school: 'West Coast University', name: 'Jane Coord, MSN', email: 'jane@wcu.edu', notes: '' },
  rotation: { start_date: '2099-01-06', end_date: '2099-03-06' },
  students: [{ first_name: 'Ann', last_name: 'Lee', email: 'ann@wcu.edu', hours_required: '144' }],
  cohortId: 'c1',
})

// ── Shared hard validation ───────────────────────────────────────────────────────────────────────

test('validation enforces coordinator, rotation, student, min-hours, and cohort rules in order', () => {
  assert.equal(validatePlacementForm(validForm()), null)

  const noCoord = validForm(); noCoord.coordinator.school = ''
  assert.equal(validatePlacementForm(noCoord).scope, 'coordinator')

  const noDates = validForm(); noDates.rotation.end_date = ''
  assert.equal(validatePlacementForm(noDates).scope, 'rotation')

  const badOrder = validForm(); badOrder.rotation.end_date = badOrder.rotation.start_date
  const bo = validatePlacementForm(badOrder)
  assert.equal(bo.scope, 'rotation')
  assert.match(bo.message, /after the start date/)

  const noName = validForm(); noName.students[0].first_name = '  '
  assert.equal(validatePlacementForm(noName).scope, 'students')

  const lowHours = validForm(); lowHours.students[0].hours_required = '80'
  const lh = validatePlacementForm(lowHours)
  assert.equal(lh.scope, 'students')
  assert.match(lh.message, /at least 90/)
  assert.match(lh.message, /Ann Lee/)

  const noCohort = validForm(); noCohort.cohortId = null
  assert.equal(validatePlacementForm(noCohort).scope, 'cohort')
})

test('minimum required hours is the canonical 90', () => {
  assert.equal(MIN_HOURS_REQUIRED, 90)
  const at90 = validForm(); at90.students[0].hours_required = '90'
  assert.equal(validatePlacementForm(at90), null)
})

// ── Shared soft warnings ─────────────────────────────────────────────────────────────────────────

test('soft warnings flag a past start, an atypical length, and an early graduation date', () => {
  const today = '2099-06-01'
  // Past start.
  assert.ok(collectPlacementSoftWarnings({ rotation: { start_date: '2099-05-01', end_date: '2099-05-29' }, students: [] }, today)
    .some(w => /past/.test(w)))
  // Too short (2 weeks).
  assert.ok(collectPlacementSoftWarnings({ rotation: { start_date: '2099-07-01', end_date: '2099-07-15' }, students: [] }, today)
    .some(w => /outside the typical 4-16 week range/.test(w)))
  // Graduation before rotation end.
  assert.ok(collectPlacementSoftWarnings({
    rotation: { start_date: '2099-07-01', end_date: '2099-09-01' },
    students: [{ first_name: 'Ann', last_name: 'Lee', estimated_graduation_date: '2099-08-01' }],
  }, today).some(w => /before the rotation end date/.test(w)))
  // A clean, in-range future rotation warns about nothing.
  assert.deepEqual(collectPlacementSoftWarnings({ rotation: { start_date: '2099-07-01', end_date: '2099-09-01' }, students: [] }, today), [])
})

// ── Shared payload builder ───────────────────────────────────────────────────────────────────────

test('the request body is canonical: trimmed coordinator, nested availability, mapped students', () => {
  const body = buildPlacementBody({
    cohortId: 'c1', cohortName: 'Fall 2099',
    coordinator: { school: ' WCU ', name: ' Jane ', email: ' jane@wcu.edu ', notes: ' hi ' },
    rotation: { start_date: '2099-01-06', end_date: '2099-03-06' },
    availability: { unavailable_weekdays: ['Mon'], blackout_dates: [], scheduling_notes: 'x' },
    students: [{ first_name: ' Ann ', last_name: ' Lee ', email: ' ann@wcu.edu ', phone: '', program_type: 'MECN', hours_required: '144', estimated_graduation_date: '' }],
  })
  assert.equal(body.cohortId, 'c1')
  assert.equal(body.coordinator.school, 'WCU')
  assert.equal(body.coordinator.name, 'Jane')
  assert.equal(body.rotationStartDate, '2099-01-06')
  assert.deepEqual(body.availability.unavailable_weekdays, ['Mon'])
  assert.equal(body.students[0].first_name, 'Ann')
  assert.equal(body.students[0].estimated_graduation_date, null)   // empty -> null
  // NURSING-ACADEMICS-1: course_type always travels in the canonical body ('' when unselected).
  assert.equal(body.students[0].course_type, '')
})

test('submit label pluralizes correctly', () => {
  assert.equal(placementSubmitLabel(1), 'Submit 1 Student')
  assert.equal(placementSubmitLabel(3), 'Submit 3 Students')
})

test('a fresh student row has a stable key and empty fields', () => {
  const r = newStudentRow()
  assert.ok(r._key)
  assert.equal(r.first_name, '')
  assert.equal(r.hours_required, '')
})

// ── The public form was refactored onto the shared module (no second hardcoded copy) ──────────────

test('the public /school-form imports and uses the shared canonical definition', () => {
  assert.match(publicForm, /from '\.\.\/lib\/schoolPlacementForm'/)
  for (const sym of ['validatePlacementForm', 'collectPlacementSoftWarnings', 'buildPlacementBody', 'placementSubmitLabel', 'SCHOOL_PLACEMENT_TEXT']) {
    assert.ok(publicForm.includes(sym), `public form uses ${sym}`)
  }
  // Labels and copy now come from the shared text, and the page title is the shared constant.
  assert.equal(PLACEMENT_PAGE_TITLE, 'ASPIRE Student Placement Request Form')
  assert.match(publicForm, /\{T\.schoolLabel\}/)
  assert.match(publicForm, /\{T\.rotationStartLabel\}/)
  assert.match(publicForm, /\{T\.hoursRequiredLabel\}/)
  // The old inline validation strings and hand-built payload are GONE from the component.
  assert.doesNotMatch(publicCode, /Please fill in your school and contact information/)
  assert.doesNotMatch(publicCode, /Hours required must be at least 90/)
  assert.doesNotMatch(publicCode, /outside the typical 4-16 week range/)
  // Program types remain sourced canonically.
  assert.ok(PROGRAM_TYPES.includes('MECN'))
})

test('the public form and the Academic Partner form share the canonical definition (no drift)', () => {
  // Both surfaces import the shared module and consume the same copy, validation, and constants.
  assert.match(publicForm, /from '\.\.\/lib\/schoolPlacementForm'/)
  assert.match(apForm, /from '\.\.\/\.\.\/lib\/schoolPlacementForm'/)
  for (const src of [publicForm, apForm]) {
    assert.ok(src.includes('SCHOOL_PLACEMENT_TEXT'), 'uses shared copy')
    assert.ok(src.includes('validatePlacementForm'), 'uses shared validation')
    assert.ok(src.includes('placementSubmitLabel'), 'uses shared submit label')
    assert.ok(src.includes('newStudentRow'), 'uses shared student-row factory')
    assert.ok(src.includes('PROGRAM_TYPES'), 'uses canonical program types')
    // NURSING-ACADEMICS-1: both surfaces render the structured course-type select.
    assert.ok(src.includes('COURSE_TYPES'), 'uses canonical course types')
    assert.ok(src.includes('T.courseTypeLabel'), 'renders the shared course-type label')
  }
  // The Academic Partner form renders labels from the shared text, exactly like the public form.
  assert.match(apForm, /\{T\.schoolLabel\}/)
  assert.match(apForm, /\{T\.rotationStartLabel\}/)
  assert.match(apForm, /\{T\.hoursRequiredLabel\}/)
  // Neither surface hardcodes the validation strings (they live only in the shared module).
  assert.doesNotMatch(stripJs(apForm), /Hours required must be at least 90/)
})
