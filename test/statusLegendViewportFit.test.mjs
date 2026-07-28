// Shared StatusLegendPopover viewport-fit correction: the popover must stay fully inside the viewport
// when opened near the bottom (or top), flipping side as needed and constraining its height so the
// BODY scrolls internally instead of the legend running off-screen. Deterministic geometry tests of
// the pure computeLegendPlacement + source guards that the shared component wires it up and preserves
// the approved interaction/accessibility model (used by Main App, Academic Partner, and Unit Leader).

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { computeLegendPlacement, clampWithin } from '../src/components/statusLegendPlacement.js'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')

const MARGIN = 14
const GAP = 8
// A trigger rect from top/left/size (bottom/right derived), matching getBoundingClientRect.
const rect = (top, left, w = 20, h = 20) => ({ top, left, bottom: top + h, right: left + w, width: w, height: h })
// The on-screen top edge of an above-anchored (bottom-based) placement.
const topEdgeOfAbove = (p, viewportH) => viewportH - p.bottom - p.maxHeight

test('trigger near the BOTTOM flips ABOVE, anchored by bottom, fully within the top margin', () => {
  const vh = 800, vw = 1280
  const p = computeLegendPlacement({ rect: rect(760, 400), viewportW: vw, viewportH: vh })
  assert.equal(p.placement, 'above')
  assert.equal(p.top, null)
  assert.ok(p.bottom != null)
  // Its rendered top edge cannot cross the viewport top margin.
  assert.ok(topEdgeOfAbove(p, vh) >= MARGIN - 1, `top edge ${topEdgeOfAbove(p, vh)} >= ${MARGIN}`)
  // Height is bounded to the room above (so the body scrolls, not the page).
  assert.ok(p.maxHeight <= 760 - GAP - MARGIN + 1)
})

test('trigger near the TOP places BELOW, anchored by top, fully within the bottom margin', () => {
  const vh = 800, vw = 1280
  const p = computeLegendPlacement({ rect: rect(40, 400), viewportW: vw, viewportH: vh })
  assert.equal(p.placement, 'below')
  assert.equal(p.bottom, null)
  assert.equal(p.top, 60 + GAP)                       // rect.bottom(60) + gap
  // Bottom edge stays within the viewport bottom margin.
  assert.ok(p.top + p.maxHeight <= vh - MARGIN + 1, `bottom edge ${p.top + p.maxHeight} <= ${vh - MARGIN}`)
})

test('insufficient room on BOTH sides: use the larger side and constrain the height (never overflow)', () => {
  const vh = 300, vw = 1280
  // Trigger mid-viewport; both sides are smaller than the desired height.
  const p = computeLegendPlacement({ rect: rect(150, 400), viewportW: vw, viewportH: vh })
  const desiredMax = Math.min(780, vh - 2 * MARGIN)
  assert.ok(p.maxHeight < desiredMax, 'height is constrained below the desired max')
  assert.ok(p.maxHeight > 0)
  if (p.placement === 'above') {
    assert.ok(topEdgeOfAbove(p, vh) >= MARGIN - 1)
  } else {
    assert.ok(p.top + p.maxHeight <= vh - MARGIN + 1)
  }
})

test('the chosen side is always the one with more room when below cannot show the full legend', () => {
  const vh = 600, vw = 1280
  // More room above than below -> flip above.
  const above = computeLegendPlacement({ rect: rect(500, 400), viewportW: vw, viewportH: vh })
  assert.equal(above.placement, 'above')
  // More room below than above -> stay below.
  const below = computeLegendPlacement({ rect: rect(80, 400), viewportW: vw, viewportH: vh })
  assert.equal(below.placement, 'below')
})

test('max-height is viewport-bounded and never exceeds the desired max', () => {
  const vh = 2000, vw = 1280   // tall viewport: desired max (780) caps it, not the viewport
  const p = computeLegendPlacement({ rect: rect(40, 400), viewportW: vw, viewportH: vh })
  assert.ok(p.maxHeight <= 780)
})

test('horizontal position is clamped within the viewport margins (both edges)', () => {
  const vw = 1280, vh = 800
  // Trigger hard against the right edge: left is clamped so the popover stays on-screen.
  const right = computeLegendPlacement({ rect: rect(40, 1270), viewportW: vw, viewportH: vh })
  assert.ok(right.left >= MARGIN)
  assert.ok(right.left + right.width <= vw - MARGIN + 1)
  // Trigger hard against the left edge.
  const left = computeLegendPlacement({ rect: rect(40, 0), viewportW: vw, viewportH: vh })
  assert.ok(left.left >= MARGIN)
})

test("position 'bottom-right' anchors the popover's right edge to the trigger, then clamps", () => {
  const vw = 1280, vh = 800
  const p = computeLegendPlacement({ rect: rect(40, 900, 20), viewportW: vw, viewportH: vh, position: 'bottom-right' })
  // right-anchored: left = rect.right - width, then clamped into the viewport.
  assert.ok(p.left >= MARGIN && p.left + p.width <= vw - MARGIN + 1)
})

test('narrow screens clamp the width (keeping a margin on both sides) and pin left to the margin', () => {
  const vw = 360, vh = 720
  const p = computeLegendPlacement({ rect: rect(40, 10), viewportW: vw, viewportH: vh })
  assert.equal(p.width, vw - MARGIN * 2)   // 332
  assert.equal(p.left, MARGIN)             // clamped to the left margin (no room to shift)
  assert.ok(p.left + p.width <= vw - MARGIN)
})

test('clampWithin never returns below the low bound, even when the range is inverted', () => {
  assert.equal(clampWithin(5, 14, 10), 14)   // hi < lo -> lo
  assert.equal(clampWithin(100, 14, 50), 50)
  assert.equal(clampWithin(30, 14, 50), 30)
})

// ── Source guards: the shared component wires the geometry + keeps the approved model ────────────────

test('the shared component uses computeLegendPlacement on open, scroll, and resize (repositions, no close)', () => {
  const c = read('src/components/StatusLegendPopover.jsx')
  assert.match(c, /import \{ computeLegendPlacement \} from '\.\/statusLegendPlacement'/)
  assert.match(c, /const computeCoords = \(\) => computeLegendPlacement\(\{/)
  assert.match(c, /viewportW: window\.innerWidth,\s*\n\s*viewportH: window\.innerHeight,/)
  // Scroll + resize reposition (capture-phase scroll); the reposition handler NEVER closes the popover.
  assert.match(c, /window\.addEventListener\('scroll', reposition, true\)/)
  assert.match(c, /window\.addEventListener\('resize', reposition\)/)
  const reposition = c.slice(c.indexOf('const reposition ='), c.indexOf('window.addEventListener(\'scroll\', reposition'))
  assert.doesNotMatch(reposition, /setIsOpen\(false\)/)
  // A scroll that originates inside the popover body is ignored (does not reposition/close).
  assert.match(c, /e\.type === 'scroll' && popoverRef\.current && popoverRef\.current\.contains\(e\.target\)\) return/)
})

test('the popover is fixed/portaled, bounded, and scrolls its BODY (not the page); header stays visible', () => {
  const c = read('src/components/StatusLegendPopover.jsx')
  assert.match(c, /createPortal\(/)                                   // escapes overflow/table/card ancestors
  assert.match(c, /position: 'fixed'/)
  // Anchored by top (below) or bottom (above); width + maxHeight come from the computed placement.
  assert.match(c, /top:\s*popoverCoords\.top != null \? popoverCoords\.top : undefined/)
  assert.match(c, /bottom: popoverCoords\.bottom != null \? popoverCoords\.bottom : undefined/)
  assert.match(c, /width:\s*popoverCoords\.width/)
  assert.match(c, /maxHeight: popoverCoords\.maxHeight/)
  // The body scrolls internally within the bounded height; minHeight:0 makes the flex child scrollable.
  assert.match(c, /flex: 1, minHeight: 0, overflowY: 'auto', WebkitOverflowScrolling: 'touch'/)
  // The header never shrinks, so the title + close button stay visible during body scroll.
  assert.match(c, /justifyContent: 'space-between',\s*\n\s*flexShrink: 0,/)
})

test('the approved interaction + accessibility model is preserved', () => {
  const c = read('src/components/StatusLegendPopover.jsx')
  assert.match(c, /role="dialog"/)
  assert.match(c, /aria-label="ASPIRE Status Legend"/)
  assert.match(c, /aria-expanded=\{isOpen\}/)
  assert.match(c, /aria-label="View status legend"/)
  assert.match(c, /aria-label="Close status legend"/)         // visible close control
  assert.match(c, /function handleClickOutside/)              // outside click closes
  assert.match(c, /e\.key === 'Escape'/)                      // Escape closes
  assert.match(c, /const handleToggle = \(\)/)                // trigger toggle
  assert.match(c, /if \(wasOpen\.current && !isOpen\) triggerRef\.current\?\.focus\(\)/) // focus restore
})

test('Main App, Academic Partner, and Unit Leader all consume the SAME shared component', () => {
  assert.match(read('src/components/StudentProfilesTab.jsx'), /import StatusLegendPopover from '\.\/StatusLegendPopover'/)
  assert.match(read('src/portal/AcademicPartnerPortal.jsx'), /import StatusLegendPopover from '\.\.\/components\/StatusLegendPopover'/)
  assert.match(read('src/portal/UnitLeaderPortal.jsx'), /import StatusLegendPopover from '\.\.\/components\/StatusLegendPopover'/)
})

test('showStaffDetail privacy is unchanged (portal-safe callers still hide disposition/readiness)', () => {
  const c = read('src/components/StatusLegendPopover.jsx')
  assert.match(c, /export default function StatusLegendPopover\(\{ position = 'bottom-left', dark = false, showStaffDetail = true \}\)/)
  assert.match(c, /\{showStaffDetail && \(<>/)
  assert.match(read('src/portal/AcademicPartnerPortal.jsx'), /showStaffDetail=\{false\}/)
  assert.match(read('src/portal/UnitLeaderPortal.jsx'), /showStaffDetail=\{false\}/)
})
