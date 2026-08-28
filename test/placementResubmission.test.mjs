// test/placementResubmission.test.mjs
//
// PLACEMENT-RESUBMIT-1: the three defences against a second placement request
// from a school that already has one in the same cohort. Written against the
// 2026-08-27 incident: a Fall II submission from West Coast University North
// Hollywood replaced the Fall I rotation row, moving every already-rotating
// student's window and erasing the blackout dates with it.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  sanitizeSubmitMode, mergeAvailabilityCols, preservedAvailabilityFields,
  describeExistingRequest, resubmissionWarning, formatRotationWindow,
  isEmptyAvailabilityValue, AVAILABILITY_COLUMNS,
} from '../src/lib/placementResubmission.js'
import { validatePlacementForm, buildPlacementBody } from '../src/lib/schoolPlacementForm.js'

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

// The state Tony Kim's Fall I submission left behind.
const STORED = Object.freeze({
  school_name: 'West Coast University North Hollywood',
  rotation_start_date: '2026-08-17',
  rotation_end_date: '2026-10-18',
  coordinator_name: 'Tony Kim',
  coordinator_email: 'tkim@westcoastuniversity.edu',
  unavailable_weekdays: ['Mon', 'Tue'],
  min_days_per_week: 2,
  weekends_allowed: true,
  nights_allowed: false,
  blackout_dates: ['2026-09-07', '2026-11-26'],
  scheduling_notes: 'No clinical during midterms week.',
  updated_at: '2026-06-21T18:04:00.000Z',
})

// What the Fall II submission actually carried: dates only, everything else blank.
const BLANK_SUBMISSION = Object.freeze({
  unavailable_weekdays: [],
  min_days_per_week: null,
  weekends_allowed: null,
  nights_allowed: null,
  blackout_dates: [],
  scheduling_notes: null,
})

// ── MERGE: the backstop that holds even when the warning is dismissed ────────

test('a blank resubmission no longer erases stored availability', () => {
  const merged = mergeAvailabilityCols(BLANK_SUBMISSION, STORED)
  assert.deepEqual(merged.unavailable_weekdays, ['Mon', 'Tue'])
  assert.equal(merged.min_days_per_week, 2)
  assert.equal(merged.weekends_allowed, true)
  assert.equal(merged.nights_allowed, false, 'false is an ANSWER, never treated as empty')
  assert.deepEqual(merged.blackout_dates, ['2026-09-07', '2026-11-26'])
  assert.equal(merged.scheduling_notes, 'No clinical during midterms week.')
  // And the endpoints can say exactly what was saved from erasure.
  assert.deepEqual(preservedAvailabilityFields(BLANK_SUBMISSION, STORED), AVAILABILITY_COLUMNS.slice())
})

test('a submitted value still wins, and a first submission is unaffected', () => {
  const merged = mergeAvailabilityCols({
    ...BLANK_SUBMISSION,
    blackout_dates: ['2027-01-01'],
    weekends_allowed: false,
    scheduling_notes: 'Nights only.',
  }, STORED)
  assert.deepEqual(merged.blackout_dates, ['2027-01-01'], 'a real value replaces')
  assert.equal(merged.weekends_allowed, false, 'false replaces true; it is not "empty"')
  assert.equal(merged.scheduling_notes, 'Nights only.')
  assert.deepEqual(merged.unavailable_weekdays, ['Mon', 'Tue'], 'untouched fields still preserved')

  // No existing row: the submission is written verbatim, blanks included.
  assert.deepEqual(mergeAvailabilityCols(BLANK_SUBMISSION, null), BLANK_SUBMISSION)
  assert.deepEqual(preservedAvailabilityFields(BLANK_SUBMISSION, null), [])
})

test('emptiness is defined the same way sanitizeAvailabilityCols produces it', () => {
  assert.equal(isEmptyAvailabilityValue(null), true)
  assert.equal(isEmptyAvailabilityValue(undefined), true)
  assert.equal(isEmptyAvailabilityValue([]), true)
  assert.equal(isEmptyAvailabilityValue('   '), true)
  assert.equal(isEmptyAvailabilityValue(false), false, 'a boolean answer is not empty')
  assert.equal(isEmptyAvailabilityValue(0), false, 'zero days per week is an answer')
  assert.equal(isEmptyAvailabilityValue(['Mon']), false)
})

// ── MODE: the roster-only path ──────────────────────────────────────────────

test('submit modes are an allowlist, defaulting to the safe full submission', () => {
  assert.equal(sanitizeSubmitMode('add_students'), 'add_students')
  assert.equal(sanitizeSubmitMode('full'), 'full')
  assert.equal(sanitizeSubmitMode(''), 'full')
  assert.equal(sanitizeSubmitMode('anything_else'), 'full')
  assert.equal(sanitizeSubmitMode(undefined), 'full')
  assert.equal(sanitizeSubmitMode({ toString: () => 'add_students' }), 'full', 'non-strings never pass')
})

test('add_students mode drops the rotation-date rules but keeps every other one', () => {
  const roster = [{ first_name: 'Ana', last_name: 'Cruz', email: 'a@wcu.edu', hours_required: 120 }]
  const coordinator = { school: 'West Coast University North Hollywood', name: 'Tony Kim', email: 't@wcu.edu' }
  const noDates = { start_date: '', end_date: '' }
  assert.equal(
    validatePlacementForm({ coordinator, rotation: noDates, students: roster, cohortId: 'c1', mode: 'add_students' }),
    null, 'no dates needed when joining an existing request',
  )
  assert.equal(
    validatePlacementForm({ coordinator, rotation: noDates, students: roster, cohortId: 'c1' })?.scope,
    'rotation', 'a full submission still requires them',
  )
  // Coordinator and student rules are untouched by the mode.
  assert.equal(
    validatePlacementForm({ coordinator: {}, rotation: noDates, students: roster, cohortId: 'c1', mode: 'add_students' })?.scope,
    'coordinator',
  )
  assert.equal(
    validatePlacementForm({ coordinator, rotation: noDates, students: [{ first_name: '' }], cohortId: 'c1', mode: 'add_students' })?.scope,
    'students',
  )
})

test('the request body carries the mode, defaulting to full', () => {
  const args = { cohortId: 'c1', cohortName: 'Fall 2026', coordinator: { school: 'S', name: 'N', email: 'e@x.edu' }, rotation: {}, availability: {}, students: [] }
  assert.equal(buildPlacementBody(args).mode, 'full')
  assert.equal(buildPlacementBody({ ...args, mode: 'add_students' }).mode, 'add_students')
})

// ── WARN: what the coordinator is told before submitting ────────────────────

test('the existing-request summary is public-safe and names no student', () => {
  const summary = describeExistingRequest(STORED, 6)
  assert.equal(summary.exists, true)
  assert.equal(summary.schoolName, 'West Coast University North Hollywood')
  assert.equal(summary.studentCount, 6)
  assert.equal(summary.coordinatorName, 'Tony Kim')
  assert.equal(summary.rotationWindow, 'August 17, 2026 to October 18, 2026')
  // The lookup is reachable by anyone holding the cohort password, so it must
  // never carry the roster or a contact address.
  assert.equal(summary.coordinatorEmail, undefined)
  assert.equal(summary.students, undefined)
  assert.deepEqual(describeExistingRequest(null), { exists: false })
})

test('rotation windows format without a timezone shift, and honour the pending sentinel', () => {
  // new Date('2026-08-17') is UTC midnight and prints as the 16th in Los
  // Angeles; the formatter must parse calendar parts instead.
  assert.equal(formatRotationWindow('2026-08-17', '2026-10-18'), 'August 17, 2026 to October 18, 2026')
  assert.equal(formatRotationWindow('1900-01-01', '1900-01-01'), 'dates pending review')
  assert.equal(formatRotationWindow('', ''), 'dates pending review')
  assert.equal(formatRotationWindow('2026-08-17', ''), 'August 17, 2026')
})

test('the warning states the consequence in the words the coordinator needs', () => {
  const warning = resubmissionWarning(describeExistingRequest(STORED, 6))
  assert.match(warning.title, /already has a placement request for this cohort/)
  assert.match(warning.detail, /6 students/)
  assert.match(warning.detail, /August 17, 2026 to October 18, 2026/)
  assert.match(warning.detail, /Tony Kim/)
  assert.match(warning.overwriteWarning, /replace the rotation dates/)
  assert.match(warning.overwriteWarning, /currently on rotation/, 'names the real harm')
  assert.match(warning.overwriteWarning, /contact the ASPIRE team/)
  assert.match(warning.addPrompt, /only need to fill in the new students/)
  assert.equal(resubmissionWarning({ exists: false }), null)
  assert.equal(resubmissionWarning(null), null)
  // Singular reads correctly.
  assert.match(resubmissionWarning(describeExistingRequest(STORED, 1)).detail, /covers 1 student for/)
})

// ── Wiring: the write path and both submit surfaces ─────────────────────────

test('the shared upsert reads the stored row first, merges, and honours the mode', () => {
  const upsert = read('api/lib/schoolPlacementUpsert.js')
  assert.match(upsert, /existingRotation = await readExistingRotation\(db, \{ cohortId, schoolName \}\)/)
  assert.match(upsert, /const availabilityCols = mergeAvailabilityCols\(submittedAvailability, existingRotation\)/)
  // add_students never writes the rotation row, and fails closed with no row.
  assert.match(upsert, /if \(submitMode === 'add_students' && !existingRotation\)/)
  assert.match(upsert, /rotationId = existingRotation\.id/)
  // The upsert call is now inside the full-mode branch only.
  assert.match(upsert, /if \(submitMode === 'add_students'\) \{\s*\n\s*rotationId = existingRotation\.id\s*\n\s*\} else \{/)
})

test('both submit endpoints accept the mode and relax the date rules for it', () => {
  for (const p of ['api/school-form-submit.js', 'api/portal/school-placement-requests.js']) {
    const src = read(p)
    assert.match(src, /sanitizeSubmitMode/, `${p} sanitizes the mode`)
    assert.match(src, /addOnly/, `${p} branches on it`)
    assert.match(src, /mode,/, `${p} passes it to the shared write`)
  }
  // The AP path names the no-existing-request case rather than 500ing.
  assert.match(read('api/portal/school-placement-requests.js'), /409\)\.json\(\{ error: 'no_existing_request'/)
})

test('the public lookup endpoint is gated exactly like the submit endpoint', () => {
  const src = read('api/school-form-existing-request.js')
  // Rate limit, then accepting_submissions, then the S-08 password.
  assert.match(src, /consumePublicRateLimit|rateLimit\(db, req, SCHOOL_SUBMIT_LIMITS\)/)
  assert.match(src, /accepting_submissions/)
  assert.match(src, /school_form_requires_password/)
  assert.match(src, /verify_school_form_password/)
  // One refusal message for missing and wrong, so it is not a protection oracle.
  assert.match(src, /The cohort password is incorrect/)
  assert.doesNotMatch(src, /password is required/i)
})

test('the public form warns, offers the roster-only path, and gates the overwrite', () => {
  const page = read('src/components/SchoolFormPage.jsx')
  assert.match(page, /school-form-existing-request/)
  // The lookup answer is keyed by school, so a late reply for a previous
  // school can never be read as an answer about the current one.
  assert.match(page, /const existing = lookup\.school === coord\.school\.trim\(\) \? lookup\.summary : null/)
  // A full resubmission needs an explicit acknowledgement.
  assert.match(page, /if \(warning && !addOnly && !ackOverwrite\)/)
  // Changing the school invalidates a decision made about a different one.
  assert.match(page, /if \(k === 'school'\) \{ setSubmitMode\('full'\); setAckOverwrite\(false\) \}/)
  // add_students hides the rotation-date and availability sections entirely.
  assert.match(page, /addOnly \? \(/)
  assert.match(page, /sf-resubmit-inherited/)
  assert.match(read('src/index.css'), /\.sf-resubmit-warning \{/)
})
