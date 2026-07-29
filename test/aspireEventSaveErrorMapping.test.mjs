// ASPIRE calendar: safe event save-error mapping.
//
// Functional tests drive the exported server classifier (classifyWriteError) directly, proving each
// database failure maps to a distinct, coded, SAFE response that never leaks raw Postgres internals.
// Source guards prove both the create and update paths use it, the recurrence-readiness 503 and the
// permission 403 stay distinct (not inferred from a generic 23514), and the modal surfaces the safe
// server message with a safe fallback.
//
// Run: node --test test/aspireEventSaveErrorMapping.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { classifyWriteError } from '../api/aspire-events.js'
import { ANNUAL_ALLDAY_TYPES } from '../src/lib/aspireEvents.js'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')
const serverApi = read('api/aspire-events.js')
const modal = read('src/components/AspireEventModal.jsx')

// A deliberately leaky Postgres error, to prove none of it reaches the client body.
const leaky = (code, constraint) => ({
  code,
  message: `new row for relation "aspire_events" violates check constraint "${constraint}"`,
  details: 'Failing row contains (id, Jester secret payload, ...).',
  hint: 'internal hint text',
})

// ─── Server classifier (functional) ────────────────────────────────────────────

test('23514 on aspire_events_event_type_chk → 422 EVENT_TYPE_UNAVAILABLE', () => {
  const r = classifyWriteError(leaky('23514', 'aspire_events_event_type_chk'))
  assert.equal(r.status, 422)
  assert.deepEqual(r.body, { error: "That event type isn't available yet.", code: 'EVENT_TYPE_UNAVAILABLE' })
})

test('23514 on aspire_events_end_after_start_chk → 422 INVALID_EVENT_DATES', () => {
  const r = classifyWriteError(leaky('23514', 'aspire_events_end_after_start_chk'))
  assert.equal(r.status, 422)
  assert.deepEqual(r.body, { error: 'Please check the event dates.', code: 'INVALID_EVENT_DATES' })
})

test('23514 on chk_aspire_events_recurrence_end → 422 INVALID_EVENT_DATES', () => {
  const r = classifyWriteError(leaky('23514', 'chk_aspire_events_recurrence_end'))
  assert.equal(r.status, 422)
  assert.deepEqual(r.body, { error: 'Please check the event dates.', code: 'INVALID_EVENT_DATES' })
})

test('recurrence readiness is NOT inferred from a generic 23514', () => {
  // A cadence-constraint violation is not a readiness problem; it must not masquerade as one.
  const r = classifyWriteError(leaky('23514', 'chk_aspire_events_recurrence'))
  assert.notEqual(r.body.code, 'EVENT_TYPE_UNAVAILABLE')
  assert.notEqual(r.body.code, 'INVALID_EVENT_DATES')
  assert.equal(r.body.code, 'EVENT_SAVE_FAILED')
  assert.notEqual(r.status, 503)
})

test('unknown failures stay generic EVENT_SAVE_FAILED', () => {
  assert.deepEqual(classifyWriteError({ code: '23505', message: 'dup' }).body, { error: 'Could not save the event.', code: 'EVENT_SAVE_FAILED' })
  assert.deepEqual(classifyWriteError(null).body, { error: 'Could not save the event.', code: 'EVENT_SAVE_FAILED' })
  assert.equal(classifyWriteError(undefined).status, 500)
})

test('no raw database message, details, hint, or constraint name reaches the client body', () => {
  for (const constraint of ['aspire_events_event_type_chk', 'aspire_events_end_after_start_chk', 'chk_aspire_events_recurrence_end']) {
    const body = classifyWriteError(leaky('23514', constraint)).body
    const serialized = JSON.stringify(body)
    assert.deepEqual(Object.keys(body).sort(), ['code', 'error']) // only these two keys, ever
    assert.ok(!/violates|Failing row|secret|hint|relation/i.test(serialized), `leaked internals for ${constraint}`)
    assert.ok(!serialized.includes(constraint), `leaked constraint name for ${constraint}`)
  }
})

// ─── Server wiring (source guards) ─────────────────────────────────────────────

test('both create and update write-error branches use the classifier', () => {
  const uses = serverApi.match(/const mapped = classifyWriteError\(error\)/g) || []
  assert.ok(uses.length >= 2, `expected classifier in create AND update, found ${uses.length}`)
  // The old generic swallow is gone.
  assert.doesNotMatch(serverApi, /message: 'Could not create the event\.'/)
  assert.doesNotMatch(serverApi, /message: 'Could not update the event\.'/)
})

test('recurrence-readiness 503 and permission 403 remain distinct paths', () => {
  assert.match(serverApi, /status\(503\)\.json\(\{ error: 'recurrence_not_enabled'/)
  assert.match(serverApi, /status\(403\)\.json\(\{ error: 'forbidden', code: 'EVENT_PERMISSION_DENIED'/)
})

// ─── Client display (source guard + behavioral truth table) ────────────────────

// The exact rule the modal uses (kept in sync by the source guard below).
const clientPick = (json, fallback) => json?.message || (json?.code ? json.error : null) || fallback

test('client surfaces the safe coded message, an explicit message, or the fallback — never a bare slug', () => {
  assert.equal(clientPick({ error: "That event type isn't available yet.", code: 'EVENT_TYPE_UNAVAILABLE' }, 'fb'), "That event type isn't available yet.")
  assert.equal(clientPick({ error: 'invalid_request', field: 'title', message: 'Title is required.' }, 'fb'), 'Title is required.')
  assert.equal(clientPick({ error: 'not_found' }, 'fb'), 'fb')  // bare slug (no code) → fallback, not leaked
  assert.equal(clientPick({}, 'fb'), 'fb')
})

test('modal uses safeServerError with that exact rule on save and archive', () => {
  assert.match(modal, /const safeServerError = \(json, fallback\) => json\?\.message \|\| \(json\?\.code \? json\.error : null\) \|\| fallback/)
  assert.match(modal, /setError\(safeServerError\(json, 'Could not save the event\. Please try again\.'\)\)/)
  assert.match(modal, /setError\(safeServerError\(json, 'Could not archive the event\.'\)\)/)
  assert.doesNotMatch(modal, /setError\(json\.message \|\| 'Could not save/)
})

// ─── Birthday payload shape (functional + source guard) ────────────────────────

test('Birthday is an annual all-day type and the modal applies those defaults', () => {
  assert.ok(ANNUAL_ALLDAY_TYPES.has('birthday'))
  // Selecting an annual-all-day type sets all_day on and (when enabled) Annually.
  assert.match(modal, /if \(ANNUAL_ALLDAY_TYPES\.has\(val\)\) \{[\s\S]*next\.all_day = true/)
  assert.match(modal, /if \(recurrenceEnabled\) next\.recurrence = 'annually'/)
})

test('all-day with no end date sends end_at null; Ends=Never sends recurrence_end null', () => {
  assert.match(modal, /end_at = form\.end_date \? combineISO\(form\.end_date, '00:00'\) : null/)
  assert.match(modal, /recurrence_end: form\.recurrence !== 'none' && form\.recurrence_end \? form\.recurrence_end : null/)
})
