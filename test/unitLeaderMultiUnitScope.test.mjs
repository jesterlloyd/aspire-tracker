// MULTI-UNIT-STUDENT-PLACEMENTS-2: Unit Leader authorization over live
// assignments, EXECUTED against the real resolver with a substituted database.
//
// The security claims proved here, each with Emi's real shape where it applies:
//   • a student with two live units appears in BOTH units' rosters;
//   • HISTORICAL assignments never grant access - Emi's ended 6 NE row makes
//     her invisible to the 6 NE leader;
//   • cross-cohort scopes and out-of-scope units authorize nothing;
//   • single-unit students behave exactly as before (one entry, primary unit).
//
// Run: node --test test/unitLeaderMultiUnitScope.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  resolveUnitScopedStudents, authorizeStudentForUnitLeader, LIVE_ASSIGNMENT_STATUSES,
} from '../api/lib/unitLeaderScope.js'

const COHORT = 'c0000000-0000-4000-8000-000000000001'
const OTHER_COHORT = 'c0000000-0000-4000-8000-000000000002'

const EMI = 's0000000-0000-4000-8000-00000000e311'
const SOLO = 's0000000-0000-4000-8000-000000050105'

/** Substituted db: assignments + students, chainable like supabase-js. */
function makeDb({ assignments = [], students = [] } = {}) {
  const calls = []
  return {
    calls,
    from(table) {
      const q = { table, filters: {} }
      calls.push(q)
      const api = {
        select() { return api },
        in(field, values) { q.filters[field] = values; return api },
        eq(field, value) { q.filters[field] = [value]; return api },
        then(res, rej) {
          let rows
          if (table === 'student_unit_assignments') {
            rows = assignments.filter(a =>
              (!q.filters.unit_key || q.filters.unit_key.includes(a.unit_key)) &&
              (!q.filters.status || q.filters.status.includes(a.status)))
          } else if (table === 'students') {
            rows = students.filter(s =>
              (!q.filters.id || q.filters.id.includes(s.id)) &&
              (!q.filters.status || q.filters.status.includes(s.status)))
          } else rows = []
          return Promise.resolve({ data: rows, error: null }).then(res, rej)
        },
      }
      return api
    },
  }
}

const student = (id, over = {}) => ({
  id, first_name: 'F', last_name: 'L', school: 'School', status: 'Active Rotation',
  matched_unit_id: 'legacy-not-used', rotation_end_date: null, rotation_completed_at: null,
  ...over,
})

/** Emi's real shape: PACU live primary; 6 NE ENDED Jul 8 - Aug 6. */
const EMI_WORLD = {
  assignments: [
    { student_id: EMI, cohort_id: COHORT, unit_key: 'PACU', role: 'primary', status: 'active' },
    { student_id: EMI, cohort_id: COHORT, unit_key: '6 NE', role: 'additional', status: 'ended' },
    { student_id: SOLO, cohort_id: COHORT, unit_key: '6 NE', role: 'primary', status: 'active' },
  ],
  students: [student(EMI), student(SOLO)],
}

const scope = (unit_key, cohort_id = COHORT) => ({ unit_key, cohort_id })

// ── Multi-unit visibility ───────────────────────────────────────────────────

test('a student with TWO live units appears in BOTH rosters, once per unit', async () => {
  const db = makeDb({
    assignments: [
      { student_id: EMI, cohort_id: COHORT, unit_key: 'PACU', role: 'primary', status: 'active' },
      { student_id: EMI, cohort_id: COHORT, unit_key: '6 NE', role: 'additional', status: 'active' },
    ],
    students: [student(EMI)],
  })
  const { students } = await resolveUnitScopedStudents(db, [scope('PACU'), scope('6 NE')])
  assert.equal(students.length, 2, 'one entry per (student, unit)')
  assert.deepEqual(students.map(s => s.unit_key).sort(), ['6 NE', 'PACU'])
  assert.equal(students[0].unit_key, 'PACU', 'the PRIMARY entry sorts first')
  assert.ok(students.every(s => s.id === EMI))
})

test('EMI TODAY: visible to the PACU leader, INVISIBLE to the 6 NE leader (her 6 NE row is history)', async () => {
  const pacu = await resolveUnitScopedStudents(makeDb(EMI_WORLD), [scope('PACU')])
  assert.deepEqual(pacu.students.map(s => [s.id, s.unit_key]), [[EMI, 'PACU']])

  const sixNe = await resolveUnitScopedStudents(makeDb(EMI_WORLD), [scope('6 NE')])
  assert.deepEqual(sixNe.students.map(s => s.id), [SOLO],
    "the 6 NE roster holds only its live student - Emi's ENDED assignment grants nothing")
})

test('HISTORICAL ASSIGNMENTS NEVER GRANT ACCESS: ended and removed are excluded in the query itself', async () => {
  const db = makeDb({
    assignments: [
      { student_id: EMI, cohort_id: COHORT, unit_key: '6 NE', role: 'additional', status: 'ended' },
      { student_id: EMI, cohort_id: COHORT, unit_key: 'PACU', role: 'primary', status: 'removed' },
    ],
    students: [student(EMI)],
  })
  const { students } = await resolveUnitScopedStudents(db, [scope('PACU'), scope('6 NE')])
  assert.deepEqual(students, [], 'no live assignment, no visibility - anywhere')
  // And the guarantee is structural: the db was ASKED for live statuses only.
  const q = db.calls.find(c => c.table === 'student_unit_assignments')
  assert.deepEqual(q.filters.status, ['planned', 'active'])
  assert.deepEqual([...LIVE_ASSIGNMENT_STATUSES], ['planned', 'active'])
})

test('single-unit students behave exactly as before: one entry, their one unit', async () => {
  const { students } = await resolveUnitScopedStudents(makeDb(EMI_WORLD), [scope('6 NE')])
  assert.equal(students.length, 1)
  assert.equal(students[0].id, SOLO)
  assert.equal(students[0].unit_key, '6 NE')
  assert.equal(students[0].bucket, 'active')
})

// ── Scope discipline ────────────────────────────────────────────────────────

test('a cross-cohort scope authorizes nothing: the assignment cohort must be covered', async () => {
  const { students } = await resolveUnitScopedStudents(
    makeDb(EMI_WORLD), [scope('PACU', OTHER_COHORT)])
  assert.deepEqual(students, [], "a PACU scope for another cohort cannot see this cohort's PACU student")
})

test('an all-cohorts scope (cohort_id null) still works', async () => {
  const { students } = await resolveUnitScopedStudents(
    makeDb(EMI_WORLD), [{ unit_key: 'PACU', cohort_id: null }])
  assert.deepEqual(students.map(s => s.id), [EMI])
})

test('narrowing to a unit outside the scope set yields the empty set, never widens', async () => {
  const { students } = await resolveUnitScopedStudents(
    makeDb(EMI_WORLD), [scope('PACU')], { unitKey: '6 NE' })
  assert.deepEqual(students, [])
})

test('planned assignments authorize (upcoming rotations are visible), per the live set', async () => {
  const db = makeDb({
    assignments: [{ student_id: SOLO, cohort_id: COHORT, unit_key: 'NICU', role: 'primary', status: 'planned' }],
    students: [student(SOLO, { status: 'Placed' })],
  })
  const { students } = await resolveUnitScopedStudents(db, [scope('NICU')])
  assert.deepEqual(students.map(s => [s.id, s.bucket]), [[SOLO, 'upcoming']])
})

// ── Single-student authorization ────────────────────────────────────────────

test('authorizeStudentForUnitLeader: allowed via ANY live scoped unit, primary context first', async () => {
  const db = makeDb({
    assignments: [
      { student_id: EMI, cohort_id: COHORT, unit_key: 'PACU', role: 'primary', status: 'active' },
      { student_id: EMI, cohort_id: COHORT, unit_key: '6 NE', role: 'additional', status: 'active' },
    ],
    students: [student(EMI)],
  })
  const both = await authorizeStudentForUnitLeader(db, [scope('PACU'), scope('6 NE')], EMI)
  assert.equal(both.allowed, true)
  assert.equal(both.unitKey, 'PACU', 'primary-first ordering gives the primary context')

  const onlyAdditional = await authorizeStudentForUnitLeader(makeDb({
    assignments: [{ student_id: EMI, cohort_id: COHORT, unit_key: '6 NE', role: 'additional', status: 'active' }],
    students: [student(EMI)],
  }), [scope('6 NE')], EMI)
  assert.equal(onlyAdditional.allowed, true, "an additional unit's leader may see their student")
  assert.equal(onlyAdditional.unitKey, '6 NE')
})

test('authorizeStudentForUnitLeader stays fail-closed: history-only and out-of-scope are identical denials', async () => {
  const history = await authorizeStudentForUnitLeader(makeDb(EMI_WORLD), [scope('6 NE')], EMI)
  assert.deepEqual(history, { allowed: false }, 'her ended 6 NE row does not authorize her 6 NE detail view')
  const missing = await authorizeStudentForUnitLeader(makeDb(EMI_WORLD), [scope('6 NE')], 'nonexistent-id')
  assert.deepEqual(missing, { allowed: false }, 'indistinguishable from a missing student')
})

// ── Negative control ────────────────────────────────────────────────────────

test('NEGATIVE CONTROL: widening the live set would change what these tests see', async () => {
  // If someone added 'ended' to LIVE_ASSIGNMENT_STATUSES, the fake db would
  // return Emi's ended row and the invisibility assertions above would fail.
  const db = makeDb(EMI_WORLD)
  await resolveUnitScopedStudents(db, [scope('6 NE')])
  const q = db.calls.find(c => c.table === 'student_unit_assignments')
  assert.ok(!q.filters.status.includes('ended') && !q.filters.status.includes('removed'),
    'the query itself is the guarantee this suite depends on')
})
