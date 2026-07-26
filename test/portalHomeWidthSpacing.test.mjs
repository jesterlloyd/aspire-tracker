// Commit 2: Unit Leader Home width alignment + spacing. Source guards that the masthead and
// On Campus Now align to the same grid edges as the calendar, the redundant lower unit label is
// gone (the upper "Unit · X" stays), and the taskbar-to-tabs gap is reduced.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')
const portal = read('src/portal/UnitLeaderPortal.jsx')
const css = read('src/portal/portal.css')
const chrome = read('src/portal/unit/UnitLeaderChrome.jsx')

test('masthead and On Campus Now align to the calendar/grid edges (no side inset)', () => {
  // The reused .mast / .mast-live classes carry a side margin for the staff page; inside the
  // Unit Leader Home grid it is zeroed so they align to the same edges as the calendar.
  assert.match(css, /\.ptl-unit-page \.mast,\s*\.ptl-unit-page \.mast-live \{ margin: 0; \}/)
  // They sit directly in the .ptl-unit-page grid, not inside a narrower nested wrapper.
  assert.match(portal, /<div className="ptl-page ptl-unit-page">/)
  const home = portal.slice(portal.indexOf('function HomeScreen'), portal.indexOf('function PlacementScreen'))
  assert.match(home, /<GreetingMasthead/)
  assert.match(home, /<OnCampusNow/)
  assert.match(home, /<UnitRotationCalendar/)
  // No Home-only width wrapper around the masthead / card.
  assert.ok(!/className="[^"]*ptl-home-wrap|ptl-home-inner/.test(home))
})

test('the redundant lower unit label is removed; the upper "Unit · X" context stays', () => {
  // Lower "Unit Leader · <units>" line and its now-unused unitContext are gone.
  assert.ok(!portal.includes('Unit Leader · {unitContext}'))
  assert.ok(!portal.includes('const unitContext'))
  // No leftover spacer paragraph where it used to be.
  assert.ok(!/<p className="ptl-muted" style=\{\{ margin: '12px 0 0' \}\}>/.test(portal))
  // The upper context (UnitSwitcher single-unit line) remains.
  assert.match(chrome, /<p className="ptl-unit-context">Unit · <b>\{unitKeys\[0\]\}<\/b><\/p>/)
})

test('the taskbar-to-tabs gap is reduced (compact, like the main app)', () => {
  // Base and desktop top padding on the shared portal main are tighter than before (24/28px).
  assert.match(css, /\.ptl-main \{ flex: 1; width: 100%; margin: 0 auto; padding: 16px 24px 40px; \}/)
  assert.match(css, /\.ptl-main \{ width: 94vw; max-width: 1500px; padding: 14px 0 40px; \}/)
  // Tabs keep their accessible 44px touch target (unchanged).
  assert.match(css, /\.ptl-nav-item \{[\s\S]*?min-height: 44px/)
})
