// AP Placement Requests, Commit 3: the shared canonical write helper (api/lib/schoolPlacementUpsert.js)
// used by BOTH the public /school-form endpoint and the (gated) authenticated Academic Partner
// endpoint, so the write path cannot drift. These are real unit tests over the write LOGIC, driven
// by a small mock of the Supabase query builder: duplicate-safe insert/update, coordinator-owned
// fields only, submitted_via provenance, and skip-incomplete behavior.

import test from 'node:test'
import assert from 'node:assert/strict'
import { performSchoolPlacementUpsert, isPlacementProvenanceReady } from '../api/lib/schoolPlacementUpsert.js'

const AP_PROVENANCE = { source: 'academic_partner_portal', submittedByProfileId: 'prof-1', submittedAt: '2099-01-01T00:00:00.000Z' }

// A minimal mock of the chained Supabase client used by the helper. It records inserts/updates and
// resolves each terminal chain based on (table, operation).
function makeDb({ existing = [], provenanceColumnsMissing = false, existingRotation = null } = {}) {
  const inserts = []
  const updates = []
  const events = []
  let insertCount = 0
  function from(table) {
    const state = { table, op: null, limited: false, eqd: false }
    const builder = {
      upsert(p) { state.op = 'upsert'; state.payload = p; return builder },
      insert(p) { state.op = 'insert'; state.payload = p; return builder },
      update(p) { state.op = 'update'; state.payload = p; return builder },
      select() { state.select = true; return builder },
      single() { state.single = true; return builder },
      // PLACEMENT-RESUBMIT-1: the helper now READS the stored rotation row
      // before writing, so a blank submission cannot erase stored availability.
      maybeSingle() { state.maybeSingle = true; return builder },
      eq() { state.eqd = true; return builder },
      limit() { state.limited = true; return builder },
      then(resolve) { resolve(result()); },
    }
    function result() {
      if (table === 'cohort_school_rotations' && state.op === 'upsert') return { data: { id: 'rot1' }, error: null }
      if (table === 'cohort_school_rotations' && state.op === null) return { data: existingRotation, error: null }
      // Readiness probe: select ... limit, no eq. Errors when the columns are "missing".
      if (table === 'students' && state.op === null && state.limited && !state.eqd) {
        return provenanceColumnsMissing
          ? { data: null, error: { code: '42703', message: 'column "placement_request_last_source" does not exist' } }
          : { data: [], error: null }
      }
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

test('a new student records original submitted_via AND the latest-submission provenance (when ready)', async () => {
  const db = makeDb({ existing: [] })
  const r = await performSchoolPlacementUpsert(db, baseParams({ provenance: AP_PROVENANCE, provenanceReady: true }))
  assert.equal(r.error, null)
  assert.equal(r.rotationId, 'rot1')
  assert.deepEqual(r.added.map(a => a.name), ['Ann Lee'])
  assert.equal(r.updated.length, 0)
  const ins = db._inserts[0]
  assert.equal(ins.submitted_via, 'academic_partner_portal')                      // original source
  assert.equal(ins.placement_request_last_source, 'academic_partner_portal')      // latest source
  assert.equal(ins.placement_request_last_submitted_by_profile_id, 'prof-1')       // verified profile
  assert.equal(ins.placement_request_last_submitted_at, '2099-01-01T00:00:00.000Z')// server timestamp
  assert.equal(ins.status, 'Pending Outreach')
  assert.equal(ins.school, 'West Coast University')                               // trimmed
  assert.equal(ins.school_email, 'ann@wcu.edu')                                   // normalized
  assert.equal(ins.hours_required, 144)                                          // parsed int
  assert.equal(ins.cohort_school_rotation_id, 'rot1')
  assert.equal(db._events[0].event_type, 'rotation_created')
})

test('the public path writes source school_form with a null profile id', async () => {
  const db = makeDb({ existing: [] })
  await performSchoolPlacementUpsert(db, baseParams({
    provenance: { source: 'school_form', submittedByProfileId: null, submittedAt: '2099-02-02T00:00:00.000Z' },
    provenanceReady: true,
  }))
  const ins = db._inserts[0]
  assert.equal(ins.submitted_via, 'school_form')
  assert.equal(ins.placement_request_last_source, 'school_form')
  assert.equal(ins.placement_request_last_submitted_by_profile_id, null)
})

test('before the migration (not ready), the write omits the provenance columns and still succeeds', async () => {
  const db = makeDb({ existing: [] })
  const r = await performSchoolPlacementUpsert(db, baseParams({ provenance: AP_PROVENANCE, provenanceReady: false }))
  assert.equal(r.error, null)
  assert.equal(r.added.length, 1)
  const ins = db._inserts[0]
  assert.equal(ins.submitted_via, 'academic_partner_portal')                      // origin still recorded
  for (const col of ['placement_request_last_source', 'placement_request_last_submitted_by_profile_id', 'placement_request_last_submitted_at']) {
    assert.ok(!(col in ins), `not-ready write must omit ${col}`)
  }
})

test('a duplicate updates ONLY coordinator-owned fields, preserves submitted_via, refreshes latest provenance', async () => {
  const db = makeDb({ existing: [{ id: 'e1', school_email: 'ann@wcu.edu', submitted_via: 'student_form' }] })
  const r = await performSchoolPlacementUpsert(db, baseParams({ provenance: AP_PROVENANCE, provenanceReady: true }))
  assert.equal(r.added.length, 0)
  assert.deepEqual(r.updated.map(u => u.name), ['Ann Lee'])
  const upd = db._updates[0]
  assert.equal(upd.first_name, 'Ann')
  assert.equal(upd.school_coordinator_name, 'Jane')
  assert.equal(upd.hours_required, 144)
  // Student-owned and ASPIRE-owned fields are NEVER written on an update.
  for (const forbidden of ['phone', 'status', 'interview_outcome', 'ngrp_outcome', 'personal_email', 'headshot_url', 'matched_unit_id', 'preceptor_id']) {
    assert.ok(!(forbidden in upd), `update must not write ${forbidden}`)
  }
  // Original submitted_via is preserved; latest-submission provenance IS refreshed on the update.
  assert.ok(!('submitted_via' in upd), 'must not relabel an existing submitted_via')
  assert.equal(upd.placement_request_last_source, 'academic_partner_portal')
  assert.equal(upd.placement_request_last_submitted_by_profile_id, 'prof-1')
  assert.equal(upd.placement_request_last_submitted_at, '2099-01-01T00:00:00.000Z')
})

test('a duplicate with no prior submitted_via receives the caller origin', async () => {
  const db = makeDb({ existing: [{ id: 'e1', school_email: 'ann@wcu.edu', submitted_via: null }] })
  await performSchoolPlacementUpsert(db, baseParams({ provenance: AP_PROVENANCE, provenanceReady: true }))
  assert.equal(db._updates[0].submitted_via, 'academic_partner_portal')
})

test('incomplete student rows are skipped, not written', async () => {
  const db = makeDb({ existing: [] })
  const r = await performSchoolPlacementUpsert(db, baseParams({
    students: [{ first_name: 'No', last_name: '', email: '' }, { first_name: 'Ann', last_name: 'Lee', email: 'ann@wcu.edu', hours_required: '144' }],
    provenance: { source: 'school_form', submittedByProfileId: null, submittedAt: '2099-01-01T00:00:00.000Z' },
    provenanceReady: true,
  }))
  assert.equal(r.skipped.length, 1)
  assert.equal(r.added.length, 1)
  assert.equal(db._inserts.length, 1)
})

test('isPlacementProvenanceReady is true only when the columns resolve', async () => {
  assert.equal(await isPlacementProvenanceReady(makeDb({ provenanceColumnsMissing: false })), true)
  assert.equal(await isPlacementProvenanceReady(makeDb({ provenanceColumnsMissing: true })), false)
})

test('the public school-form endpoint delegates to the shared helper (no inline write)', async () => {
  const { readFileSync } = await import('node:fs')
  const { fileURLToPath } = await import('node:url')
  const { dirname, join } = await import('node:path')
  const here = dirname(fileURLToPath(import.meta.url))
  const src = readFileSync(join(here, '..', 'api/school-form-submit.js'), 'utf8')
  assert.match(src, /performSchoolPlacementUpsert/)
  assert.match(src, /isPlacementProvenanceReady/)
  assert.match(src, /source: 'school_form', submittedByProfileId: null/)
  // The inline student write is gone from the endpoint (it lives only in the shared helper).
  const stripped = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  assert.doesNotMatch(stripped, /\.from\('students'\)\s*\.insert\(/)
})
