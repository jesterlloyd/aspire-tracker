// test/calendarCanon.test.mjs
//
// CALENDAR-NAV-CANON + CALENDAR-HOLIDAY-CANON.
//
// Two properties worth pinning across six calendars that are easy to let drift apart,
// because each lives in a different folder and no single screen shows them together:
//
//   1. Every month toolbar is composed the same way: nav pinned left in a flex:1 slot,
//      the month CENTERED, controls in a matching flex:1 slot on the right. The two
//      equal flanks are what stop the arrows moving when the month name changes width.
//   2. Every calendar shows US federal holidays, through ONE chip, not five imitations.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { getUsHolidaysForRange } from '../src/lib/usHolidays.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(root, p), 'utf8')
// Line comments FIRST: a path ending in a wildcard inside a // comment otherwise opens a
// false block comment and swallows the rest of the file.
const strip = (src) => src.replace(/^\s*\/\/[^\n]*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')

const FOUNDATION = 'src/components/shared/CanonicalCalendarFoundation.jsx'

// The month-grid calendars, which put a holiday chip in a day cell.
const GRID_CALENDARS = {
  'NGRP Activity':      'src/components/ngrp/ActivityCalendar.jsx',
  'Rotation Activity':  'src/components/rotation/RotationActivityCalendar.jsx',
  'Unit Leader':        'src/portal/unit/UnitRotationCalendar.jsx',
  'Student Portal':     'src/portal/StudentRotationActivity.jsx',
}
// The three-slot toolbar. The Interviews calendar composes its own wider toolbar (it
// carries filters and legends), and Academics is a timeline; both still use the shared
// nav primitive, which is asserted separately.
const THREE_SLOT = {
  'NGRP Activity':     'src/components/ngrp/ActivityCalendar.jsx',
  'Rotation Activity': 'src/components/rotation/RotationActivityCalendar.jsx',
  'Unit Leader':       'src/portal/unit/UnitRotationCalendar.jsx',
  'Student Portal':    'src/portal/StudentRotationActivity.jsx',
}
const ALL_CALENDARS = {
  ...GRID_CALENDARS,
  'Interviews': 'src/components/InterviewCalendar.jsx',
  'Academics':  'src/portal/na/AcademicsCalendarView.jsx',
}

test('calendar appearance is canonical: app follows Style and portals stay Modern', () => {
  const foundation = read(FOUNDATION)
  const css = read('src/components/shared/plannerCalendar.css')
  assert.match(foundation, /const \{ style \} = useTheme\(\)/)
  assert.match(foundation, /appearance === 'modern' \|\| \(appearance === 'auto' && style === 'modern'\)/)
  assert.match(css, /\.canonical-calendar-shell\.canonical-calendar-modern \{[\s\S]*?grid-template-columns:[^;]+;[\s\S]*?gap: 0;/)
  assert.match(css, /\.canonical-calendar-modern \.canonical-calendar-sidebar \{[\s\S]*?border-right: 1px solid var\(--rule\);/)
  assert.match(css, /\.pl-planner \{[\s\S]*?border: 7px solid #85512A;/, 'Classic uses the approved wood frame')
  assert.match(css, /--pad-base: #2B3453;/, 'Classic uses the approved navy desk pad')
  assert.match(css, /\.pl-planner \.pl-cal-title,[\s\S]*?font-family: Georgia/, 'Classic uses the approved calendar typography')
  for (const name of ['Unit Leader', 'Student Portal', 'Academics']) {
    assert.match(read(ALL_CALENDARS[name]), /appearance="modern"/, `${name} is Modern-only`)
  }
  for (const name of ['NGRP Activity', 'Rotation Activity', 'Interviews']) {
    assert.match(read(ALL_CALENDARS[name]), /paper="slate"/, `${name} uses the Interview Classic planner`)
  }
})

test('Modern calendar add controls use a clear secondary and primary hierarchy', () => {
  const css = read('src/components/shared/plannerCalendar.css')
  assert.match(css, /\.canonical-calendar-modern \.pl-ghost-avail \{[\s\S]*?background: #F2F4FF;[\s\S]*?color: #1D2567;/)
  assert.match(css, /\.canonical-calendar-modern \.pl-ghost-event \{[\s\S]*?background: #1D2567;[\s\S]*?color: #FFFFFF;/)
  assert.match(css, /\.canonical-calendar-modern \.pl-ghost-mini \{[\s\S]*?border-radius: 6px !important;/)
  assert.match(css, /\.canonical-calendar-modern \.ngrp-dayadd\.pl-ghost-event:hover \{[\s\S]*?background: #151D57;/)
})

test('Modern timeline calendars can size themselves to their rendered rows', () => {
  const foundation = read(FOUNDATION)
  const css = read('src/components/shared/plannerCalendar.css')
  const academics = read(ALL_CALENDARS.Academics)
  assert.match(foundation, /contentAware = false/)
  assert.match(foundation, /canonical-calendar-content-aware/)
  assert.match(css, /\.canonical-calendar-modern\.canonical-calendar-content-aware \.pl-calbox \{[\s\S]*?height: auto;[\s\S]*?min-height: 0;[\s\S]*?padding-bottom: 12px;/)
  assert.match(academics, /appearance="modern"[\s\S]{0,80}contentAware/)
})

test('Classic calendars use the prototype paper stack under each sheet', () => {
  const foundation = read(FOUNDATION)
  const css = read('src/components/shared/plannerCalendar.css')
  assert.match(foundation, /pl-padwrap material-pagestack material-pagestack-bound/)
  assert.match(foundation, /pl-holder material-pagestack/)
  assert.match(css, /\.pl-holder\.material-pagestack::before/)
  assert.match(css, /\.pl-holder\.material-pagestack::after/)
  assert.match(css, /5px 6px 0 #E6E0D4/)
  assert.match(css, /8px 9px 0 rgba\(17, 24, 49, 0\.24\)/)
  assert.match(css, /\.pl-holder\.material-pagestack::after[\s\S]*?content: none;/)
})

test('calendar bookings use the approved pastel palette', () => {
  const legend = read('src/lib/interviewCalendarLegend.js')
  const foundation = read(FOUNDATION)
  for (const color of ['#FAE9EC', '#FAE8DF', '#E8EDFF', '#E7F7EF']) {
    assert.match(legend, new RegExp(color), `missing pastel ${color}`)
  }
  assert.match(foundation, /color \? tint\(color, 0\.18\)/, 'typed events use a pastel tint')
  assert.match(foundation, /color: color \|\| \(live \? '#24694F' : '#283665'\)/, 'event text uses its darker accent')
  assert.match(foundation, /live \? '#E7F7EF' : '#E8EDFF'/, 'activity chips use pastel state fills')
})

// ── One navigation control ───────────────────────────────────────────────────

test('every calendar navigates through the shared primitive, none hand-rolls arrows', () => {
  for (const [name, file] of Object.entries(ALL_CALENDARS)) {
    assert.match(read(file), /CanonicalCalendarNav/, `${name} must use the shared nav`)
  }
})

test('the three-slot toolbar: nav left, month centred, equal flanks', () => {
  // The PROPERTY is two equal flanks around a centred month: the label's width changes
  // with its name ("May 2027" against "September 2027"), and the flanks absorb that
  // instead of the nav. The MECHANISM may be flex or grid - the Student Portal uses
  // `grid-template-columns: 1fr auto 1fr`, which is the same three slots plus a mobile
  // reflow the others do not have. Asserting flex specifically would fail a correct
  // implementation, so this checks the shape, not the property name.
  for (const [name, file] of Object.entries(THREE_SLOT)) {
    const src = strip(read(file))
    const flexFlanks = (src.match(/flex: 1/g) || []).length >= 2
    const gridFlanks = /ptl-student-cal-toolbar/.test(src)
    assert.ok(flexFlanks || gridFlanks, `${name} needs two equal toolbar flanks`)
    assert.match(src, /<CanonicalCalendarMonthTitle ariaLive="polite">/, `${name} centres the month`)
  }
  // The three flex implementations additionally pin the nav into the left slot.
  for (const name of ['NGRP Activity', 'Rotation Activity', 'Unit Leader']) {
    assert.match(strip(read(THREE_SLOT[name])), /justifyContent: 'flex-start'/, `${name} pins the nav left`)
  }
})

test("the Student Portal's grid toolbar really is three slots", () => {
  const css = read('src/portal/portal.css')
  const rule = css.slice(css.indexOf('.ptl-student-cal-toolbar {'), css.indexOf('.ptl-student-cal-grid'))
  assert.match(rule, /grid-template-columns: 1fr auto 1fr/, 'equal flanks around an auto-width month')
})

test('NGRP no longer wraps its toolbar, which is what moved the grid on a month change', () => {
  // A long month name pushed Add Event onto a second line and the toolbar's height went
  // from 32px to 74px, shoving the whole grid down. Measured before the fix.
  const src = strip(read('src/components/ngrp/ActivityCalendar.jsx'))
  const toolbar = src.slice(src.indexOf('toolbar={'), src.indexOf('sidebar={'))
  assert.doesNotMatch(toolbar, /flexWrap/, 'the toolbar must not wrap')
  assert.doesNotMatch(toolbar, /marginLeft: 'auto'/, 'the right slot positions Add Event, not a margin')
  assert.match(toolbar, /justifyContent: 'flex-end'/, 'Add Event sits in the right slot')
})

// ── One holiday chip ─────────────────────────────────────────────────────────

test('the holiday chip is a shared primitive, defined once', () => {
  assert.match(read(FOUNDATION), /export function CanonicalHolidayChip\(\{ name, observed = false \}\)/)
  // Inline styles, no className: portal CSS is absent from the staff bundle and staff CSS
  // from the portal bundle, so a shared class would render unstyled on one side.
  const chip = read(FOUNDATION)
  const body = chip.slice(chip.indexOf('export function CanonicalHolidayChip'), chip.indexOf('A dense activity chip'))
  assert.doesNotMatch(body, /className=/, 'the shared chip may not depend on a stylesheet')
  // Amber, never an event colour: a holiday is context nobody scheduled.
  assert.match(body, /#FEF3C7/)
  assert.match(body, /#92400E/)
})

test('every calendar shows US holidays', () => {
  for (const [name, file] of Object.entries(ALL_CALENDARS)) {
    assert.match(read(file), /getUsHolidaysForRange|holidays/i, `${name} must surface holidays`)
  }
  // The four that gained the shared chip use it rather than a fifth hand-tuned copy.
  for (const name of ['Rotation Activity', 'Unit Leader', 'Academics']) {
    const file = ALL_CALENDARS[name]
    assert.match(read(file), /CanonicalHolidayChip/, `${name} must use the shared chip`)
  }
})

test('a holiday is announced, not only coloured', () => {
  // Colour is never the only signal, the rule the status pills already follow.
  for (const name of ['Rotation Activity', 'Unit Leader']) {
    const src = strip(read(ALL_CALENDARS[name]))
    assert.match(src, /dayHolidays\.length \? `\$\{base\}, \$\{dayHolidays\.map\(h => h\.name\)\.join\(', '\)\}` : base/,
      `${name} must put the holiday in the cell's accessible label`)
  }
  assert.match(read(ALL_CALENDARS.Academics), /aria-label=\{`US holidays in \$\{monthLabel\}`\}/)
})

test('the Academics timeline keeps holidays off the track, where today already lives', () => {
  const src = read(ALL_CALENDARS.Academics)
  // .ptl-na-today is already amber; a second amber mark on the same axis would read as
  // another "today". The strip sits under the axis instead, stated once for the month.
  const strip_ = src.slice(src.indexOf('monthHolidays.length > 0'), src.indexOf('inMonth.length === 0'))
  assert.match(strip_, /CanonicalHolidayChip/)
  assert.doesNotMatch(strip_, /ptl-na-track|ptl-na-today|dayPct/)
})

test('holidays stay client-computed: no calendar fetches or persists one', () => {
  for (const [name, file] of Object.entries(ALL_CALENDARS)) {
    const src = strip(read(file))
    assert.doesNotMatch(src, /holidays.*await fetch|fetch\([^)]*holiday/i, `${name} must not fetch holidays`)
  }
  const lib = strip(read('src/lib/usHolidays.js'))
  for (const forbidden of [/fetch\(/, /supabase/i, /await /]) {
    assert.doesNotMatch(lib, forbidden, 'usHolidays must stay pure date math')
  }
})

// ── The holiday data itself ──────────────────────────────────────────────────

test('federal observance: a fixed-date holiday on a weekend is observed on a weekday', () => {
  // 2027-07-04 is a Sunday, so Independence Day is observed Monday the 5th.
  const jul = getUsHolidaysForRange('2027-07-01', '2027-07-31')
  const actual = jul.find(h => h.date === '2027-07-04')
  const obs = jul.find(h => h.date === '2027-07-05')
  assert.ok(actual, 'the actual date is still reported')
  assert.ok(obs?.observed, 'and the observed weekday is reported as observed')
})

test('a month with no federal holiday returns nothing, so the strip renders nothing', () => {
  assert.deepEqual(getUsHolidaysForRange('2027-03-01', '2027-03-31'), [])
})

test('no em dash in anything this change touched', () => {
  const EM = String.fromCharCode(0x2014)
  for (const f of [FOUNDATION, ...Object.values(ALL_CALENDARS)]) {
    assert.ok(!read(f).includes(EM), `${f} contains an em dash`)
  }
})
