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
  // The avatar shows the photo when present and not failed, else initials.
  assert.match(avatar, /const showPhoto = url && !failed/)
  assert.match(avatar, /initials\(name\)/)
})

test('a photo that fails to load falls back rather than showing broken', () => {
  assert.match(avatar, /onError=/)
})

test('the row shows the required fields and a colored status pill', () => {
  // SUPERSEDED: the row is now a table row and the pill is the ASPIRE STATUS (not the
  // lifecycle bucket). Unit and onboarding left the columns per the approved table spec.
  const row = portalCode.slice(portalCode.indexOf('function StudentRow'), portalCode.indexOf('function PreceptorScreen'))
  assert.match(row, /studentName\(s\)/)
  assert.match(row, /orDash\(s\.school\)/)
  // Preceptor(s) column (all active assignments) and the deployed-shift fallback.
  assert.match(row, /<PreceptorList assignments=\{s\.preceptors\}/)
  assert.match(row, /\{s\.shift \|\| 'Not assigned'\}/)
  assert.match(row, /orDash\(s\.cohort\?\.name\)/)
  assert.match(row, /<HoursCell/)
  assert.match(row, /const status = statusToken\(s\.status\)/)
  assert.match(row, /background: status\.bg, color: status\.text/)
})

test('exactly one kebab menu, and the stacked View details plus Actions buttons are gone', () => {
  // SUPERSEDED: the kebab menu now lives in its own portal component, StudentActionsMenu,
  // used exactly once from the row's Actions cell.
  assert.ok(!portalCode.includes('function StudentActions'), 'the old stacked control is removed')
  assert.match(portalCode, /import StudentActionsMenu from/)
  assert.match(portalCode, /<StudentActionsMenu/)
  assert.equal((portalCode.match(/<StudentActionsMenu/g) || []).length, 1)
})

test('the whole table row opens the profile and the kebab is in its own cell', () => {
  // SUPERSEDED: the row is a <tr role="button">; the kebab lives in the Actions cell,
  // which stops click propagation so a kebab click is never a row click.
  const row = portalCode.slice(portalCode.indexOf('function StudentRow'), portalCode.indexOf('function PreceptorScreen'))
  assert.match(row, /role="button"/)
  assert.match(row, /onClick=\{\(e\) => open_\(e\.currentTarget\)\}/)
  assert.match(row, /className="ptl-stu-actioncell"[\s\S]{0,80}stopPropagation/)
})

test('the kebab carries only Message Student in this no-SQL phase', () => {
  // SUPERSEDED: the milestone confirmations were removed until Phase 2; only Message
  // Student remains, built as the single item passed to StudentActionsMenu.
  const row = portalCode.slice(portalCode.indexOf('function StudentRow'), portalCode.indexOf('function PreceptorScreen'))
  assert.match(row, /Message student/)
  assert.ok(!row.includes('Confirm '))
  for (const forbidden of ['Change primary', 'Add secondary', 'Add coverage', 'Create new preceptor']) {
    assert.ok(!portalCode.includes(forbidden), `Phase 1 kebab must not offer ${forbidden}`)
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
test('mobile More holds exactly Evaluations, Placement Requests, and Capacity', () => {
  assert.match(chromeCode, /const MOBILE_MORE_KEYS = \['evaluations', 'placements', 'capacity'\]/)
  const m = /const MOBILE_MORE_KEYS = \[([^\]]*)\]/.exec(chromeCode)
  assert.ok(!m[1].includes('profile'), 'Profile must not appear in More')
  assert.ok(!m[1].includes('notifications'), 'Notification Preferences must not appear in More')
  assert.ok(!m[1].includes('preceptors'), 'Preceptors must be top level')
})

test('there is exactly one Notification Preferences destination', () => {
  const profile = portalCode.slice(portalCode.indexOf('function ProfileScreen'))
  assert.match(profile, /Notification preferences/)
  assert.ok(!chromeCode.includes("'notifications'"))
  assert.ok(!shell.includes('Notification'))
})

test('Profile remains reachable as a route even though it left More', () => {
  // Profile is reached from the avatar menu and remains a routable unit view.
  assert.match(stripJs(app), /goUnitSection\('profile'\)/)
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
