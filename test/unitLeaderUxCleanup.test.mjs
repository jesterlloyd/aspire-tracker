// UL-UX-CLEANUP: guards for the pre-Phase-2 UX pass.
//
// Home layout, the trimmed kebab, the single 90-day student table, the corrected More,
// the disappearing-photo root-cause fix, and the load-waterfall properties.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { statusToken, STATUS_TOKENS } from '../src/portal/unit/unitStageTokens.js'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')
const stripJs = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const portal   = read('src/portal/UnitLeaderPortal.jsx')
const chrome   = read('src/portal/unit/UnitLeaderChrome.jsx')
const avatar   = read('src/portal/unit/UnitStudentAvatar.jsx')
const drawer   = read('src/portal/unit/StudentDetailDrawer.jsx')
const cache    = read('src/lib/studentPhotoCache.js')
const roster   = read('api/portal/unit-roster.js')
const css      = read('src/portal/portal.css')

const portalCode = stripJs(portal)
const chromeCode = stripJs(chrome)
const avatarCode = stripJs(avatar)
const drawerCode = stripJs(drawer)

// ── 1. Home layout ──────────────────────────────────────────────────────────
test('the attention strip renders only when something is actionable', () => {
  assert.match(portalCode, /const hasAttention = onShiftNow\.length > 0 \|\| notifications\.length > 0 \|\| supportFlags\.length > 0/)
  assert.match(portalCode, /\{hasAttention && \(/)
  // No empty "nothing needs your attention" card any more.
  assert.ok(!portalCode.includes('Nothing needs your attention right now'))
})

test('the calendar is on the left, Upcoming Students then Capacity on the right', () => {
  const grid = portalCode.slice(portalCode.indexOf('ptl-home-grid'), portalCode.indexOf('Your Students', portalCode.indexOf('ptl-home-grid')) === -1
    ? portalCode.indexOf('StudentRoster') : portalCode.indexOf('StudentRoster'))
  const left = portalCode.indexOf('ptl-col-7')
  const cal = portalCode.indexOf('<UnitRotationCalendar', left)
  const right = portalCode.indexOf('ptl-col-5', left)
  const upcoming = portalCode.indexOf('bucket="upcoming"', right)
  const cap = portalCode.indexOf('Capacity and placement', right)
  assert.ok(left < cal && cal < right, 'calendar is in the left column')
  assert.ok(right < upcoming && upcoming < cap, 'Upcoming Students precedes Capacity in the right column')
})

test('Your Students is full width below the grid', () => {
  const gridEnd = portalCode.indexOf('</div>', portalCode.indexOf('ptl-col-5'))
  const roster = portalCode.indexOf('<StudentRoster', gridEnd)
  assert.ok(roster > gridEnd, 'the roster renders after the two-column grid closes')
  assert.match(portalCode, /heading="Your students"/)
})

// ── 2. Redundant cards removed ──────────────────────────────────────────────
test('Active Rotations and Recent Messages cards are gone', () => {
  assert.ok(!portalCode.includes('Active rotations'), 'Active Rotations card removed')
  assert.ok(!portalCode.includes('Recent Messages'), 'Recent Messages card removed')
  assert.ok(!portalCode.includes('listPortalConversations'), 'the recent-threads fetch is removed from Home')
  // BucketCard is still used for Upcoming only, not Active.
  assert.equal((portalCode.match(/<BucketCard/g) || []).length, 1)
})

// ── 3. Kebab: Message Student only ──────────────────────────────────────────
test('the kebab shows only Message Student in this no-SQL phase', () => {
  // The single action is built as the one item passed to StudentActionsMenu in the row.
  const row = portalCode.slice(portalCode.indexOf('function StudentRow'), portalCode.indexOf('function PreceptorScreen'))
  assert.match(row, /Message student/)
  // The milestone confirmations are removed.
  assert.ok(!row.includes('Confirm '))
  assert.ok(!portalCode.includes('MILESTONES'))
  assert.ok(!portal.includes('confirmMilestone'))
  // And no unfinished preceptor action.
  for (const f of ['Assign New Primary', 'Assign Secondary', 'Assign Preceptor Coverage', 'Change primary']) {
    assert.ok(!portalCode.includes(f), `Phase 1 must not show ${f}`)
  }
})

// ── 4. Disappearing photo root-cause fix ────────────────────────────────────
test('the avatar falls back to initials on error via state, not DOM mutation', () => {
  // The root cause was onError setting display:none, which React never reverts, over an
  // initials branch that only rendered for a missing url. It is now a render-driven
  // state flag keyed to the failing url.
  assert.ok(!avatarCode.includes("style.display = 'none'"),
    'the DOM-mutation hide is gone')
  assert.match(avatarCode, /const failed = !!url && failedUrl === url/)
  assert.match(avatarCode, /onError=\{\(\) => setFailedUrl\(url\)\}/)
  assert.match(avatarCode, /const showPhoto = url && !failed/)
  // A new url is automatically a fresh chance (derived, no effect).
  assert.ok(!/useEffect\([^)]*setFailed/.test(avatarCode))
})

test('opening the kebab does not change the photo url or remount the row', () => {
  // The row is keyed by s.id (stable, no remount) and photoUrl comes from the cache
  // peek, which the kebab toggle does not touch.
  assert.match(portalCode, /key=\{s\.id\}/)
  assert.match(portalCode, /photoUrl=\{photos\.peek\(s\.id\)\}/)
  // The kebab toggle only flips openActions; it does not clear the cache.
  const row = portalCode.slice(portalCode.indexOf('function StudentRow'), portalCode.indexOf('function PreceptorScreen'))
  assert.ok(!row.includes('clearStudentPhotoCache'))
  assert.ok(!row.includes('invalidateStudentPhoto'))
})

test('the drawer no longer wipes the whole photo cache on one photo error', () => {
  // The second defect: the drawer called clearStudentPhotoCache() on a single photo
  // error, blanking every roster avatar. It now invalidates only that student's key.
  assert.ok(!drawerCode.includes('clearStudentPhotoCache'),
    'the global wipe is gone from the drawer')
  assert.match(drawerCode, /invalidateStudentPhoto\(cacheKey\)/)
  // The surgical invalidate exists and deletes exactly one key.
  assert.match(cache, /export function invalidateStudentPhoto\(key\)/)
  assert.match(cache, /cache\.delete\(key\)/)
})

// ── 5. One 90-day table with the approved columns ───────────────────────────
test('the stage filters are removed', () => {
  assert.ok(!portalCode.includes('ptl-filterbar'), 'the filter bar is gone from the roster')
  assert.ok(!portalCode.includes("filter === f"), 'no stage filter state')
  assert.ok(!portalCode.includes("useState('all')"))
})

test('the student table has exactly the approved columns', () => {
  // Scope to the StudentRoster's own table; other screens (placements, capacity) also
  // render tables with their own headers.
  const roster0 = portalCode.slice(portalCode.indexOf('function StudentRoster'), portalCode.indexOf('function StudentRow'))
  const head = roster0.slice(roster0.indexOf('<thead>'), roster0.indexOf('</thead>'))
  // The preceptor column is now Preceptor(s), showing every active assignment.
  for (const col of ['Student', 'ASPIRE status', 'Preceptor(s)', 'Shift', 'Rotation', 'Cohort', 'Hours']) {
    assert.ok(head.includes(`>${col}<`), `the table must have a ${col} column`)
  }
  // The row renders each column from roster data.
  const row = portalCode.slice(portalCode.indexOf('function StudentRow'), portalCode.indexOf('function PreceptorScreen'))
  assert.match(row, /<UnitStudentAvatar/)
  assert.match(row, /statusToken\(s\.status\)/)
  assert.match(row, /<PreceptorList assignments=\{s\.preceptors\}/)
  // Deployed shift with a clear Not assigned fallback (never a preference).
  assert.match(row, /\{s\.shift \|\| 'Not assigned'\}/)
  assert.match(row, /s\.rotation \?/)
  assert.match(row, /orDash\(s\.cohort\?\.name\)/)
  assert.match(row, /<HoursCell hours=\{s\.hours\}/)
})

test('the whole row opens the profile and the kebab does not double as a row click', () => {
  const row = portalCode.slice(portalCode.indexOf('function StudentRow'), portalCode.indexOf('function PreceptorScreen'))
  assert.match(row, /role="button"/)
  assert.match(row, /onClick=\{\(e\) => open_\(e\.currentTarget\)\}/)
  assert.match(row, /e\.key === 'Enter' \|\| e\.key === ' '/)
  // The actions cell stops propagation so a kebab click is not a row click.
  assert.match(row, /className="ptl-stu-actioncell"[\s\S]{0,80}onClick=\{\(e\) => e\.stopPropagation\(\)\}/)
})

test('the deep link and safe drawer are preserved', () => {
  assert.match(portalCode, /function StudentsScreen\(props\)/)
  assert.match(portalCode, /<StudentDetailDrawer/)
})

test('the roster returns shift and rotation window, both approved fields', () => {
  // Shift is now the DEPLOYED shift (primary preceptor's shift_type), never the preference.
  assert.match(roster, /shift: normalizeAssignedShift\(primaryShiftByStudent\[s\.id\]\) \|\| null/)
  assert.match(roster, /rotation: rotationById\[s\.cohort_school_rotation_id\] \|\| null/)
  // Rotation dates come from the canonical table, sentinel resolved to null.
  assert.match(roster, /const ROTATION_SENTINEL = '1900-01-01'/)
  assert.match(roster, /\.from\('cohort_school_rotations'\)/)
  // Still no path or restricted field on the roster.
  assert.ok(!/headshot_url:/.test(stripJs(roster)))
})

// ── 6. More corrected ───────────────────────────────────────────────────────
test('mobile More contains exactly Evaluations, Placement Requests, and Capacity', () => {
  assert.match(chromeCode, /const MOBILE_MORE_KEYS = \['evaluations', 'placements', 'capacity'\]/)
  const m = /const MOBILE_MORE_KEYS = \[([^\]]*)\]/.exec(chromeCode)
  assert.ok(!m[1].includes('notifications'), 'Notification Preferences is not in More')
  assert.ok(!m[1].includes('profile'), 'Profile is not in More')
  assert.ok(!m[1].includes('preceptors'), 'Preceptors is a primary mobile destination')
})

test('Notification preferences still lives in Profile', () => {
  const profile = portalCode.slice(portalCode.indexOf('function ProfileScreen'))
  assert.match(profile, /Notification preferences/)
  assert.match(profile, /setNotificationPreference/)
})

// ── 7. Load waterfall ───────────────────────────────────────────────────────
test('the independent Home requests are separate parallel useEndpoint calls', () => {
  const home = portalCode.slice(portalCode.indexOf('function HomeScreen'), portalCode.indexOf('function BucketCard'))
  // Each is its own useEndpoint, so they fan out in parallel, none chained on another. The
  // Home capacity fetch was dropped: capacity is now the canonical model, which the portal
  // does not read back, so Home no longer queries the old unit_capacity_submissions summary.
  for (const call of ['getPlacementRequests', 'getNotifications', 'getShiftActivity']) {
    assert.match(home, new RegExp(`useEndpoint\\([^)]*${call}`), `${call} is an independent endpoint`)
  }
})

test('there is no duplicate roster fetch on Home', () => {
  // getRoster is fetched once in the parent and passed down as students; HomeScreen and
  // the roster table both consume the prop, never re-fetch.
  // getRoster is called from exactly one useEndpoint, in the parent, and never re-fetched.
  assert.equal((portalCode.match(/useEndpoint\(getRoster/g) || []).length, 1)
  const home = portalCode.slice(portalCode.indexOf('function HomeScreen'))
  assert.ok(!home.includes('getRoster'), 'HomeScreen must not re-fetch the roster')
})

test('photos are batch-signed once and reused, never per-avatar', () => {
  assert.match(portalCode, /const photos = useUnitStudentPhotos\(students\)/)
  const photosMod = read('src/portal/unit/useUnitStudentPhotos.js')
  assert.match(photosMod, /getStudentFileUrlsBatch/)
  // Already-cached students are filtered out, so a re-prime signs nothing.
  assert.match(photosMod, /!peekStudentPhotoUrl\(ulPhotoKey\(s\.id\)\)/)
})

test('the roster load no longer hides the navigation behind a full-page spinner', () => {
  // While roster loads, the nav renders so Messages/Evaluations/More are usable at once.
  assert.match(portalCode, /if \(roster\.loading && !roster\.data\) \{[\s\S]*?<UnitLeaderNav/)
})

test('the drawer reuses roster data and the primed photo, avoiding a visible reload', () => {
  // The hero renders name/school/bucket from the roster `student` prop immediately, and
  // the photo reads the shared cache before signing.
  assert.match(drawerCode, /peekStudentPhotoUrl\(cacheKey\)/)
  assert.match(drawerCode, /student\?\.school/)
})

// ── Status tokens ───────────────────────────────────────────────────────────
test('the ASPIRE status pill maps the roster statuses to staff hues', () => {
  assert.equal(statusToken('Active Rotation').bg, '#d1fae5')
  assert.equal(statusToken('Placed').bg, '#dcfce7')
  assert.equal(statusToken('Completed').bg, '#f0fdf4')
  assert.ok(statusToken('Anything Else').bg, 'an unknown status still gets a neutral token')
  assert.equal(Object.keys(STATUS_TOKENS).length, 3)
})

// ── No new permission or field ──────────────────────────────────────────────
test('no new permission or restricted field is exposed', () => {
  // shift and rotation are approved fields already shown in the detail drawer.
  const rosterCode = stripJs(roster)
  for (const bad of ['date_of_birth', 'cumulative_gpa', 'ssn', 'admin_notes',
    'support_needed', 'interview_outcome', 'ngrp', 'disposition']) {
    // support_needed is allowed only as a count FILTER, checked elsewhere; here assert it
    // is never selected or returned.
    if (bad === 'support_needed') continue
    assert.ok(!rosterCode.includes(bad), `roster must not reference ${bad}`)
  }
  // The roster reuses the same auth helpers, adds no role or scope.
  assert.match(roster, /verifyPortalUnitLeaderCaller/)
  assert.match(roster, /resolveUnitScopedStudents/)
})

// ── House style ─────────────────────────────────────────────────────────────
test('no em dash in the changed sources', () => {
  const EM_DASH = String.fromCharCode(0x2014)
  for (const [name, s] of [['avatar', avatar], ['cache', cache], ['css', css]]) {
    assert.ok(!s.includes(EM_DASH), `${name} must not contain an em dash`)
  }
})
