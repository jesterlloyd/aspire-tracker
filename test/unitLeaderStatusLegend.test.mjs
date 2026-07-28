// Unit Leader status legend, Commit 1: the shared ASPIRE Status Legend is added to the Unit Leader
// student roster's ASPIRE status header, in the same position and with the same interaction behavior
// as the Academic Partner roster, reusing the ONE canonical StatusLegendPopover (no UL-specific
// legend) in portal-safe detail mode (showStaffDetail=false). Source guards + shared-behavior checks.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')

const ul = read('src/portal/UnitLeaderPortal.jsx')
const ap = read('src/portal/AcademicPartnerPortal.jsx')
const legend = read('src/components/StatusLegendPopover.jsx')

test('the Unit Leader roster reuses the shared StatusLegendPopover (no UL-specific legend)', () => {
  assert.match(ul, /import StatusLegendPopover from '\.\.\/components\/StatusLegendPopover'/)
  // The trigger sits in the ASPIRE status column header, on the shared inline row used by the AP roster.
  assert.match(ul, /<th scope="col">[\s\S]*?<span className="am-sort-th-inner">ASPIRE status<StatusLegendPopover showStaffDetail=\{false\} \/><\/span>[\s\S]*?<\/th>/)
})

test('the same shared component is used by Main App, Academic Partner, and Unit Leader', () => {
  // AP and UL point at the same file; the main app (StudentProfilesTab and peers) points at the sibling
  // path. All three resolve to src/components/StatusLegendPopover.jsx — one component, not three.
  assert.match(ap, /import StatusLegendPopover from '\.\.\/components\/StatusLegendPopover'/)
  assert.match(ul, /import StatusLegendPopover from '\.\.\/components\/StatusLegendPopover'/)
  assert.match(read('src/components/StudentProfilesTab.jsx'), /import StatusLegendPopover from '\.\/StatusLegendPopover'/)
})

test('the Unit Leader legend is portal-safe: showStaffDetail=false hides disposition/readiness detail', () => {
  // UL (and AP) pass false; the shared component gates the Not Proceeding disposition breakdown and the
  // Readiness Colors behind that prop, so no NGRP disposition reasons or staff-only detail are exposed.
  assert.match(ul, /<StatusLegendPopover showStaffDetail=\{false\} \/>/)
  assert.match(legend, /export default function StatusLegendPopover\(\{ position = 'bottom-left', dark = false, showStaffDetail = true \}\)/)
  assert.match(legend, /\{showStaffDetail && \(<>/)
  assert.match(legend, /Not Proceeding/)      // the gated section exists...
  assert.match(legend, /Readiness Colors/)    // ...and is inside the showStaffDetail block
})

test('the approved shared behavior lives in the ONE component, so the UL roster inherits it', () => {
  // Scroll repositions (does not close); capture-phase scroll listener; inner-popover scroll ignored.
  assert.match(legend, /window\.addEventListener\('scroll', reposition, true\)/)
  assert.match(legend, /popoverRef\.current\.contains\(e\.target\)\) return/)
  // Closes ONLY via: outside click, Escape, close button, trigger toggle.
  assert.match(legend, /function handleClickOutside/)
  assert.match(legend, /e\.key === 'Escape'/)
  assert.match(legend, /aria-label="Close status legend"/)
  assert.match(legend, /const handleToggle = \(\)/)
  // Focus returns to the trigger on close, without a setState-in-effect.
  assert.match(legend, /if \(wasOpen\.current && !isOpen\) triggerRef\.current\?\.focus\(\)/)
  // Accessible trigger.
  assert.match(legend, /aria-label="View status legend"/)
  assert.match(legend, /aria-expanded=\{isOpen\}/)
})
