import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildUnitPreceptorCollections,
  createUnitPreceptorsHandler,
} from '../api/portal/unit-preceptors.js'

const STUDENTS = [
  { id: 'student-in', first_name: 'Ana', last_name: 'Lee', unit_key: '5N' },
]

const PRECEPTORS = [
  {
    id: 'home-unit', full_name: 'Home Unit Nurse', email: 'home@cshs.org', phone: '555-0101',
    unit_id: 'unit-5n', unit_name: '5N', shift_type: 'Day', is_active: true,
  },
  {
    id: 'cross-unit', full_name: 'Cross Unit Nurse', email: 'cross@cshs.org', phone: null,
    unit_id: 'unit-6n', unit_name: '6N', shift_type: 'Night', is_active: true,
  },
  {
    id: 'inactive-home', full_name: 'Inactive Nurse', email: 'inactive@cshs.org', phone: null,
    unit_id: 'unit-5n', unit_name: '5N', shift_type: 'Variable', is_active: false,
  },
]

const ASSIGNMENTS = [
  {
    id: 'assignment-in', student_id: 'student-in', preceptor_id: 'cross-unit',
    role: 'coverage', start_date: '2026-07-01', end_date: null, status: 'active',
  },
  {
    id: 'assignment-out', student_id: 'student-out', preceptor_id: 'cross-unit',
    role: 'primary', start_date: '2026-07-01', end_date: null, status: 'active',
  },
]

function responseRecorder() {
  return {
    statusCode: null,
    payload: null,
    headers: {},
    setHeader(name, value) { this.headers[name] = value },
    status(code) { this.statusCode = code; return this },
    json(payload) { this.payload = payload; return this },
    end() { return this },
  }
}

function authorizedHandler(overrides = {}) {
  return createUnitPreceptorsHandler({
    verifyCaller: async () => ({
      ok: true, db: {}, scopes: [{ unit_key: '5N', cohort_id: null }], unitKeys: ['5N'],
    }),
    resolveStudents: async () => ({ students: STUDENTS, unitKeys: ['5N'] }),
    fetchPreceptors: async () => PRECEPTORS,
    fetchAssignments: async () => ASSIGNMENTS,
    ...overrides,
  })
}

test('authorized request returns a scoped roster and exact assignment ids', async () => {
  const res = responseRecorder()
  await authorizedHandler()({ method: 'GET', headers: {} }, res)

  assert.equal(res.statusCode, 200)
  assert.deepEqual(res.payload.roster.map(p => p.id), ['cross-unit', 'home-unit', 'inactive-home'])
  const cross = res.payload.roster.find(p => p.id === 'cross-unit')
  assert.equal(cross.assignments.length, 1)
  assert.equal(cross.assignments[0].id, 'assignment-in')
  assert.equal(cross.assignments[0].role, 'Coverage')
  assert.equal(cross.assignments[0].student_name, 'Ana Lee')
})

test('an unassigned canonical preceptor is included through its scoped home unit', () => {
  const { roster } = buildUnitPreceptorCollections({
    preceptors: PRECEPTORS, assignments: [], students: STUDENTS, unitKeys: ['5N'],
  })
  const home = roster.find(p => p.id === 'home-unit')
  assert.ok(home)
  assert.equal(home.active_assignment_count, 0)
  assert.deepEqual(home.assignments, [])
})

test('a cross-unit preceptor is associated through an in-scope student', () => {
  const { roster } = buildUnitPreceptorCollections({
    preceptors: PRECEPTORS, assignments: ASSIGNMENTS, students: STUDENTS, unitKeys: ['5N'],
  })
  const cross = roster.find(p => p.id === 'cross-unit')
  assert.ok(cross)
  assert.equal(cross.home_unit.name, '6N')
  assert.equal(cross.cross_unit_association, true)
})

test('out-of-scope student assignments never reach the response', () => {
  const { roster } = buildUnitPreceptorCollections({
    preceptors: PRECEPTORS, assignments: ASSIGNMENTS, students: STUDENTS, unitKeys: ['5N'],
  })
  const serialized = JSON.stringify(roster)
  assert.doesNotMatch(serialized, /student-out|assignment-out/)
})

test('candidate records contain only safe selector fields and exclude inactive preceptors', () => {
  const { candidates } = buildUnitPreceptorCollections({
    preceptors: PRECEPTORS, assignments: ASSIGNMENTS, students: STUDENTS, unitKeys: ['5N'],
  })
  assert.deepEqual(candidates.map(p => p.id), ['cross-unit', 'home-unit'])
  assert.deepEqual(Object.keys(candidates[0]).sort(), ['full_name', 'home_unit', 'id', 'shift'])
  assert.doesNotMatch(JSON.stringify(candidates), /email|phone|assignments|student/)
})

test('a caller without active Unit Leader authority is denied before data access', async () => {
  let reads = 0
  const handler = createUnitPreceptorsHandler({
    verifyCaller: async () => ({ ok: false, status: 403, reason: 'unit_leader_role_required' }),
    resolveStudents: async () => { reads += 1; return { students: [] } },
    fetchPreceptors: async () => { reads += 1; return [] },
    fetchAssignments: async () => { reads += 1; return [] },
  })
  const res = responseRecorder()
  await handler({ method: 'GET', headers: {} }, res)
  assert.equal(res.statusCode, 403)
  assert.deepEqual(res.payload, { error: 'unit_leader_role_required' })
  assert.equal(reads, 0)
})

test('an active Unit Leader with no active unit scope receives an empty authorized set', async () => {
  let reads = 0
  const handler = createUnitPreceptorsHandler({
    verifyCaller: async () => ({ ok: true, db: {}, scopes: [], unitKeys: [] }),
    resolveStudents: async () => { reads += 1; return { students: [] } },
    fetchPreceptors: async () => { reads += 1; return [] },
    fetchAssignments: async () => { reads += 1; return [] },
  })
  const res = responseRecorder()
  await handler({ method: 'GET', headers: {} }, res)
  assert.equal(res.statusCode, 200)
  assert.deepEqual(res.payload, { roster: [], candidates: [] })
  assert.equal(reads, 0)
})
