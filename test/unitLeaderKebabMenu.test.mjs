// UL-WORKFLOW: guards for the portal-based student actions menu (kebab).
//
// The menu was being clipped by the student table wrapper's overflow. It now renders
// through a document.body portal as a fixed, viewport-clamped popover, with full close
// and focus behavior. These are static-source guards; the live browser check confirms
// the visual result after deploy.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')
const stripJs = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const menu = read('src/portal/unit/StudentActionsMenu.jsx')
const menuCode = stripJs(menu)
const portal = read('src/portal/UnitLeaderPortal.jsx')
const portalCode = stripJs(portal)
const css = read('src/portal/portal.css')

// ── The clip is gone: the menu escapes the table wrapper via a body portal ──────
test('the menu renders through a document.body portal so overflow cannot clip it', () => {
  assert.match(menuCode, /import \{ createPortal \} from 'react-dom'/)
  assert.match(menuCode, /createPortal\(/)
  assert.match(menuCode, /document\.body,?\s*\)/)
  // Fixed positioning takes it out of the flow entirely; the CSS carries no absolute
  // offset that would re-anchor it inside the clipping ancestor.
  assert.match(menuCode, /position: 'fixed'/)
  const rule = css.slice(css.indexOf('.ptl-stu-menu {'), css.indexOf('.ptl-stu-menuitem {'))
  assert.ok(!rule.includes('position: absolute'), 'the menu rule no longer positions absolutely')
})

test('the table wrapper still scrolls horizontally, proving the clip was real', () => {
  // The wrapper keeps overflow-x: auto (wide tables must scroll); the fix is the portal,
  // not removing the scroller. This documents WHY the absolute menu was clipped before.
  assert.match(css, /\.ptl-stu-tablewrap \{[^}]*overflow-x: auto/)
})

// ── Position is measured imperatively and clamped to the viewport ───────────────
test('the menu is anchored to the button and clamped to the viewport (desktop and narrow)', () => {
  assert.match(menuCode, /getBoundingClientRect\(\)/)
  // Horizontal clamp keeps it on-screen at either edge.
  assert.match(menuCode, /Math\.max\(EDGE, Math\.min\([^)]*window\.innerWidth/)
  // Vertical flip: drop below normally, flip above when the viewport bottom would clip.
  assert.match(menuCode, /window\.innerHeight/)
  assert.match(menuCode, /r\.top - GAP - height/)
  // Measured in a ref callback, not setState-in-effect (which this repo forbids).
  assert.ok(!/useEffect\([\s\S]*?set[A-Z]\w*\(/.test(menuCode), 'no setState inside an effect')
})

// ── Close behavior: Escape, outside press, external scroll/resize; focus returns ─
test('Escape, an outside press, and external scroll or resize all close the menu', () => {
  assert.match(menuCode, /e\.key === 'Escape'/)
  assert.match(menuCode, /addEventListener\('mousedown', onPointerDown, true\)/)
  assert.match(menuCode, /addEventListener\('scroll', onScrollResize, true\)/)
  assert.match(menuCode, /addEventListener\('resize', onScrollResize\)/)
  // An outside press is one whose target is neither the menu nor the button.
  assert.match(menuCode, /menuRef\.current\?\.contains\(e\.target\) \|\| btnRef\.current\?\.contains\(e\.target\)/)
  // Every listener is removed on close, so nothing leaks after the menu unmounts.
  assert.match(menuCode, /removeEventListener\('keydown'/)
  assert.match(menuCode, /removeEventListener\('mousedown'/)
  assert.match(menuCode, /removeEventListener\('scroll'/)
  assert.match(menuCode, /removeEventListener\('resize'/)
})

test('closing returns focus to the trigger button', () => {
  assert.match(menuCode, /const close = useCallback\(\(\) => \{\s*onClose\(\)\s*btnRef\.current\?\.focus\(\)/)
  // Selecting an item also closes (and therefore returns focus).
  assert.match(menuCode, /onClick=\{\(\) => \{ it\.onSelect\(\); close\(\) \}\}/)
})

test('the first item is focused on open and arrow keys move between items', () => {
  assert.match(menuCode, /querySelector\('\[role="menuitem"\]:not\(\[disabled\]\)'\)\?\.focus\(\)/)
  assert.match(menuCode, /e\.key === 'ArrowDown' \|\| e\.key === 'ArrowUp'/)
})

// ── One open at a time, and the photo is untouched ──────────────────────────────
test('one menu is open at a time, enforced by a single open-row id in the roster', () => {
  assert.match(portalCode, /const \[openActions, setOpenActions\] = useState\(null\)/)
  assert.match(portalCode, /open=\{openActions === s\.id\}/)
  assert.match(portalCode, /onCloseActions=\{\(\) => setOpenActions\(null\)\}/)
})

test('opening the menu never reloads or hides the student photo', () => {
  // The avatar takes a stable cached url and falls back to initials via state, so the
  // re-render from toggling the menu cannot blank or refetch it. The menu component does
  // not render or touch the avatar at all.
  assert.ok(!menuCode.includes('UnitStudentAvatar'), 'the menu does not render the avatar')
  assert.ok(!menuCode.includes('photoUrl') && !menuCode.includes('studentPhotoCache'),
    'the menu never touches photo state')
})

// ── Still Message Student only in this no-SQL phase ─────────────────────────────
test('the menu renders exactly the items it is given, no hardcoded actions', () => {
  // The component is generic: it maps items; the row supplies only Message Student.
  assert.match(menuCode, /items\.map\(it =>/)
  assert.ok(!menuCode.includes('Confirm '), 'no milestone confirmations baked into the menu')
  assert.ok(!menuCode.includes('Assign'), 'no preceptor-assignment actions baked into the menu')
})
