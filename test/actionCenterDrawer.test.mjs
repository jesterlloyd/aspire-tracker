// ACTION-CENTER-DRAWER-1: presentation pins for the full-height drawer.
//
// The old sheet capped itself at 600px and reserved 116px of bottom space, so
// on a busy cohort the Owner clicked "Show all" while half the viewport sat
// empty. The reservation existed because the floating Keith/Messages launchers
// render at z 998-1001, ABOVE the old scrim/panel pair (499/500) - the sheet
// could not extend into space it was not allowed to cover. The drawer now
// layers above the launchers (standard modal behavior; toasts at z 9998 stay
// on top) and takes the full height under the chrome.
//
// These are source pins, not predicates: the attention engine is untouched by
// this work and keeps its own tests in attentionEngine.test.mjs.
// Run: node --test test/actionCenterDrawer.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')
const panel = read('src/components/ActionCenter.jsx')
const notifPanel = read('src/components/StaffNotificationsPanel.jsx')

test('the drawer is full height: no 600px cap, no launcher reservation', () => {
  assert.ok(!/min\(600px/.test(panel), 'the 600px height cap must not return')
  assert.ok(!/pos\.top \+ 116/.test(panel), 'the 116px launcher reservation must not return')
  assert.match(panel, /height: pos\.mobile \? '100dvh' : `calc\(100vh - \$\{pos\.top \+ 16\}px\)`/,
    'header-to-bottom with a 16px margin on desktop; the real visual viewport on mobile')
})

test('the drawer layers above the floating launchers, below toasts', () => {
  // Keith orb: 1000/1001. Messages launcher: 999/1001. Toast: 9998.
  assert.match(panel, /\.ac-scrim \{[^}]*z-index: 1002/, 'scrim above the launchers')
  assert.match(panel, /zIndex: 1003/, 'panel above its scrim')
  const toast = read('src/components/Toast.jsx')
  assert.match(toast, /zIndex: 9998/, 'toasts still render above the drawer')
})

test('the section cap matches the taller drawer and a filter uncaps entirely', () => {
  assert.match(panel, /const SECTION_CAP = 8/)
  assert.ok(!/items\.slice\(0, 3\)/.test(panel), 'the old 3-item cap must not survive')
  // A pill filter means "show me this section": no Show-all click stands
  // between the reader and the items they asked for.
  assert.match(panel, /!!expandedStacks\[section\.key\] \|\| !!activeFilter/)
  // "Show all" is retained as progressive disclosure for the multi-section
  // All view - the cap's only remaining job is keeping lower sections
  // reachable when several sections are long at once.
  assert.match(panel, /Show all/)
})

test('section headers are sticky with a theme-aware background', () => {
  assert.match(panel, /\.ac-sechead \{ position: sticky; top: 0/)
  assert.match(panel, /\[data-theme="dark"\] \.ac-sechead/)
  assert.match(panel, /className="ac-sechead"/)
})

test('scroll stays inside the drawer on both tabs', () => {
  // overscroll-behavior keeps a fast wheel from scrolling the page beneath
  // the scrim once the internal list hits its end - the "double scroll" the
  // refinement was asked to prevent.
  assert.match(panel, /overscrollBehavior: 'contain'/)
  assert.match(notifPanel, /overscrollBehavior: 'contain'/)
})

test('mobile is a full-screen sheet with safe-area padding', () => {
  assert.match(panel, /setPos\(\{ top: 0, right: 0, width: vw, mobile: true \}\)/)
  assert.match(panel, /borderRadius: pos\.mobile \? 0 : 16/)
  assert.match(panel, /env\(safe-area-inset-bottom\)/)
  assert.match(notifPanel, /env\(safe-area-inset-bottom\)/)
})

test('the empty state centers and passive sections pin to the drawer bottom', () => {
  // In the always-full-height drawer an empty list is real estate: the
  // caught-up state takes flex:1 (centered), which pushes Handled
  // automatically / Recently completed to the bottom edge - "covered" vs
  // "needs me" stays legible even with nothing to do.
  assert.match(panel, /flex: 1, overflowY: 'auto', overscrollBehavior: 'contain',\s*\n\s*display: 'flex', flexDirection: 'column'/)
  const emptyBlocks = panel.match(/flex: 1, display: 'flex', (alignItems|flexDirection)/g) || []
  assert.ok(emptyBlocks.length >= 2, 'both the loading and caught-up states absorb the free height')
})

test('Show less stays reachable after Show all', () => {
  // Caught in production QC: the expand/collapse row was derived from the
  // post-expansion hidden count, so expanding a section removed the only way
  // to collapse it again. The row must key on section OVERFLOW instead.
  const src = read('src/components/ActionCenter.jsx')
  assert.match(src, /const overflow\s+= activeFilter \? 0 : items\.length - SECTION_CAP/)
  assert.match(src, /\{overflow > 0 && \(/, 'the row renders on overflow, not on hiddenCount')
  assert.match(src, /Showing all \$\{items\.length\}/, 'the expanded row says what it shows')
  assert.ok(!/\{hiddenCount > 0 && \(/.test(src), 'the old hiddenCount-gated row must not return')
})
