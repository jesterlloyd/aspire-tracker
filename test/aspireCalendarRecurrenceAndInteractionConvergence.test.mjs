// ASPIRE calendar: recurrence + interaction convergence.
//
// Functional tests exercise the pure recurrence expansion in src/lib/aspireEvents.js directly
// (the same eventOnDate/matchesRecurrence the calendar renders through). Source guards prove the
// server allow-list stays in sync, recurrence fails closed until the Owner migration is applied,
// availability anchors to its trigger while the Add Event modal stays centered, and the two create
// actions read as one converged family (order + color) everywhere they appear.
//
// Run: node --test test/aspireCalendarRecurrenceAndInteractionConvergence.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  ASPIRE_EVENT_TYPES, EVENT_TYPE_VALUES, RECURRENCE_OPTIONS, RECURRENCE_VALUES,
  ANNUAL_ALLDAY_TYPES, matchesRecurrence, eventOnDate, groupEventsByDate, eventColor,
} from '../src/lib/aspireEvents.js'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')

const staffCalendar = read('src/components/InterviewCalendar.jsx')
const aspireModal = read('src/components/AspireEventModal.jsx')
const serverApi = read('api/aspire-events.js')
const migration = read('supabase/migrations/20260731000000_add_aspire_event_recurrence.sql')

// Build an event at local noon (noon avoids DST edges in localDateStr).
const evt = (startYmd, over = {}) => ({ start_at: `${startYmd}T12:00:00`, recurrence: 'none', ...over })

// ─── Event model ────────────────────────────────────────────────────────────

test('event model: birthday is a first-class type in the shared allow-list', () => {
  assert.ok(EVENT_TYPE_VALUES.includes('birthday'))
  const birthday = ASPIRE_EVENT_TYPES.find(t => t.value === 'birthday')
  assert.ok(birthday && /^#[0-9A-Fa-f]{6}$/.test(birthday.color))
  // Birthday defaults to an annual all-day series.
  assert.ok(ANNUAL_ALLDAY_TYPES.has('birthday'))
})

test('event model: server keeps its own copy of the type allow-list, in sync with the client', () => {
  // api/ imports do not resolve at the Vercel runtime, so the list is duplicated by design.
  EVENT_TYPE_VALUES.forEach(v => {
    assert.ok(serverApi.includes(`'${v}'`), `server EVENT_TYPES missing '${v}'`)
  })
})

test('event model: recurrence set is the canonical none|weekly|monthly|annually', () => {
  assert.deepEqual(RECURRENCE_VALUES, ['none', 'weekly', 'monthly', 'annually'])
  assert.equal(RECURRENCE_OPTIONS.length, 4)
})

// ─── Recurrence expansion (functional) ────────────────────────────────────────

test('weekly recurs on the start weekday, never before the start', () => {
  const e = evt('2026-03-04', { recurrence: 'weekly' }) // a Wednesday
  assert.equal(eventOnDate(e, '2026-03-04'), true)  // start day
  assert.equal(eventOnDate(e, '2026-03-11'), true)  // +7
  assert.equal(eventOnDate(e, '2026-03-05'), false) // next day, different weekday
  assert.equal(eventOnDate(e, '2026-02-25'), false) // same weekday but BEFORE start
})

test('monthly recurs on the day-of-month; months lacking that day are skipped, never shifted', () => {
  const m = evt('2026-01-31', { recurrence: 'monthly' })
  assert.equal(eventOnDate(m, '2026-01-31'), true)
  assert.equal(eventOnDate(m, '2026-02-28'), false) // Feb has no 31st → no occurrence (not shifted to 28)
  assert.equal(eventOnDate(m, '2026-03-31'), true)
})

test('annually recurs on month+day; Feb 29 falls back to Feb 28 in non-leap years', () => {
  const b = evt('2024-02-29', { recurrence: 'annually' }) // leap-year birthday
  assert.equal(eventOnDate(b, '2024-02-29'), true)
  assert.equal(eventOnDate(b, '2025-02-28'), true)  // non-leap → Feb 28
  assert.equal(eventOnDate(b, '2028-02-29'), true)  // leap → Feb 29
  assert.equal(eventOnDate(b, '2025-03-01'), false)
})

test('recurrence_end bounds the series inclusively', () => {
  const w = evt('2026-03-04', { recurrence: 'weekly', recurrence_end: '2026-03-18' })
  assert.equal(eventOnDate(w, '2026-03-18'), true)  // on the end date
  assert.equal(eventOnDate(w, '2026-03-25'), false) // after the end date
})

test('expansion produces no duplicates: one occurrence per matching day', () => {
  const w = evt('2026-03-04', { recurrence: 'weekly' })
  const days = ['2026-03-04', '2026-03-05', '2026-03-11', '2026-03-18']
  const g = groupEventsByDate([w], days)
  assert.equal(g['2026-03-04'].length, 1)
  assert.equal(g['2026-03-11'].length, 1)
  assert.equal(g['2026-03-18'].length, 1)
  assert.equal(g['2026-03-05'], undefined) // non-matching day has no entry
})

test('one-time events are preserved: point and multi-day span, no phantom repeats', () => {
  const one = evt('2026-03-04', { recurrence: 'none' })
  assert.equal(eventOnDate(one, '2026-03-04'), true)
  assert.equal(eventOnDate(one, '2026-03-11'), false)
  const span = evt('2026-03-04', { recurrence: 'none', end_at: '2026-03-06T12:00:00' })
  assert.equal(eventOnDate(span, '2026-03-05'), true)  // inside the range
  assert.equal(eventOnDate(span, '2026-03-07'), false) // past the range
})

test('recurrence fails closed: absent or unknown cadence behaves as one-time', () => {
  const legacy = { start_at: '2026-03-04T12:00:00' } // no recurrence key (pre-migration row)
  assert.equal(eventOnDate(legacy, '2026-03-11'), false)
  const bad = evt('2026-03-04', { recurrence: 'daily' }) // not a canonical value
  assert.equal(eventOnDate(bad, '2026-03-04'), true)  // still shows on its own day
  assert.equal(eventOnDate(bad, '2026-03-05'), false) // but never expands
})

test('matchesRecurrence is deterministic and interval-1 (no builder)', () => {
  assert.equal(matchesRecurrence('weekly', '2026-03-04', '2026-03-11'), true)
  assert.equal(matchesRecurrence('weekly', '2026-03-04', '2026-03-10'), false)
  assert.equal(matchesRecurrence('monthly', '2026-01-15', '2026-04-15'), true)
  assert.equal(matchesRecurrence('annually', '2026-07-04', '2030-07-04'), true)
})

// ─── Server: allow-list + fail-closed gate ─────────────────────────────────────

test('server validates recurrence against the canonical set and gates readiness', () => {
  assert.match(serverApi, /RECURRENCE_VALUES/)
  assert.match(serverApi, /isRecurrenceReady/)
  // process is guarded (repo convention for api/ files).
  assert.match(serverApi, /global process/)
})

test('server fails closed: recurring writes 503 until the column exists', () => {
  assert.match(serverApi, /recurrence_not_enabled/)
  assert.match(serverApi, /503/)
})

test('server widens the list query for recurring parents and returns the capability flag', () => {
  // Recurring parents can start before the visible range, so they must be included.
  assert.match(serverApi, /recurrence\.neq\.none/)
  assert.match(serverApi, /recurrence_enabled/)
})

test('recurrence migration is additive, idempotent, and Owner-gated', () => {
  assert.match(migration, /ADD COLUMN IF NOT EXISTS recurrence text NOT NULL DEFAULT 'none'/)
  assert.match(migration, /ADD COLUMN IF NOT EXISTS recurrence_end date/)
  assert.match(migration, /chk_aspire_events_recurrence/)
  assert.match(migration, /'none', 'weekly', 'monthly', 'annually'/)
})

// ─── Interaction: anchored availability, centered Add Event modal ───────────────

test('Add Availability anchors to its trigger via the shared placement helper', () => {
  assert.match(staffCalendar, /import \{ computeLegendPlacement \} from '\.\/statusLegendPlacement'/)
  assert.match(staffCalendar, /computeLegendPlacement\(/)
  assert.match(staffCalendar, /triggerRect/)
  // The anchored popover is a labelled, dismissable dialog.
  assert.match(staffCalendar, /role="dialog"/)
  assert.match(staffCalendar, /aria-label="Add Availability"/)
  assert.match(staffCalendar, /Escape/)
})

test('the large Add Event modal stays centered (never anchored)', () => {
  // Constraint: do not change the centered modal. It must not adopt the anchoring machinery.
  assert.doesNotMatch(aspireModal, /triggerRect/)
  assert.doesNotMatch(aspireModal, /computeLegendPlacement/)
})

test('Add Event modal exposes Repeats gated on readiness and drops the Audience control', () => {
  assert.match(aspireModal, /RECURRENCE_OPTIONS/)
  assert.match(aspireModal, /recurrenceEnabled/)
  assert.match(aspireModal, /ANNUAL_ALLDAY_TYPES/)
})

// ─── Interaction: converged action hierarchy (order + color) ────────────────────

test('action order is Availability then Event in the header toolbar', () => {
  const availAt = staffCalendar.indexOf('onClick={handleAddAvailabilityClick}')
  const eventAt = staffCalendar.indexOf('defaultDate: selectedDate }')
  assert.ok(availAt > 0 && eventAt > 0)
  assert.ok(availAt < eventAt, 'Add Availability must precede Add Event in the header')
})

test('action colors are a single converged family, defined once', () => {
  // PLANNER-CALENDAR-1 (Owner, 2026-09-18): the Interviews add controls are PAPER now,
  // "both plain paper as drawn", with the distinction on hover and explicitly not the
  // bright violet. So this calendar no longer paints with the action palette. What the
  // Residency now follows that same treatment, so no calendar keeps a purple exception.
  const activity = read('src/components/ngrp/ActivityCalendar.jsx')
  assert.match(activity, /className="pl-ghost pl-ghost-event"/)
  assert.doesNotMatch(activity, /EVENT_ACTION|EVENT_ACTION_HOVER|#6D28D9|#5B21B6/)
  assert.match(activity, /className="ngrp-dayadd pl-ghost pl-ghost-event pl-ghost-mini"/)
  const ngrpCss = read('src/components/ngrp/ngrp.css')
  assert.doesNotMatch(ngrpCss, /\.ngrp-dayadd[^}]*background:\s*#(?:6D28D9|5B21B6)/)
  assert.match(ngrpCss, /\.ngrp-dayadd\.pl-ghost-event:hover[\s\S]*?#8F5A0A/)
  // The Interviews calendar carries no hardcoded action hex of its own either.
  assert.doesNotMatch(staffCalendar, /background:\s*'#7C3AED'/)
  // Strip comments first: a "must NOT contain" assertion happily matches the comment that
  // explains why the value is wrong, and this file's header used to quote the hex.
  const staffCode = staffCalendar.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  assert.doesNotMatch(staffCode, /#6D28D9/, 'the violet never gets copied back in')
  // Its add controls are paper, and the hover cue is the event amber, not a violet.
  assert.match(staffCalendar, /className="pl-ghost pl-ghost-event/)
  assert.match(read('src/components/shared/plannerCalendar.css'), /\.pl-ghost-event:hover \{[\s\S]*?#8F5A0A/)
})

test('regression: type chip colors are untouched by the action recolor', () => {
  assert.equal(eventColor({ event_type: 'town_hall' }), '#7C3AED') // type color unchanged
  assert.equal(eventColor({ event_type: 'milestone' }), '#9333EA')
  assert.equal(eventColor({ color: '#123456', event_type: 'custom' }), '#123456') // override wins
})
