// UL-PHASE1-VISUAL: guards for the visual-language corrections.
//
// Roster row, student profile hero, photo reuse, the single kebab, the avatar menu,
// and More. These are static-source guards in the repo's node:test convention; the
// runtime rendering is confirmed separately in the acceptance pass.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { STAGE_TOKENS, stageToken } from '../src/portal/unit/unitStageTokens.js'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')
const stripJs = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const portal   = read('src/portal/UnitLeaderPortal.jsx')
const drawer   = read('src/portal/unit/StudentDetailDrawer.jsx')
const avatar   = read('src/portal/unit/UnitStudentAvatar.jsx')
const photos   = read('src/portal/unit/useUnitStudentPhotos.js')
const shell    = read('src/portal/PortalShell.jsx')
const chrome   = read('src/portal/unit/UnitLeaderChrome.jsx')
const app      = read('src/portal/PortalApp.jsx')
const roster   = read('api/portal/unit-roster.js')
const css      = read('src/portal/portal.css')
const api      = read('src/portal/unit/unitLeaderApi.js')

const portalCode = stripJs(portal)
const drawerCode = stripJs(drawer)
const chromeCode = stripJs(chrome)

// ── Roster row ──────────────────────────────────────────────────────────────
test('the roster renders a circular photo avatar with an initials fallback', () => {
  assert.match(portalCode, /<UnitStudentAvatar url=\{photoUrl\} name=\{studentName\(s\)\}/)
  assert.match(avatar, /borderRadius: '50%'/)
  // The avatar renders the photo when a url is present, else initials.
  assert.match(avatar, /if \(url\) \{/)
  assert.match(avatar, /initials\(name\)/)
})

test('a photo that fails to load falls back rather than showing broken', () => {
  assert.match(avatar, /onError=/)
})

test('the row shows the required fields and a colored stage pill', () => {
  const row = portalCode.slice(portalCode.indexOf('function StudentRow'), portalCode.indexOf('function StudentKebab'))
  assert.match(row, /studentName\(s\)/)
  assert.match(row, /orDash\(s\.school\)/)
  assert.match(row, /orDash\(s\.unit_key\)/)
  assert.match(row, /orDash\(s\.preceptor_name\)/)
  assert.match(row, /<HoursCell/)
  assert.match(row, /ONBOARDING_LABEL/)
  // Stage pill uses the shared stage tokens.
  assert.match(row, /const stage = stageToken\(s\.bucket\)/)
  assert.match(row, /background: stage\.bg, color: stage\.text/)
})

test('exactly one kebab menu, and the stacked View details plus Actions buttons are gone', () => {
  assert.ok(!portalCode.includes('function StudentActions'), 'the old stacked control is removed')
  assert.match(portalCode, /function StudentKebab/)
  // One overflow control per row.
  const row = portalCode.slice(portalCode.indexOf('function StudentRow'), portalCode.indexOf('export default') === -1 ? undefined : undefined)
  assert.match(portalCode, /<StudentKebab/)
  assert.equal((portalCode.match(/<StudentKebab/g) || []).length, 1)
  assert.match(portalCode, /aria-haspopup="menu"/)
})

test('the whole row is the open-profile control and the kebab is a sibling', () => {
  const row = portalCode.slice(portalCode.indexOf('function StudentRow'), portalCode.indexOf('function StudentKebab'))
  assert.match(row, /className="ptl-stu-rowbtn"/)
  assert.match(row, /onClick=\{\(e\) => onOpen\(s, e\.currentTarget\)\}/)
  // The kebab opens after the row button closes: not nested inside it.
  const rowBtnClose = row.indexOf('</button>')
  const kebab = row.indexOf('<StudentKebab')
  assert.ok(rowBtnClose > -1 && kebab > rowBtnClose)
})

test('the kebab carries only the safe Phase 1 actions, no preceptor write', () => {
  const kebab = portalCode.slice(portalCode.indexOf('function StudentKebab'), portalCode.indexOf('function StudentKebab') + 1400)
  assert.match(kebab, /Message student/)
  assert.match(kebab, /Confirm \$\{m\.label\.toLowerCase\(\)\}/)
  for (const forbidden of ['Change primary', 'Add secondary', 'Add coverage', 'Create new preceptor']) {
    assert.ok(!kebab.includes(forbidden), `Phase 1 kebab must not offer ${forbidden}`)
  }
})

// ── Photo prefetch and reuse ────────────────────────────────────────────────
test('the roster returns has_photo and batch-prefetches into the shared cache', () => {
  assert.match(roster, /has_photo: hasFile\(s\.headshot_url\)/)
  assert.match(portalCode, /const photos = useUnitStudentPhotos\(students\)/)
  assert.match(photos, /getStudentFileUrlsBatch/)
  assert.match(photos, /resolveStudentPhotoUrl\(ulPhotoKey/)
  // Only students with a photo are requested.
  assert.match(photos, /\.filter\(s => s\?\.id && s\.has_photo/)
})

test('the drawer reuses the roster-cached photo before signing a new one', () => {
  assert.match(drawerCode, /const warm = peekStudentPhotoUrl\(cacheKey\)/)
  assert.match(drawerCode, /if \(attempt === 0 && peekStudentPhotoUrl\(cacheKey\)\) return undefined/)
  assert.match(drawerCode, /ulPhotoKey\(studentId\)/)
})

test('the batch client sends only ids and a kind, never a path or scope', () => {
  const fn = stripJs(api).slice(stripJs(api).indexOf('export const getStudentFileUrlsBatch'))
  const body = fn.slice(0, fn.indexOf('\n\n'))
  assert.match(body, /items/)
  for (const forbidden of ['unit_key', 'scope', 'headshot_url', 'path']) {
    assert.ok(!body.includes(forbidden), `the batch client must not send ${forbidden}`)
  }
})

// ── Student profile hero ────────────────────────────────────────────────────
test('the profile uses a circular hero photo, never a square', () => {
  assert.match(css, /img\.ptl-detail-photo \{[\s\S]*?border-radius: 50%/)
  assert.ok(!/\.ptl-detail-photo \{[^}]*border-radius: 12px/.test(css),
    'the square headshot rule is gone')
})

test('the empty and error placeholder may stay a rounded rectangle', () => {
  assert.match(css, /\.ptl-detail-photo-empty \{[\s\S]*?border-radius: 16px/)
})

test('the hero uses the pastel light-blue tint and centred identity', () => {
  assert.match(css, /\.ptl-detail-hero \{[\s\S]*?linear-gradient\(160deg, #dceff8/)
  assert.match(css, /\.ptl-detail-hero \{[\s\S]*?text-align: center/)
  assert.match(drawerCode, /className="ptl-detail-hero"/)
  assert.match(drawerCode, /ptl-detail-heroname/)
  assert.match(drawerCode, /ptl-detail-heropill/)
})

test('the drawer still shows only approved fields and no restricted data', () => {
  for (const forbidden of ['date_of_birth', 'ssn', 'cumulative_gpa', 'gpa',
    'interview_outcome', 'ngrp', 'disposition', 'admin_notes', 'support_needed',
    'certificate', 'rubric']) {
    assert.ok(!drawerCode.includes(forbidden), `the drawer must not reference ${forbidden}`)
  }
  // The approved contact and rotation fields remain.
  for (const ok of ['school_email', 'personal_email', 'phone', 'preceptor_name', 'rotation']) {
    assert.match(drawerCode, new RegExp(ok), `the drawer should keep ${ok}`)
  }
})

// ── Stage tokens ────────────────────────────────────────────────────────────
test('stage tokens map every lifecycle bucket to a color, reusing staff hues', () => {
  for (const bucket of ['upcoming', 'active', 'completed']) {
    const t = stageToken(bucket)
    assert.ok(t.bg && t.text && t.border, `${bucket} must have a full token`)
  }
  // Active reuses the staff Active Rotation green; completed the pale green.
  assert.equal(STAGE_TOKENS.active.bg, '#d1fae5')
  assert.equal(STAGE_TOKENS.completed.bg, '#f0fdf4')
  assert.equal(STAGE_TOKENS.upcoming.bg, '#dbeafe')
  // An unknown bucket falls back to a neutral token rather than crashing.
  const n = stageToken('nope')
  assert.ok(n.bg && n.text && n.border)
})

// ── Avatar menu ─────────────────────────────────────────────────────────────
test('the avatar menu shows exactly Profile, Public site, Sign out for a Unit Leader', () => {
  // The Unit Leader mount passes onProfile and a canonical public-site URL.
  assert.match(app, /onProfile=\{\(\) => goUnitSection\('profile'\)\}/)
  assert.match(app, /publicSiteUrl="https:\/\/aspireintelligence\.app"/)
  // The menu renders Profile (not Edit Profile) when onProfile is present.
  assert.match(shell, /onProfile\s*\n?\s*\?\s*<button[\s\S]*?Profile<\/button>/)
  assert.match(shell, /Public site/)
  assert.match(shell, /Sign out/)
  // Notification preferences must NOT be in the avatar menu.
  assert.ok(!shell.includes('Notification'), 'the avatar menu must not carry notification preferences')
})

test('the Student Portal avatar menu is unchanged, still Edit Profile', () => {
  // Student mount passes neither onProfile nor a publicSiteUrl override.
  const studentMount = app.slice(app.indexOf('title="Student Portal"'), app.indexOf('title="Student Portal"') + 400)
  assert.ok(!studentMount.includes('onProfile'), 'the student menu must keep its Edit Profile drawer')
  assert.match(shell, /Edit Profile/)
})

// ── More ────────────────────────────────────────────────────────────────────
test('More holds exactly Placement Requests, Capacity, Preceptors, Notification Preferences', () => {
  assert.match(chromeCode, /const MORE_KEYS = \['placements', 'capacity', 'preceptors', 'notifications'\]/)
  // Profile is not in More.
  const m = /const MORE_KEYS = \[([^\]]*)\]/.exec(chromeCode)
  assert.ok(!m[1].includes('profile'), 'Profile must not appear in More')
})

test('there is exactly one Notification Preferences destination', () => {
  // In More, and nowhere else: not in the avatar menu, not in primary nav.
  assert.ok(chromeCode.includes("'notifications'"))
  const primary = /const PRIMARY_KEYS = \[([^\]]*)\]/.exec(chromeCode)
  assert.ok(!primary[1].includes('notifications'))
  assert.ok(!shell.includes('Notification'))
})

test('Profile remains reachable as a route even though it left More', () => {
  // Still a known section and a routable unit view.
  assert.match(chromeCode, /key: 'profile'/)
  assert.match(stripJs(app), /'profile'/)
})

// ── Messages is the shared workspace ────────────────────────────────────────
test('Unit Leader Messages mounts the same workspace as the Student Portal', () => {
  // Same shared component, so the same conversational visual language, with only the
  // unit_leader variant differing. No UL-specific message UI is introduced.
  assert.match(portalCode, /<PortalMessagesWorkspace[\s\S]*?variant="unit_leader"/)
  assert.match(app, /<PortalMessagesWorkspace/, 'the student mounts the same component')
  assert.match(portalCode, /Message the ASPIRE Team/, 'the ASPIRE Team action is preserved')
})

// ── House style ─────────────────────────────────────────────────────────────
test('no em dash in the changed visual sources', () => {
  const EM_DASH = String.fromCharCode(0x2014)
  for (const [name, s] of [['avatar', avatar], ['photos', photos],
    ['tokens', read('src/portal/unit/unitStageTokens.js')], ['shell', shell]]) {
    assert.ok(!s.includes(EM_DASH), `${name} must not contain an em dash`)
  }
})
