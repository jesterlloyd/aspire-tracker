// AP Placement Requests, Commit 3: the shared canonical write helper (api/lib/schoolPlacementUpsert.js)
// used by BOTH the public /school-form endpoint and the (gated) authenticated Academic Partner
// endpoint, so the write path cannot drift. These are real unit tests over the write LOGIC, driven
// by a small mock of the Supabase query builder: duplicate-safe insert/update, coordinator-owned
// fields only, submitted_via provenance, and skip-incomplete behavior.

import test from 'node:test'
import assert from 'node:assert/strict'
import { performSchoolPlacementUpsert } from '../api/lib/schoolPlacementUpsert.js'

// A minimal mock of the chained Supabase client used by the helper. It records inserts/updates and
// resolves each terminal chain based on (table, operation).
function makeDb({ existing = [] } = {}) {
  const inserts = []
  const updates = []
  const events = []
  let insertCount = 0
  function from(table) {
    const state = { table, op: null }
    const builder = {
      upsert(p) { state.op = 'upsert'; state.payload = p; return builder },
      insert(p) { state.op = 'insert'; state.payload = p; return builder },
      update(p) { state.op = 'update'; state.payload = p; return builder },
      select() { state.select = true; return builder },
      single() { state.single = true; return builder },
      eq() { return builder },
      then(resolve) { resolve(result()); },
    }
    function result() {
      if (table === 'cohort_school_rotations' && state.op === 'upsert') return { data: { id: 'rot1' }, error: null }
      if (table === 'students' && state.op === null) return { data: existing, error: null }
      if (table === 'students' && state.op === 'insert') {
        insertCount += 1; inserts.push(state.payload); return { data: { id: `new${insertCount}` }, error: null }
      }
      if (table === 'students' && state.op === 'update') { updates.push(state.payload); return { error: null } }
      if (table === 'program_events' && state.op === 'insert') { events.push(state.payload); return { error: null } }
      return { data: null, error: null }
    }
    return builder
  }
  return { from, _inserts: inserts, _updates: updates, _events: events }
}

const baseParams = (overrides = {}) => ({
  cohortId: 'c1', cohortName: 'Fall 2099',
  coordinator: { school: ' West Coast University ', name: ' Jane ', email: ' jane@wcu.edu ', notes: ' see notes ' },
  rotationStartDate: '2099-01-06', rotationEndDate: '2099-03-06',
  availability: { unavailable_weekdays: ['Mon'], scheduling_notes: 'x' },
  students: [{ first_name: ' Ann ', last_name: ' Lee ', email: ' ANN@wcu.edu ', phone: '555', program_type: 'MECN', hours_required: '144', estimated_graduation_date: '' }],
  ...overrides,
})

test('a new student is inserted with pathway defaults and the submitted_via provenance', async () => {
  const db = makeDb({ existing: [] })
  const r = await performSchoolPlacementUpsert(db, baseParams({ submittedVia: 'academic_partner_portal' }))
  assert.equal(r.error, null)
  assert.equal(r.rotationId, 'rot1')
  assert.deepEqual(r.added.map(a => a.name), ['Ann Lee'])
  assert.equal(r.updated.length, 0)
  const ins = db._inserts[0]
  assert.equal(ins.submitted_via, 'academic_partner_portal')  // origin recorded
  assert.equal(ins.status, 'Pending Outreach')
  assert.equal(ins.school, 'West Coast University')           // trimmed
  assert.equal(ins.school_email, 'ann@wcu.edu')               // normalized
  assert.equal(ins.hours_required, 144)                       // parsed int
  assert.equal(ins.cohort_school_rotation_id, 'rot1')
  // The rotation_created event is logged for the first new student.
  assert.equal(db._events.length, 1)
  assert.equal(db._events[0].event_type, 'rotation_created')
})

test('a duplicate (case-insensitive email) updates ONLY coordinator-owned fields and preserves submitted_via', async () => {
  const db = makeDb({ existing: [{ id: 'e1', school_email: 'ann@wcu.edu', submitted_via: 'student_form' }] })
  const r = await performSchoolPlacementUpsert(db, baseParams({ submittedVia: 'academic_partner_portal' }))
  assert.equal(r.added.length, 0)
  assert.deepEqual(r.updated.map(u => u.name), ['Ann Lee'])
  const upd = db._updates[0]
  // Coordinator-owned seed fields ARE updated.
  assert.equal(upd.first_name, 'Ann')
  assert.equal(upd.school_coordinator_name, 'Jane')
  assert.equal(upd.hours_required, 144)
  // Student-owned and ASPIRE-owned fields are NEVER written on an update.
  for (const forbidden of ['phone', 'status', 'interview_outcome', 'ngrp_outcome', 'personal_email', 'headshot_url', 'matched_unit_id', 'preceptor_id']) {
    assert.ok(!(forbidden in upd), `update must not write ${forbidden}`)
  }
  // Existing submitted_via='student_form' is preserved (no submitted_via key written).
  assert.ok(!('submitted_via' in upd), 'must not relabel an existing submitted_via')
})

test('a duplicate with no prior submitted_via receives the caller origin', async () => {
  const db = makeDb({ existing: [{ id: 'e1', school_email: 'ann@wcu.edu', submitted_via: null }] })
  await performSchoolPlacementUpsert(db, baseParams({ submittedVia: 'academic_partner_portal' }))
  assert.equal(db._updates[0].submitted_via, 'academic_partner_portal')
})

test('incomplete student rows are skipped, not written', async () => {
  const db = makeDb({ existing: [] })
  const r = await performSchoolPlacementUpsert(db, baseParams({
    students: [{ first_name: 'No', last_name: '', email: '' }, { first_name: 'Ann', last_name: 'Lee', email: 'ann@wcu.edu', hours_required: '144' }],
  }))
  assert.equal(r.skipped.length, 1)
  assert.equal(r.added.length, 1)
  assert.equal(db._inserts.length, 1)
})

test('the public school-form endpoint delegates to the shared helper (no inline write)', async () => {
  const { readFileSync } = await import('node:fs')
  const { fileURLToPath } = await import('node:url')
  const { dirname, join } = await import('node:path')
  const here = dirname(fileURLToPath(import.meta.url))
  const src = readFileSync(join(here, '..', 'api/school-form-submit.js'), 'utf8')
  assert.match(src, /performSchoolPlacementUpsert/)
  assert.match(src, /submittedVia: 'school_form'/)
  // The inline student write is gone from the endpoint (it lives only in the shared helper).
  const stripped = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  assert.doesNotMatch(stripped, /\.from\('students'\)\s*\.insert\(/)
})
