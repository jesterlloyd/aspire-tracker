// QC polish, Commit 1: the shared ASPIRE Status Legend stays OPEN while the page, roster, or viewport
// scrolls. The old behavior closed the popover on any external scroll; because the popover is
// position:fixed and portaled with coordinates captured from the trigger's rect, scrolling used to
// detach it, so it was dismissed. It now REPOSITIONS to follow the trigger instead, and closes only
// through the explicit affordances (close button, outside click, Escape, trigger toggle, unmount).
//
// Source-guard tests (regex on comment-stripped source), matching the repo's existing legend/roster
// coverage. Assertions cover both the main-app default and the Academic Partner (showStaffDetail).

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')
const stripJs = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const src = stripJs(read('src/components/StatusLegendPopover.jsx'))

test('scroll and resize reposition the legend to follow the trigger; they never close it', () => {
  // A capture-phase scroll listener and a resize listener both recompute the anchored coordinates.
  assert.match(src, /const reposition = \(e\) =>/)
  assert.match(src, /setPopoverCoords\(computeCoords\(\)\)/)
  assert.match(src, /addEventListener\('scroll', reposition, true\)/)
  assert.match(src, /addEventListener\('resize', reposition\)/)
  assert.match(src, /removeEventListener\('scroll', reposition, true\)/)
  assert.match(src, /removeEventListener\('resize', reposition\)/)
  // The old close-on-scroll is gone: no scroll path calls setIsOpen(false).
  assert.doesNotMatch(src, /scroll[\s\S]{0,200}setIsOpen\(false\)/)
  assert.doesNotMatch(src, /handleScroll/)
})

test('a scroll originating inside the popover body does not reposition (only external scroll follows)', () => {
  assert.match(src, /e\.type === 'scroll' && popoverRef\.current && popoverRef\.current\.contains\(e\.target\)/)
})

test('coordinates are computed from the trigger rect and shared by open and reposition', () => {
  assert.match(src, /const computeCoords = \(\) =>/)
  assert.match(src, /triggerRef\.current\.getBoundingClientRect\(\)/)
  // Opening seeds the coords through the same helper (no duplicated positioning math).
  assert.match(src, /if \(!isOpen && triggerRef\.current\) \{\s*\n\s*setPopoverCoords\(computeCoords\(\)\)/)
  // Still portaled and fixed-positioned so no ancestor overflow clips it.
  assert.match(src, /createPortal\(/)
  assert.match(src, /position: 'fixed'/)
})

test('the legend still closes via the close button, outside click, Escape, and the trigger', () => {
  // Explicit close button.
  assert.match(src, /aria-label="Close status legend"/)
  assert.match(src, /onClick=\{\(\) => setIsOpen\(false\)\}/)
  // Outside click (mousedown outside popover and trigger).
  assert.match(src, /function handleClickOutside\(e\)/)
  assert.match(src, /addEventListener\('mousedown', handleClickOutside\)/)
  // Escape.
  assert.match(src, /e\.key === 'Escape'/)
  assert.match(src, /addEventListener\('keydown', handleEscape\)/)
  // Trigger toggle.
  assert.match(src, /onClick=\{handleToggle\}/)
  assert.match(src, /aria-expanded=\{isOpen\}/)
})

test('focus returns to the trigger when the legend closes', () => {
  assert.match(src, /if \(wasOpen\.current && !isOpen\) triggerRef\.current\?\.focus\(\)/)
})

test('main-app content and the Academic Partner privacy gate are preserved', () => {
  // Default keeps the staff detail (main app unchanged); the gate still wraps it.
  assert.match(src, /showStaffDetail = true/)
  assert.match(src, /\{showStaffDetail && \(<>/)
  // The Academic Partner still hides the staff disposition detail.
  const ap = stripJs(read('src/portal/AcademicPartnerPortal.jsx'))
  assert.match(ap, /<StatusLegendPopover showStaffDetail=\{false\} \/>/)
})
