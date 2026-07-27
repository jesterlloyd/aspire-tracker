// Portal context convergence, Commit 2: canonical school-scoped cohort availability. Proves the
// server helper returns the cohorts a school may see INDEPENDENT of the roster (so an open-but-empty
// accepting cohort appears), respects cohort-restricted scopes, and keeps WCU campuses isolated.

import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveSchoolScopedCohorts } from '../api/lib/schoolScope.js'

// Minimal mock: cohorts come via .select().order(); rotations via .select() awaited directly.
function makeDb({ cohorts = [], rotations = [] } = {}) {
  function from(table) {
    const b = {
      select() { return b },
      order() { return Promise.resolve(table === 'cohorts' ? { data: cohorts, error: null } : { data: [], error: null }) },
      then(res) { res(table === 'cohort_school_rotations' ? { data: rotations, error: null } : { data: [], error: null }) },
    }
    return b
  }
  return { from }
}

const cohorts = [
  { id: 'fall', name: 'Fall 2026', status: 'Planning', start_date: '', end_date: '', accepting_submissions: true, created_at: '2026-05-01' },
  { id: 'summer', name: 'Summer 2026', status: 'Active', start_date: '', end_date: '', accepting_submissions: false, created_at: '2026-02-01' },
  { id: 'fall25', name: 'Fall 2025', status: 'Completed', start_date: '', end_date: '', accepting_submissions: false, created_at: '2025-08-01' },
]

test('an accepting cohort with ZERO students appears for an unrestricted school scope', async () => {
  const db = makeDb({ cohorts, rotations: [] })
  const scopes = [{ school_key: 'West Coast University Anaheim', cohort_id: null }]
  const map = await resolveSchoolScopedCohorts(db, scopes, [])  // no matched students
  const ids = (map.get('West Coast University Anaheim') || []).map(c => c.id)
  assert.ok(ids.includes('fall'), 'the Planning + Accepting Fall cohort is available even with no students')
})

test('rotation-linked cohorts are included, matched by EXACT normalized school name (WCU isolated)', async () => {
  const rotations = [
    { cohort_id: 'summer', school_name: 'West Coast University Anaheim' },
    { cohort_id: 'fall25', school_name: 'West Coast University North Hollywood' },  // a DIFFERENT campus
  ]
  const db = makeDb({ cohorts, rotations })
  const scopes = [{ school_key: 'West Coast University Anaheim', cohort_id: null }]
  const map = await resolveSchoolScopedCohorts(db, scopes, [])
  const ids = (map.get('West Coast University Anaheim') || []).map(c => c.id)
  assert.ok(ids.includes('summer'), 'Anaheim rotation-linked cohort included')
  assert.ok(!ids.includes('fall25'), 'North Hollywood rotation must NOT leak into the Anaheim scope')
})

test('a cohort-restricted scope sees ONLY its cohort (not accepting/rotation cohorts)', async () => {
  const db = makeDb({ cohorts, rotations: [{ cohort_id: 'summer', school_name: 'Mount Saint Mary' }] })
  const scopes = [{ school_key: 'Mount Saint Mary', cohort_id: 'summer' }]
  const map = await resolveSchoolScopedCohorts(db, scopes, [])
  assert.deepEqual((map.get('Mount Saint Mary') || []).map(c => c.id), ['summer'])
})

test('cohorts are returned newest-first (endpoint order) and carry the state fields', async () => {
  const db = makeDb({ cohorts, rotations: [] })
  const scopes = [{ school_key: 'West Coast University Anaheim', cohort_id: null }]
  const map = await resolveSchoolScopedCohorts(db, scopes, [])
  const list = map.get('West Coast University Anaheim') || []
  // Only 'fall' is accepting and unrestricted-scope includes accepting cohorts; order preserved.
  assert.equal(list[0].id, 'fall')
  assert.equal(list[0].status, 'Planning')
  assert.equal(list[0].accepting_submissions, true)
})
