// Commit 2: Unit Leader Home reuses the canonical calendar foundation safely.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')
const stripJs = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const foundation = read('src/components/shared/CanonicalCalendarFoundation.jsx')
const staffSidebar = read('src/components/CalendarSidebar.jsx')
const staffCalendar = read('src/components/InterviewCalendar.jsx')
const unitCalendar = read('src/portal/unit/UnitRotationCalendar.jsx')
const portal = read('src/portal/UnitLeaderPortal.jsx')
const sharedCss = read('src/index.css')
const portalCss = read('src/portal/portal.css')

const unitCalendarCode = stripJs(unitCalendar)
const portalCode = stripJs(portal)

test('main app and Unit Leader calendar share the canonical foundation', () => {
  assert.match(foundation, /export function CanonicalCalendarLayout/)
  assert.match(foundation, /export function CanonicalCalendarSidebar/)
  assert.match(foundation, /export function CanonicalCalendarTodayPanel/)
  assert.match(staffSidebar, /CanonicalCalendarSidebar/)
  assert.match(staffCalendar, /<CalendarSidebar/)
  assert.match(unitCalendar, /CanonicalCalendarLayout/)
  assert.match(unitCalendar, /CanonicalCalendarSidebar/)
  assert.match(unitCalendar, /CanonicalCalendarTodayPanel/)
})

test('Unit Leader calendar renders mini calendar, Today panel, toolbar, and selected state', () => {
  assert.match(unitCalendar, /Mini Calendar/)
  assert.match(unitCalendar, /Today/)
  assert.match(unitCalendar, /Previous month/)
  assert.match(unitCalendar, /Next month/)
  // The Today button is now the shared CanonicalCalendarNav's, wired via onToday.
  assert.match(unitCalendar, /onToday=\{goToday\}/)
  assert.doesNotMatch(unitCalendar, /ptl-cal-view-active|ptl-cal-view-tabs/)
  assert.match(staffCalendar, /Month/)
  assert.match(staffCalendar, /Week/)
  assert.match(unitCalendarCode, /const \[selectedDate, setSelectedDate\] = useState\(today\)/)
  // The main grid's selected state now flows through the shared CanonicalMonthCell.
  assert.match(unitCalendarCode, /isSelected=\{selected\}/)
  assert.match(unitCalendarCode, /selected \? 'ptl-cal-mini-selected' : ''/)
})

test('selected date and activity details stay synchronized without opening empty days', () => {
  assert.match(unitCalendarCode, /const selectedShifts = byDay\.get\(selectedDate\) \|\| \[\]/)
  assert.match(unitCalendarCode, /dateLabel=\{formatLongDate\(selectedDate\)\}/)
  assert.match(unitCalendarCode, /summary=\{`\$\{selectedShifts\.length\} student activit/)
  assert.match(unitCalendarCode, /emptyLabel="No student activity recorded for this day\."/)
  assert.match(unitCalendarCode, /setSelectedDate\(ymd\)/)
  assert.match(unitCalendarCode, /if \(day\.length > 0\) onSelectDay\?\.\(ymd, day\)/)
})

test('Unit Leader Home filters calendar activity by authorized unit selection', () => {
  assert.match(portalCode, /const visibleShifts = unitKey === ALL_UNITS \? shifts : shifts\.filter\(shift => shift\.unit_key === unitKey\)/)
  assert.match(portalCode, /const onShiftNow = visibleShifts\.filter\(x => x\.state === 'in_progress'\)/)
  assert.match(portalCode, /shifts=\{visibleShifts\}/)
  assert.match(portalCode, /visibleShifts\.filter\(y => y\.shift_date === x\.shift_date\)/)
})

test('students table follows the full-width calendar without redundant cards', () => {
  const home = portalCode.slice(portalCode.indexOf('function HomeScreen'), portalCode.indexOf('function PlacementScreen'))
  const cal = home.indexOf('<UnitRotationCalendar')
  const roster = home.indexOf('<StudentRoster')
  assert.ok(cal > -1 && roster > cal)
  assert.ok(!home.includes('ptl-home-followup-grid'))
  assert.ok(!home.includes('bucket="upcoming"'))
  assert.ok(!home.includes('Capacity and placement'))
})

test('role-unsafe staff controls and data dependencies do not enter Unit Leader calendar', () => {
  for (const forbidden of [
    'Add Event',
    'Add Availability',
    'Manage Interviewers',
    'Schedule Interview',
    'interviewer_name',
    'cohort-wide',
    'FullCalendar',
    'useAuth',
    'supabase',
    'fetch(',
  ]) {
    assert.ok(!unitCalendarCode.includes(forbidden), `Unit Leader calendar must not include ${forbidden}`)
  }
  assert.match(unitCalendar, /does not hold a forward schedule/)
  assert.match(unitCalendar, /last 90 days/)
})

test('responsive and accessible calendar shell guardrails are codified', () => {
  // The shell sidebar column is now 260px, matching the main-app calendar sidebar.
  assert.match(sharedCss, /\.canonical-calendar-shell \{[\s\S]*?grid-template-columns: 260px minmax\(0, 1fr\)/)
  assert.match(sharedCss, /\.canonical-calendar-main \{[\s\S]*?min-width: 0/)
  assert.match(sharedCss, /@media \(max-width: 760px\) \{[\s\S]*?\.canonical-calendar-shell \{[\s\S]*?grid-template-columns: 1fr/)
  assert.match(unitCalendar, /role="grid"/)
  assert.match(unitCalendar, /role="gridcell"/)
  assert.match(unitCalendar, /aria-label=\{`Rotation activity for/)
  assert.match(unitCalendar, /aria-label="Mini rotation activity calendar"/)
  // The shared month cell carries the main-grid focus ring; the mini keeps its own.
  assert.match(sharedCss, /\.canonical-month-cell:focus-visible/)
  assert.match(portalCss, /\.ptl-cal-mini-cell:focus-visible/)
})
