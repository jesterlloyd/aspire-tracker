// test/s06FieldLimits.test.mjs
//
// S-06 LENGTH CAPS: the public submission endpoints bound every free-text field and the size of a
// placement roster. The rules that matter:
//   1. over-length input is REJECTED with a message naming the field, never silently truncated,
//   2. the caps are generous enough that ordinary thoughtful prose never trips one, and
//   3. the two placement paths share one validator, so they cannot drift apart.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { checkLength, checkLengths, LIMITS, MAX_STUDENTS_PER_PLACEMENT_REQUEST } from '../api/lib/fieldLimits.js'
import { validatePlacementRequestInput } from '../api/lib/schoolPlacementUpsert.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = p => readFileSync(join(root, p), 'utf8')

const longer = n => 'x'.repeat(n + 1)

// ── The helper itself ────────────────────────────────────────────────────────────────────────────

test('S-06 caps: a value at the limit passes and one over it fails', () => {
  assert.equal(checkLength('f', 'Field', 'x'.repeat(LIMITS.SHORT), LIMITS.SHORT), null)
  const failure = checkLength('f', 'Field', longer(LIMITS.SHORT), LIMITS.SHORT)
  assert.ok(failure, 'an over-length value must be rejected')
  assert.equal(failure.field, 'f')
  assert.match(failure.message, /Field is too long/)
  assert.match(failure.message, /500 characters or fewer/)
})

test('S-06 caps: length is measured after trimming, and non-strings are ignored', () => {
  assert.equal(checkLength('f', 'Field', `  ${'x'.repeat(LIMITS.NAME)}  `, LIMITS.NAME), null)
  for (const value of [null, undefined, 42, {}, []]) {
    assert.equal(checkLength('f', 'Field', value, 1), null, `non-string ${typeof value} must not trip the cap`)
  }
})

test('S-06 caps: checkLengths reports the FIRST problem so one field is named', () => {
  const failure = checkLengths([
    ['a', 'Field A', 'fine', LIMITS.NAME],
    ['b', 'Field B', longer(LIMITS.NAME), LIMITS.NAME],
    ['c', 'Field C', longer(LIMITS.NAME), LIMITS.NAME],
  ])
  assert.equal(failure.field, 'b')
})

test('S-06 caps: the message is non-technical and names the field and the limit', () => {
  const { message } = checkLength('considerations', 'Considerations', longer(LIMITS.LONG_NARRATIVE), LIMITS.LONG_NARRATIVE)
  assert.match(message, /^Considerations is too long\./)
  assert.match(message, /4000 characters or fewer/)
  assert.doesNotMatch(message, /undefined|null|\[object|Error|stack/i, 'must not leak internals')
})

// ── Generosity: real prose must never hit a cap ──────────────────────────────────────────────────

test('S-06 caps: several thoughtful paragraphs fit comfortably in a narrative field', () => {
  const paragraph =
    'Our unit can support two students this cohort. We have found that pairing a student with the ' +
    'same preceptor across the rotation produces the strongest outcome, so we prefer to schedule ' +
    'consecutive shifts where possible. Please let us know as early as you can if the dates shift.'
  const fiveParagraphs = Array(5).fill(paragraph).join('\n\n')
  assert.ok(fiveParagraphs.length > 900, 'the fixture should be substantial prose')
  assert.equal(checkLength('considerations', 'Considerations', fiveParagraphs, LIMITS.LONG_NARRATIVE), null)
  assert.equal(checkLength('notes', 'Notes', fiveParagraphs, LIMITS.NARRATIVE), null)
})

test('S-06 caps: a long real-world name and school fit', () => {
  assert.equal(checkLength('n', 'Name', 'Maria de los Angeles Fernandez-Villanueva de la Cruz', LIMITS.NAME), null)
  assert.equal(checkLength('s', 'School', 'West Coast University, Los Angeles Campus, School of Nursing', LIMITS.IDENTITY), null)
})

// ── The shared placement validator ───────────────────────────────────────────────────────────────

const okCoordinator = { school: 'A School', name: 'Pat Lee', email: 'pat@school.edu', notes: '' }
const okStudent = { first_name: 'Sam', last_name: 'Rivera', email: 'sam@school.edu' }

test('S-06 caps: a normal placement request passes', () => {
  assert.equal(validatePlacementRequestInput({
    coordinator: okCoordinator, students: [okStudent], availability: { scheduling_notes: 'Mornings preferred.' },
  }), null)
})

test('S-06 caps: the student roster is bounded', () => {
  const roster = Array(MAX_STUDENTS_PER_PLACEMENT_REQUEST + 1).fill(okStudent)
  const failure = validatePlacementRequestInput({ coordinator: okCoordinator, students: roster })
  assert.ok(failure, 'an oversized roster must be rejected')
  assert.equal(failure.field, 'students')
  assert.match(failure.message, /at most 100 at a time/)
  // Exactly at the limit is fine.
  assert.equal(validatePlacementRequestInput({
    coordinator: okCoordinator, students: Array(MAX_STUDENTS_PER_PLACEMENT_REQUEST).fill(okStudent),
  }), null)
})

test('S-06 caps: an over-length coordinator field is named', () => {
  const failure = validatePlacementRequestInput({
    coordinator: { ...okCoordinator, notes: longer(LIMITS.NARRATIVE) }, students: [okStudent],
  })
  assert.equal(failure.field, 'coordinator.notes')
  assert.match(failure.message, /Coordinator notes is too long/)
})

test('S-06 caps: an over-length student field names the row a coordinator can see', () => {
  const failure = validatePlacementRequestInput({
    coordinator: okCoordinator,
    students: [okStudent, { ...okStudent, first_name: longer(LIMITS.NAME) }],
  })
  assert.equal(failure.field, 'students[1].first_name')
  assert.match(failure.message, /Student 2 first name is too long/, 'rows are 1-based for the reader')
})

test('S-06 caps: scheduling notes are bounded', () => {
  const failure = validatePlacementRequestInput({
    coordinator: okCoordinator, students: [okStudent],
    availability: { scheduling_notes: longer(LIMITS.NARRATIVE) },
  })
  assert.equal(failure.field, 'availability.scheduling_notes')
})

// ── Wiring: both placement paths use the one validator, endpoints reject rather than truncate ────

test('S-06 caps: both placement submit paths call the shared validator before writing', () => {
  for (const p of ['api/school-form-submit.js', 'api/portal/school-placement-requests.js']) {
    const src = read(p)
    assert.match(src, /validatePlacementRequestInput\(\{ coordinator, students, availability \}\)/, `${p} must validate`)
    assert.ok(
      src.indexOf('validatePlacementRequestInput') < src.indexOf('performSchoolPlacementUpsert(db'),
      `${p}: validation must precede the write`,
    )
  }
})

test('S-06 caps: the public form endpoints reject over-length input instead of truncating it', () => {
  for (const p of ['api/student-intake-submit.js', 'api/unit-form-submit.js']) {
    const src = read(p)
    assert.match(src, /checkLengths\(\[/, `${p} must apply the shared caps`)
    assert.match(src, /field: tooLong\.field, message: tooLong\.message/, `${p} must name the field`)
  }
})

test('S-06 caps: the intake endpoint no longer silently truncates a student\'s own words', () => {
  const src = read('api/student-intake-submit.js')
  // The two former .slice() caps are gone; the same limits are enforced as rejections instead.
  assert.doesNotMatch(src, /unavailable_weekdays_reason\).slice\(/)
  assert.doesNotMatch(src, /availability_notes\).slice\(/)
  assert.match(src, /\['unavailable_weekdays_reason', *'Reason for unavailability', *body\.unavailable_weekdays_reason, *LIMITS\.SHORT\]/)
  assert.match(src, /\['availability_notes', *'Availability notes', *body\.availability_notes, *LIMITS\.NOTES\]/)
  // The retired limits are preserved exactly, so nothing that fit before is rejected now.
  assert.equal(LIMITS.SHORT, 500)
  assert.equal(LIMITS.NOTES, 1000)
})

test('S-06 caps: the unit form keeps its existing identity caps and adds the missing ones', () => {
  const src = read('api/unit-form-submit.js')
  // Pre-existing caps, unchanged.
  assert.match(src, /unitName\.length > 200/)
  assert.match(src, /submitterEmail\.length > 254/)
  assert.match(src, /submitterRole\.length > 100/)
  // Newly capped free-text fields.
  for (const field of ['considerations', 'preferred_preceptors', 'reason_for_zero', 'hiring_ngrp_reason', 'alumni_notes']) {
    assert.ok(src.includes(`'${field}'`), `${field} must be capped`)
  }
})
