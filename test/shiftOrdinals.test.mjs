// Commit 4: chronological shift ordinals + calendar chip. Pure ordinal-computation tests
// (first/fourth/fifth, same-day distinct, no month/unit reset, full-history), the accessible
// ordinal word, and source guards that the server computes ordinals over full history and the
// chip stays Interviews-safe with no preceptor last name.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { buildStudentShiftOrdinals, compareShiftChronological } from '../lib/server/shiftOrdinals.js'
import { ordinalWord } from '../src/lib/ordinalWord.js'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')

const log = (id, student_id, shift_date, extra = {}) => ({ id, student_id, shift_date, lifecycle_state: 'completed', ...extra })

// ── ordinal computation ───────────────────────────────────────────────────────
test('ordinals count a student chronologically from 1, across full history', () => {
  const rows = [
    log('e', 's1', '2026-05-10'),
    log('a', 's1', '2026-01-02'),
    log('c', 's1', '2026-03-01'),
    log('b', 's1', '2026-02-15'),
    log('d', 's1', '2026-04-20'),
  ]
  const m = buildStudentShiftOrdinals(rows)
  assert.equal(m.get('a'), 1)   // first
  assert.equal(m.get('d'), 4)   // fourth
  assert.equal(m.get('e'), 5)   // fifth
})
test('ordinals never reset by month or unit, and are per student', () => {
  const rows = [
    log('a', 's1', '2026-01-31', { unit_name: '6 NE' }),
    log('b', 's1', '2026-02-01', { unit_name: 'PACU' }),   // new month AND new unit
    log('x', 's2', '2026-01-05'),                          // different student
  ]
  const m = buildStudentShiftOrdinals(rows)
  assert.equal(m.get('a'), 1)
  assert.equal(m.get('b'), 2)   // continues, not reset to 1 by the new month/unit
  assert.equal(m.get('x'), 1)   // independent per student
})
test('an in-progress (active) shift counts and sorts by its date', () => {
  const rows = [
    log('a', 's1', '2026-06-01'),
    log('b', 's1', '2026-06-03', { lifecycle_state: 'in_progress' }),
  ]
  const m = buildStudentShiftOrdinals(rows)
  assert.equal(m.get('a'), 1)
  assert.equal(m.get('b'), 2)
})
test('multiple shifts on the SAME date get distinct deterministic ordinals', () => {
  const rows = [
    log('later', 's1', '2026-06-02', { checked_in_at: '2026-06-02T18:00:00Z' }),
    log('early', 's1', '2026-06-02', { checked_in_at: '2026-06-02T06:00:00Z' }),
  ]
  const m = buildStudentShiftOrdinals(rows)
  assert.equal(m.get('early'), 1)   // earlier check-in first
  assert.equal(m.get('later'), 2)
  // Fully deterministic: same-date, no timestamps -> id ascending.
  const m2 = buildStudentShiftOrdinals([log('bbb', 's1', '2026-06-02'), log('aaa', 's1', '2026-06-02')])
  assert.equal(m2.get('aaa'), 1)
  assert.equal(m2.get('bbb'), 2)
})
test('history BEFORE the visible window makes later ordinals correct', () => {
  // A student with two old shifts (outside a 90-day window) plus one recent one: the recent
  // shift is the 3rd, even though a window-only view would call it the 1st.
  const rows = [
    log('old1', 's1', '2026-01-01'),
    log('old2', 's1', '2026-01-08'),
    log('recent', 's1', '2026-07-01'),
  ]
  assert.equal(buildStudentShiftOrdinals(rows).get('recent'), 3)
})
test('rows with an unexpected lifecycle_state are excluded (defensive)', () => {
  const rows = [log('a', 's1', '2026-06-01'), log('void', 's1', '2026-06-02', { lifecycle_state: 'canceled' })]
  const m = buildStudentShiftOrdinals(rows)
  assert.equal(m.get('a'), 1)
  assert.equal(m.has('void'), false)
})
test('the comparator is a stable total order', () => {
  assert.equal(compareShiftChronological({ shift_date: '2026-01-01', id: 'a' }, { shift_date: '2026-01-02', id: 'b' }), -1)
  assert.equal(compareShiftChronological({ shift_date: '2026-01-02', id: 'a' }, { shift_date: '2026-01-02', id: 'a' }), 0)
})

// ── accessible ordinal word ───────────────────────────────────────────────────
test('ordinalWord: words to ten, then a numeric suffix', () => {
  assert.equal(ordinalWord(1), 'first')
  assert.equal(ordinalWord(4), 'fourth')
  assert.equal(ordinalWord(10), 'tenth')
  assert.equal(ordinalWord(11), '11th')
  assert.equal(ordinalWord(21), '21st')
  assert.equal(ordinalWord(23), '23rd')
  assert.equal(ordinalWord(0), '')
})

// ── source guards ──────────────────────────────────────────────────────────────
test('the endpoint computes ordinals over full history, not the 90-day window', () => {
  const ep = read('api/portal/unit-shift-activity.js')
  assert.match(ep, /buildStudentShiftOrdinals/)
  // The history query selects only minimal columns and is NOT bounded by from/to.
  const hist = ep.slice(ep.indexOf('historyRows'))
  assert.ok(!/\.gte\('shift_date', from\)/.test(hist.slice(0, 400)), 'ordinal query must not be date-bounded')
  assert.match(ep, /ordinal: ordinalById\.get\(r\.id\) \?\? null/)
})
test('the calendar chip is Interviews-safe and never shows a preceptor last name', () => {
  const chip = read('src/components/shared/CanonicalCalendarFoundation.jsx')
  // Label-only callers keep the exact prior output (Interviews unchanged).
  assert.match(chip, /if \(secondary == null && ordinal == null\) return <span style=\{base\}>\{label\}<\/span>/)
  const cal = read('src/portal/unit/UnitRotationCalendar.jsx')
  // First name only, via the shared helper; a full accessible label carries the ordinal word.
  assert.match(cal, /firstNameOf\(shift\.preceptor_name\)/)
  assert.match(cal, /\$\{ordinalWord\(ordinal\)\} logged shift/)
  assert.ok(!/last_name|lastNameOf/.test(cal), 'no preceptor last name in the chip')
})
