// PROCEEDING-GAP-1: the Placement Snapshot's fifth card counts proceeding students only.
// Not Proceeding and Declined students never need a slot, in any cohort.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { placementCoverage, EXITED_STATUSES } from '../src/lib/placementCoverage.js'

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const cohort = (placed, unplaced, exited) => [
  ...Array.from({ length: placed }, (_, i) => ({ status: 'Placed', matched_unit_id: `u${i}` })),
  ...Array.from({ length: unplaced }, () => ({ status: 'Interviewed', matched_unit_id: null })),
  ...exited.map(status => ({ status, matched_unit_id: null })),
]

test('Not Proceeding and Declined are the exited statuses', () => {
  assert.deepEqual([...EXITED_STATUSES].sort(), ['Declined', 'Not Proceeding'])
})

test('Fall 2026 as the Owner described it: 19 placed, 2 exited, reads All Placed at any capacity', () => {
  const fall = cohort(19, 0, ['Not Proceeding', 'Declined'])
  for (const slots of [19, 33]) {
    assert.deepEqual(placementCoverage(fall, slots),
      { kind: 'all_placed', value: 19, label: 'All Placed', sub: '19 of 19 proceeding students', accent: 'sage' })
  }
})

test('exited students never create a gap', () => {
  // 17 proceeding (15 placed, 2 waiting), 3 exited, 17 slots: covered exactly, not "Gap 3".
  const c = placementCoverage(cohort(15, 2, ['Not Proceeding', 'Not Proceeding', 'Declined']), 17)
  assert.equal(c.kind, 'covered')
  assert.equal(c.value, 0)
})

test('a real shortfall of proceeding students still reads Placement Gap', () => {
  const c = placementCoverage(cohort(5, 4, ['Declined']), 7)
  assert.deepEqual(c, { kind: 'gap', value: 2, label: 'Placement Gap', sub: 'More requests than open slots', accent: 'warning' })
})

test('an unplaced cohort with room reads Fully Covered by the spare slots', () => {
  assert.deepEqual(placementCoverage(cohort(0, 7, []), 24),
    { kind: 'covered', value: 17, label: 'Fully Covered', sub: 'Enough slots for all', accent: 'sage' })
  assert.equal(placementCoverage([], 5).kind, 'covered')
})

test('the Snapshot reads placementCoverage and no longer counts every student against slots', () => {
  const ov = read('src/components/OverviewTab.jsx')
  assert.match(ov, /import \{ placementCoverage \} from '\.\.\/lib\/placementCoverage'/)
  assert.match(ov, /const coverage\s+= placementCoverage\(students, totalSlots\)/)
  assert.match(ov, /<KPICell value=\{coverage\.value\}\s+label=\{coverage\.label\} sub=\{coverage\.sub\} accent=\{coverage\.accent\} \/>/)
  assert.doesNotMatch(ov, /totalStudents - totalSlots/)
  // Student Requests still counts everyone.
  assert.match(ov, /const studentsRequesting\s+= totalStudents/)
})
