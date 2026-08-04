// SHIFT-SEQUENCE-1: one canonical clinical-shift sequence, shown consistently.
//
// AUDIT RESULT: the rule already existed server-side for the Unit Leader
// calendar (lib/server/shiftOrdinals.js -> buildStudentShiftOrdinals). Rather
// than inventing a second algorithm, the pure logic moved to
// src/lib/shiftOrdinals.js (the repo's existing core/server split, as with
// contactSearch -> contactSearchCore) so client surfaces share the identical
// definition, and the server module re-exports it unchanged.
//
// These are CLINICAL SHIFTS, not logins: the records are shift_logs rows that
// exist only once a student checks in.
//
// Run: node --test test/shiftSequenceNumbers.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { buildStudentShiftOrdinals, compareShiftChronological } from '../src/lib/shiftOrdinals.js'
import { buildStudentShiftOrdinals as serverBuild } from '../lib/server/shiftOrdinals.js'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')
const panel  = read('src/components/ClinicalHoursPanel.jsx')
const badge  = read('src/components/ShiftNumberBadge.jsx')
const ulApi  = read('api/portal/unit-shift-activity.js')
const ulCal  = read('src/portal/unit/UnitRotationCalendar.jsx')

const log = (id, date, extra = {}) => ({ id, student_id: 's1', shift_date: date, ...extra })

// ── Chronological numbering ──────────────────────────────────────────────────

test('shifts number chronologically from 1, per student, across full history', () => {
  const ord = buildStudentShiftOrdinals([
    log('c', '2026-07-15'), log('a', '2026-06-18'), log('b', '2026-06-25'),
  ])
  assert.equal(ord.get('a'), 1)
  assert.equal(ord.get('b'), 2)
  assert.equal(ord.get('c'), 3)
})

test('each student is numbered independently', () => {
  const ord = buildStudentShiftOrdinals([
    { id: 'x1', student_id: 'A', shift_date: '2026-06-01' },
    { id: 'y1', student_id: 'B', shift_date: '2026-06-02' },
    { id: 'x2', student_id: 'A', shift_date: '2026-06-03' },
  ])
  assert.equal(ord.get('x1'), 1)
  assert.equal(ord.get('x2'), 2)
  assert.equal(ord.get('y1'), 1, 'B starts at 1, not 2')
})

test('same-day shifts break ties deterministically: check-in time, then id', () => {
  const ord = buildStudentShiftOrdinals([
    log('late',  '2026-07-19', { checked_in_at: '2026-07-19T15:00:00Z' }),
    log('early', '2026-07-19', { checked_in_at: '2026-07-19T07:00:00Z' }),
  ])
  assert.equal(ord.get('early'), 1)
  assert.equal(ord.get('late'), 2)
  // With no check-in times at all, the immutable id is the stable tie-break, so
  // the same input always yields the same numbers across requests.
  const byId = buildStudentShiftOrdinals([log('b2', '2026-07-19'), log('a1', '2026-07-19')])
  assert.equal(byId.get('a1'), 1)
  assert.equal(byId.get('b2'), 2)
  // A row WITH a check-in sorts before one without on the same day.
  assert.ok(compareShiftChronological(
    log('t', '2026-07-19', { checked_in_at: '2026-07-19T09:00:00Z' }),
    log('u', '2026-07-19')) < 0)
})

// ── Inclusion and exclusion by status ────────────────────────────────────────

test('pending-review and in-progress shifts count; they are real logged shifts', () => {
  // ASPIRE has no forward schedule: a shift_logs row exists only once a student
  // checks in, so in_progress is an actual shift in progress.
  const ord = buildStudentShiftOrdinals([
    log('a', '2026-07-01', { lifecycle_state: 'completed' }),
    log('b', '2026-07-02', { lifecycle_state: 'in_progress' }),
    log('c', '2026-07-03', { lifecycle_state: null }), // older rows predate the column
  ])
  assert.equal(ord.get('a'), 1)
  assert.equal(ord.get('b'), 2)
  assert.equal(ord.get('c'), 3)
})

test('an unexpected lifecycle_state is excluded and does not consume a number', () => {
  const ord = buildStudentShiftOrdinals([
    log('a', '2026-07-01', { lifecycle_state: 'completed' }),
    log('void', '2026-07-02', { lifecycle_state: 'voided' }),
    log('c', '2026-07-03', { lifecycle_state: 'completed' }),
  ])
  assert.equal(ord.get('a'), 1)
  assert.equal(ord.has('void'), false, 'excluded rows get no ordinal')
  assert.equal(ord.get('c'), 2, 'numbering stays consecutive across an exclusion')
})

test('rows without an id or student are ignored rather than numbered', () => {
  const ord = buildStudentShiftOrdinals([
    { id: null, student_id: 's1', shift_date: '2026-07-01' },
    { id: 'ok', student_id: 's1', shift_date: '2026-07-02' },
    null,
  ])
  assert.equal(ord.get('ok'), 1)
  assert.equal(ord.size, 1)
})

// ── Dynamic behavior ─────────────────────────────────────────────────────────

test('a late-entered OLDER shift renumbers the shifts after it', () => {
  const before = buildStudentShiftOrdinals([log('a', '2026-07-01'), log('b', '2026-07-08')])
  assert.equal(before.get('a'), 1)
  assert.equal(before.get('b'), 2)
  // The same records plus an earlier shift entered afterwards:
  const after = buildStudentShiftOrdinals([log('a', '2026-07-01'), log('b', '2026-07-08'), log('late', '2026-06-20')])
  assert.equal(after.get('late'), 1)
  assert.equal(after.get('a'), 2)
  assert.equal(after.get('b'), 3)
})

test('there is no cap: the 21st and 150th shifts number correctly', () => {
  const many = Array.from({ length: 150 }, (_, i) =>
    log(`s${String(i).padStart(3, '0')}`, `2026-01-${String((i % 28) + 1).padStart(2, '0')}`))
  // Give every row a distinct date so the order is unambiguous.
  many.forEach((l, i) => { l.shift_date = new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10) })
  const ord = buildStudentShiftOrdinals(many)
  assert.equal(ord.get('s020'), 21, 'no enclosed-numeral ceiling at 20')
  assert.equal(ord.get('s149'), 150)
})

// ── One rule, every surface ──────────────────────────────────────────────────

test('the server module re-exports the SAME function the client imports', () => {
  assert.equal(serverBuild, buildStudentShiftOrdinals, 'one implementation, two import sites')
  assert.match(read('lib/server/shiftOrdinals.js'), /export \{ compareShiftChronological, buildStudentShiftOrdinals \} from '\.\.\/\.\.\/src\/lib\/shiftOrdinals\.js'/)
})

test('the Unit Leader calendar keeps its server-computed ordinal, unchanged', () => {
  assert.match(ulApi, /import \{ buildStudentShiftOrdinals \} from '\.\.\/\.\.\/lib\/server\/shiftOrdinals\.js'/)
  assert.match(ulApi, /ordinal: ordinalById\.get\(r\.id\) \?\? null/)
  assert.match(ulCal, /const ordinal = Number\.isInteger\(shift\.ordinal\) \? shift\.ordinal : null/)
})

test('the shared staff panel numbers rows with the same helper', () => {
  // ClinicalHoursPanel backs BOTH Student Profiles and Rotation > Activity, so
  // one wiring covers both surfaces with identical numbers.
  assert.match(panel, /import \{ buildStudentShiftOrdinals \} from '\.\.\/lib\/shiftOrdinals'/)
  assert.match(panel, /const ordinalById = buildStudentShiftOrdinals\(shiftLogs\)/)
  assert.match(panel, /'Shift #', 'Date', 'Hrs'/)
  assert.match(panel, /<ShiftNumberBadge ordinal=\{ordinalById\.get\(log\.id\)\} \/>/)
  assert.match(read('src/components/RotationActivity.jsx'), /import ClinicalHoursPanel from '\.\/ClinicalHoursPanel'/)
})

// ── Accessibility and presentation ───────────────────────────────────────────

test('the badge announces "Shift N" and never relies on shape or colour alone', () => {
  assert.match(badge, /<span aria-hidden="true">\{ordinal\}<\/span>/)
  assert.match(badge, /<span className="sr-only">\{`Shift \$\{ordinal\}`\}<\/span>/)
  // The visible glyph is the integer itself, not an encoded symbol.
  assert.doesNotMatch(badge, /[①-⓿❵-➓]/, 'no Unicode enclosed numerals')
  // Any integer fits: the badge widens past 99 instead of clipping.
  assert.match(badge, /const wide = ordinal > 99/)
  // An unknown sequence says so rather than showing a wrong number.
  assert.match(badge, /aria-label="Shift number unavailable"/)
})

test('the label is a clinical shift, never a login', () => {
  for (const src of [panel, badge]) {
    assert.doesNotMatch(src, /\blogins?\b/i, 'these records are clinical shifts, not sign-ins')
  }
})
