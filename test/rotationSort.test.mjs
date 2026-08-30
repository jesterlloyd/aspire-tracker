// ROTATION-SORT-2: Active Rotation Progress ordering.
//
// The defect this replaces: "Least hours completed" sorted by RAW approved
// hours while its sibling "Closest to completion" sorted by percentage, so the
// two were not inverses of each other and a 96/96 student (100%) could rank as
// less complete than an 84/108 student (77.8%). Every completion sort now runs
// on the same percentage the card shows, from the same canonical helper behind
// the green Complete badge.
// Run: node --test test/rotationSort.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  ROTATION_SORT_OPTIONS, DEFAULT_ROTATION_SORT, rotationComparator, rotationSortFeedback,
} from '../src/lib/rotationSort.js'
import { hoursProgress } from '../src/lib/clinicalHours.js'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')

// Cards exactly as RotationActivity builds them: hours values come from the
// canonical helper, never from a second calculation inside the test.
const card = (name, approved, required, over = {}) => {
  const h = hoursProgress({ approved_hours: approved, hours_required: required })
  return {
    name, school: over.school || 'Cal State LA', onCampus: !!over.onCampus,
    pct: h.pct, apv: h.approved, complete: h.complete, ...over,
  }
}
const nameOf = (c) => c.name
const order = (mode, cards) => [...cards].sort(rotationComparator(mode, nameOf)).map(c => c.name)

// The user's worked example plus the wider production mix.
const A = card('Avery', 96, 96)      // 100.0% complete
const B = card('Blake', 108, 132)    //  81.8%
const C = card('Casey', 84, 108)     //  77.8%
const D = card('Devon', 96, 132)     //  72.7%
const E = card('Ellis', 132, 132)    // 100.0% complete, more raw hours than A
const F = card('Frank', 150, 132)    // over-required -> capped 100% complete
const U = card('Unknown', 40, 0)     // unknown requirement -> pct 0, not complete
const MIX = [D, C, B, A, E, F, U]

test('the menu is exactly the six approved modes, in order', () => {
  assert.deepEqual(ROTATION_SORT_OPTIONS.map(o => o.key), [
    'completed_first', 'most_complete', 'least_complete', 'name', 'school', 'on_campus_first',
  ])
  assert.deepEqual(ROTATION_SORT_OPTIONS.map(o => o.label), [
    'Completed first', 'Most complete', 'Least complete', 'Name A–Z', 'School A–Z', 'On campus first',
  ])
  assert.equal(DEFAULT_ROTATION_SORT, 'completed_first')
})

test('the retired sorts are gone from the component and the module', () => {
  const comp = read('src/components/RotationActivity.jsx')
  for (const gone of ['Needs attention', 'Closest to completion', 'Least hours completed']) {
    assert.ok(!comp.includes(gone), `${gone} must not survive`)
  }
  // The raw-hours comparator and the attention ranking are both retired.
  assert.ok(!/\(a\.apv - b\.apv\) \|\| byName/.test(comp), 'raw-hours sort must not survive')
  assert.ok(!/missingPreceptor \|\| a\.noRecentLog/.test(comp), 'attention ranking must not survive')
  // ...but the badges those flags drive are preserved. ROTATION-ACTIVITY-CALENDAR-1
  // moved them from the progress cards into RotationStudentTable when the cards became
  // a table; the flags and their labels are unchanged.
  const table = read('src/components/rotation/RotationStudentTable.jsx')
  assert.match(table, /label="No preceptor"/)
  assert.match(table, /label="No recent log"/)
  assert.match(table, /label="Complete"/)
})

test('Most complete ranks by percentage, not raw hours', () => {
  // The stated example: A(96/96)=100% must beat B(108/132)=81.8% even though
  // B has more raw approved hours, and C(84/108)=77.8% comes last.
  assert.deepEqual(order('most_complete', [C, B, A]), ['Avery', 'Blake', 'Casey'])
  // Full mix: the three 100% students tie on progress and fall to Name A-Z,
  // NOT to raw hours - Avery (96) leads Ellis (132) and Frank (150).
  assert.deepEqual(order('most_complete', MIX),
    ['Avery', 'Ellis', 'Frank', 'Blake', 'Casey', 'Devon', 'Unknown'])
})

test('Least complete inverts the PERCENTAGE order, ties stay alphabetical', () => {
  assert.deepEqual(order('least_complete', [A, B, C]), ['Casey', 'Blake', 'Avery'])

  const byName = (mode) => order(mode, MIX)
  const pctOf = (n) => MIX.find(c => c.name === n).pct
  const asc = byName('least_complete').map(pctOf)
  const desc = byName('most_complete').map(pctOf)
  // The percentage sequence is the exact mirror - which the old raw-hours
  // sort could not manage.
  assert.deepEqual(asc, [...desc].reverse())

  // But the full name order is NOT a mirror, and must not be: name is a
  // stable presentation tie-break, not part of the ranking, so an
  // equal-percentage group reads A-Z in both directions rather than
  // flipping. The three 100% students prove it.
  const tied = ['Avery', 'Ellis', 'Frank']
  assert.deepEqual(byName('most_complete').slice(0, 3), tied)
  assert.deepEqual(byName('least_complete').slice(-3), tied)
})

test('Completed first groups by the canonical Complete condition', () => {
  const out = order('completed_first', MIX)
  // Completed group first, alphabetical inside it.
  assert.deepEqual(out.slice(0, 3), ['Avery', 'Ellis', 'Frank'])
  // Then in-progress by completion percentage descending.
  assert.deepEqual(out.slice(3), ['Blake', 'Casey', 'Devon', 'Unknown'])
})

test('over-required hours stay Complete with the capped percentage', () => {
  assert.equal(F.pct, 100, 'capped, exactly as the badge caps it')
  assert.equal(F.complete, true)
  // 150/132 and 132/132 are both capped at 100%: equally complete, so name
  // decides. Raw hours must not promote Frank (150) above Ellis (132).
  assert.deepEqual(order('most_complete', [F, E]), ['Ellis', 'Frank'])
  assert.deepEqual(order('least_complete', [F, E]), ['Ellis', 'Frank'])
})

test('unknown required hours is 0% and never Complete', () => {
  assert.equal(U.pct, 0)
  assert.equal(U.complete, false)
  // Sorts with genuine 0%, last under Most complete and first under Least.
  assert.equal(order('most_complete', MIX).at(-1), 'Unknown')
  assert.equal(order('least_complete', MIX)[0], 'Unknown')
  // Never promoted into the completed group.
  assert.ok(!order('completed_first', MIX).slice(0, 3).includes('Unknown'))
  // null / missing behave identically - one interpretation, not two.
  for (const req of [null, undefined, '']) {
    const c = card('X', 40, req)
    assert.equal(c.pct, 0)
    assert.equal(c.complete, false)
  }
})

test('equal percentages tie on progress and fall to Name A-Z', () => {
  // Same percentage AND same approved hours -> name decides, so the order is
  // total and cannot depend on input order.
  const p = card('Parker', 66, 132)
  const q = card('Quinn', 66, 132)
  assert.deepEqual(order('most_complete', [q, p]), ['Parker', 'Quinn'])
  assert.deepEqual(order('most_complete', [p, q]), ['Parker', 'Quinn'])
  assert.deepEqual(order('least_complete', [q, p]), ['Parker', 'Quinn'])

  // THE CORRECTION: equal percentage with DIFFERENT raw hours must also fall
  // to name. A bigger raw total is a longer rotation, not more progress.
  const zed = card('Zed', 100, 100)     // 100%, 100 raw hours
  const abe = card('Abe', 50, 50)       // 100%,  50 raw hours
  assert.deepEqual(order('most_complete', [zed, abe]), ['Abe', 'Zed'])
  assert.deepEqual(order('most_complete', [abe, zed]), ['Abe', 'Zed'])
  assert.deepEqual(order('least_complete', [zed, abe]), ['Abe', 'Zed'])

  // The stated 75% pair: 72/96 and 99/132 are equally three-quarters done.
  const g = card('Gray', 72, 96)
  const h = card('Hall', 99, 132)
  assert.equal(g.pct, 75)
  assert.equal(h.pct, 75)
  assert.deepEqual(order('most_complete', [h, g]), ['Gray', 'Hall'])
  assert.deepEqual(order('least_complete', [h, g]), ['Gray', 'Hall'])

  // 96/96 and 132/132 are equally complete.
  const a96 = card('Ana', 96, 96)
  const b132 = card('Bea', 132, 132)
  assert.equal(a96.pct, b132.pct)
  assert.deepEqual(order('most_complete', [b132, a96]), ['Ana', 'Bea'])
  assert.deepEqual(order('least_complete', [b132, a96]), ['Ana', 'Bea'])
})

test('no comparator reads raw approved hours', () => {
  // Source guard for the correction: raw hours may inform the card's display
  // but must never influence rank.
  const mod = read('src/lib/rotationSort.js')
  const code = mod.split('\n').filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n')
  assert.ok(!/\.apv/.test(code), 'no comparator may reference approved hours')
})

test('On campus first uses the canonical membership, then name', () => {
  const on1 = card('Yara', 10, 100, { onCampus: true })
  const on2 = card('Adam', 90, 100, { onCampus: true })
  const off1 = card('Zoe', 95, 100)
  const off2 = card('Bob', 5, 100)
  // On-campus group first (alphabetical), then everyone else (alphabetical).
  // Percentage deliberately does NOT influence this mode.
  assert.deepEqual(order('on_campus_first', [off1, on1, off2, on2]),
    ['Adam', 'Yara', 'Bob', 'Zoe'])
})

test('Name and School sorts are stable and total', () => {
  const a = card('Ann', 10, 100, { school: 'Zeta College' })
  const b = card('Bob', 10, 100, { school: 'Alpha University' })
  const c = card('Cal', 10, 100, { school: 'Alpha University' })
  assert.deepEqual(order('name', [c, a, b]), ['Ann', 'Bob', 'Cal'])
  // School groups first, name inside each school.
  assert.deepEqual(order('school', [a, c, b]), ['Bob', 'Cal', 'Ann'])
})

test('an unknown sort key falls back to the default, never crashes', () => {
  assert.deepEqual(order('nonsense_key', MIX), order(DEFAULT_ROTATION_SORT, MIX))
  assert.deepEqual(order(undefined, MIX), order(DEFAULT_ROTATION_SORT, MIX))
})

test('a tied cohort explains why a valid sort leaves the visible order unchanged', () => {
  const tied = [card('Zed', 96, 96), card('Abe', 132, 132)]
  assert.equal(rotationSortFeedback('completed_first', tied),
    'All students shown are completed; ties are listed by name.')
  assert.equal(rotationSortFeedback('most_complete', tied),
    'All students shown are at 100%; ties are listed by name.')
  assert.equal(rotationSortFeedback('least_complete', tied),
    'All students shown are at 100%; ties are listed by name.')
  assert.equal(rotationSortFeedback('on_campus_first', tied),
    'No students shown are on campus; ties are listed by name.')
  assert.equal(rotationSortFeedback('name', tied), '')
  assert.equal(rotationSortFeedback('school', tied), '')
})

test('tie feedback disappears as soon as the selected criterion can differentiate cards', () => {
  assert.equal(rotationSortFeedback('completed_first', [A, B]), '')
  assert.equal(rotationSortFeedback('most_complete', [A, B]), '')
  assert.equal(rotationSortFeedback('least_complete', [A, B]), '')
  assert.equal(rotationSortFeedback('on_campus_first', [A, { ...B, onCampus: true }]), '')
  assert.equal(rotationSortFeedback('most_complete', [A]), '')
  assert.equal(rotationSortFeedback('most_complete', []), '')
})

test('the component consumes the shared comparators and canonical hours', () => {
  const comp = read('src/components/RotationActivity.jsx')
  assert.match(comp, /ROTATION_SORT_OPTIONS, DEFAULT_ROTATION_SORT, rotationComparator, rotationSortFeedback/)
  assert.match(comp, /rotationComparator\(sortMode, c => getStudentPreferredFullName\(c\.s\)\)/)
  assert.match(comp, /rotationSortFeedback\(sortMode, visibleCards\)/)
  assert.match(comp, /useState\(DEFAULT_ROTATION_SORT\)/)
  assert.match(comp, /aria-label="Sort active rotation progress"/)
  assert.match(comp, /onInput=\{commitSelection\}/)
  assert.match(comp, /onChange=\{commitSelection\}/)
  // The completion values still come from the canonical hours helper.
  assert.match(comp, /hoursProgress\(s\)/)
  // On Campus Now membership is reused, not recomputed.
  assert.match(comp, /const onCampusIds = new Set\(openLogs\.map\(l => l\.student_id\)\)/)
  assert.match(comp, /onCampus: onCampusIds\.has\(s\.id\)/)
})
