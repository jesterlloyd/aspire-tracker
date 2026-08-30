// test/rotationActivityCalendar.test.mjs
//
// ROTATION-ACTIVITY-CALENDAR-1: the staff Rotation > Activity rebuild.
//
// Three things this pins that are easy to break later and expensive to notice:
//
//   1. THE LAYERING. The staff calendar must not depend on ptl-* classes, which live in
//      src/portal/portal.css and are not reliably in the staff bundle. A calendar that
//      renders unstyled only in production is exactly the failure this prevents.
//   2. NO SECOND QUERY. The calendar reads the cohort-wide shift rows the summary query
//      already fetched. A future edit that "just adds a useQuery" would double the reads
//      on a 60-second poll without anyone noticing.
//   3. WHAT SURVIVED THE REWRITE. The progress cards became a table and On Campus Now
//      changed shape; several behaviors threaded through the old cards had to be carried
//      across by hand, so each is asserted rather than assumed.
//
// Source assertions. No network, no database, no rendering.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(root, p), 'utf8')

// Line comments first, then block comments: a trailing "/*" inside a line comment
// (src/App.jsx has one) otherwise opens a false block and swallows the file.
const strip = (src) => src.replace(/^\s*\/\/[^\n]*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')

const STAFF_CAL = 'src/components/rotation/RotationActivityCalendar.jsx'
const STAFF_TABLE = 'src/components/rotation/RotationStudentTable.jsx'
const ACTIVITY = 'src/components/RotationActivity.jsx'
const PORTAL_CAL = 'src/portal/unit/UnitRotationCalendar.jsx'
const DATES = 'src/lib/rotationCalendarDates.js'

// ── 1. Layering ──────────────────────────────────────────────────────────────

test('the staff calendar depends on no portal CSS', () => {
  // portal.css is imported by PortalApp and one Settings panel. Neither is guaranteed
  // to have loaded when Rotation > Activity renders, so a ptl-* class here would style
  // correctly in dev and silently not in production.
  // Stripped, because both files EXPLAIN this rule in their header comments and would
  // otherwise match their own explanation.
  for (const f of [STAFF_CAL, STAFF_TABLE]) {
    const code = strip(read(f))
    assert.doesNotMatch(code, /ptl-/, `${f} must not use portal classes`)
    assert.doesNotMatch(code, /portal\.css/, `${f} must not import portal.css`)
  }
})

test('the portal calendar was not disturbed', () => {
  // The staff calendar is a separate component precisely so the live Unit Leader
  // calendar keeps its own styling. If this stops being true, the two have been merged
  // and the CSS question above needs answering for real.
  const portal = read(PORTAL_CAL)
  assert.match(portal, /ptl-cal-mini-grid/, 'the portal calendar still owns its ptl- styling')
  assert.match(portal, /from '\.\.\/\.\.\/lib\/rotationCalendarDates'/, 'and reads the moved helpers')
})

test('both calendars are one visual system, not two look-alikes', () => {
  // The shared primitives are what make that true. Each calendar owns its own chrome;
  // the cells, chips, nav and layout are the same components the Interviews calendar uses.
  for (const f of [STAFF_CAL, PORTAL_CAL]) {
    const src = read(f)
    assert.match(src, /CanonicalCalendarLayout/, f)
    assert.match(src, /CanonicalMonthCell/, f)
    assert.match(src, /CanonicalActivityChip/, f)
    assert.match(src, /rotationCalendarDates/, f)
  }
})

test('the date helpers are shared code, not portal code', () => {
  const dates = read(DATES)
  assert.match(dates, /export function pacificToday/)
  assert.match(dates, /export function monthGrid/)
  assert.match(dates, /export function groupByDay/)
  // Everything is string-based: shift_date is TEXT stamped in Pacific, so parsing it
  // through Date would slide a shift a column for any reader east of Pacific.
  assert.doesNotMatch(strip(dates), /new Date\(ymd\)|Date\.parse/)
})

test('the staff calendar is presentational: it fetches nothing', () => {
  const src = strip(read(STAFF_CAL))
  assert.doesNotMatch(src, /supabase/)
  assert.doesNotMatch(src, /useQuery/)
  assert.doesNotMatch(src, /fetch\(/)
})

// ── 2. No second query ───────────────────────────────────────────────────────

test('the calendar adds no network request', () => {
  const src = read(ACTIVITY)
  // The exact set that existed before this change, named rather than counted so a new
  // query fails LOUDLY with its own key instead of shifting a number. Three are
  // cohort-wide and poll every 60s; the fourth is per-expanded-row and shares the
  // Student Profile's cache key. The calendar joined the summary rather than adding a fifth.
  const keys = [...src.matchAll(/queryKey: \[([^\]]+)\]/g)].map(m => m[1].split(',')[0].trim())
  assert.deepEqual(keys.sort(), [
    "'rotation_log_summary'", "'rotation_open_shifts'", "'rotation_ranges'", "'student_shift_logs'",
  ])
  assert.match(src, /shiftRows\.push\(l\)/, 'calendar rows come out of the summary query')
})

test('ordinals come from the shared rule over full history, not the visible month', () => {
  const src = read(ACTIVITY)
  assert.match(src, /import \{ buildStudentShiftOrdinals \} from '\.\.\/lib\/shiftOrdinals'/)
  assert.match(src, /buildStudentShiftOrdinals\(rows\)/)
  // The rows it runs over are the cohort's full set: the summary query has no date
  // filter. A windowed input would renumber a student's shifts as months changed.
  const q = src.slice(src.indexOf("queryKey: ['rotation_log_summary'"), src.indexOf('rotation_ranges'))
  assert.doesNotMatch(q, /\.gte\(|\.lte\(|\.limit\(/, 'the summary read stays unwindowed')
})

// ── 3. What survived the rewrite ─────────────────────────────────────────────

test('an in-progress shift reads its PLANNED unit and preceptor', () => {
  // Mirrors api/portal/unit-shift-activity.js. An open shift has not recorded its final
  // unit or preceptor, so reading the actual columns would blank a live chip and then
  // make it appear to change unit when the student checks out.
  const src = read(ACTIVITY)
  assert.match(src, /inProgress \? l\.planned_preceptor_name : l\.preceptor_name/)
  assert.match(src, /inProgress \? l\.planned_unit_name : l\.unit_name/)
})

test('a withdrawn shift never appears on the calendar', () => {
  // STUDENT-SHIFT-LOG-MANAGEMENT-1: a withdrawn entry drives nothing. The guard has to
  // come BEFORE the calendar push, or a retracted shift would render as one that happened.
  const src = strip(read(ACTIVITY))
  const guard = src.indexOf('if (!shiftDrivesState(l)) continue')
  const push = src.indexOf('shiftRows.push(l)')
  assert.ok(guard > 0 && push > 0, 'both the guard and the push must exist')
  assert.ok(guard < push, 'the lifecycle guard must run before a row reaches the calendar')
})

test('the unit filter is derived from the shifts, never from the units table', () => {
  // A shift log records unit_name as TEXT and can name a unit the student is not
  // formally assigned to (a float shift). Building the options from units, or filtering
  // on matched_unit_id, would silently drop exactly those shifts.
  const src = read(ACTIVITY)
  assert.match(src, /for \(const s of calendarShifts\) if \(s\.unit_key\) names\.add\(s\.unit_key\)/)
  assert.match(src, /calendarShifts\.filter\(s => s\.unit_key === calendarUnit\)/)
})

test('the progress list includes Placed, and every consumer uses that one definition', () => {
  const src = read(ACTIVITY)
  assert.match(src, /const PROGRESS_STATUSES = \['Placed', 'Active Rotation'\]/)
  // The membership filter, the focus handoff guard, and the calendar's click-through all
  // read the same constant. The focus guard is the one that silently no-opped before:
  // it required 'Active Rotation' while the handoff could target any listed student.
  const uses = src.match(/PROGRESS_STATUSES\.includes/g) || []
  assert.ok(uses.length >= 3, `expected 3+ uses of PROGRESS_STATUSES, found ${uses.length}`)
  assert.doesNotMatch(strip(src), /s\.status === 'Active Rotation'/, 'no second definition of membership')
})

test('the stranded-review safety net survived widening the list', () => {
  // Including Placed shrinks this ledger; it does not remove the need for it. A
  // Completed student holding a Pending Review shift must still be named somewhere.
  const src = read(ACTIVITY)
  assert.match(src, /data-testid="pending-offlist"/)
  assert.match(src, /data-testid="pending-review-filter"/)
  assert.match(src, /const offListPending = Object\.keys\(pendingByStudent\)/)
})

test('one piece of state serves every path that opens an exact shift', () => {
  // The Action Center deep link, the Support badge, and the calendar's day panel all
  // target one shift's Details modal. Three separate mechanisms would be three chances
  // for the modal to open on the wrong row.
  const src = read(ACTIVITY)
  assert.match(src, /const openShiftForStudent = \(studentId, shiftLogId\) => \{/)
  assert.match(src, /openShiftForStudent\(studentId, target\.id\)/, 'support badge')
  assert.match(src, /openShiftForStudent\(shift\.student_id, shift\.id\)/, 'calendar day panel')
  assert.match(src, /autoOpenShiftLogId=\{focusShiftLogId/, 'action center deep link')
})

test('a calendar shift for an unlisted student falls back to their profile', () => {
  // Expanding a row that is not rendered would do nothing at all, which reads as a
  // broken click. Older shifts belong to Completed students and are reachable this way.
  const src = read(ACTIVITY)
  assert.match(src, /if \(!listed\) \{ onNavigateToStudent\?\.\(shift\.student_id\); return \}/)
})

test('the review-capable hours panel is the one that renders, not the portal read-only one', () => {
  // ClinicalHoursPanel carries ShiftReviewModal; the portal's UnitClinicalHours does not.
  // Swapping them would quietly remove the only path that clears a stranded shift.
  const src = read(ACTIVITY)
  assert.match(src, /import ClinicalHoursPanel from '\.\/ClinicalHoursPanel'/)
  assert.doesNotMatch(src, /UnitClinicalHours/)
})

test('OpenShiftReview is unmounted but not deleted', () => {
  // Owner decision, recorded so it does not read as an accident: nothing renders it,
  // and it stays as the standing spec for a future clock-out nudge cron.
  assert.doesNotMatch(strip(read(ACTIVITY)), /OpenShiftReview/, 'no longer mounted')
  const survivors = ['src/components/OpenShiftReview.jsx']
  for (const f of survivors) assert.ok(read(f).length > 0, `${f} must still exist`)
})

// ── House style ──────────────────────────────────────────────────────────────

test('no em dash in anything this change added', () => {
  // The character below is the em dash, written as an escape so this file contains none.
  const EM = String.fromCharCode(0x2014)
  for (const f of [STAFF_CAL, STAFF_TABLE, 'src/components/oncampus/StaffOnCampusStrip.jsx']) {
    assert.ok(!read(f).includes(EM), `${f} contains an em dash`)
  }
})
