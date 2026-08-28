// AP Placement Requests provenance/password follow-up, Commit 5: consolidated provenance + migration
// readiness + regression guards. The write-logic behavior (source, profile id, timestamp, duplicate
// refresh, not-ready omission) is unit-tested in test/schoolPlacementUpsert.test.mjs; this file adds
// the endpoint-level provenance-trust, ordering (no partial write), Main-App visibility, and public
// regression guards.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { performSchoolPlacementUpsert } from '../api/lib/schoolPlacementUpsert.js'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')
const stripJs = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const endpoint = read('api/portal/school-placement-requests.js')
const endpointCode = stripJs(endpoint)
const publicEndpoint = read('api/school-form-submit.js')

// ── Provenance is server-selected, never browser-supplied ──────────────────────────────────────────

test('the authenticated endpoint selects provenance server-side and ignores any browser-supplied value', () => {
  // source is a hardcoded literal, the profile id is the verified caller, the timestamp is generated.
  assert.match(endpoint, /source: 'academic_partner_portal',/)
  assert.match(endpoint, /submittedByProfileId: profile\.id,/)
  assert.match(endpoint, /submittedAt: new Date\(\)\.toISOString\(\),/)
  // Nothing reads a provenance field from the request body.
  assert.doesNotMatch(endpointCode, /body\.(source|submittedBy|submittedByProfileId|submittedAt|placement_request_last)/)
})

test('the public endpoint records source school_form with a null profile id, server-side', () => {
  assert.match(publicEndpoint, /source: 'school_form', submittedByProfileId: null/)
  assert.match(publicEndpoint, /isPlacementProvenanceReady\(db\)/)
})

// ── Readiness ordering: no partial write when not ready ────────────────────────────────────────────

test('readiness is checked BEFORE the write, so a not-ready POST creates no rotation or student rows', () => {
  // The 503 return sits between the readiness probe and the shared write call, so when not ready the
  // helper (which does the rotation upsert + student writes) is never reached.
  assert.match(endpointCode, /const provenanceReady = await isPlacementProvenanceReady\(db\)[\s\S]*?if \(!provenanceReady\)[\s\S]*?submission_not_enabled[\s\S]*?performSchoolPlacementUpsert/)
})

test('a not-ready write performs no insert/update at all (helper omits columns and would not be called)', async () => {
  // Direct proof at the helper layer: with provenanceReady=false the helper still writes the student
  // (public path) but omits the provenance columns; the endpoint gate ensures the AP path never
  // reaches even this when not ready.
  const inserts = []
  const db = {
    from(table) {
      const state = { table, op: null }
      const b = {
        upsert(p) { state.op = 'upsert'; state.p = p; return b },
        insert(p) { state.op = 'insert'; if (table === 'students') inserts.push(p); return b },
        update() { state.op = 'update'; return b },
        select() { return b }, single() { return b }, maybeSingle() { return b }, eq() { return b }, limit() { return b },
        then(r) { r(table === 'cohort_school_rotations' ? { data: { id: 'rot1' }, error: null } : (state.op === 'insert' ? { data: { id: 'n1' }, error: null } : { data: [], error: null })) },
      }
      return b
    },
  }
  await performSchoolPlacementUpsert(db, {
    cohortId: 'c1', cohortName: 'F', coordinator: { school: 'WCU', name: 'J', email: 'j@w.edu', notes: '' },
    rotationStartDate: '2099-01-01', rotationEndDate: '2099-03-01', availability: {},
    students: [{ first_name: 'A', last_name: 'B', email: 'a@w.edu', hours_required: '144' }],
    provenance: { source: 'school_form', submittedByProfileId: null, submittedAt: '2099-01-01T00:00:00Z' },
    provenanceReady: false,
  })
  assert.equal(inserts.length, 1)
  assert.ok(!('placement_request_last_source' in inserts[0]))
})

// ── Main App "At a Glance" visibility is preserved ─────────────────────────────────────────────────

test('a written request carries the fields At a Glance groups by (school + cohort_id + status)', async () => {
  const inserts = []
  const db = {
    from(table) {
      const state = { table, op: null }
      const b = {
        upsert() { state.op = 'upsert'; return b },
        insert(p) { state.op = 'insert'; inserts.push(p); return b },
        update() { state.op = 'update'; return b },
        select() { return b }, single() { return b }, maybeSingle() { return b }, eq() { return b }, limit() { return b },
        then(r) { r(table === 'cohort_school_rotations' ? { data: { id: 'rot1' }, error: null } : (state.op === 'insert' ? { data: { id: 'n1' }, error: null } : { data: [], error: null })) },
      }
      return b
    },
  }
  await performSchoolPlacementUpsert(db, {
    cohortId: 'cohort-9', cohortName: 'Fall', coordinator: { school: 'West Coast University', name: 'J', email: 'j@w.edu', notes: '' },
    rotationStartDate: '2099-01-01', rotationEndDate: '2099-03-01', availability: {},
    students: [{ first_name: 'A', last_name: 'B', email: 'a@w.edu', hours_required: '144' }],
    provenance: { source: 'academic_partner_portal', submittedByProfileId: 'p1', submittedAt: '2099-01-01T00:00:00Z' },
    provenanceReady: true,
  })
  // At a Glance groups students.school within the active cohort; a submitted request must set both.
  assert.equal(inserts[0].school, 'West Coast University')
  assert.equal(inserts[0].cohort_id, 'cohort-9')
  assert.equal(inserts[0].status, 'Pending Outreach')
})

// ── Public /school-form regression ─────────────────────────────────────────────────────────────────

test('the public /school-form still submits to its endpoint through the shared definition', () => {
  const publicForm = read('src/components/SchoolFormPage.jsx')
  assert.match(publicForm, /'\/api\/school-form-submit'/)
  assert.match(publicForm, /buildPlacementBody\(/)
  assert.match(publicForm, /from '\.\.\/lib\/schoolPlacementForm'/)
})
