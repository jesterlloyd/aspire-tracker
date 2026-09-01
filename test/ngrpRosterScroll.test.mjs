// test/ngrpRosterScroll.test.mjs
//
// NGRP-ROSTER-SCROLL-1: the Applicants roster must not extend the page's scroll.
//
// THE DEFECT, MEASURED. On a 1728x1117 viewport with 28 alumni, every visible thing
// ended at 1142px and the page scrolled 1197px FURTHER, into a viewport holding
// nothing but the floating launchers. The roster's own scrolling worked the whole
// time; the document simply claimed a screenful of space that did not exist.
//
// The cause was that `overflow: auto` clipped the rows' PAINT while they were still
// counted in the root scrolling box. `contain: paint` is what declares that nothing
// inside affects layout outside. This file exists because that one declaration looks
// like a removable micro-optimization to anyone who does not know what it is holding
// up, and removing it restores a bug that is invisible in code review.
//
// Source assertions only. The behavioral proof is a browser measurement, recorded in
// the CSS comment; a unit test cannot lay out a viewport.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(root, p), 'utf8')
const css = read('src/components/ngrp/ngrp.css')

// The scroller's whole rule block, so assertions cannot drift onto another selector.
const scrollerRule = css.slice(css.indexOf('.ngrp-roster-scroll {'), css.indexOf('}', css.indexOf('.ngrp-roster-scroll {')) + 1)

test('the roster scroller contains its overflow', () => {
  assert.ok(scrollerRule.length > 0, '.ngrp-roster-scroll rule not found')
  assert.match(scrollerRule, /contain:\s*paint/,
    'without paint containment the rows extend the DOCUMENT scroll by ~1200px into an empty viewport')
  // Still a real scroll container: containment fixes the leak, it does not do the
  // clipping. Both are required.
  assert.match(scrollerRule, /overflow:\s*auto/)
  assert.match(scrollerRule, /max-height:\s*calc\(100vh - 330px\)/)
})

test('containment stays at paint: strict would collapse the box', () => {
  // contain: strict also zeroes the phantom scroll, but adds SIZE containment, which
  // makes this element ignore its own content height. Its height is content-derived
  // (max-height + auto), so strict would collapse it. Paint is the weakest containment
  // that fixes the defect, which is why it is the one used.
  assert.doesNotMatch(scrollerRule, /contain:\s*strict/)
  assert.doesNotMatch(scrollerRule, /contain:\s*size/)
})

test('the sticky header this scroller exists for is still declared', () => {
  // Paint containment makes the scroller a containing block and a stacking context, so
  // the sticky thead is the thing most likely to break. It was measured working
  // (offset 0 before and after scrolling the rows), and it must stay declared: a
  // scroller with no sticky header would make the containment look purposeless.
  assert.match(css, /\.ngrp-table thead th \{[^}]*position:\s*sticky/s)
  assert.match(css, /\.ngrp-table thead th \{[^}]*top:\s*0/s)
})

test('the reasoning is recorded where the next reader will be', () => {
  // A bare `contain: paint` reads as a micro-optimization and gets deleted. The
  // comment carries the measurement and the ruled-out causes so nobody repeats the
  // investigation.
  const comment = css.slice(0, css.indexOf('.ngrp-roster-scroll {'))
  assert.match(comment, /NGRP-ROSTER-SCROLL-1/)
  assert.match(comment, /1197/, 'the measured phantom scroll')
  assert.match(comment, /overflow:clip \(which does NOT fix it\)/, 'the ruled-out alternative')
})

test('no em dash in the stylesheet', () => {
  // The character below is the em dash, written as an escape so this file has none.
  assert.ok(!css.includes(String.fromCharCode(0x2014)), 'ngrp.css contains an em dash')
})
