// test/eventAudience.test.mjs
//
// EVENT-AUDIENCE-1: the first path by which a staff-authored event reaches a student.
//
// This is a DISCLOSURE surface, so the tests are about what must NOT get through as much as
// what must. Until this shipped, aspire_events was readable only by active internal users,
// so no student could see an event at all. Everything below guards that widening.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import {
  OFFERED_AUDIENCES, STUDENT_DELIVERED_TYPES, AUDIENCE_VALUES, EVENT_TYPE_VALUES,
} from '../src/lib/aspireEvents.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(root, p), 'utf8')
// Line comments FIRST: a path ending in a wildcard inside a // comment otherwise opens a
// false block comment and swallows the rest of the file.
const strip = (src) => src.replace(/^\s*\/\/[^\n]*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')

const ENDPOINT = 'api/portal/my-calendar-events.js'
const MODAL = 'src/components/AspireEventModal.jsx'
const CALENDAR = 'src/portal/StudentRotationActivity.jsx'

// ── Two gates, both required ─────────────────────────────────────────────────

test('the endpoint requires BOTH an opted-in audience and a delivered type', () => {
  const src = strip(read(ENDPOINT))
  assert.match(src, /\.eq\('status', 'active'\)/, 'archived events never reach a student')
  assert.match(src, /\.eq\('audience', DELIVERED_AUDIENCE\)/)
  assert.match(src, /\.in\('event_type', DELIVERED_TYPES\)/)
  // Audience alone is one mis-click from an accident, which is why the type gates too.
  assert.match(src, /const DELIVERED_AUDIENCE = 'all'/)
})

test("a targeted audience is NOT delivered, it is treated like internal", () => {
  // 'cohort' and 'school' are valid column values with no consumer. The endpoint must match
  // 'all' exactly rather than "anything that is not internal", or adding a value to the
  // column later would silently start delivering it.
  const src = strip(read(ENDPOINT))
  assert.doesNotMatch(src, /neq\('audience'/, 'never "not internal", always "is all"')
  assert.doesNotMatch(src, /'cohort'/)
  assert.doesNotMatch(src, /'school'/)
})

test('the delivered types are the narrow programme set, not everything', () => {
  assert.deepEqual(STUDENT_DELIVERED_TYPES,
    ['ngrp_open', 'ngrp_deadline', 'interview_window', 'town_hall', 'orientation'])
  // The free-text types are where internal shorthand gets written. They must be absent.
  for (const risky of ['deadline', 'reminder', 'custom', 'milestone', 'rotation', 'birthday']) {
    assert.ok(!STUDENT_DELIVERED_TYPES.includes(risky), `${risky} must not reach students`)
  }
  // Every delivered type is a real type, so none is dead config.
  for (const t of STUDENT_DELIVERED_TYPES) {
    assert.ok(EVENT_TYPE_VALUES.includes(t), `${t} is not a real event type`)
  }
})

test('the endpoint imports the delivered types rather than copying them', () => {
  // This test used to check two lists for parity. There is one list now: the endpoint imports
  // STUDENT_DELIVERED_TYPES directly. The duplicate was justified by "api/ imports do not
  // resolve safely at the Vercel runtime", which is false, and this file's own import is the
  // proof. Parity is unnecessary when there is nothing to be un-parallel with.
  const src = read(ENDPOINT)
  assert.match(src, /import \{ STUDENT_DELIVERED_TYPES as DELIVERED_TYPES \} from '\.\.\/\.\.\/src\/lib\/aspireEvents\.js'/)
  assert.doesNotMatch(strip(src), /const DELIVERED_TYPES = \[/, 'no second copy of the list')
})

// ── What comes back ──────────────────────────────────────────────────────────

test('the response is BUILT from named fields, never a spread of the row', () => {
  const src = strip(read(ENDPOINT))
  // A spread would leak any column added to aspire_events later, by default.
  assert.doesNotMatch(src, /\.\.\.row/, 'never spread a database row into a student response')
  assert.match(src, /function publicShape\(row\)/)
  // Nothing about authorship, targeting, or internal flags may be returned.
  const shape = src.slice(src.indexOf('function publicShape'), src.indexOf('export default'))
  for (const secret of ['created_by', 'updated_by', 'audience', 'cohort_id', 'school', 'is_milestone', 'status']) {
    assert.ok(!shape.includes(secret), `publicShape must not return ${secret}`)
  }
  // And the SELECT itself asks only for what it returns.
  const select = src.match(/\.select\('([^']*)'\)/)
  assert.ok(select, 'an explicit select')
  for (const secret of ['created_by', 'updated_by', 'cohort_id']) {
    assert.ok(!select[1].includes(secret), `the query must not read ${secret}`)
  }
})

// ── Who may call it ──────────────────────────────────────────────────────────

test('the endpoint is read-only and student-gated', () => {
  const src = strip(read(ENDPOINT))
  assert.match(src, /verifyPortalCaller\(req\)/)
  assert.match(src, /hasActiveRoleGrant\(db, auth\.profile\.id, 'student'\)/)
  // A profile whose student link was revoked is not a student any more (S-05).
  assert.match(src, /studentIds\.length === 0/)
  assert.match(src, /req\.method !== 'POST'/)
  // Students author nothing here.
  for (const write of ['.insert(', '.update(', '.delete(', '.upsert(']) {
    assert.ok(!src.includes(write), `a read endpoint must not ${write}`)
  }
})

test('a request cannot enumerate the table', () => {
  const src = strip(read(ENDPOINT))
  assert.match(src, /MAX_RANGE_DAYS = 120/)
  assert.match(src, /range_too_wide/)
  assert.match(src, /\.limit\(200\)/)
  assert.match(src, /invalid_range/)
})

test('a missing table reads as no events, not as an error the student cannot act on', () => {
  const src = strip(read(ENDPOINT))
  assert.match(src, /migrationMissing\(error\)\) return res\.status\(200\)\.json\(\{ events: \[\] \}\)/)
})

// ── The staff control ────────────────────────────────────────────────────────

test('the modal offers only audiences that have a consumer', () => {
  assert.deepEqual(OFFERED_AUDIENCES, ['internal', 'all'])
  // Both are real values the endpoint validates.
  for (const a of OFFERED_AUDIENCES) assert.ok(AUDIENCE_VALUES.includes(a))
  const modal = read(MODAL)
  assert.match(modal, /<option value="internal">Internal team only<\/option>/)
  assert.match(modal, /<option value="all">Everyone, including students<\/option>/)
  // An event carrying a value the picker does not offer keeps it visible rather than being
  // silently rewritten to whichever option happens to render first.
  assert.match(modal, /!OFFERED_AUDIENCES\.includes\(form\.audience\)/)
})

test('the modal tells the truth about what a choice will actually do', () => {
  const modal = read(MODAL)
  // Choosing Everyone on a type students never receive must NOT claim they will see it.
  assert.match(modal, /STUDENT_DELIVERED_TYPES\.includes\(form\.event_type\)/)
  assert.match(modal, /Students will see this on their portal calendar/)
  assert.match(modal, /is not a type delivered to students, whatever the audience/)
  assert.match(modal, /Staff calendars only\. Nobody outside the ASPIRE team sees this/)
})

test('the default is still internal: nothing already written becomes visible', () => {
  const modal = read(MODAL)
  assert.match(modal, /audience:\s*event\?\.audience \|\| 'internal'/)
  // Every event created before this shipped is 'internal' (the control did not exist), so
  // making the field readable cannot retroactively expose anything.
  assert.match(strip(read(ENDPOINT)), /const DELIVERED_AUDIENCE = 'all'/)
})

// ── The student calendar ─────────────────────────────────────────────────────

test('an event failure never takes the student\'s own shifts down with it', () => {
  const src = strip(read(CALENDAR))
  const block = src.slice(src.indexOf('fetchMyCalendarEvents({ from: rangeFrom'), src.indexOf('const eventsByDay'))
  assert.match(block, /setEvents\(result\.ok \? \(result\.events \|\| \[\]\) : \[\]\)/)
  assert.doesNotMatch(block, /setLoadError/, 'an event fetch failure is not a rotation failure')
})

test('events are fetched for exactly the visible grid, and refetched when it moves', () => {
  const src = strip(read(CALENDAR))
  assert.match(src, /const rangeFrom = cells\[0\]\.ymd/)
  assert.match(src, /const rangeTo = cells\[cells\.length - 1\]\.ymd/)
  assert.match(src, /\}, \[rangeFrom, rangeTo\]\)/, 'refetch is keyed to the visible range')
})

test('an event is announced and shaped, not carried by colour alone', () => {
  const src = strip(read(CALENDAR))
  assert.match(src, /labelParts\.push\(`\$\{eventTypeLabel\(ev\.event_type\)\}: \$\{ev\.title\}`\)/)
  // Its own type colour, so the same event reads the same on staff and student calendars.
  assert.match(src, /background: `\$\{eventColor\(ev\)\}1a`, color: eventColor\(ev\)/)
  assert.match(src, /ASPIRE event<\/span>|ASPIRE event/, 'the legend names it')
})

test('an external link from a student portal is opener-safe', () => {
  assert.match(read(CALENDAR), /target="_blank" rel="noopener noreferrer"/)
})

test('no em dash in anything this change touched', () => {
  const EM = String.fromCharCode(0x2014)
  for (const f of [ENDPOINT, MODAL, CALENDAR, 'src/lib/aspireEvents.js', 'src/lib/studentRotationActivity.js']) {
    assert.ok(!read(f).includes(EM), `${f} contains an em dash`)
  }
})
