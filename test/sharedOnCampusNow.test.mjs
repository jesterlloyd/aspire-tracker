// Commit 2: the shared On Campus Now card. Pure live-shift-row tests (badge, duration,
// overdue, missing preceptor/photo, hours) plus source guards that staff and the Unit Leader
// portal both render the SAME shared card, the endpoint exposes only a photo boolean, and the
// UL card reuses the already-loaded activity payload and opens the canonical profile drawer.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { buildLiveShiftDisplay } from '../src/lib/onCampusRows.js'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')
const code = (p) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')

const NOW = Date.parse('2026-07-18T18:00:00Z')

// ── pure live-shift display (reuses canonical shiftStatus) ─────────────────────
test('an open shift shows the badge, unit, preceptor, and open duration', () => {
  const d = buildLiveShiftDisplay({
    state: 'in_progress', checked_in_at: '2026-07-18T14:00:00Z', shift_type: 'Day',
    student_name: 'Jordan Cruz', unit_key: '6 NE', preceptor_name: 'Susie Rivera',
  }, NOW)
  assert.equal(d.name, 'Jordan Cruz')
  assert.equal(d.subLabel, '6 NE · with Susie Rivera')
  assert.equal(d.badge.label, '☀ Day')
  assert.match(d.statusText, /^Open \d+h \d{2}m$/)     // 4h 00m
  assert.equal(d.statusWarn, false)
})
test('a long-running open shift hedges that clock-out may be overdue', () => {
  const d = buildLiveShiftDisplay({
    state: 'in_progress', checked_in_at: '2026-07-17T20:00:00Z', shift_type: 'Day',  // ~22h
    student_name: 'A', unit_key: '6 NE',
  }, NOW)
  assert.equal(d.statusText, 'Clock-out may be overdue')
  assert.equal(d.statusWarn, true)
})
test('a completed shift shows logged hours, not a duration', () => {
  const d = buildLiveShiftDisplay({ state: 'completed', hours: 12, shift_type: 'Night', student_name: 'A', unit_key: 'PACU' }, NOW)
  assert.equal(d.statusText, '12 hrs logged')
  assert.equal(d.statusWarn, false)
  assert.equal(d.badge.label, '☾ Night')
})
test('missing preceptor and missing name fall back safely', () => {
  const d = buildLiveShiftDisplay({ state: 'in_progress', checked_in_at: '2026-07-18T17:00:00Z', unit_key: '6 NE' }, NOW)
  assert.equal(d.subLabel, '6 NE')                     // no " · with …" when preceptor absent
  assert.equal(d.name, 'A student')
  assert.equal(d.badge.label, 'Shift not specified')   // unknown shift type never guessed
})

// ── the shared card is presentational and role-safe ───────────────────────────
test('OnCampusNow renders role-safe rows as buttons, with a zero-state', () => {
  const c = read('src/components/oncampus/OnCampusNow.jsx')
  assert.ok(!/fetch\(|supabase|useQuery|useEffect|useState/.test(c), 'presentational only, no data/side effects')
  // Still the canonical card system. The header always renders; the optional
  // `flush` layout only drops the horizontal inset for hosts already inside a
  // padded page column (INTERVIEWS-TODAY-HEADER-1).
  assert.match(c, /'mast-live'/)                        // reuses the canonical card system
  assert.match(c, /flush \? 'mast-live mast-live-flush' : 'mast-live'/)
  assert.match(c, /<button[\s\S]*?className="mast-live-card"/)  // cards are buttons (keyboard-activatable)
  assert.match(c, /emptyText/)                         // zero-state supported
  assert.match(c, /mast-live-empty/)
})

// ── staff dashboard renders the SAME shared card (main app visually unchanged) ─
test('the staff At a Glance strip delegates to the shared card, keeping its guards', () => {
  const ov = read('src/components/OverviewTab.jsx')
  assert.match(ov, /import OnCampusNow from '\.\/oncampus\/OnCampusNow'/)
  assert.match(ov, /return <OnCampusNow /)
  // ROTATION-ACTIVITY-CALENDAR-1: the campus strip's row builder moved one level down,
  // into StaffOnCampusStrip, so Rotation > Activity renders the IDENTICAL strip instead
  // of a second one that could drift. The guards did not change, so they are asserted
  // where they now live; chartToday.test.mjs reads the same file for the same reason.
  const strip = read('src/components/oncampus/StaffOnCampusStrip.jsx')
  assert.match(ov, /import StaffOnCampusStrip from '\.\/oncampus\/StaffOnCampusStrip'/)
  assert.match(strip, /return <OnCampusNow|<OnCampusNow$/m)
  assert.match(strip, /if \(logs\.length === 0 && !emptyText\) return null/)
  assert.match(strip, /Clock-out may be overdue/)
  assert.match(strip, /shiftBadge\(shiftTypeOf\(log\)\)/)
})

// Both staff surfaces must go through that one builder, or the drift it was extracted
// to prevent comes straight back.
test('every staff On Campus strip is the shared one', () => {
  for (const f of ['src/components/OverviewTab.jsx', 'src/components/RotationActivity.jsx']) {
    assert.match(read(f), /StaffOnCampusStrip/, f)
  }
})

// ── the UL endpoint exposes a photo BOOLEAN only, never a path ────────────────
test('unit-shift-activity adds has_photo without leaking the headshot path', () => {
  const ep = read('api/portal/unit-shift-activity.js')
  assert.match(ep, /has_photo: hasFile\(s\?\.headshot_url\)/)
  // headshot_url is resolved only into the boolean; it is never in the shift-column allowlist.
  const safeCols = ep.match(/const SAFE_COLUMNS = \[([\s\S]*?)\]/)[1]
  assert.ok(!safeCols.includes('headshot_url'), 'headshot_url must not be in SAFE_COLUMNS')
  // Scope is still server-derived.
  assert.match(ep, /verifyPortalUnitLeaderCaller/)
  assert.match(ep, /resolveUnitScopedStudents/)
})

// ── UL Home: reuses the loaded activity payload; card opens the profile drawer ─
test('the Unit Leader Home renders the shared card from the existing activity payload', () => {
  const portal = code('src/portal/UnitLeaderPortal.jsx')
  assert.match(portal, /import OnCampusNow from '\.\.\/components\/oncampus\/OnCampusNow'/)
  // Rows are derived from onShiftNow (the already-loaded activity), not a new request.
  assert.match(portal, /const campusRows = onShiftNow\.map/)
  assert.match(portal, /buildLiveShiftDisplay\(x, activityNow\)/)
  // Photos via the unit-scoped avatar/hook (never the staff StudentAvatar).
  assert.match(portal, /<UnitStudentAvatar url=\{photos\.peek\(x\.student_id\)\}/)
  assert.ok(!/from '\.\.\/components\/StudentAvatar'/.test(portal), 'must not use the staff avatar')
  // A zero-state and the canonical profile drawer on click.
  assert.match(portal, /emptyText="No students from your units are on shift right now\."/)
  assert.match(portal, /openCampusDetail\(x\)/)
  assert.match(portal, /campusDetail &&[\s\S]*?<StudentDetailDrawer/)
  // The old single "is on shift now" alert row is gone.
  assert.ok(!portal.includes('is on shift now'))
  // One batch of photos for the whole Home (passed down to the roster).
  assert.match(portal, /<StudentRoster[\s\S]*?photos=\{photos\}/)
})
