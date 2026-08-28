// NURSING-ACADEMICS-1: the structured course_type field through the shared
// placement pipeline (canonical form module + shared server upsert) and the
// staff correction path.
// Pure unit and source assertions. No network, no live database, no email.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  performSchoolPlacementUpsert,
  isCourseTypeReady,
  sanitizeCourseType,
} from '../api/lib/schoolPlacementUpsert.js'
import { COURSE_TYPES } from '../src/lib/constants.js'
import { newStudentRow, buildPlacementBody } from '../src/lib/schoolPlacementForm.js'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')

// Mirrors the mock in schoolPlacementUpsert.test.mjs, extended with a switch
// for the course_type readiness probe (select('course_type').limit(1)).
function makeDb({ existing = [], probesFail = false } = {}) {
  const inserts = []
  const updates = []
  function from(table) {
    const state = { table, op: null, limited: false, eqd: false }
    const builder = {
      upsert(p) { state.op = 'upsert'; state.payload = p; return builder },
      insert(p) { state.op = 'insert'; state.payload = p; return builder },
      update(p) { state.op = 'update'; state.payload = p; return builder },
      select(cols) { state.select = cols; return builder },
      single() { return builder },
      maybeSingle() { state.maybeSingle = true; return builder },
      eq() { state.eqd = true; return builder },
      limit() { state.limited = true; return builder },
      then(resolve) { resolve(result()) },
    }
    function result() {
      if (table === 'cohort_school_rotations' && state.op === 'upsert') return { data: { id: 'rot1' }, error: null }
      if (table === 'students' && state.op === null && state.limited && !state.eqd) {
        return probesFail
          ? { data: null, error: { code: '42703', message: 'column does not exist' } }
          : { data: [], error: null }
      }
      if (table === 'students' && state.op === null) return { data: existing, error: null }
      if (table === 'students' && state.op === 'insert') { inserts.push(state.payload); return { data: { id: 'new1' }, error: null } }
      if (table === 'students' && state.op === 'update') { updates.push(state.payload); return { error: null } }
      return { data: null, error: null }
    }
    return builder
  }
  return { from, _inserts: inserts, _updates: updates }
}

const params = (studentOver = {}, over = {}) => ({
  cohortId: 'c1', cohortName: 'Fall 2099',
  coordinator: { school: 'UCLA', name: 'Jane', email: 'jane@ucla.edu', notes: '' },
  rotationStartDate: '2099-01-06', rotationEndDate: '2099-03-06',
  availability: {},
  students: [{ first_name: 'Ann', last_name: 'Lee', email: 'ann@ucla.edu', program_type: 'MECN', hours_required: '144', course_type: '', ...studentOver }],
  provenance: { source: 'school_form', submittedByProfileId: null, submittedAt: '2099-01-01T00:00:00.000Z' },
  provenanceReady: false,
  ...over,
})

// ── The shared canonical definition ──────────────────────────────────────────

test('the canonical form module carries course_type end to end', () => {
  assert.ok(COURSE_TYPES.length >= 5)
  assert.ok(COURSE_TYPES.includes('Capstone / Preceptorship'))
  assert.equal(newStudentRow().course_type, '')
  const body = buildPlacementBody({
    cohortId: 'c1', coordinator: {}, rotation: {},
    students: [{ first_name: 'A', last_name: 'B', email: 'x@y.z', course_type: 'Critical Care' }],
  })
  assert.equal(body.students[0].course_type, 'Critical Care')
})

// ── Server sanitation ────────────────────────────────────────────────────────

test('course_type is structured: catalog values pass, free text is dropped', () => {
  assert.equal(sanitizeCourseType('Critical Care'), 'Critical Care')
  assert.equal(sanitizeCourseType('  Critical Care  '), 'Critical Care')
  assert.equal(sanitizeCourseType('whatever the coordinator typed'), '')
  assert.equal(sanitizeCourseType(''), '')
  assert.equal(sanitizeCourseType(null), '')
})

// ── The shared upsert ────────────────────────────────────────────────────────

test('a new student inserts the selected course_type (null when unselected) once the column is ready', async () => {
  const db = makeDb()
  await performSchoolPlacementUpsert(db, params({ course_type: 'Pediatrics' }))
  assert.equal(db._inserts[0].course_type, 'Pediatrics')

  const db2 = makeDb()
  await performSchoolPlacementUpsert(db2, params({ course_type: '' }))
  assert.equal(db2._inserts[0].course_type, null)
})

test('before the migration is applied, the write omits course_type and still succeeds (live forms keep working)', async () => {
  const db = makeDb({ probesFail: true })
  const r = await performSchoolPlacementUpsert(db, params({ course_type: 'Pediatrics' }))
  assert.equal(r.error, null)
  assert.equal(r.added.length, 1)
  assert.ok(!('course_type' in db._inserts[0]), 'not-ready write must omit course_type')
  assert.equal(await isCourseTypeReady(makeDb({ probesFail: true })), false)
  assert.equal(await isCourseTypeReady(makeDb()), true)
})

test('a resubmission with a BLANK course type never wipes an existing classification', async () => {
  const db = makeDb({ existing: [{ id: 'e1', school_email: 'ann@ucla.edu', submitted_via: 'school_form' }] })
  await performSchoolPlacementUpsert(db, params({ course_type: '' }))
  assert.ok(!('course_type' in db._updates[0]), 'blank submission must not touch course_type')

  const db2 = makeDb({ existing: [{ id: 'e1', school_email: 'ann@ucla.edu', submitted_via: 'school_form' }] })
  await performSchoolPlacementUpsert(db2, params({ course_type: 'Leadership / Management' }))
  assert.equal(db2._updates[0].course_type, 'Leadership / Management')
})

// ── The correction path and historical behavior ──────────────────────────────

test('the staff editor exposes course_type through the allowlisted profile domain', () => {
  const endpoint = read('api/student-update.js')
  assert.match(endpoint, /'program_type', 'course_type', 'shift_availability'/)
  assert.match(endpoint, /case 'course_type':/)
  const routing = read('src/App.jsx')
  assert.match(routing, /'program_type', 'course_type', 'shift_availability'/)
  const panel = read('src/components/StudentSidePanel.jsx')
  assert.match(panel, /Course Type/)
  assert.match(panel, /Unclassified/)
})

test('historical records render Unclassified and are never inferred from notes', () => {
  // The compute module renders empty/NULL as Unclassified (covered in
  // communityBenefitCompute.test.mjs); here, assert nothing anywhere derives
  // course type from coordinator notes.
  for (const p of [
    'api/lib/schoolPlacementUpsert.js',
    'lib/server/communityBenefit/compute.js',
    'api/lib/communityBenefitData.js',
  ]) {
    const src = read(p)
    assert.ok(!/course_type[^\n]{0,60}(notes|coordinators)/.test(src), `${p} must not infer course_type from notes`)
  }
})
