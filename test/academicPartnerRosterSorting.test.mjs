// AP Phase visual convergence, Commit 3: sortable Student / ASPIRE Status / Hours columns. Pure
// sort-helper tests (canonical pathway order, locale-aware name, numeric hours, stability) plus
// source guards for the accessible sortable headers and that sorting preserves filter/cohort/school.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { sortRoster, statusRank, displayNameOf, SORTABLE_COLUMNS } from '../src/portal/ap/academicPartnerRoster.js'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')
const portal = read('src/portal/AcademicPartnerPortal.jsx')

const mk = (id, first, last, status, approved, required) =>
  ({ id, first_name: first, last_name: last, status, hours: { approved, required, pending: 0 } })

test('exactly Student, ASPIRE Status, and Hours are sortable', () => {
  assert.deepEqual([...SORTABLE_COLUMNS].sort(), ['hours', 'status', 'student'])
})

test('Student sorts locale-aware by display name, preferring the preferred first name', () => {
  const a = { id: '1', preferred_first_name: 'Zed', first_name: 'Zebulon', last_name: 'Adams' }
  const b = { id: '2', first_name: 'ana', last_name: 'brooks' }   // lower-case, accents-insensitive
  assert.equal(displayNameOf(a), 'Zed Adams')
  const asc = sortRoster([a, b], 'student', 'asc').map(s => s.id)
  assert.deepEqual(asc, ['2', '1'])   // "ana brooks" < "Zed Adams" (base sensitivity)
  const desc = sortRoster([a, b], 'student', 'desc').map(s => s.id)
  assert.deepEqual(desc, ['1', '2'])
})

test('ASPIRE Status sorts by the canonical pathway order, not alphabetically', () => {
  // Alphabetical would put Active Rotation first; the pathway puts Pending Outreach first.
  const rows = [
    mk('c', 'C', 'C', 'Completed'),
    mk('a', 'A', 'A', 'Pending Outreach'),
    mk('r', 'R', 'R', 'Active Rotation'),
    mk('p', 'P', 'P', 'Placed'),
  ]
  assert.deepEqual(sortRoster(rows, 'status', 'asc').map(s => s.id), ['a', 'p', 'r', 'c'])
  assert.deepEqual(sortRoster(rows, 'status', 'desc').map(s => s.id), ['c', 'r', 'p', 'a'])
  // Terminal statuses keep their canonical order (after Completed); unknown sorts safely at the end.
  assert.ok(statusRank('Declined') < statusRank('Not Proceeding'))
  assert.ok(statusRank('Completed') < statusRank('Declined'))
  assert.ok(statusRank('Whatever Unknown') >= statusRank('Not Proceeding'))
  const withUnknown = [mk('u', 'U', 'U', 'Mystery'), mk('a', 'A', 'A', 'Pending Outreach')]
  assert.deepEqual(sortRoster(withUnknown, 'status', 'asc').map(s => s.id), ['a', 'u'])
})

test('Hours sorts by approved numerically; pending is never treated as approved; required breaks ties', () => {
  const rows = [
    { id: 'x', first_name: 'X', last_name: 'X', status: 'Active Rotation', hours: { approved: 10, required: 100, pending: 90 } },
    { id: 'y', first_name: 'Y', last_name: 'Y', status: 'Active Rotation', hours: { approved: 40, required: 100, pending: 0 } },
    { id: 'z', first_name: 'Z', last_name: 'Z', status: 'Active Rotation', hours: { approved: 10, required: 40, pending: 0 } },
  ]
  // Ascending by approved: x(10) and z(10) tie on approved; z(req 40) < x(req 100); then y(40).
  assert.deepEqual(sortRoster(rows, 'hours', 'asc').map(s => s.id), ['z', 'x', 'y'])
  // x has 90 pending but is NOT ranked above y's 40 approved.
  assert.deepEqual(sortRoster(rows, 'hours', 'desc').map(s => s.id), ['y', 'x', 'z'])
})

test('sorting never mutates the input and is stable for full ties', () => {
  const rows = [mk('1', 'Sam', 'Lee', 'Placed', 5, 40), mk('2', 'Sam', 'Lee', 'Placed', 5, 40)]
  const before = rows.map(s => s.id)
  const sorted = sortRoster(rows, 'student', 'asc')
  assert.deepEqual(rows.map(s => s.id), before)          // input unchanged
  assert.deepEqual(sorted.map(s => s.id), ['1', '2'])    // stable: original order kept for full ties
  // An unsortable/absent column returns the rows unchanged (original order).
  assert.equal(sortRoster(rows, null, 'asc'), rows)
})

test('the roster headers use the shared canonical SortHeader; sort stays client-side', () => {
  // The bespoke AP sort header is gone; the portal imports and uses the shared canonical component.
  assert.match(portal, /import SortHeader from '\.\.\/components\/shared\/SortHeader'/)
  assert.doesNotMatch(portal, /function SortHeader\(/)          // no local redefinition
  assert.doesNotMatch(portal, /ptl-ap-sort/)                   // no bespoke sort class
  assert.doesNotMatch(portal, /[▲▼↕]/)          // no ▲ ▼ ↕ text-glyph indicators
  // Exactly Student, ASPIRE status, and Hours are sortable, wired to the client sort state and the
  // portal cell context (thClassName="").
  assert.match(portal, /<SortHeader sortKey="student" sortBy=\{sort\.column\} sortDir=\{sort\.direction\} onSort=\{onSort\} thClassName="">Student<\/SortHeader>/)
  assert.match(portal, /<SortHeader sortKey="hours" sortBy=\{sort\.column\} sortDir=\{sort\.direction\} onSort=\{onSort\} thClassName="">Hours<\/SortHeader>/)
  assert.match(portal, /sortKey="status" sortBy=\{sort\.column\} sortDir=\{sort\.direction\} onSort=\{onSort\} thClassName=""/)
  // Sort runs over the already filtered + scoped rows, never a new request; filter/cohort/school
  // state is independent of the sort state.
  assert.match(portal, /const rows = sortRoster\(filtered, sort\.column, sort\.direction\)/)
  assert.doesNotMatch(portal, /fetch\([^)]*sort|[?&]sort=|order_by/)
})
