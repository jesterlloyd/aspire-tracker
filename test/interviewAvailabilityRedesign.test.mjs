// AVAILABILITY-CALENDAR-1: the calendar-style Add Availability editor, the
// unified day representation, and the delete-integrity fixes.
//
// AUDITED MODEL (confirmed, not assumed): interview_availability_blocks is the
// PARENT; interview_slots.block_id are STORED children generated at creation.
// The day drawer used to render the children ("Open Availability Slots") and
// the parents ("Availability Blocks") as two unrelated sections, which is why
// the same availability appeared twice and deleting from one left the other on
// screen. Breaks are a GENERATION parameter with no schema: the gap is
// recoverable from the stored slot times.
//
// Run: node --test test/interviewAvailabilityRedesign.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  parseTimeInput, nextHalfHourFrom, generateSlotTimes, slotCountFor,
  deriveBreakMinutes, describeCadence, toHHMM, formatTime12,
  INTERVIEW_LENGTHS, BREAK_OPTIONS, DEFAULT_BREAK_MINUTES, interviewLengthLabel, breakLabel,
} from '../src/lib/interviewAvailability.js'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')
const calendar = read('src/components/InterviewCalendar.jsx')
const drawer   = read('src/components/InterviewDayDrawer.jsx')
const api      = read('api/availability.js')

// ── Nearest-30-minute default ────────────────────────────────────────────────

test('Start defaults to the NEXT nearest 30-minute mark', () => {
  assert.equal(nextHalfHourFrom(new Date(2026, 7, 3, 9, 1)), '09:30')
  assert.equal(nextHalfHourFrom(new Date(2026, 7, 3, 9, 29)), '09:30')
  assert.equal(nextHalfHourFrom(new Date(2026, 7, 3, 9, 31)), '10:00')
  // An exact mark advances: that minute has already begun.
  assert.equal(nextHalfHourFrom(new Date(2026, 7, 3, 9, 30)), '10:00')
  assert.equal(nextHalfHourFrom(new Date(2026, 7, 3, 9, 0)), '09:30')
  // Never rolls past the end of the day.
  assert.equal(nextHalfHourFrom(new Date(2026, 7, 3, 23, 55)), '23:30')
  assert.match(calendar, /const initialStart = startTime \|\| nextHalfHourFrom\(\)/)
})

// ── Direct time input ────────────────────────────────────────────────────────

test('times can be typed directly in the shapes people actually use', () => {
  assert.equal(parseTimeInput('9'), '09:00')
  assert.equal(parseTimeInput('930'), '09:30')
  assert.equal(parseTimeInput('9:30'), '09:30')
  assert.equal(parseTimeInput('9:30 AM'), '09:30')
  assert.equal(parseTimeInput('9:30pm'), '21:30')
  assert.equal(parseTimeInput('1315'), '13:15')
  assert.equal(parseTimeInput('13:15'), '13:15')
  assert.equal(parseTimeInput('12am'), '00:00')
  assert.equal(parseTimeInput('12pm'), '12:00')
  // Unreadable input is rejected rather than guessed.
  for (const bad of ['', 'noon', '99', '9:75', '25:00', 'abc']) {
    assert.equal(parseTimeInput(bad), null, `${bad} must not parse`)
  }
  // The editor commits typed text instead of stepping a native time input.
  assert.match(calendar, /onBlur=\{e => commitTime\('start', e\.target\.value\)\}/)
  assert.match(calendar, /if \(e\.key === 'Enter'\) \{ e\.preventDefault\(\); commitTime\('end'/)
  assert.doesNotMatch(calendar.slice(calendar.indexOf('avail-start'), calendar.indexOf('Duration')), /type="time"/)
})

// ── Duration suggestions ─────────────────────────────────────────────────────

test('AVAILABILITY-CALENDAR-1B: the separate Duration section is gone', () => {
  // Start and End already define the availability window, so a second
  // "duration" control competed with Interview length. Removing it also
  // removed the "1.5.5 hours" label bug that lived in its chip formatter.
  assert.doesNotMatch(calendar, /DURATION_SUGGESTIONS/)
  assert.doesNotMatch(calendar, /const applyDuration/)
  assert.doesNotMatch(calendar, /<div style=\{labelStyle\}>Duration<\/div>/)
  assert.doesNotMatch(calendar, /\$\{mins % 60 \? '\.5' : ''\}/, 'the 1.5.5 hours formatter is gone')
  assert.doesNotMatch(calendar, /1\.5\.5/)
  // The window is still fully controllable by typing Start and End.
  assert.match(calendar, /aria-label="Start time"/)
  assert.match(calendar, /aria-label="End time"/)
  assert.equal(toHHMM(9 * 60 + 90), '10:30')
})

// ── Break-aware generation, no overflow ──────────────────────────────────────

test('breaks change the stride, never the interview length', () => {
  // 9:00-13:00, 30-minute interviews, 10-minute breaks -> starts every 40 min.
  const times = generateSlotTimes({ start: '09:00', end: '13:00', duration: 30, breakMinutes: 10 })
  assert.deepEqual(times, ['09:00', '09:40', '10:20', '11:00', '11:40', '12:20'])
  assert.equal(times.length, 6)
  // No break is the previous behavior exactly.
  assert.equal(slotCountFor({ start: '09:00', end: '13:00', duration: 30, breakMinutes: 0 }), 8)
  // The DEFAULT cadence: 9:00-13:00, 30-minute interviews, 15-minute breaks.
  // Starts every 45 minutes; 12:45 would end at 13:15 and is correctly excluded.
  assert.deepEqual(
    generateSlotTimes({ start: '09:00', end: '13:00', duration: 30, breakMinutes: DEFAULT_BREAK_MINUTES }),
    ['09:00', '09:45', '10:30', '11:15', '12:00'])
})

test('a slot that would run past the end time is never created', () => {
  // The last start is 12:20 and ends 12:50; 13:00 would need a 13:00-13:30 slot.
  const times = generateSlotTimes({ start: '09:00', end: '13:00', duration: 30, breakMinutes: 10 })
  const lastEnd = times.length ? Number(times.at(-1).slice(0, 2)) * 60 + Number(times.at(-1).slice(3)) + 30 : 0
  assert.ok(lastEnd <= 13 * 60, 'no slot ends after the block end')
  // A window too small for even one interview yields nothing.
  assert.deepEqual(generateSlotTimes({ start: '09:00', end: '09:20', duration: 30, breakMinutes: 0 }), [])
  // A trailing gap that cannot fit another interview is simply not used.
  assert.deepEqual(generateSlotTimes({ start: '09:00', end: '10:05', duration: 30, breakMinutes: 5 }), ['09:00', '09:35'])
})

test('the server generates with the same stride and rejects unknown breaks', () => {
  assert.match(api, /const stride = dur \+ rawBreak;/)
  assert.match(api, /for \(let t = startTotal; t \+ dur <= endTotal; t \+= stride\)/)
  assert.match(api, /const ALLOWED_BREAKS = \[0, 5, 10, 15, 30\];/)
  assert.match(api, /!ALLOWED_BREAKS\.includes\(rawBreak\)/)
  // No migration: the break is never written as a column.
  assert.doesNotMatch(api, /break_minutes:\s*rawBreak/)
  assert.doesNotMatch(api, /\.insert\(\{[^}]*break_minutes/)
})

// ── Live preview ─────────────────────────────────────────────────────────────

test('the preview promises exactly what the server will create', () => {
  assert.match(calendar, /const slotCount = slotCountFor\(\{/)
  assert.match(calendar, /break_minutes:\s+form\.break_minutes,/)
  assert.match(calendar, /interview slot\{slotCount !== 1 \? 's' : ''\} will be created/)
  assert.match(calendar, /\{describeCadence\(form\.duration_minutes, form\.break_minutes\)\}/)
  assert.equal(describeCadence(30, 10), '30-minute interviews with 10-minute breaks')
  assert.equal(describeCadence(45, 0), '45-minute interviews with no breaks')
  assert.equal(formatTime12('13:00'), '1:00 PM')
})

test('Interview length is 30/45/60 only, labelled "1 hour" at the top', () => {
  assert.deepEqual(INTERVIEW_LENGTHS, [30, 45, 60])
  assert.ok(Math.max(...INTERVIEW_LENGTHS) === 60, 'never longer than an hour')
  assert.equal(interviewLengthLabel(30), '30 minutes')
  assert.equal(interviewLengthLabel(60), '1 hour')
  assert.match(calendar, />Interview length</)
  assert.doesNotMatch(calendar, />Slot Duration</)
  assert.match(calendar, /interviewLengthLabel\(m\)/)
  assert.match(calendar, /Create availability/)
})

test('the break defaults to 15 minutes; No break is retained but never default', () => {
  assert.equal(DEFAULT_BREAK_MINUTES, 15)
  assert.deepEqual(BREAK_OPTIONS, [0, 5, 10, 15, 30])
  assert.equal(breakLabel(0), 'No break')
  assert.equal(breakLabel(15), '15 minutes')
  assert.match(calendar, />Break between interviews</)
  assert.match(calendar, /break_minutes:\s+DEFAULT_BREAK_MINUTES,/)
  // 0 stays valid server-side: every block created before breaks existed is a
  // zero-break block, and back-to-back interviewing remains a real pattern.
  assert.match(api, /const ALLOWED_BREAKS = \[0, 5, 10, 15, 30\];/)
})

// ── Unified day representation ───────────────────────────────────────────────

test('the day shows each parent block once, with its slots nested', () => {
  assert.match(drawer, /const availabilityGroups = \(\(\) => \{/)
  assert.match(drawer, /const key = slot\.block_id \|\| '__unlinked__'/)
  assert.match(drawer, /<SectionHeader title="Availability"/)
  // The two old sibling sections are gone.
  assert.doesNotMatch(drawer, /title="Open Availability Slots"/)
  assert.doesNotMatch(drawer, /title="Availability Blocks"/)
  // Slots with a missing parent are still surfaced, not dropped.
  assert.match(drawer, /Unlinked slots/)
  // A fully booked block keeps a home in the day.
  assert.match(drawer, /const fullyBookedBlocks = \(\(\) => \{/)
  assert.match(drawer, /title="Fully Booked Availability"/)
})

test('the parent summary derives the break from stored slot times', () => {
  assert.match(drawer, /import \{ deriveBreakMinutes \} from '\.\.\/lib\/interviewAvailability'/)
  assert.match(drawer, /interview slot\$\{count !== 1 \? 's' : ''\}/)
  assert.match(drawer, /\$\{brk\}-minute breaks/)
  assert.equal(deriveBreakMinutes(['09:00', '09:40', '10:20'], 30), 10)
  assert.equal(deriveBreakMinutes(['09:00', '09:30', '10:00'], 30), 0)
  assert.equal(deriveBreakMinutes(['09:00'], 30), 0)
  // Irregular spacing is reported as unknown rather than as a wrong number.
  assert.equal(deriveBreakMinutes(['09:00', '09:40', '10:00'], 30), null)
})

// ── Delete semantics ─────────────────────────────────────────────────────────

test('INTEGRITY FIX: a refused block delete no longer destroys the open slots', () => {
  const handler = api.slice(api.indexOf("if (action === 'delete_block')"), api.indexOf("if (action === 'delete_slot')"))
  const countIdx = handler.indexOf("eq('is_booked', true)")
  const deleteIdx = handler.indexOf("eq('is_booked', false)")
  assert.ok(countIdx > -1 && deleteIdx > countIdx,
    'the booked count must be taken BEFORE any slot deletion')
  assert.match(handler, /booked > 0 && body\.open_only !== true/)
  assert.match(handler, /return res\.status\(409\)[\s\S]{0,200}booked_count: booked/)
})

test('a partially booked block releases only its open slots and keeps the parent', () => {
  const handler = api.slice(api.indexOf("if (action === 'delete_block')"), api.indexOf("if (action === 'delete_slot')"))
  assert.match(handler, /if \(booked > 0\) \{[\s\S]{0,400}block_retained: true/)
  // Booked slots are never deleted, and the block row survives so nothing is orphaned.
  assert.doesNotMatch(handler, /delete\(\)[\s\S]{0,80}eq\('is_booked', true\)/)
})

test('deleting one open slot goes through the endpoint and keeps the parent', () => {
  assert.match(api, /if \(action === 'delete_slot'\) \{/)
  assert.match(api, /if \(slot\.is_booked\) \{[\s\S]{0,160}status\(409\)/)
  assert.match(api, /remaining_open: remainingOpen/)
  // The drawer no longer writes to interview_slots directly.
  assert.match(drawer, /action: 'delete_slot', slot_id: slotId/)
  assert.doesNotMatch(drawer, /from\('interview_slots'\)\.delete\(\)/)
})

test('booked interviews are protected on every path', () => {
  // Block delete: refuses or preserves. Slot delete: refuses outright.
  assert.match(api, /That slot is booked\. Cancel the interview first\./)
  assert.match(api, /Cancel those bookings first, or remove only the open slots\./)
  // Ownership is enforced for single-slot deletion, as it is for blocks.
  const slotHandler = api.slice(api.indexOf("if (action === 'delete_slot')"), api.indexOf("if (action === 'cancel_booking')"))
  assert.match(slotHandler, /if \(!adminLevel\) \{/)
  assert.match(slotHandler, /created_by_user_id !== auth\.profileId/)
})

test('the allowed action list gained delete_slot and nothing else', () => {
  assert.match(api, /const ALLOWED_ACTIONS = \['create_block', 'delete_block', 'delete_slot', 'cancel_booking'\];/)
})
