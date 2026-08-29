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

// ── The Academic Partner portal: the path the incident actually came through ──

test('the AP portal derives the same summary from the requests already on the page', async () => {
  const { describeExistingRequestFromPortalRequests } = await import('../src/lib/placementResubmission.js')
  // Shape of api/portal/school-placement-requests.js GET entries.
  const requests = [
    { id: 's1', cohort: { id: 'fall26' }, rotation: { start_date: '2026-08-17', end_date: '2026-10-25' } },
    { id: 's2', cohort: { id: 'fall26' }, rotation: { start_date: '2026-08-17', end_date: '2026-10-25' } },
    { id: 's3', cohort: { id: 'summer26' }, rotation: { start_date: '2026-05-04', end_date: '2026-08-18' } },
  ]
  const summary = describeExistingRequestFromPortalRequests('West Coast University North Hollywood', requests, 'fall26')
  assert.equal(summary.exists, true)
  assert.equal(summary.studentCount, 2, 'only the requests in THIS cohort count')
  assert.equal(summary.rotationWindow, 'August 17, 2026 to October 25, 2026')
  assert.equal(summary.coordinatorName, '', 'the portal payload carries no coordinator name')
  // A cohort with no prior requests is not a resubmission.
  assert.deepEqual(describeExistingRequestFromPortalRequests('X', requests, 'winter27'), { exists: false })
  assert.deepEqual(describeExistingRequestFromPortalRequests('X', [], 'fall26'), { exists: false })
  assert.deepEqual(describeExistingRequestFromPortalRequests('X', null, 'fall26'), { exists: false })
  // No cohort selected must never look like an existing request.
  assert.deepEqual(describeExistingRequestFromPortalRequests('X', requests, null), { exists: false })
  // A request with no rotation dates still counts, and reads as pending.
  const undated = [{ id: 's4', cohort: { id: 'c9' }, rotation: null }]
  assert.equal(describeExistingRequestFromPortalRequests('X', undated, 'c9').rotationWindow, 'dates pending review')
})

test('the AP portal warns, offers the roster-only path, and gates the overwrite', () => {
  const view = read('src/portal/ap/PlacementRequestsView.jsx')
  // The warning is derived, not fetched: no new endpoint on this surface.
  assert.match(view, /describeExistingRequestFromPortalRequests\(schoolKey, existingRequests, cohortId\)/)
  assert.match(view, /existingRequests=\{school\.requests\}/)
  // Same gate as the public form, same shared copy.
  assert.match(view, /if \(warning && !addOnly && !ackOverwrite\)/)
  assert.match(view, /mode: submitMode/)
  assert.match(view, /ptl-plr-resubmit/)
  // Switching cohort invalidates a decision made about a different cohort.
  assert.match(view, /setPrevCohortId\(cohortId\)\s*\n\s*setSubmitMode\('full'\)\s*\n\s*setAckOverwrite\(false\)/)
  // The 409 from an add_students request with no existing row is named, not generic.
  assert.match(view, /no_existing_request/)
  assert.match(read('src/portal/portal.css'), /\.ptl-plr-resubmit \{/)
})

test('both surfaces warn in the SAME words, from the one copy module', () => {
  for (const p of ['src/components/SchoolFormPage.jsx', 'src/portal/ap/PlacementRequestsView.jsx']) {
    const src = read(p)
    assert.match(src, /resubmissionWarning/, `${p} uses the shared copy`)
    assert.match(src, /warning\.addPrompt/)
    assert.match(src, /warning\.overwriteWarning/)
    assert.match(src, /warning\.acknowledgement/)
    // Neither surface hardcodes its own wording.
    assert.doesNotMatch(src, /already has a placement request for this cohort/,
      `${p} must not restate the copy`)
  }
})

// ── The incident repair script ──────────────────────────────────────────────

test('the repair script is exact-row, locked, fails closed, and is reversible', () => {
  const sql = read('supabase/migrations/20260830000000_wcu_noho_fall2_split_repair.sql')
  // Exactly the five movers, and the four stayers named separately.
  for (const id of ['4901f694-8a46-4d50-b900-7583231d4bc2', 'da1d51c6-514a-4291-892b-900b42891eb9',
    'ea42bb7e-a906-4b8d-8b7f-e47cfb09c01b', 'a7240031-da1e-4f1e-8f7c-714874ad1577',
    'b4abd33a-81fe-4227-a35e-6472084c90ba']) {
    assert.ok(sql.includes(id), `mover ${id} is named`)
  }
  assert.ok(sql.includes('d6ff6ac4-94c0-4818-935a-e5bde2c07c00'), 'Juliana Pilla is named as a STAYER')
  // Locked before any check or write.
  assert.match(sql, /SELECT \* INTO v_row FROM cohort_school_rotations WHERE id = r_fall FOR UPDATE/)
  assert.match(sql, /PERFORM 1 FROM students WHERE cohort_school_rotation_id = r_fall FOR UPDATE/)
  // Proves the overwritten state before repairing it, so a second run cannot re-run the writes.
  assert.match(sql, /not the overwritten % to %/)
  // Restores the window quoted from program_events, never invented.
  assert.match(sql, /d_f1_start date := DATE '2026-08-17'/)
  assert.match(sql, /d_f1_end\s+date := DATE '2026-10-25'/)
  // Availability copies column-to-column (type-agnostic) and clears via DEFAULT.
  assert.match(sql, /r\.unavailable_weekdays, r\.min_days_per_week, r\.weekends_allowed, r\.nights_allowed/)
  assert.match(sql, /unavailable_weekdays = DEFAULT/)
  // Postconditions run before COMMIT, and a rollback is documented.
  assert.match(sql, /POSTCONDITION: expected 5 students moved to Winter 2027/)
  // Student-keyed tables are classified, and anything unclassified still aborts.
  assert.match(sql, /follow_tables text\[\] := ARRAY\['program_events', 'communications'\]/)
  assert.match(sql, /inert_tables  text\[\] := ARRAY\['notification_log', 'student_reads'\]/)
  assert.match(sql, /no longer inert\. Reclassify it/)
  assert.match(sql, /POSTCONDITION: a staying student was moved/)
  assert.ok(sql.lastIndexOf('POSTCONDITION') < sql.indexOf('COMMIT;'), 'postconditions precede COMMIT')
  assert.match(sql, /── Rollback ─/)
  // Data-only: no schema change hides in an incident repair.
  assert.doesNotMatch(sql, /\n\s*(ALTER TABLE|CREATE TABLE|DROP TABLE|CREATE POLICY)/)
})

test('the Anaheim move repoints the row rather than copying it, and is reversible', () => {
  const sql = read('supabase/migrations/20260831000000_wcu_anaheim_move_to_winter_2027.sql')
  assert.ok(sql.includes('4dbf6d13-d5cd-4c63-8cec-0c61b6e2400e'), 'the Anaheim rotation row is named')
  assert.ok(sql.includes('52933615-cf6e-441f-ac68-130bdb6a0491'), 'Winter 2027 is named')
  // Locked before any check or write.
  assert.match(sql, /SELECT \* INTO v_row FROM cohort_school_rotations WHERE id = r_anah FOR UPDATE/)
  assert.match(sql, /PERFORM 1 FROM students WHERE cohort_school_rotation_id = r_anah FOR UPDATE/)
  // The ROW moves. Nothing is copied, so the window and blackout dates cannot be
  // mistyped, and cohort_school_rotation_id on the students never changes.
  assert.match(sql, /UPDATE cohort_school_rotations\s*\n\s*SET cohort_id = c_winter/)
  assert.doesNotMatch(sql, /INSERT INTO cohort_school_rotations/, 'no new rotation row is created')
  assert.doesNotMatch(sql, /cohort_school_rotation_id\s*=\s*r_winter/, 'students keep their rotation id')
  // Proves it is still in Fall 2026 first, so a second run cannot re-run the writes.
  assert.match(sql, /is already in cohort %, not Fall 2026/)
  // The roster is captured from the row at runtime, then proven, not hardcoded.
  assert.match(sql, /SELECT array_agg\(id ORDER BY id\), count\(\*\) INTO v_ids, v_n/)
  assert.match(sql, /students on rotation % are in Fall 2026/)
  // Postconditions run before COMMIT, including "nothing left behind".
  assert.match(sql, /POSTCONDITION: % Anaheim student\(s\) remain in Fall 2026/)
  assert.match(sql, /POSTCONDITION: the Anaheim blackout dates were lost/)
  assert.match(sql, /follow_tables text\[\] := ARRAY\['program_events', 'communications'\]/)
  assert.match(sql, /inert_tables  text\[\] := ARRAY\['notification_log', 'student_reads'\]/)
  assert.ok(sql.lastIndexOf('POSTCONDITION') < sql.indexOf('COMMIT;'), 'postconditions precede COMMIT')
  assert.match(sql, /── Rollback ─/)
  // Data-only, and a separate transaction from the North Hollywood repair so an
  // abort here cannot roll that back.
  assert.doesNotMatch(sql, /\n\s*(ALTER TABLE|CREATE TABLE|DROP TABLE|CREATE POLICY)/)
  assert.equal(sql.match(/^BEGIN;/gm)?.length, 1, 'one transaction')
})
