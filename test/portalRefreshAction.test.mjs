// QC polish, Commit 3: a shared Refresh action in the attached nav row of the Student, Unit Leader,
// and Academic Partner portals. It reuses the canonical main-app RefreshHint, is right-aligned on
// desktop and hidden in the phone bottom bar, and re-fetches the ACTIVE section's data through a
// register-per-surface contract (never a full browser reload, never an unsupported call from a
// prepared state).
//
// Source-guard tests (regex on source), matching the repo's portal/chrome coverage style.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const read = (p) => readFileSync(join(root, p), 'utf8')
const stripJs = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const refresh = read('src/portal/PortalRefresh.jsx')
const refreshCode = stripJs(refresh)
const shell = read('src/portal/PortalShell.jsx')
const studentNav = read('src/portal/PortalNav.jsx')
const ulChrome = read('src/portal/unit/UnitLeaderChrome.jsx')
const apChrome = read('src/portal/ap/AcademicPartnerChrome.jsx')
const css = read('src/portal/portal.css')

// ── The shared primitive reuses the canonical control and never hard-reloads ─────────────────────

test('the shared refresh module exists and reuses the canonical RefreshHint (no browser reload)', () => {
  assert.ok(existsSync(join(root, 'src/portal/PortalRefresh.jsx')))
  assert.match(refresh, /export function PortalRefreshProvider\(/)
  assert.match(refresh, /export function useRegisterPortalRefresh\(fn, active = true\)/)
  assert.match(refresh, /export function PortalNavRefresh\(/)
  // Canonical control, not a bespoke button.
  assert.match(refresh, /import \{ RefreshHint \} from '\.\.\/components\/UnifiedNav'/)
  assert.match(refresh, /<RefreshHint\b/)
  // Soft refetch only: this module never triggers a full browser reload.
  assert.doesNotMatch(refreshCode, /location\.reload|window\.location/)
})

test('the button shows busy/disabled state and the provider guards concurrent runs', () => {
  assert.match(refresh, /loading=\{ctx\.refreshing\}/)
  assert.match(refresh, /disabled=\{!ctx\.canRefresh\}/)
  // In-flight guard so a second run cannot start while one is running.
  assert.match(refreshCode, /if \(inFlightRef\.current \|\| handlerRef\.current == null\) return/)
  assert.match(refreshCode, /setRefreshing\(true\)/)
  assert.match(refreshCode, /finally \{[\s\S]*?setRefreshing\(false\)/)
  // Registration is stable across fn identity changes and cleans up when the surface changes.
  assert.match(refreshCode, /if \(handlerRef\.current === fn\) \{[\s\S]*?setCanRefresh\(false\)/)
})

// ── Provider wraps the shell; the action is in all three portal navs ─────────────────────────────

test('PortalShell provides the refresh context around the nav and children', () => {
  assert.match(shell, /import \{ PortalRefreshProvider \} from '\.\/PortalRefresh'/)
  assert.match(shell, /<PortalRefreshProvider>[\s\S]*\{nav\}[\s\S]*<main className="ptl-main">\{children\}<\/main>[\s\S]*<\/PortalRefreshProvider>/)
})

test('the Refresh action appears in all three portal navs', () => {
  for (const [name, src] of [['Student', studentNav], ['Unit Leader', ulChrome], ['Academic Partner', apChrome]]) {
    assert.match(src, /import \{ PortalNavRefresh \} from '(\.\/|\.\.\/)PortalRefresh'/, `${name} nav imports PortalNavRefresh`)
    assert.match(src, /<PortalNavRefresh\b/, `${name} nav renders PortalNavRefresh`)
  }
})

test('Refresh is right-aligned in the desktop nav row and hidden in the phone bottom bar', () => {
  // Right-aligned at the end of the attached row.
  assert.match(css, /\.ptl-nav-refresh \{ margin-left: auto;[^}]*\}/)
  // Hidden on phones (inside the <=760px bottom-bar media query), so the tabs are never crowded.
  const mobile = css.slice(css.indexOf('@media (max-width: 760px)'))
  assert.match(mobile, /\.ptl-nav-refresh \{ display: none; \}/)
  // The phone bottom-bar behavior itself is untouched.
  assert.match(mobile, /\.ptl-nav \{[\s\S]*?position: fixed;[\s\S]*?bottom: 0;/)
})

// ── Active-surface refetch registration, per portal ──────────────────────────────────────────────

test('the Student portal registers Home refetch, gated to the active surface', () => {
  const student = read('src/portal/StudentPortal.jsx')
  const app = read('src/portal/PortalApp.jsx')
  assert.match(student, /import \{ useRegisterPortalRefresh \} from '\.\/PortalRefresh'/)
  assert.match(student, /useRegisterPortalRefresh\(load, active\)/)
  // active is driven by the current view (Home vs Messages both stay mounted).
  // STUDENT-PORTAL-PROFILE-1: the drawer plumbing left the signature with the
  // drawer's retirement; onOpenProfile routes to the My Profile destination.
  assert.match(student, /active = true, onOpenProfile, onMobileAction/)
  assert.match(app, /active=\{studentView === 'home'\}/)
})

test('the Academic Partner roster registers its reload, and prepared states register nothing', () => {
  const ap = read('src/portal/AcademicPartnerPortal.jsx')
  assert.match(ap, /import \{ useRegisterPortalRefresh \} from '\.\/PortalRefresh'/)
  assert.match(ap, /useRegisterPortalRefresh\(reload\)/)
  // Exactly one registration call in the AP portal (the Students roster); the Placement Requests and
  // Messages prepared states never register, so Refresh is disabled there and issues no call.
  assert.equal(ap.split('useRegisterPortalRefresh(').length - 1, 1)
})

test('every Unit Leader section registers its own active data path', () => {
  const ul = read('src/portal/UnitLeaderPortal.jsx')
  assert.match(ul, /import \{ useRegisterPortalRefresh \} from '\.\/PortalRefresh'/)
  // Home: roster + feed + calendar activity.
  assert.match(ul, /useRegisterPortalRefresh\(\(\) => Promise\.all\(\[\s*refreshRoster\?\.\(\), alerts\.refresh\(\), activity\.refresh\(\),\s*\]\)\)/)
  // Students, Placement Requests, Capacity, Profile.
  assert.match(ul, /useRegisterPortalRefresh\(props\.refreshRoster\)/)      // Students
  assert.match(ul, /useRegisterPortalRefresh\(refresh\)/)                   // Placement Requests
  assert.match(ul, /useRegisterPortalRefresh\(refreshRoster\)/)            // Capacity
  assert.match(ul, /useRegisterPortalRefresh\(prefs\.refresh\)/)           // Profile
})

test('the lazy Unit Leader workspaces register their own refetch', () => {
  const prec = read('src/portal/unit/UnitPreceptorsWorkspace.jsx')
  const evals = read('src/portal/unit/UnitEvaluationsWorkspace.jsx')
  assert.match(prec, /useRegisterPortalRefresh\(\(\) => Promise\.all\(\[preceptors\.refresh\(\), history\.refresh\(\)\]\)\)/)
  assert.match(evals, /useRegisterPortalRefresh\(reload\)/)
})

test('Messages registers a refetch gated to the active surface (inbox plus the open thread)', () => {
  const msgs = read('src/portal/messages/PortalMessagesWorkspace.jsx')
  assert.match(msgs, /import \{ useRegisterPortalRefresh \} from '\.\.\/PortalRefresh'/)
  assert.match(msgs, /useRegisterPortalRefresh\(manualRefresh, active\)/)
  assert.match(msgs, /portal_messages_list/)
  assert.match(msgs, /selectedId \? qc\.invalidateQueries\(\{ queryKey: portalThreadQueryKey\(selectedId\) \}\) : null/)
})
