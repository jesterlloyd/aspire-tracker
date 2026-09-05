// test/eventAudience.test.mjs
//
// EVENT-AUDIENCE-1 / EVENT-AUDIENCE-2: the one path by which a staff-authored event reaches
// anyone outside the staff app.
//
// This is a DISCLOSURE surface, so the tests are about what must NOT get through as much as
// what must. Until AUDIENCE-1 shipped, aspire_events was readable only by active internal
// users. AUDIENCE-2 (Owner, 2026-09-04) made "Who sees this" a SET of portal roles: Internal
// team always, plus any of Student, Unit Leader, Academic Partner, Nursing Education &
// Leadership. Everything below guards that widening.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import {
  PORTAL_AUDIENCES, PORTAL_AUDIENCE_VALUES, PORTAL_DELIVERED_TYPES, STUDENT_DELIVERED_TYPES,
  EVENT_TYPE_VALUES, legacyAudienceFor,
} from '../src/lib/aspireEvents.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(root, p), 'utf8')
// Line comments FIRST: a path ending in a wildcard inside a // comment otherwise opens a
// false block comment and swallows the rest of the file.
const strip = (src) => src.replace(/^\s*\/\/[^\n]*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')

const ENDPOINT = 'api/portal/my-calendar-events.js'
const STAFF_ENDPOINT = 'api/aspire-events.js'
const MODAL = 'src/components/AspireEventModal.jsx'
const CALENDAR = 'src/portal/StudentRotationActivity.jsx'
const FEED = 'src/portal/shared/useMastheadFeed.js'
const MIGRATION = 'supabase/migrations/20260908000000_aspire_event_audiences.sql'

// ── The set ──────────────────────────────────────────────────────────────────

test('the audience set is the four portal roles, named as the grant table names them', () => {
  assert.deepEqual(PORTAL_AUDIENCE_VALUES, ['student', 'unit_leader', 'academic_partner', 'nursing_academic'])
  assert.deepEqual(PORTAL_AUDIENCES.map(a => a.label),
    ['Student', 'Unit Leader', 'Academic Partner', 'Nursing Education & Leadership'])
  // Internal is not a member: the internal team always sees an event, so it is never a tick.
  assert.ok(!PORTAL_AUDIENCE_VALUES.includes('internal'))
  assert.ok(!PORTAL_AUDIENCE_VALUES.includes('all'))
})

test('the legacy column is derived from the set, so every old reader stays coherent', () => {
  assert.equal(legacyAudienceFor([]), 'internal')
  assert.equal(legacyAudienceFor(['student']), 'all')
  assert.equal(legacyAudienceFor(['unit_leader']), 'all')
  assert.equal(legacyAudienceFor(undefined), 'internal')
})

test('the migration adds a checked array, backfills all -> {student}, and widens nothing', () => {
  const sql = read(MIGRATION)
  assert.match(sql, /add column if not exists audiences text\[\] not null default '\{\}'::text\[\]/)
  assert.match(sql, /check \(audiences <@ array\['student','unit_leader','academic_partner','nursing_academic'\]::text\[\]\)/)
  assert.match(sql, /set audiences = array\['student'\]::text\[\]\s+where audience = 'all'/)
  assert.doesNotMatch(sql, /drop column/, 'the legacy column stays')
  // The Owner runs it; nothing here applies it.
  assert.match(sql, /OWNER_SQL_GATE/)
  assert.match(read('db/audit/aspire_event_audiences_preflight_and_verification.sql'), /all_not_student_should_be_0/)
})

// ── Two gates, both required ─────────────────────────────────────────────────

test('the endpoint requires BOTH the caller role in the set and a delivered type', () => {
  const src = strip(read(ENDPOINT))
  assert.match(src, /\.eq\('status', 'active'\)/, 'archived events never leave the staff app')
  assert.match(src, /\.contains\('audiences', \[role\]\)/)
  assert.match(src, /\.in\('event_type', DELIVERED_TYPES\)/)
  // Never "not internal"; always "this role was ticked".
  assert.doesNotMatch(src, /neq\('audience/)
  assert.doesNotMatch(src, /'cohort'/)
  assert.doesNotMatch(src, /'school'/)
})

test('before the migration is applied, the AUDIENCE-1 rule holds exactly: all -> students only', () => {
  const src = strip(read(ENDPOINT))
  const fallback = src.slice(src.indexOf('columnMissing(error)) {'), src.indexOf('if (error) {'))
  assert.match(fallback, /if \(role !== 'student'\) return res\.status\(200\)\.json\(\{ events: \[\] \}\)/)
  assert.match(fallback, /\.eq\('audience', 'all'\)/)
})

test('the delivered types are the narrow programme set, shared by every outside audience', () => {
  assert.deepEqual(STUDENT_DELIVERED_TYPES,
    ['ngrp_open', 'ngrp_deadline', 'interview_window', 'town_hall', 'orientation'])
  assert.equal(PORTAL_DELIVERED_TYPES, STUDENT_DELIVERED_TYPES, 'one list, no per-role copy')
  // The free-text types are where internal shorthand gets written. They must be absent.
  for (const risky of ['deadline', 'reminder', 'custom', 'milestone', 'rotation', 'birthday']) {
    assert.ok(!PORTAL_DELIVERED_TYPES.includes(risky), `${risky} must not leave the staff app`)
  }
  for (const t of PORTAL_DELIVERED_TYPES) {
    assert.ok(EVENT_TYPE_VALUES.includes(t), `${t} is not a real event type`)
  }
  const src = read(ENDPOINT)
  assert.match(src, /import \{ PORTAL_DELIVERED_TYPES as DELIVERED_TYPES, PORTAL_AUDIENCE_VALUES \} from '\.\.\/\.\.\/src\/lib\/aspireEvents\.js'/)
  assert.doesNotMatch(strip(src), /const DELIVERED_TYPES = \[/, 'no second copy of the list')
})

// ── What comes back ──────────────────────────────────────────────────────────

test('the response is BUILT from named fields, never a spread of the row', () => {
  const src = strip(read(ENDPOINT))
  assert.doesNotMatch(src, /\.\.\.row/, 'never spread a database row into a portal response')
  assert.match(src, /function publicShape\(row\)/)
  const shape = src.slice(src.indexOf('function publicShape'), src.indexOf('const SELECT'))
  for (const secret of ['created_by', 'updated_by', 'audience', 'cohort_id', 'school', 'is_milestone', 'status']) {
    assert.ok(!shape.includes(secret), `publicShape must not return ${secret}`)
  }
  // The one flag returned is the masthead tick, as a computed boolean.
  assert.match(shape, /in_masthead: row\.show_on_welcome === true/)
  const select = src.match(/const SELECT = '([^']*)'/)
  assert.ok(select, 'an explicit select')
  for (const secret of ['created_by', 'updated_by', 'cohort_id', 'audiences', 'audience']) {
    assert.ok(!select[1].split(', ').includes(secret), `the query must not read ${secret}`)
  }
})

// ── Who may call it ──────────────────────────────────────────────────────────

test('the endpoint is read-only and verifies the claimed role against a live grant', () => {
  const src = strip(read(ENDPOINT))
  assert.match(src, /verifyPortalCaller\(req\)/)
  assert.match(src, /if \(!PORTAL_AUDIENCE_VALUES\.includes\(role\)\) return res\.status\(422\)/)
  assert.match(src, /hasActiveRoleGrant\(db, auth\.profile\.id, role\)/)
  // A profile whose student link was revoked is not a student any more (S-05).
  assert.match(src, /if \(role === 'student'\) \{[\s\S]*?studentIds\.length === 0/)
  // The AUDIENCE-1 caller sends no role and is still a student.
  assert.match(src, /: 'student'/)
  assert.match(src, /req\.method !== 'POST'/)
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

test('a missing table reads as no events, not as an error the caller cannot act on', () => {
  const src = strip(read(ENDPOINT))
  assert.match(src, /migrationMissing\(error\)\) return res\.status\(200\)\.json\(\{ events: \[\] \}\)/)
})

// ── The staff control ────────────────────────────────────────────────────────

test('the modal is a checkbox set: Internal always on, one tick per portal role', () => {
  const modal = read(MODAL)
  assert.doesNotMatch(modal, /<select\s+id="event-audience"/, 'the single-value picker is gone')
  assert.doesNotMatch(modal, /OFFERED_AUDIENCES/)
  assert.match(modal, /<input type="checkbox" checked readOnly disabled[^>]*\/>\s*Internal team \(always\)/)
  assert.match(modal, /\{PORTAL_AUDIENCES\.map\(a => \(/)
  assert.match(modal, /checked=\{form\.audiences\.includes\(a\.value\)\}/)
  // Add on tick, remove on untick, never rewrite the rest of the set.
  assert.match(modal, /\[\.\.\.form\.audiences, a\.value\]/)
  assert.match(modal, /form\.audiences\.filter\(v => v !== a\.value\)/)
})

test('the modal tells the truth about what the ticks will actually do', () => {
  const modal = read(MODAL)
  assert.match(modal, /PORTAL_DELIVERED_TYPES\.includes\(form\.event_type\)/)
  assert.match(modal, /Visible on the \$\{listWithAnd\(/)
  assert.match(modal, /is not a type delivered to portals, whichever roles are ticked/)
  assert.match(modal, /Staff calendars only\. Nobody outside the ASPIRE team sees this/)
})

test('the default is still internal, and an old "all" reads back as {student}', () => {
  const modal = read(MODAL)
  assert.match(modal, /audiences:\s*Array\.isArray\(event\?\.audiences\) \? event\.audiences : \(event\?\.audience === 'all' \? \['student'\] : \[\]\)/)
  // Both columns go up together, the legacy one derived.
  assert.match(modal, /audiences: form\.audiences,\s*audience: legacyAudienceFor\(form\.audiences\)/)
})

test('the milestone tick is retired everywhere: Show in Masthead is the one flag', () => {
  const modal = read(MODAL)
  assert.doesNotMatch(modal, /Mark as milestone/)
  assert.doesNotMatch(modal, /is_milestone/)
  assert.match(modal, /Show in Masthead/)
  assert.doesNotMatch(read('src/components/InterviewCalendar.jsx'), /is_milestone/)
  assert.doesNotMatch(strip(read(STAFF_ENDPOINT)), /out\.is_milestone/, 'nothing writes it any more')
})

test('the staff endpoint validates the set and derives the legacy column from it', () => {
  const src = strip(read(STAFF_ENDPOINT))
  assert.match(src, /import \{ PORTAL_AUDIENCE_VALUES, legacyAudienceFor \} from '\.\.\/src\/lib\/aspireEvents\.js'/)
  assert.match(src, /const set = \[\.\.\.new Set\(body\.audiences\)\]/)
  assert.match(src, /const bad = set\.find\(v => !PORTAL_AUDIENCE_VALUES\.includes\(v\)\)/)
  assert.match(src, /out\.audiences = set;\s*out\.audience = legacyAudienceFor\(set\);/)
  // Until the Owner applies the migration the column is absent: the write retries without it.
  assert.match(src, /function audiencesColumnMissing\(error\)/)
  assert.match(src, /if \(error && audiencesColumnMissing\(error\) && 'audiences' in row\)/)
  assert.match(src, /if \(error && audiencesColumnMissing\(error\) && 'audiences' in patch\)/)
})

// ── The portal mastheads ─────────────────────────────────────────────────────

test('every portal masthead asks as exactly the role it renders', () => {
  const feed = read(FEED)
  assert.match(feed, /body: JSON\.stringify\(\{ from: today, to, role \}\)/)
  assert.match(feed, /if \(!res\.ok\) return \[\]/, 'a 403 is silence, not an error')
  assert.match(read('src/portal/StudentPortal.jsx'), /useMastheadFeed\('student', \{ enabled: !readOnlyPreview \}\)/)
  assert.match(read('src/portal/UnitLeaderPortal.jsx'), /useMastheadFeed\('unit_leader'\)/)
  assert.match(read('src/portal/AcademicPartnerPortal.jsx'), /useMastheadFeed\('academic_partner'\)/)
  assert.match(read('src/portal/na/NursingAcademicsPortal.jsx'), /useMastheadFeed\('nursing_academic'\)/)
  // The pill only where the host has a calendar to scroll to.
  assert.match(read('src/portal/StudentPortal.jsx'), /scrollToCalendar\('student-rotation-activity-title'\)/)
  assert.match(read('src/portal/UnitLeaderPortal.jsx'), /scrollToCalendar\('ul-cal-title'\)/)
  assert.doesNotMatch(read('src/portal/AcademicPartnerPortal.jsx'), /calendar=\{/)
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
  assert.match(src, /background: `\$\{eventColor\(ev\)\}1a`, color: eventColor\(ev\)/)
  assert.match(src, /ASPIRE event<\/span>|ASPIRE event/, 'the legend names it')
})

test('an external link from a student portal is opener-safe', () => {
  assert.match(read(CALENDAR), /target="_blank" rel="noopener noreferrer"/)
})

test('no em dash in anything this change touched', () => {
  const EM = String.fromCharCode(0x2014)
  for (const f of [ENDPOINT, STAFF_ENDPOINT, MODAL, CALENDAR, FEED, MIGRATION, 'src/lib/aspireEvents.js', 'src/lib/mastheadEvents.js', 'src/components/masthead/MastheadEventsRow.jsx']) {
    assert.ok(!read(f).includes(EM), `${f} contains an em dash`)
  }
})
