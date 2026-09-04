// UL-PHASE1: guards for the Unit Leader Portal redesign, phase 1.
//
// Covers the locked navigation, the Rotation Activity Calendar and its endpoint, the
// embedded roster, the Evaluations placeholder, and the Report a Concern handoff.
//
// The safety-critical part is the shift endpoint's field allowlist. student_shift_logs
// carries the private support narrative, internal review notes, and the student's own
// written reflection; none of it may reach a Unit Leader. Those guards check
// comment-stripped source, because the endpoint's documentation names the forbidden
// columns in order to explain why they are excluded.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  pacificToday, addDays, monthGrid, monthLabel, groupByDay,
} from '../src/lib/rotationCalendarDates.js'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')

const endpoint = read('api/portal/unit-shift-activity.js')
const chrome   = read('src/portal/unit/UnitLeaderChrome.jsx')
const portal   = read('src/portal/UnitLeaderPortal.jsx')
const app      = read('src/portal/PortalApp.jsx')
const calendar = read('src/portal/unit/UnitRotationCalendar.jsx')
const dayDrawer = read('src/portal/unit/UnitShiftDayDrawer.jsx')
const evals    = read('src/portal/unit/UnitEvaluationsPlaceholder.jsx')
const api      = read('src/portal/unit/unitLeaderApi.js')

const stripJs = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const endpointCode = stripJs(endpoint)
const chromeCode   = stripJs(chrome)
const portalCode   = stripJs(portal)
const appCode      = stripJs(app)
const calendarCode = stripJs(calendar)
const evalsCode    = stripJs(evals)

// ── Locked navigation ──────────────────────────────────────────────────────
test('desktop navigation promotes Preceptors and preserves the locked order', () => {
  assert.match(chromeCode, /const DESKTOP_KEYS = \['home', 'preceptors', 'messages', 'evaluations', 'placements', 'capacity'\]/)
})

test('Students is absent from navigation but remains a supported deep link', () => {
  const m = /const DESKTOP_KEYS = \[([^\]]*)\]/.exec(chromeCode)
  assert.ok(!m[1].includes('students'), 'Students must not be a primary tab')
  assert.match(appCode, /'students'/, 'but it must remain a known route')
})

test('mobile More holds Evaluations, Placement Requests, and Capacity', () => {
  assert.match(chromeCode,
    /const MOBILE_MORE_KEYS = \['evaluations', 'placements', 'capacity'\]/)
})

test('responsive membership is CSS-driven at the existing mobile breakpoint', () => {
  assert.match(chromeCode, /MOBILE_PRIMARY_KEYS\.includes\(sec\.key\)/)
  assert.match(chromeCode, /ptl-nav-mobile-more/)
})

test('More is a real dialog with focus trap, Escape, and focus return', () => {
  assert.match(chromeCode, /role="dialog"/)
  assert.match(chromeCode, /aria-modal="true"/)
  assert.match(chromeCode, /e\.key === 'Escape'/)
  assert.match(chromeCode, /if \(prev\?\.focus\) prev\.focus\(\)/)
  assert.match(chromeCode, /aria-haspopup="dialog"/)
  assert.match(chromeCode, /aria-expanded=\{moreOpen\}/)
})

test('the active nested route is visible on the More control', () => {
  assert.match(chromeCode, /const moreActive = MOBILE_MORE_KEYS\.includes\(view\)/)
  assert.match(chromeCode, /aria-current=\{moreActive \? 'page' : undefined\}/)
})

test('the Messages badge still works, so More can carry a count later', () => {
  assert.match(chromeCode, /ptl-nav-badge/)
  assert.match(chromeCode, /unreadLabel\(unread\)/)
})

// ── Routes preserved ───────────────────────────────────────────────────────
test('every rendered unit route still resolves, including students and concern', () => {
  const m = /const UNIT_SECTIONS = new Set\(\[([\s\S]*?)\]\)/.exec(appCode)
  assert.ok(m, 'UNIT_SECTIONS must exist')
  for (const key of ['home', 'placements', 'capacity', 'students', 'preceptors',
    'profile', 'concern', 'evaluations']) {
    assert.ok(m[1].includes(`'${key}'`), `/portal/unit/${key} must remain routable`)
  }
  assert.ok(!m[1].includes("'notifications'"), 'the stale standalone notifications route is removed')
})

test('the concern route hands off to Messages instead of 404ing', () => {
  assert.match(appCode, /const HANDOFF_TO_MESSAGES = \{ concern: \{ compose: 'aspire'/)
  assert.match(appCode, /const unitView = unitHandoff \? 'messages' : rawUnitView/)
  assert.match(appCode, /composeIntent=\{unitHandoff\}/)
})

test('Message the ASPIRE Team lives inside Messages and opens from the concern link', () => {
  assert.match(portalCode, /view === 'messages' && composeIntent\?\.compose === 'aspire'/)
  assert.match(portalCode, /<AspireTeamComposer[\s\S]*startOpen/)
  assert.match(portalCode, /Message the ASPIRE Team/)
  // It is no longer a section of its own.
  assert.ok(!/view === 'concern'/.test(portalCode))
})

test('/portal/unit/students renders the same roster module Home embeds', () => {
  assert.match(portalCode, /function StudentsScreen\(props\) \{[\s\S]*?return <StudentRoster \{\.\.\.props\} \/>/)
  assert.match(portalCode, /<StudentRoster[\s\S]{0,200}heading="Your Students"/,
    'Home embeds the same module')
})

test('the Evaluations route is wired', () => {
  // Now activated to the read-only workspace (the placeholder was superseded on release).
  assert.match(portalCode, /view === 'evaluations'[\s\S]*?<UnitEvaluationsWorkspace unitKeys=\{unitKeys\} \/>/)
})

// ── Shift endpoint: the field allowlist ────────────────────────────────────
const FORBIDDEN = [
  'support_needed', 'admin_notes', 'learning_highlight', 'unit_override_reason',
  'preceptor_override_note', 'exception_flags', 'reviewed_by', 'reviewed_at',
  'school_email', 'attestation',
]

test('no forbidden shift column appears anywhere in the endpoint code', () => {
  for (const col of FORBIDDEN) {
    assert.ok(!endpointCode.includes(col),
      `the shift endpoint must never reference ${col}`)
  }
})

test('the endpoint uses an explicit allowlist, not a denylist', () => {
  const m = /const SAFE_COLUMNS = \[([\s\S]*?)\]\.join/.exec(endpointCode)
  assert.ok(m, 'SAFE_COLUMNS must exist')
  const listed = m[1].match(/'[a-z_]+'/g).map(s => s.replace(/'/g, ''))
  assert.deepEqual(listed, [
    'id', 'student_id', 'shift_date', 'shift_type', 'total_hours', 'status',
    'lifecycle_state', 'checked_in_at', 'checked_out_at', 'expected_hours',
    'preceptor_name', 'planned_preceptor_name', 'planned_shift_type',
    'unit_name', 'planned_unit_name',
  ])
  // A column added to the table later must be excluded by default.
  assert.match(endpointCode, /\.select\(SAFE_COLUMNS\)/)
  assert.ok(!/\.select\('\*'\)/.test(endpointCode), 'never select star')
})

test('no forbidden field can reach the response shape', () => {
  const resp = endpointCode.slice(endpointCode.indexOf('const shifts = (data || []).map'))
  for (const col of FORBIDDEN) assert.ok(!resp.includes(col))
  // Review metadata is deliberately reduced to a presentation label.
  assert.match(resp, /hours_state:/)
  assert.ok(!resp.includes('r.reviewed'), 'no review metadata is echoed')
})

// ── Shift endpoint: scope and range ────────────────────────────────────────
test('the endpoint re-derives scope server-side and never trusts the client', () => {
  assert.match(endpointCode, /verifyPortalUnitLeaderCaller\(req\)/)
  assert.match(endpointCode, /resolveUnitScopedStudents\(db, scopes\)/)
  assert.match(endpointCode, /\.in\('student_id', \[\.\.\.byId\.keys\(\)\]\)/,
    'the student set comes from the resolved scope, not the request')
  assert.ok(!endpointCode.includes('req.query.student_id'))
  assert.ok(!endpointCode.includes('req.query.unit_key'))
})

test('a caller with no scoped students gets an empty set, not everyone', () => {
  assert.match(endpointCode, /if \(students\.length === 0\)[\s\S]{0,120}shifts: \[\]/)
})

test('the range is bounded to a rolling 90 days in both directions', () => {
  assert.match(endpointCode, /const WINDOW_DAYS = 90/)
  assert.match(endpointCode, /if \(from < windowStart\) return res\.status\(400\)/)
  assert.match(endpointCode, /if \(to > today\) return res\.status\(400\)/,
    'a future range is refused, because there is no forward schedule')
  assert.match(endpointCode, /if \(from > to\) return res\.status\(400\)/)
  assert.match(endpointCode, /invalid_date_range/)
})

test('the endpoint is read only', () => {
  assert.match(endpointCode, /req\.method !== 'GET'/)
  for (const w of ['.insert(', '.update(', '.upsert(', '.delete(', '.rpc(']) {
    assert.ok(!endpointCode.includes(w), `the shift endpoint must not ${w}`)
  }
})

test('shift_date is treated as a string, matching the TEXT column', () => {
  assert.match(endpointCode, /\/\^\\d\{4\}-\\d\{2\}-\\d\{2\}\$\//)
  assert.match(endpointCode, /America\/Los_Angeles/,
    'the window is computed in Pacific, matching how shift_date is stamped')
})

// ── Date helpers ───────────────────────────────────────────────────────────
test('addDays crosses month, year, and leap boundaries correctly', () => {
  assert.equal(addDays('2026-03-01', -90), '2025-12-01')
  assert.equal(addDays('2024-03-01', -1), '2024-02-29', 'leap day')
  assert.equal(addDays('2026-01-01', -1), '2025-12-31')
  assert.equal(addDays('2026-12-31', 1), '2027-01-01')
})

test('monthGrid returns whole Sunday-first weeks with the right day count', () => {
  for (const [y, m, days] of [[2026, 8, 30], [2026, 1, 28], [2024, 1, 29], [2026, 10, 30]]) {
    const g = monthGrid(y, m)
    assert.equal(g.length % 7, 0, 'always whole weeks')
    assert.equal(g.filter(c => c.inMonth).length, days)
  }
  // Sunday first (matching the main-app Interviews calendar): the first cell is a Sunday.
  const g = monthGrid(2026, 8)
  assert.equal(new Date(`${g[0].ymd}T00:00:00Z`).getUTCDay(), 0)
})

test('pacificToday returns a YYYY-MM-DD string', () => {
  assert.match(pacificToday(), /^\d{4}-\d{2}-\d{2}$/)
  // A UTC instant that is still the previous day in Pacific resolves to that day.
  assert.equal(pacificToday(new Date('2026-09-15T03:00:00Z')), '2026-09-14')
})

test('groupByDay buckets shifts by their date string', () => {
  const g = groupByDay([
    { id: 1, shift_date: '2026-09-01' }, { id: 2, shift_date: '2026-09-01' },
    { id: 3, shift_date: '2026-09-02' },
  ])
  assert.equal(g.get('2026-09-01').length, 2)
  assert.equal(g.get('2026-09-02').length, 1)
})

// ── Calendar behavior ──────────────────────────────────────────────────────
test('the calendar is presentational: no fetch, no auth, no supabase', () => {
  for (const forbidden of ['fetch(', 'supabase', 'useAuth', 'apiFetch']) {
    assert.ok(!calendarCode.includes(forbidden),
      `the calendar must not reference ${forbidden}`)
  }
})

test('in-progress shifts render as on shift now', () => {
  assert.match(calendarCode, /ptl-cal-chip-live/)
  assert.match(calendar, /On shift now/)
  assert.match(calendarCode, /s\.state === 'in_progress'/)
  assert.match(dayDrawer, /On shift now/)
})

test('completed shifts render with a stable marker distinct from live', () => {
  assert.match(calendar, /Completed shift/)
  assert.match(read('src/portal/portal.css'), /\.ptl-cal-chip \{/)
  assert.match(read('src/portal/portal.css'), /\.ptl-cal-chip-live \{/)
})

test('the calendar never implies a future shift is scheduled', () => {
  assert.match(calendar, /does not hold a forward schedule/)
  assert.match(calendarCode, /const future = ymd > today/)
  // Future days are marked via the shared CanonicalMonthCell's isFuture prop, which
  // dims the day number rather than filling the cell.
  assert.match(calendarCode, /isFuture=\{future\}/)
  // Checked against COMMENT-STRIPPED code. The header legitimately says the UI must
  // never say "Schedule", and matching raw source flags that explanation as a label.
  assert.ok(!/Schedule/.test(calendarCode),
    'the word Schedule must not appear as a rendered label')
})

test('an empty month states so rather than rendering a blank grid', () => {
  assert.match(calendarCode, /const monthHasActivity = /)
  assert.match(calendar, /No rotation activity recorded in/)
})

test('month navigation is unbounded, matching the main-app calendar', () => {
  // The old current-month ceiling and window floor are gone: navigation is free in
  // both directions, and no month change triggers a server request (all window data
  // arrives in one fetch), so empty months just render the honest empty note.
  assert.doesNotMatch(calendarCode, /canGoForward/)
  assert.doesNotMatch(calendarCode, /canGoBack/)
  assert.doesNotMatch(calendarCode, /prevDisabled/)
  assert.doesNotMatch(calendarCode, /nextDisabled/)
})

test('a day cell selects every date but opens the day drawer only when activity exists', () => {
  assert.match(calendarCode, /const selectDate = \(ymd, day = byDay\.get\(ymd\) \|\| \[\]\) => \{/)
  assert.match(calendarCode, /setSelectedDate\(ymd\)/)
  assert.match(calendarCode, /if \(day\.length > 0\) onSelectDay\?\.\(ymd, day\)/)
  assert.doesNotMatch(calendarCode, /disabled=\{day\.length === 0\}/)
  assert.match(portalCode, /<UnitShiftDayDrawer/)
})

test('the day drawer shows student and preceptor and traps focus', () => {
  assert.match(dayDrawer, /role="dialog"/)
  assert.match(dayDrawer, /aria-modal="true"/)
  assert.match(stripJs(dayDrawer), /e\.key === 'Escape'/)
  assert.match(stripJs(dayDrawer), /if \(prev\?\.focus\) prev\.focus\(\)/)
  assert.match(dayDrawer, /s\.student_name/)
  assert.match(dayDrawer, /s\.preceptor_name/)
  for (const col of FORBIDDEN) {
    assert.ok(!stripJs(dayDrawer).includes(col), `the day drawer must not show ${col}`)
  }
})

// ── Home composition ───────────────────────────────────────────────────────
test('Home renders welcome, an attention strip, the calendar, then the students table', () => {
  const home = portalCode.slice(portalCode.indexOf('function HomeScreen'), portalCode.indexOf('function PlacementScreen'))
  // The plain "Welcome" heading is now the shared greeting masthead (Commit 1).
  const order = ['<GreetingMasthead', 'ptl-attn-strip', '<UnitRotationCalendar', '<StudentRoster']
  let cursor = -1
  for (const marker of order) {
    const at = home.indexOf(marker)
    assert.ok(at > -1, `Home must contain ${marker}`)
    assert.ok(at > cursor, `${marker} must come after the previous block`)
    cursor = at
  }
  // Redundant Home cards are gone; dedicated routes remain.
  assert.ok(!home.includes('bucket="upcoming"'))
  assert.ok(!home.includes('Capacity and placement'))
  assert.ok(!home.includes('ptl-home-followup-grid'))
  assert.ok(!home.includes('Recent Messages'))
})

test('a student on shift now is surfaced in the On Campus Now card', () => {
  // Live shifts moved from the attention strip into the canonical On Campus Now card (Commit 2).
  assert.match(portalCode, /const unitShifts = unitKey === ALL_UNITS \? shifts : shifts\.filter\(shift => shift\.unit_key === unitKey\)/)
  assert.match(portalCode, /const onShiftNow = visibleShifts\.filter\(x => x\.state === 'in_progress'\)/)
  assert.match(portalCode, /const campusRows = onShiftNow\.map/)
  assert.match(portal, /<OnCampusNow/)
})

test('Home student rows open the approved drawer, not the staff panel', () => {
  assert.match(portalCode, /<StudentDetailDrawer/)
  assert.ok(!portalCode.includes('StudentSidePanel'),
    'the staff profile panel exposes restricted data and must never be mounted here')
})

// ── Phase boundary: no preceptor writes ────────────────────────────────────
test('phase 1 contains no preceptor assignment or creation action', () => {
  for (const forbidden of [
    'unit-preceptor-assign', 'unit-preceptor-create', 'preceptor-assignments',
    'Change primary preceptor', 'Add secondary preceptor', 'Add coverage',
  ]) {
    assert.ok(!portalCode.includes(forbidden),
      `phase 1 must not ship ${forbidden}`)
  }
})

test('the kebab menu carries only Message Student in this no-SQL phase', () => {
  // SUPERSEDED: milestone confirmations were removed until Phase 2; only Message Student
  // remains. The whole row opens the profile.
  const row = portalCode.slice(portalCode.indexOf('function StudentRow'), portalCode.indexOf('function PreceptorScreen'))
  assert.match(row, /Message student/)
  assert.ok(!row.includes('Confirm '))
  assert.match(portalCode, /aria-label=\{`Open details for \$\{studentName\(s\)\}`\}/,
    'the whole row opens the profile')
})

// ── Evaluations exposes nothing ────────────────────────────────────────────
test('the Evaluations tab reads no endpoint and shows no result', () => {
  for (const forbidden of ['fetch(', 'apiFetch', 'supabase', 'useEndpoint', 'evaluation_responses']) {
    assert.ok(!evalsCode.includes(forbidden), `Evaluations must not reference ${forbidden}`)
  }
  // No numbers at all: a count is itself a result at these cohort sizes.
  const rendered = evals.slice(evals.indexOf('export default'))
  assert.ok(!/>\s*\d+\s*</.test(rendered), 'no numeric value may be rendered')
})

test('the Evaluations placeholder explains purpose and prerequisites honestly', () => {
  assert.match(evals, /not available here yet/)
  for (const safeguard of ['Consent', 'Moderation', 'Delayed release',
    'Stable attribution', 'Small-cohort', 'Free-text']) {
    assert.match(evals, new RegExp(safeguard), `it must name ${safeguard}`)
  }
  assert.ok(!/loading/i.test(rendered0(evals)), 'it must not imitate a loading state')
})
function rendered0(src) { return src.slice(src.indexOf('export default')) }

// ── API client ─────────────────────────────────────────────────────────────
test('the shift client sends only a date range', () => {
  const fn = stripJs(api).slice(stripJs(api).indexOf('export const getShiftActivity'))
  const body = fn.slice(0, fn.indexOf('\n\n'))
  assert.match(body, /q\.set\('from', from\)/)
  assert.match(body, /q\.set\('to', to\)/)
  for (const forbidden of ['student_id', 'unit_key', 'scope']) {
    assert.ok(!body.includes(forbidden), `the client must not send ${forbidden}`)
  }
})

// ── House style ────────────────────────────────────────────────────────────
test('no em dash in the phase 1 sources', () => {
  const EM_DASH = String.fromCharCode(0x2014)
  for (const [name, src] of [['endpoint', endpoint], ['calendar', calendar],
    ['day drawer', dayDrawer], ['evaluations', evals], ['chrome', chrome],
    ['dates', read('src/lib/rotationCalendarDates.js')]]) {
    assert.ok(!src.includes(EM_DASH), `${name} must not contain an em dash`)
  }
})
