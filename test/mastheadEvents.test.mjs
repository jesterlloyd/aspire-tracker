// MASTHEAD-LOCKSCREEN-1: which events earn a masthead chip, and what it says.
// The rule is the Owner's (2026-09-04): explicitly flagged or a milestone, AND
// inside the next 14 days. Nothing further out, whatever it is.
//
// Run: node --test test/mastheadEvents.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  MASTHEAD_WINDOW_DAYS, mastheadItems, holidayItems, chipWhen, daysUntil, addDays, isMastheadCandidate,
} from '../src/lib/mastheadEvents.js'
import { clockLabel, dateLabel, planFit } from '../src/lib/mastheadClock.js'

const TODAY = '2026-09-04'
const at = (ymd, hh = '09:00') => `${ymd}T${hh}:00`     // local wall time, like the API's timestamps in this zone
const ev = (over) => ({ id: over.title, title: 'Event', start_at: at(TODAY), all_day: false, show_on_welcome: false, is_milestone: false, ...over })

test('the window is fourteen days', () => {
  assert.equal(MASTHEAD_WINDOW_DAYS, 14)
})

test('only flagged or milestone events are candidates', () => {
  assert.equal(isMastheadCandidate(ev({ show_on_welcome: true })), true)
  assert.equal(isMastheadCandidate(ev({ is_milestone: true })), true)
  assert.equal(isMastheadCandidate(ev({})), false)
  assert.equal(isMastheadCandidate(null), false)
})

test('an event inside the window earns a chip; one day past it does not', () => {
  const inside = ev({ title: 'Cohort orientation', show_on_welcome: true, start_at: at(addDays(TODAY, 14)) })
  const outside = ev({ title: 'Applications close', is_milestone: true, start_at: at(addDays(TODAY, 15)) })
  const items = mastheadItems([inside, outside], TODAY)
  assert.deepEqual(items.map(i => i.text), ['Cohort orientation · in 14 days'])
})

test('"in 67 days" never appears: a far milestone is silent, not shown', () => {
  const far = ev({ title: 'Applications close', is_milestone: true, show_on_welcome: true, start_at: at(addDays(TODAY, 67)) })
  assert.deepEqual(mastheadItems([far], TODAY), [])
})

test('chip wording: time today, "tomorrow", then "in N days"', () => {
  assert.equal(chipWhen(0, ev({ all_day: true })), 'All day')
  assert.match(chipWhen(0, ev({ start_at: at(TODAY, '14:30') })), /2:30 PM/)
  assert.equal(chipWhen(1, ev({})), 'tomorrow')
  assert.equal(chipWhen(8, ev({})), 'in 8 days')
})

test('milestones lead, then by distance, then by start time', () => {
  const items = mastheadItems([
    ev({ title: 'Huddle', show_on_welcome: true, start_at: at(addDays(TODAY, 8)) }),
    ev({ title: 'Orientation', show_on_welcome: true, start_at: at(TODAY, '09:00') }),
    ev({ title: 'Applications close', is_milestone: true, start_at: at(addDays(TODAY, 12)) }),
    ev({ title: 'Town hall', show_on_welcome: true, start_at: at(TODAY, '08:00') }),
  ], TODAY)
  assert.deepEqual(items.map(i => i.text), [
    'Applications close · in 12 days',
    'Town hall · 8:00 AM',
    'Orientation · 9:00 AM',
    'Huddle · in 8 days',
  ])
  assert.equal(items[0].milestone, true)
  assert.equal(items[1].milestone, false)
})

test('a multi-day event already under way counts as today', () => {
  const span = ev({ title: 'Conference', show_on_welcome: true, start_at: at(addDays(TODAY, -2)), end_at: at(addDays(TODAY, 2)), all_day: true })
  assert.equal(daysUntil(span, TODAY), 0)
  assert.deepEqual(mastheadItems([span], TODAY).map(i => i.text), ['Conference · All day'])
})

test('a weekly recurring event surfaces on its next occurrence inside the window', () => {
  const weekly = ev({ title: 'Preceptor huddle', show_on_welcome: true, start_at: at(addDays(TODAY, -4), '14:30'), recurrence: 'weekly' })
  assert.equal(daysUntil(weekly, TODAY), 3)
  assert.deepEqual(mastheadItems([weekly], TODAY).map(i => i.text), ['Preceptor huddle · in 3 days'])
})

test("nothing qualifies -> no items, so the row shows only the calendar pill", () => {
  assert.deepEqual(mastheadItems([ev({ title: 'Unflagged' })], TODAY), [])
  assert.deepEqual(mastheadItems([], TODAY), [])
  assert.deepEqual(mastheadItems(null, TODAY), [])
})

test("today's holidays become chips", () => {
  assert.deepEqual(holidayItems([{ name: 'Labor Day' }]).map(i => i.text), ['Labor Day · US Holiday'])
  assert.deepEqual(holidayItems([]), [])
})

test('the clock is twelve-hour, zero-padded, with no AM/PM', () => {
  assert.equal(clockLabel(new Date(2026, 8, 4, 7, 5)), '07:05')
  assert.equal(clockLabel(new Date(2026, 8, 4, 19, 29)), '07:29')
  assert.equal(clockLabel(new Date(2026, 8, 4, 0, 0)), '12:00')
  assert.equal(clockLabel(new Date(2026, 8, 4, 12, 0)), '12:00')
  assert.doesNotMatch(clockLabel(new Date(2026, 8, 4, 19, 29)), /AM|PM/)
})

test('the date is "Friday, 4 Sep": full weekday, day, three-letter month, no year', () => {
  assert.equal(dateLabel(new Date(2026, 8, 4)), 'Friday, 4 Sep')
  assert.equal(dateLabel(new Date(2026, 11, 25)), 'Friday, 25 Dec')
  assert.doesNotMatch(dateLabel(new Date(2026, 8, 4)), /2026/)
})

test('the width match tracks the clock out when the date is wider, and scales the date up when it is narrower', () => {
  // A long date over a tightened clock: the clock spreads, the date keeps its size.
  const wide = planFit({ dateW: 131, clockW: 84, baseFontPx: 13, glyphs: 5 })
  assert.equal(wide.kind, 'track')
  assert.ok(Math.abs(wide.letterSpacingPx - (131 - 84) / 5) < 1e-9)
  assert.equal(wide.paddingLeftPx, wide.letterSpacingPx, 'padding balances the trailing spacing')
  // A short date under the clock: the date grows to meet it, capped.
  const narrow = planFit({ dateW: 75, clockW: 84, baseFontPx: 13, glyphs: 5 })
  assert.equal(narrow.kind, 'scale')
  assert.ok(Math.abs(narrow.fontSizePx - 13 * 84 / 75) < 1e-9)
  assert.equal(planFit({ dateW: 20, clockW: 84, baseFontPx: 13, glyphs: 5 }).fontSizePx, 16, 'never past the cap')
  // The failure mode this exists to prevent: the date is never fitted DOWN.
  assert.notEqual(wide.kind, 'scale')
  assert.equal(planFit({ dateW: 0, clockW: 84, baseFontPx: 13, glyphs: 5 }).kind, 'none')
})
