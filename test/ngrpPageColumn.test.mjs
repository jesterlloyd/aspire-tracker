// test/ngrpPageColumn.test.mjs
//
// NGRP-PAGE-COLUMN-1: the Residency workspace sits in the same page column as every
// other staff tab.
//
// THE DEFECT. `.ngrp-main` was referenced in NgrpWorkspace.jsx from the first commit
// but never given a CSS rule, so the workspace ran the full width of .app-main while
// the rest of the app sat 20px inside it. Measured at a 1728px viewport: At a Glance's
// content began at 93px, NGRP's at 76px, and NGRP ran 37px wider. Side by side it read
// as a different application.
//
// WHY 20px IS NOT AN ARBITRARY NUMBER, which is the thing most likely to be "tidied"
// later: it is the horizontal margin the At a Glance card system already uses, and
// .mast-live-flush exists specifically to CANCEL that inset for hosts that already sit
// in a padded page column. The same 20px, named from both sides.
//
// Source assertions. The layout proof is a browser measurement recorded in the CSS.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(root, p), 'utf8')
const css = read('src/components/ngrp/ngrp.css')
const workspace = read('src/components/ngrp/NgrpWorkspace.jsx')

const mainRule = css.slice(css.indexOf('.ngrp-main {'), css.indexOf('}', css.indexOf('.ngrp-main {')) + 1)

test('the Residency workspace has a page column at all', () => {
  assert.ok(mainRule.length > 0, '.ngrp-main must have a rule; it went unstyled once already')
  assert.match(mainRule, /padding-left:\s*20px/)
  assert.match(mainRule, /padding-right:\s*20px/)
})

test('it is the SAME column the rest of the app uses', () => {
  // If either side of this pair changes, the workspace silently stops matching the
  // app again, which is exactly how this defect went unnoticed.
  const indexCss = read('src/index.css')
  assert.match(indexCss, /\.snap \{[^}]*margin:\s*14px 20px/s, 'the At a Glance card inset')
  assert.match(indexCss, /\.mast-live-flush \{ margin-left: 0; margin-right: 0;/,
    'the opt-out that names the same column from the other side')
})

test('the column is on the shared wrapper, not on individual cards', () => {
  // Both Residency tabs render inside .ngrp-main, so putting the inset here means
  // Planning gets it too, and a tab added later gets it without remembering to.
  assert.match(workspace, /<div className="ngrp-main">/)
  const inMain = workspace.slice(workspace.indexOf('<div className="ngrp-main">'))
  for (const tab of ['<ApplicantsTab', '<PlanningTab']) {
    assert.ok(inMain.includes(tab), `${tab} must render inside .ngrp-main`)
  }
  // The cards must not carry their own horizontal inset, or it would double.
  const roster = css.slice(css.indexOf('.ngrp-roster {'), css.indexOf('}', css.indexOf('.ngrp-roster {')) + 1)
  assert.doesNotMatch(roster, /margin-left|margin-right/)
  assert.doesNotMatch(roster, /margin:\s*\S+\s+\S+/, 'no shorthand margin with a horizontal component')
})

test('the reasoning is recorded where the next reader will be', () => {
  const comment = css.slice(0, css.indexOf('.ngrp-main {'))
  assert.match(comment, /NGRP-PAGE-COLUMN-1/)
  assert.match(comment, /mast-live-flush/, 'the evidence that 20px is the app column')
  assert.match(comment, /93px/, 'the measured At a Glance edge')
})

test('no em dash in the stylesheet', () => {
  // The character below is the em dash, written as an escape so this file has none.
  assert.ok(!css.includes(String.fromCharCode(0x2014)), 'ngrp.css contains an em dash')
})
