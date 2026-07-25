// Commit 1: the Unit Leader calendar and the main-app Interviews calendar render
// through the SAME shared calendar primitives, so they are one visual system rather
// than two hand-tuned imitations. Source-level assertions, matching this repo's
// established calendar-convergence test style.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')
const stripJs = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const foundation = read('src/components/shared/CanonicalCalendarFoundation.jsx')
const staffCalendar = read('src/components/InterviewCalendar.jsx')
const unitCalendar = read('src/portal/unit/UnitRotationCalendar.jsx')
const dates = read('src/portal/unit/rotationCalendarDates.js')
const unitCode = stripJs(unitCalendar)
const staffCode = stripJs(staffCalendar)

test('the shared foundation exports the canonical calendar primitives', () => {
  for (const name of [
    'CanonicalCalendarNav',
    'CanonicalCalendarMonthTitle',
    'CanonicalWeekdayHeader',
    'CanonicalMonthCell',
    'CanonicalActivityChip',
  ]) {
    assert.match(foundation, new RegExp(`export function ${name}\\b`), `foundation must export ${name}`)
  }
})

test('the canonical primitives carry the main-app visual values verbatim', () => {
  // Grouped prev/next pill + Today button geometry.
  assert.match(foundation, /border: '1px solid #e5e7eb', borderRadius: '9px'/)
  // Fixed 88px month cell with a 22px round day-number badge, navy fill.
  assert.match(foundation, /height: 88/)
  assert.match(foundation, /width: 22, height: 22/)
  assert.match(foundation, /background: \(isToday \|\| isSelected\) \? '#1D2567' : 'transparent'/)
  // Uppercase weekday header, Sunday-first default.
  assert.match(foundation, /textTransform: 'uppercase'/)
  assert.match(foundation, /\['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'\]/)
})

test('both calendars consume the shared nav and weekday-header primitives', () => {
  assert.match(staffCalendar, /import \{ CanonicalCalendarNav, CanonicalWeekdayHeader \} from '\.\/shared\/CanonicalCalendarFoundation'/)
  assert.match(staffCalendar, /<CanonicalCalendarNav /)
  assert.match(staffCalendar, /<CanonicalWeekdayHeader /)
  assert.match(unitCalendar, /CanonicalCalendarNav/)
  assert.match(unitCalendar, /CanonicalWeekdayHeader/)
})

test('the Unit Leader calendar builds its month grid from the shared cell and chip', () => {
  assert.match(unitCalendar, /CanonicalMonthCell/)
  assert.match(unitCalendar, /CanonicalActivityChip/)
  // Out-of-month days go through the same primitive as an inert placeholder.
  assert.match(unitCode, /<CanonicalMonthCell key=\{ymd\} isOtherMonth \/>/)
})

test('the Unit Leader toolbar groups previous, next, and Today with a centered title', () => {
  // Prev/Next/Today are one CanonicalCalendarNav cluster (not spread apart).
  assert.match(unitCode, /onPrev=\{\(\) => step\(-1\)\}/)
  assert.match(unitCode, /onNext=\{\(\) => step\(1\)\}/)
  assert.match(unitCode, /onToday=\{goToday\}/)
  // The month/year title sits in the centre group via the shared title primitive.
  assert.match(unitCode, /<CanonicalCalendarMonthTitle[^>]*>\{monthLabel\(cursor\.y, cursor\.m\)\}<\/CanonicalCalendarMonthTitle>/)
})

test('both calendars use a Sunday-first week start', () => {
  assert.match(dates, /Sunday first/)
  assert.match(dates, /const lead = first\.getUTCDay\(\)/)
  assert.match(unitCalendar, /\['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'\]/)
  assert.match(staffCalendar, /\['Sun','Mon','Tue','Wed','Thu','Fri','Sat'\]/)
})

test('the main-app calendar keeps all staff-only controls after convergence', () => {
  for (const control of ['Add Event', 'Add Availability', 'Month', 'Week', 'FullCalendar']) {
    assert.ok(staffCode.includes(control), `main app must still render ${control}`)
  }
})

test('the Unit Leader calendar exposes no staff calendar controls', () => {
  // Specific staff strings only: generic tokens like "Month" collide with primitive
  // names (CanonicalMonthCell, CanonicalCalendarMonthTitle), so they are not used here.
  for (const forbidden of ['Add Event', 'Add Availability', 'FullCalendar', 'interviewer_name', "Everyone's schedule", 'My schedule']) {
    assert.ok(!unitCode.includes(forbidden), `Unit Leader calendar must not include ${forbidden}`)
  }
})
