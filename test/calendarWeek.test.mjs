// ONE-CALENDAR-1: the planner's shared Week view arithmetic, and the one interview time as it draws it.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { weekStartOf, weekDays, weekTitle, addDaysYmd, minutesOf, hhmmOf, pacificParts, weekScrollTop, overlapGroups } from '../src/lib/calendarWeek.js'
import { slotWeekItem, slotStateWord } from '../src/lib/ngrp/interviewScheduleModel.js'

test('WEEK 1: Sunday-first weeks, stepped by string arithmetic, titled like the Interviews calendar', () => {
  assert.equal(weekStartOf('2026-10-06'), '2026-10-04', 'a Tuesday belongs to the Sunday before it')
  assert.equal(weekStartOf('2026-10-04'), '2026-10-04', 'a Sunday starts its own week')
  assert.deepEqual(weekDays('2026-10-04').at(-1), '2026-10-10')
  assert.equal(addDaysYmd('2026-10-31', 1), '2026-11-01')
  assert.equal(weekTitle('2026-10-04'), 'October 4 – 10, 2026')
  assert.equal(weekTitle('2026-09-27'), 'Sep 27 – Oct 3, 2026', 'a week across a month end names both months')
})

test('WEEK 2: times, Pacific placement, and where the scroller opens', () => {
  assert.equal(minutesOf('09:30'), 570)
  assert.equal(hhmmOf(570 + 45), '10:15')
  assert.deepEqual(pacificParts('2026-11-02T16:00:00.000Z'), { date: '2026-11-02', time: '08:00' }, 'PST after the November change')
  assert.deepEqual(pacificParts('2026-10-06T16:00:00.000Z'), { date: '2026-10-06', time: '09:00' }, 'PDT')
  assert.equal(pacificParts('nope'), null)
  // The first interview of the week, a little above it; 8 AM when the week has nothing timed.
  assert.equal(weekScrollTop([{ start: '09:30' }, { start: '13:00' }], { startHour: 7, hourHeight: 64 }), 2.5 * 64 - 8)
  assert.equal(weekScrollTop([], { startHour: 7, hourHeight: 64 }), 64 - 8)
  assert.equal(weekScrollTop([{ start: '07:00' }], { startHour: 7, hourHeight: 64 }), 0, 'never negative')
  // The Interviews calendar's own numbers: a 9:30 interview sits 342px down at 140px an hour.
  assert.equal(weekScrollTop([{ start: '09:30' }], { startHour: 7, hourHeight: 140 }), 2.5 * 140 - 8)
})

test('WEEK 3: overlapping items share the column; a gap starts a new group', () => {
  const g = overlapGroups([
    { id: 'a', start: '09:00', end: '09:30' }, { id: 'b', start: '09:15', end: '09:45' }, { id: 'c', start: '10:00', end: '10:30' },
  ])
  assert.deepEqual(g.map(x => x.map(i => i.id)), [['a', 'b'], ['c']])
})

test('WEEK 4: an interview time on the week grid is on its Pacific date, for its duration, in its state\'s colour', () => {
  const booked = { id: 's1', unit_key: '6 NE', slot_at: '2026-10-06T16:00:00.000Z', duration_minutes: 30, status: 'booked', booked: true, booked_name: 'Reyes, Jordan' }
  const item = slotWeekItem(booked, { showUnit: true })
  assert.equal(item.date, '2026-10-06'); assert.equal(item.start, '09:00'); assert.equal(item.end, '09:30')
  assert.equal(item.label, '6 NE · Reyes, Jordan'); assert.equal(item.color, '#1D2567')
  assert.equal(slotWeekItem({ ...booked, status: 'blocked', booked: false, booked_name: null }).label, 'Blocked')
  assert.equal(slotStateWord({ status: 'available', booked: false }), 'Open')
  assert.equal(slotWeekItem({ ...booked, slot_at: 'bad' }), null)
})

test('WEEK 5: a residency cohort\'s key dates are dated items for the unit leader\'s calendar (ONE-CALENDAR-3)', async () => {
  const { cycleDateItems, KEY_DATE_COLOR } = await import('../src/lib/ngrp/interviewScheduleModel.js')
  const items = cycleDateItems([{ id: 'c1', name: 'Winter 2027', application_open_date: '2026-10-03', application_deadline: '2026-10-14', interview_window_start: '2026-10-06', interview_window_end: '2026-10-07', residency_start_date: '2027-01-11T00:00:00+00:00', licensure_deadline: '2026-12-01' }])
  assert.deepEqual(items.map(i => [i.date, i.label]), [
    ['2026-10-03', 'Application opens'], ['2026-10-06', 'Interviews begin'], ['2026-10-07', 'Interviews end'], ['2026-10-14', 'Application deadline'], ['2027-01-11', 'Residency starts'],
  ], 'sorted by date, the licensure deadline left to the alumnus, a timestamp read as its date')
  assert.ok(items.every(i => i.color === KEY_DATE_COLOR && i.cycle === 'Winter 2027'))
  assert.deepEqual(cycleDateItems([{ id: 'c2', name: 'X', interview_window_start: '2026-11-02', interview_window_end: '2026-11-02' }]).map(i => i.label), ['Interviews begin'], 'a one-day window is one item')
  assert.deepEqual(cycleDateItems([]), [])
})
