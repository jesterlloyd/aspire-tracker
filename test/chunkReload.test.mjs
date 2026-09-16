// CHUNK-RELOAD-1 (2026-09-15): a deploy must never leave an open tab blank.
//
// Every deploy renames the code-split chunks. A tab from before the deploy asks for
// the old names; the SPA rewrite answered with app.html (200), the import failed,
// and with no error boundary React unmounted everything. Three layers now:
// missing assets 404, a failed lazy import reloads the page once, and a boundary
// shows a message for anything else. Plus the portal chunk is warmed from the menu.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { shouldReloadAfterChunkFailure } from '../src/lib/lazyReload.js'

const read = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const root = new URL('../', import.meta.url).pathname

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (/ \d\./.test(name)) continue   // untracked " 2." duplicates
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(jsx?|mjs)$/.test(name)) out.push(p)
  }
  return out
}

test('missing assets are a real 404, not app.html with a 200', () => {
  const vercel = JSON.parse(read('vercel.json'))
  const spa = vercel.rewrites.find(r => r.destination === '/app.html')
  assert.equal(spa.source, '/((?!api/|assets/).*)')
})

test('a failed chunk reloads once, then gives up to the boundary', () => {
  const store = new Map()
  const storage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) }
  assert.equal(shouldReloadAfterChunkFailure('PortalApp', storage, 1_000_000), true, 'first failure reloads')
  assert.equal(shouldReloadAfterChunkFailure('PortalApp', storage, 1_000_000 + 30_000), false, 'same chunk again inside the window does not')
  assert.equal(shouldReloadAfterChunkFailure('PublicSite', storage, 1_000_000 + 30_000), true, 'a different chunk is its own decision')
  assert.equal(shouldReloadAfterChunkFailure('PortalApp', storage, 1_000_000 + 3 * 60_000), true, 'after the window it may reload again')
  // Storage that throws (private mode, blocked) still reloads once rather than crashing.
  const broken = { getItem() { throw new Error('blocked') }, setItem() { throw new Error('blocked') } }
  assert.equal(shouldReloadAfterChunkFailure('PortalApp', broken), true)
})

test('every lazy import in src goes through lazyReload, with a stable chunk name', () => {
  const offenders = []
  for (const file of walk(join(root, 'src'))) {
    if (file.endsWith('/src/lib/lazyReload.js')) continue   // the one place lazy() belongs
    const src = readFileSync(file, 'utf8')
    if (/\blazy\(\s*\(\)\s*=>\s*import\(/.test(src)) offenders.push(file.replace(root, ''))
    if (/import \{[^}]*\blazy\b[^}]*\} from 'react'/.test(src)) offenders.push(file.replace(root, '') + ' (imports lazy)')
  }
  assert.deepEqual(offenders, [])
  for (const [file, names] of [
    ['src/App.jsx', ['PublicSite', 'PortalApp']],
    // PORTAL-SPLIT Phase 3: one chunk per portal, so a visitor downloads the one
    // their role resolves to instead of all five.
    ['src/portal/PortalApp.jsx', ['StudentShiftLog', 'StudentPortal', 'MyProfile', 'UnitLeaderPortal',
      'AcademicPartnerPortal', 'NursingAcademicsPortal', 'ResidencyPortal']],
    ['src/portal/StudentPortal.jsx', ['StudentRotationActivity']],
    ['src/portal/UnitLeaderPortal.jsx', ['UnitRotationCalendar', 'UnitPreceptorsWorkspace', 'UnitLeaderPreceptorManager', 'UnitEvaluationsWorkspace']],
  ]) {
    const src = read(file)
    for (const n of names) assert.match(src, new RegExp(`lazyReload\\((?:\\(\\) => import\\('[^']+'\\)|loadPortalApp), '${n}'\\)`), `${file}: ${n}`)
  }
})

test('PORTAL-SPLIT Phase 1: the staff app is its own chunk and App.jsx never imports it back', () => {
  const app = read('src/App.jsx')
  assert.match(app, /const StaffApp = lazyReload\(loadStaffApp, 'StaffApp'\)/)
  assert.match(app, /import \{ loadStaffApp \} from '\.\/lib\/staffAppLoader'/)
  assert.match(app, /<Route path="\/\*"\s+element=\{<Suspense fallback=\{<ShellSplash \/>\}><StaffApp \/><\/Suspense>\} \/>/)
  // The saving is the whole point: a portal, public or login visitor must not
  // pull the staff tree into the entry. One static import of any of these undoes
  // ~745 KB gzipped (961 KB first load -> 216 KB, measured 2026-09-15).
  for (const staffOnly of [
    './components/OverviewTab', './components/Header/Header', './pages/Connect',
    './components/settings/SettingsShell', './components/ngrp/NgrpWorkspace',
    './components/RotationTab', './components/EvaluationTab', './components/Keith',
  ]) {
    assert.doesNotMatch(app, new RegExp(`from '${staffOnly.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'`), `App.jsx must not import ${staffOnly}`)
  }
  // Values both halves need live in their own module, not in either chunk.
  const shared = read('src/lib/staffRoutes.js')
  assert.match(shared, /export const TAB_TO_PATH/)
  assert.match(shared, /export const PORTAL_STAFF_ROLES/)
  assert.doesNotMatch(shared, /^import /m, 'staffRoutes must stay dependency-free so it costs the entry nothing')
  const staff = read('src/staff/StaffApp.jsx')
  assert.match(staff, /export default AuthedShell/)
  assert.match(staff, /import \{ TAB_TO_PATH, PORTAL_STAFF_ROLES \} from '\.\.\/lib\/staffRoutes'/)
})

test('the boundary wraps the app, and the portal chunk is warmed when the profile menu opens', () => {
  const main = read('src/main.jsx')
  assert.match(main, /<AppErrorBoundary>\s*<App \/>\s*<\/AppErrorBoundary>/)
  const boundary = read('src/components/AppErrorBoundary.jsx')
  assert.match(boundary, /static getDerivedStateFromError/)
  assert.match(boundary, /onClick=\{\(\) => window\.location\.reload\(\)\}/)
  assert.doesNotMatch(boundary, /className=/, 'inline styles only: it must render when a stylesheet is what failed')
  const loader = read('src/lib/portalAppLoader.js')
  assert.match(loader, /export const loadPortalApp = \(\) => import\('\.\.\/portal\/PortalApp'\)/)
  const menu = read('src/components/UserMenu.jsx')
  assert.match(menu, /if \(isOpen\) preloadPortalApp\(\);/)
})
