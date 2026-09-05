// MASTHEAD-LOCKSCREEN-1: the masthead is a lock screen (Owner, 2026-09-04).
// Greeting left, date over a live clock in the centre, weather right, an
// events row along the bottom; white ink over the full-colour artwork with
// no fade and no veil; every operational item a chip. These pin the contract
// on BOTH hosts so the staff card and the portal card cannot drift apart.
//
// Run: node --test test/mastheadLockscreen.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')
const staff = read('src/components/TodayMasthead.jsx')
const shared = read('src/components/masthead/GreetingMasthead.jsx')
const css = read('src/index.css')

test('both hosts carry the same three columns and the events row', () => {
  for (const [name, src] of [['TodayMasthead', staff], ['GreetingMasthead', shared]]) {
    assert.match(src, /<div className="mast-left">/, `${name}: greeting column`)
    assert.match(src, /<MastheadClock \/>/, `${name}: the clock column`)
    assert.match(src, /<div className="mast-right">/, `${name}: weather column`)
    assert.match(src, /<MastheadEventsRow /, `${name}: the events row`)
    // Retired from the card: the date-and-cohort line and the milestone block.
    assert.doesNotMatch(src, /className="mast-sub"/, `${name}: no date-and-cohort line`)
    assert.doesNotMatch(src, /className="mast-mile"/, `${name}: no milestone block`)
    assert.doesNotMatch(src, /Next milestone/, `${name}: the milestone is a chip now`)
  }
})

test('the staff card applies the shared window rule and always offers Open Calendar', () => {
  assert.match(staff, /import \{ mastheadItems, holidayItems \} from '\.\.\/lib\/mastheadEvents'/)
  assert.match(staff, /mastheadItems\(events, today\)/)
  assert.match(staff, /calendar=\{\{ label: 'Open Calendar', onClick: \(\) => navigate\('\/interviews'\) \}\}/)
  // No private "next milestone however far away" logic survives.
  assert.doesNotMatch(staff, /IMPORTANT_TYPES|nextMilestone|milestoneWhen/)
})

test('the events row: sentence-case label only when something qualifies, pill last', () => {
  const row = read('src/components/masthead/MastheadEventsRow.jsx')
  assert.match(row, /if \(list\.length === 0 && !calendar\) return null/)
  assert.match(row, /\{list\.length > 0 && <span className="mast-today-label">Events Today<\/span>\}/)
  assert.doesNotMatch(row, /Today in ASPIRE/)
  // The pill is the last child of the row.
  const pill = row.indexOf('mast-cal-btn mast-cal-btn-inline')
  const lastChip = row.lastIndexOf('mast-evchip')
  assert.ok(pill > lastChip, 'Open Calendar renders after the chips')
  assert.match(css, /\.mast-scenic \.mast-today-label \{[^}]*text-transform: none;/)
})

test('the artwork is no longer faded under the greeting', () => {
  const img = css.slice(css.indexOf('.mast-scn-img {'), css.indexOf('.mast-scene-day .mast-scn-img-day'))
  assert.doesNotMatch(img, /mask-image/, 'no left fade on the scene frames')
  assert.match(img, /NO left fade any more/)
})

test('white ink with a dark drop shadow on every scene, day and night; no halo, no veil', () => {
  assert.match(css, /\.mast-scenic \.mast-clock, \.mast-scenic h1\.mast-greet, \.mast-scenic \.mast-date,\n\.mast-scenic \.wx-mast-temp, \.mast-scenic \.wx-mast-cond, \.mast-scenic \.mast-today-label \{\n {2}color: #fff;\n {2}text-shadow: 0 1px 2px rgba\(0,0,0,0\.55\), 0 2px 14px rgba\(0,0,0,0\.45\);/)
  // The pair block must stay the first '.mast-scenic .mast-greet,' in the file (chartToday reads it by first match).
  assert.ok(css.indexOf('.mast-scenic .mast-greet,') === css.indexOf('.mast-scenic .mast-greet,\n.mast-scenic .wx-mast-temp {'), 'the pair is the first .mast-scenic .mast-greet, selector')
  assert.doesNotMatch(css, /\.mast-scenic:not\(\.mast-night\) \.mast-greet[^{]*\{\n {2}text-shadow: 0 1px 10px rgba\(255,255,255/, 'the daytime white halo is gone')
  assert.doesNotMatch(css, /mast-veil|mast-vignette|mast-scrim/)
})

test('the pair is small and all sans; the clock is the one large element', () => {
  const pair = css.slice(css.indexOf('.mast-scenic .mast-greet,\n.mast-scenic .wx-mast-temp {'))
  assert.match(pair.slice(0, pair.indexOf('\n}')), /font-size: 19px/)
  assert.match(pair, /\.mast-scenic \.mast-greet\.chart-route-title \{[^}]*font-family: 'Plus Jakarta Sans', sans-serif; font-weight: 700;/)
  assert.doesNotMatch(pair.slice(0, pair.indexOf('.mast-scenic .wx-mast-temp { color')), /var\(--chart-serif\)/)
  assert.match(css, /\.mast-clock \{\n {2}font-family: 'Plus Jakarta Sans', sans-serif; font-weight: 500;\n {2}font-size: 32px;/)
  // The base greeting block the scale guard reads by first match is untouched.
  assert.match(css, /\.mast-greet \{[\s\S]*?font-size: 30px; margin: 0; line-height: 1\.25; padding-bottom: 2px;/)
})

test('the weather shows temperature and condition; the city lives in the hover', () => {
  const wx = read('src/components/WeatherScene.jsx')
  const trigger = wx.slice(wx.indexOf('className="wx-mast-caption wx-mast-trigger"'), wx.indexOf('</button>'))
  assert.match(trigger, /wx-mast-temp/)
  assert.match(trigger, /wx-mast-cond/)
  assert.doesNotMatch(trigger, /wx-mast-hilo|wx-mast-city/, 'H/L and city are off the card')
  assert.match(trigger, /title=\{`\$\{location\.label\} · Choose masthead scenery`\}/)
  // The accessible readout still speaks the full reading.
  assert.match(wx, /const readout = `\$\{label \|\| 'Weather'\}, \$\{data\.temp\} degrees/)
})

test('the layout is a three-column grid with the clock centred on the card', () => {
  assert.match(css, /\.mast-scenic \.mast-row \{\n {2}display: grid; grid-template-columns: 1fr auto 1fr;/)
  assert.match(css, /\.mast-centre \{\n {2}grid-column: 2; justify-self: center; align-self: center;/)
  assert.match(css, /@media \(max-width: 760px\) \{[\s\S]*?\.mast-centre \{ grid-column: 1 \/ -1; grid-row: 2;/)
})

test('the calendar flag is named for what it does now', () => {
  assert.match(read('src/components/AspireEventModal.jsx'), /Show in Masthead/)
  assert.doesNotMatch(read('src/components/AspireEventModal.jsx'), /Show on Aggregate welcome/)
  assert.match(read('src/components/InterviewCalendar.jsx'), />In masthead</)
  // The column did not change, so every already-flagged event carries over.
  assert.match(read('src/lib/mastheadEvents.js'), /ev\.show_on_welcome \|\| ev\.is_milestone/)
})

test('the Residency At a Glance folds its milestone into the same window', () => {
  const glance = read('src/components/ngrp/AtAGlanceTab.jsx')
  assert.match(glance, /import \{ MASTHEAD_WINDOW_DAYS \} from '\.\.\/\.\.\/lib\/mastheadEvents'/)
  assert.match(glance, /nextMilestone\.daysAway <= MASTHEAD_WINDOW_DAYS/)
  assert.match(glance, /items=\{mastheadItems\}/)
  assert.doesNotMatch(glance, /milestone=\{mastheadMilestone\}/)
})
