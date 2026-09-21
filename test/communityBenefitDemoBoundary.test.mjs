// test/communityBenefitDemoBoundary.test.mjs
//
// DEMO-DATA-1 (Owner, 2026-09-21): "In community benefit, the Demo students are included.
// why? we're not supposed to mix real and fake data."
//
// The report is one population, always. These tests run the REAL loader against a fake
// Supabase client that applies the filters it is given, over a database holding both
// populations, and hold it to:
//   1. an unscoped client (what the staff endpoints used to pass, and what a request
//      without x-aspire-demo still produces) reads REAL rows only;
//   2. a client scoped to the demo reads demo rows only;
//   3. capstone hours, which have no is_demo, follow their cohort;
//   4. every endpoint that builds this report is inside the boundary.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fetchCommunityBenefitInputs, capstoneRowsInScope } from '../api/lib/communityBenefitData.js'
import { scopedServiceDb } from '../lib/server/demoScope.js'

const read = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

// Two cohorts, one real and one demo, each with a student, a rotation, a shift log, a
// primary preceptor assignment and a preceptor; three capstone rows (real cohort, demo
// cohort, school-level with no cohort).
const DB = {
  cohorts: [
    { id: 'c-real', name: 'Summer 2026', is_demo: false },
    { id: 'c-demo', name: 'Demo Cohort', is_demo: true },
  ],
  students: [
    { id: 's-real', first_name: 'Real', last_name: 'Student', status: 'Completed', cohort_id: 'c-real', school: 'CSUN', is_demo: false },
    { id: 's-demo', first_name: 'Demo', last_name: 'Student', status: 'Completed', cohort_id: 'c-demo', school: 'CSUN', is_demo: true },
  ],
  cohort_school_rotations: [
    { id: 'r-real', cohort_id: 'c-real', school_name: 'CSUN', is_demo: false },
    { id: 'r-demo', cohort_id: 'c-demo', school_name: 'CSUN', is_demo: true },
  ],
  student_shift_logs: [
    { id: 'l-real', student_id: 's-real', total_hours: 12, status: 'Approved', lifecycle_state: 'completed', is_demo: false },
    { id: 'l-demo', student_id: 's-demo', total_hours: 12, status: 'Approved', lifecycle_state: 'completed', is_demo: true },
  ],
  student_preceptor_assignments: [
    { id: 'a-real', student_id: 's-real', preceptor_id: 'p-real', role: 'primary', status: 'active', is_demo: false },
    { id: 'a-demo', student_id: 's-demo', preceptor_id: 'p-demo', role: 'primary', status: 'active', is_demo: true },
  ],
  preceptors: [
    { id: 'p-real', full_name: 'Real Preceptor', is_demo: false },
    { id: 'p-demo', full_name: 'Demo Preceptor', is_demo: true },
  ],
  community_benefit_rates: [{ id: 'rate-1', fiscal_year: 2027, category: 'standard', hourly_rate: 50 }],
  community_benefit_capstone_hours: [
    { id: 'cap-real', fiscal_year: 2027, school_name: 'CSUN', cohort_id: 'c-real', hours: 5 },
    { id: 'cap-demo', fiscal_year: 2027, school_name: 'CSUN', cohort_id: 'c-demo', hours: 7 },
    { id: 'cap-school', fiscal_year: 2027, school_name: 'CSUN', cohort_id: null, hours: 3 },
  ],
}

// A PostgREST-shaped fake: every builder method the loader or the boundary calls, and
// .range() applies the eq/in filters it was given.
function fakeClient() {
  const calls = []
  const client = {
    from(table) {
      const filters = []
      const qb = {
        select() { return qb },
        update() { return qb },
        delete() { return qb },
        insert() { return qb },
        upsert() { return qb },
        order() { return qb },
        eq(col, val) { filters.push(r => r[col] === val); calls.push({ table, col, val }); return qb },
        in(col, vals) { filters.push(r => vals.includes(r[col])); return qb },
        async range() { return { data: (DB[table] || []).filter(r => filters.every(f => f(r))), error: null } },
      }
      return qb
    },
  }
  return { client, calls }
}

test('an unscoped client reads real rows only: no demo student, cohort, hour or preceptor', async () => {
  const { client, calls } = fakeClient()
  const inputs = await fetchCommunityBenefitInputs(client)
  assert.deepEqual(inputs.students.map(s => s.id), ['s-real'])
  assert.deepEqual(inputs.cohorts.map(c => c.id), ['c-real'])
  assert.deepEqual(inputs.rotations.map(r => r.id), ['r-real'])
  assert.deepEqual([...inputs.preceptorNameById.values()].map(p => p.name), ['Real Preceptor'])
  assert.deepEqual(inputs.capstoneRows.map(c => c.id), ['cap-real', 'cap-school'])
  // The filter was asked of the database, not applied after the fact.
  for (const t of ['students', 'cohorts', 'cohort_school_rotations', 'student_shift_logs', 'student_preceptor_assignments', 'preceptors']) {
    assert.ok(calls.some(c => c.table === t && c.col === 'is_demo' && c.val === false), `${t} is read with is_demo = false`)
  }
})

test('a client scoped to the demo reads demo rows only, and no real capstone hours', async () => {
  const { client } = fakeClient()
  const inputs = await fetchCommunityBenefitInputs(scopedServiceDb(client, true))
  assert.deepEqual(inputs.students.map(s => s.id), ['s-demo'])
  assert.deepEqual(inputs.cohorts.map(c => c.id), ['c-demo'])
  assert.deepEqual([...inputs.preceptorNameById.values()].map(p => p.name), ['Demo Preceptor'])
  assert.deepEqual(inputs.capstoneRows.map(c => c.id), ['cap-demo'])
})

test('a client already scoped to real rows keeps that scope', async () => {
  const { client } = fakeClient()
  const inputs = await fetchCommunityBenefitInputs(scopedServiceDb(client, false))
  assert.deepEqual(inputs.students.map(s => s.id), ['s-real'])
  assert.deepEqual(inputs.capstoneRows.map(c => c.id), ['cap-real', 'cap-school'])
})

test('capstone hours follow their cohort; a school-level row is real', () => {
  const rows = DB.community_benefit_capstone_hours
  assert.deepEqual(capstoneRowsInScope(rows, ['c-real'], false).map(r => r.id), ['cap-real', 'cap-school'])
  assert.deepEqual(capstoneRowsInScope(rows, new Set(['c-demo']), true).map(r => r.id), ['cap-demo'])
  assert.deepEqual(capstoneRowsInScope(rows, [], null).map(r => r.id), ['cap-real', 'cap-demo', 'cap-school'],
    'a client with no boundary at all is the only case that keeps everything')
  assert.deepEqual(capstoneRowsInScope(null, [], false), [])
})

test('every endpoint that builds this report is inside the boundary', () => {
  for (const f of ['api/community-benefit-report.js', 'api/community-benefit-export.js']) {
    const src = read(f)
    assert.match(src, /import \{ serviceDbForRequest \} from '\.\.\/lib\/server\/demoScope\.js'/, f)
    assert.match(src, /db = serviceDbForRequest\(makeDb\(\), req\)/, f)
    assert.doesNotMatch(src, /db = makeDb\(\)(?!,)/, `${f} never reads through a raw client`)
  }
  // The portal's two copies already resolve their client through the boundary.
  const scope = read('api/lib/nursingAcademicScope.js')
  assert.match(scope, /db = serviceDbForRequest\(getServiceDb\(\), req\)/)
  for (const f of ['api/portal/academics-community-benefit.js', 'api/portal/academics-benefit-export.js']) {
    assert.match(read(f), /fetchInputs\(auth\.db\)/, f)
  }
  // And the loader itself refuses to read unscoped.
  const loader = read('api/lib/communityBenefitData.js')
  assert.match(loader, /const db = demoScopeOf\(client\) === null \? scopedServiceDb\(client, false\) : client/)
})
