// SHIFT-LOG-RETURNING-1 (2026-11-03). Juliana Pilla re-joined a later cohort, so two student
// records share her school email: Fall 2026 (Not Proceeding) and Winter 2027 (Placed). The
// shift-log lookup refused every duplicate, so she could not log a shift in the portal or on
// the public page. Several matches now narrow to the one record that can log a shift.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { pickShiftLogStudent, canLogShifts } from '../api/lib/shiftLogPick.js'

const rec = (id, status, cohortStatus = 'Active') => ({ id, status, cohorts: { status: cohortStatus } })

test('a returning student resolves to the record that can log shifts', () => {
  const old = rec('fall', 'Not Proceeding')
  const now = rec('winter', 'Placed')
  assert.equal(pickShiftLogStudent([old, now]).id, 'winter')
  assert.equal(pickShiftLogStudent([now, old]).id, 'winter')
  assert.equal(pickShiftLogStudent([rec('a', 'Completed'), rec('b', 'Active Rotation')]).id, 'b')
})

test('one match is returned as it is, so eligibility still decides the answer', () => {
  const only = rec('x', 'Not Proceeding')
  assert.equal(pickShiftLogStudent([only]), only)
  assert.equal(pickShiftLogStudent([]), null)
})

test('never guesses: none or several loggable records stay ambiguous', () => {
  assert.deepEqual(pickShiftLogStudent([rec('a', 'Placed'), rec('b', 'Active Rotation')]), { ambiguous: true })
  assert.deepEqual(pickShiftLogStudent([rec('a', 'Not Proceeding'), rec('b', 'Completed')]), { ambiguous: true })
  // An Archived cohort cannot log, so it does not count as the one.
  assert.deepEqual(pickShiftLogStudent([rec('a', 'Placed', 'Archived'), rec('b', 'Completed')]), { ambiguous: true })
  assert.equal(pickShiftLogStudent([rec('a', 'Placed', 'Archived'), rec('b', 'Placed')]).id, 'b')
})

test('canLogShifts is the lookup eligibility rule', () => {
  assert.equal(canLogShifts(rec('a', 'Placed')), true)
  assert.equal(canLogShifts(rec('a', 'Active Rotation')), true)
  assert.equal(canLogShifts(rec('a', 'Placed', 'Archived')), false)
  assert.equal(canLogShifts(rec('a', 'Pending Outreach')), false)
})

test('both shift-log paths use the shared rule', () => {
  const lookup = readFileSync(new URL('../api/lib/shiftLogLookup.js', import.meta.url), 'utf8')
  const past = readFileSync(new URL('../api/shift-log/submit-past-shift.js', import.meta.url), 'utf8')
  assert.match(lookup, /pickShiftLogStudent\(matches\)/)
  assert.match(past, /pickShiftLogStudent\(\[\.\.\.byId\.values\(\)\]\)/)
  assert.doesNotMatch(lookup, /matches\.length > 1/)
})
