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
} from '../src/portal/unit/rotationCalendarDates.js'

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
test('primary navigation is exactly Home, Messages, Evaluations, in that order', () => {
  assert.match(chromeCode, /const PRIMARY_KEYS = \['home', 'messages', 'evaluations'\]/)
})

test('Students is absent from primary navigation but still a section', () => {
  const m = /const PRIMARY_KEYS = \[([^\]]*)\]/.exec(chromeCode)
  assert.ok(!m[1].includes('students'), 'Students must not be a primary tab')
  assert.match(chromeCode, /key: 'students'/, 'but it must remain a known section')
})

test('More holds the five infrequent destinations', () => {
  assert.match(chromeCode,
    /const MORE_KEYS = \['placements', 'capacity', 'preceptors', 'profile', 'notifications'\]/)
})

test('the nav is identical at every width, with no desktop-only branch', () => {
  // The desktop branch used to render all eight sections while narrow screens got More.
  assert.ok(!chromeCode.includes('usePortalIsNarrow'),
    'the width branch is gone; one nav for all widths')
  assert.ok(!/if \(!narrow\)/.test(chromeCode))
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
  assert.match(chromeCode, /const moreActive = MORE_KEYS\.includes\(view\)/)
  assert.match(chromeCode, /aria-current=\{moreActive \? 'page' : undefined\}/)
})

test('the Messages badge still works, so More can carry a count later', () => {
  assert.match(chromeCode, /ptl-nav-badge/)
  assert.match(chromeCode, /unreadLabel\(unread\)/)
})

// ── Routes preserved ───────────────────────────────────────────────────────
test('every prior unit route still resolves, including students and concern', () => {
  const m = /const UNIT_SECTIONS = new Set\(\[([\s\S]*?)\]\)/.exec(appCode)
  assert.ok(m, 'UNIT_SECTIONS must exist')
  for (const key of ['home', 'placements', 'capacity', 'students', 'preceptors',
    'profile', 'concern', 'evaluations', 'notifications']) {
    assert.ok(m[1].includes(`'${key}'`), `/portal/unit/${key} must remain routable`)
  }
})

test('the concern route hands off to Messages instead of 404ing', () => {
  assert.match(appCode, /const HANDOFF_TO_MESSAGES = \{ concern: \{ compose: 'aspire'/)
  assert.match(appCode, /const unitView = unitHandoff \? 'messages' : rawUnitView/)
  assert.match(appCode, /composeIntent=\{unitHandoff\}/)
})

test('Message the ASPIRE Team lives inside Messages and opens from the concern link', () => {
  assert.match(portalCode, /<AspireTeamComposer/)
  assert.match(portalCode, /startOpen=\{composeIntent\?\.compose === 'aspire'\}/)
  assert.match(portalCode, /Message the ASPIRE Team/)
  // It is no longer a section of its own.
  assert.ok(!/view === 'concern'/.test(portalCode))
})

test('/portal/unit/students renders the same roster module Home embeds', () => {
  assert.match(portalCode, /function StudentsScreen\(props\) \{\s*return <StudentRoster \{\.\.\.props\} \/>/)
  assert.match(portalCode, /<StudentRoster[\s\S]{0,200}heading="Your students"/,
    'Home embeds the same module')
})

test('the Evaluations route is wired', () => {
  assert.match(portalCode, /view === 'evaluations' && <UnitEvaluationsPlaceholder/)
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

test('monthGrid returns whole Monday-first weeks with the right day count', () => {
  for (const [y, m, days] of [[2026, 8, 30], [2026, 1, 28], [2024, 1, 29], [2026, 10, 30]]) {
    const g = monthGrid(y, m)
    assert.equal(g.length % 7, 0, 'always whole weeks')
    assert.equal(g.filter(c => c.inMonth).length, days)
  }
  // Monday first: the first cell is always a Monday.
  const g = monthGrid(2026, 8)
  assert.equal(new Date(`${g[0].ymd}T00:00:00Z`).getUTCDay(), 1)
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
  assert.match(calendarCode, /future \? 'ptl-cal-future' : ''/)
  // Checked against COMMENT-STRIPPED code. The header legitimately says the UI must
  // never say "Schedule", and matching raw source flags that explanation as a label.
  assert.ok(!/Schedule/.test(calendarCode),
    'the word Schedule must not appear as a rendered label')
})

test('an empty month states so rather than rendering a blank grid', () => {
  assert.match(calendarCode, /const monthHasActivity = /)
  assert.match(calendar, /No rotation activity recorded in/)
})

test('month navigation is bounded by the same window the server enforces', () => {
  assert.match(calendarCode, /canGoBack = !windowStart \|\| monthStart > windowStart/)
  assert.match(calendarCode, /canGoForward = monthStart < today/)
})

test('a day cell with activity opens the day drawer and is otherwise inert', () => {
  assert.match(calendarCode, /disabled=\{day\.length === 0\}/)
  assert.match(calendarCode, /onSelectDay\?\.\(ymd, day\)/)
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
test('Home renders welcome, attention, calendar, roster, then summaries', () => {
  const home = portalCode.slice(portalCode.indexOf('function HomeScreen'), portalCode.indexOf('function BucketCard'))
  const order = ['Welcome', 'Needs your attention', '<UnitRotationCalendar', '<StudentRoster', 'Capacity and placement']
  let cursor = -1
  for (const marker of order) {
    const at = home.indexOf(marker)
    assert.ok(at > -1, `Home must contain ${marker}`)
    assert.ok(at > cursor, `${marker} must come after the previous block`)
    cursor = at
  }
})

test('a student on shift now is promoted into the attention list', () => {
  assert.match(portalCode, /const onShiftNow = shifts\.filter\(x => x\.state === 'in_progress'\)/)
  assert.match(portal, /is on shift now/)
  assert.match(portalCode, /ptl-attn-dot-live/)
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

test('the kebab menu carries only the existing safe actions', () => {
  const actions = portalCode.slice(portalCode.indexOf('function StudentActions'))
  assert.match(actions, /View details/)
  assert.match(actions, /Message student/)
  assert.match(actions, /Confirm \$\{m\.label\.toLowerCase\(\)\}/)
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
    ['dates', read('src/portal/unit/rotationCalendarDates.js')]]) {
    assert.ok(!src.includes(EM_DASH), `${name} must not contain an em dash`)
  }
})
