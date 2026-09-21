// test/reviewReleaseClipboard.test.mjs
//
// REVIEW-RELEASE-2: Evaluation > Review & Release is a clipboard, presentation only.
//
// What this pins, on outcomes:
//   1. The theme-aware pairs exist in BOTH themes: paper, status inks with their soft
//      tints, the pressboard and the tape. The planner's slate paper reads the shared
//      paper tokens rather than restating them.
//   2. JetBrains Mono is the third self-hosted family: declared, shipped with its OFL,
//      named once as --aspire-mono, and NOT preloaded.
//   3. The stylesheet reads tokens for every corner (no literal radius), reuses the
//      page-stack sheet for the carbon copy, respects prefers-reduced-motion, stacks the
//      rail below 900px, and gives the rail and the board the same top margin.
//   4. The queue's clipboard markup carries no inline presentation, the clip is
//      decorative, and nothing from Part 1 came back: no Remind, no Undo, and the tape is
//      the Sent log.
//   5. The dashboard no longer carries its own <style> block or the narrow-screen select,
//      and the release slide-out defers to prefers-reduced-motion.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')
const stripCss = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '')
const stripJs = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const theme = read('src/styles/theme.css')
const brand = read('src/styles/aspireBrand.css')
const fonts = read('src/styles/fonts.css')
// The rail's own rules moved to the shared selection canon (SETTINGS-HIERARCHY-1).
const css = read('src/components/evaluation/reviewReleaseClipboard.css') + '\n' + read('src/styles/selectionRail.css')
const cssCode = stripCss(css)
const queue = read('src/components/evaluation/ReviewReleaseQueue.jsx')
const dash = read('src/components/evaluation/SurveyAutomationDashboard.jsx')
const planner = read('src/components/shared/plannerCalendar.css')
const stack = read('src/styles/pageStack.css')

const lightBlock = theme.slice(theme.indexOf(':root[data-theme="light"] {'), theme.indexOf(':root[data-theme="dark"] {'))
const darkBlock = theme.slice(theme.indexOf(':root[data-theme="dark"] {'))

const TOKENS = ['--aspire-paper', '--aspire-paper-2', '--aspire-paper-ink', '--aspire-paper-muted', '--aspire-rule',
  '--aspire-ok', '--aspire-ok-soft', '--aspire-warn', '--aspire-warn-soft', '--aspire-bad', '--aspire-bad-soft',
  '--aspire-pressboard-a', '--aspire-pressboard-b', '--aspire-pressboard-c', '--aspire-pressboard-ink',
  '--aspire-tape', '--aspire-tape-ink', '--aspire-tape-muted']

test('every clipboard token has a value in light AND in dark, and a pair travels together', () => {
  for (const t of TOKENS) {
    assert.match(lightBlock, new RegExp(`${t}:\\s*[^;]+;`), `${t} in light`)
    assert.match(darkBlock, new RegExp(`${t}:\\s*[^;]+;`), `${t} in dark`)
  }
  // The brief's exact values, where the harness did not have to move them.
  assert.match(lightBlock, /--aspire-pressboard-a:\s*#554E43;/)
  assert.match(darkBlock, /--aspire-pressboard-a:\s*#2E2A25;/)
  assert.match(lightBlock, /--aspire-tape:\s*#EFE9DA;/)
  assert.match(darkBlock, /--aspire-tape-muted:\s*#A89C7E;/)
  // The one value that moved, and why: the mockup's tape-muted measured 4.06:1.
  assert.match(lightBlock, /--aspire-tape-muted:\s*#675E44;/)
})

test('the planner reads the shared paper instead of restating it, in both themes', () => {
  assert.match(planner, /\.pl-planner \{\s*--paper: var\(--aspire-paper\);\s*--paper-2: var\(--aspire-paper-2\);\s*--paper-ink: var\(--aspire-paper-ink\);\s*--paper-muted: var\(--aspire-paper-muted\);\s*--rule: var\(--aspire-rule\);/)
  assert.match(planner, /\[data-theme="dark"\] \.pl-planner\[data-paper="forest"\] \{\s*--paper: var\(--aspire-paper\);/)
  // The tan and forest papers are their own and stay literal.
  assert.match(planner, /\.pl-planner\[data-paper="tan"\] \{\s*--paper: #FBF3E2;/)
  // No second definition of the slate paper anywhere in the clipboard sheet.
  assert.doesNotMatch(cssCode, /#FDFCFA|#F6F5F2|#1B2140|#61667E/)
})

test('JetBrains Mono is the third self-hosted family: declared, licensed, named once, not preloaded', () => {
  for (const f of ['JetBrainsMono-Variable.woff2', 'JetBrainsMono-Italic-Variable.woff2', 'OFL.txt']) {
    const p = join(here, '..', 'public/fonts/jetbrains-mono', f)
    assert.ok(existsSync(p), `${f} missing`)
    if (f.endsWith('.woff2')) assert.ok(statSync(p).size > 20_000 && statSync(p).size < 120_000, `${f} is the subset, not the whole face`)
  }
  assert.match(read('public/fonts/jetbrains-mono/OFL.txt'), /SIL Open Font License, Version 1\.1/)
  assert.equal((fonts.match(/font-family: 'JetBrains Mono';/g) || []).length, 2, 'upright and italic')
  assert.match(brand, /--aspire-mono: 'JetBrains Mono', ui-monospace/)
  assert.doesNotMatch(read('index.html'), /jetbrains/i)
  // The clipboard reaches the face only through the token.
  assert.doesNotMatch(cssCode, /JetBrains/)
  assert.match(cssCode, /--rr-mono: var\(--aspire-mono\);/)
})

test('the stylesheet takes every corner from a token, and a slip is one sheet', () => {
  assert.match(dash, /import '\.\/reviewReleaseClipboard\.css'/)
  const literalRadii = cssCode.match(/border-radius:\s*[0-9.]+px/g) || []
  assert.deepEqual(literalRadii, [], 'no literal radius: card, control, pill, or a named chip token')
  assert.match(cssCode, /\.rq-board \{[^}]*border-radius: var\(--aspire-radius-card\);/)
  assert.match(cssCode, /\.rq-tape \{[^}]*border-radius: 0 0 var\(--aspire-radius-card\) var\(--aspire-radius-card\);/)
  assert.match(cssCode, /\.rq-card \{[^}]*border-radius: 0;/, 'paper is the one square surface')
  assert.match(cssCode, /\.rq-pbtn \{[^}]*border-radius: var\(--aspire-radius-control\);/)
  // No stack under a slip (Owner, 2026-09-19): one student is one sheet on a clipboard.
  assert.doesNotMatch(queue, /material-pagestack/)
  assert.doesNotMatch(css, /pageStack|pagestack/)
  assert.doesNotMatch(stack, /pagestack-single/)
})

test('the rail meets the board at the top edge, keeps its own height, stays pinned while the board scrolls, and stacks below 900px', () => {
  assert.match(cssCode, /\.rr-nav \{[^}]*margin-top: 14px;/)
  assert.match(cssCode, /\.rq-board \{[^}]*margin-top: 14px;/)
  assert.match(cssCode, /\.rr-layout \{[^}]*align-items: start;/)
  assert.match(cssCode, /\.rr-nav \{[^}]*position: sticky; top: var\(--app-chrome-height, 0px\); align-self: start;/)
  // SETTINGS-FIX-2: the layout stacks in the clipboard's sheet; the rail's own unpin lives
  // with the rail (selectionRail.css), AFTER its base rule, so no load order can undo it.
  assert.match(cssCode, /@media \(max-width: 900px\) \{\s*\.rr-layout \{ grid-template-columns: 1fr; \}/)
  const railSheet = read('src/styles/selectionRail.css')
  assert.match(railSheet, /@media \(max-width: 900px\) \{\s*\.rr-nav \{ margin-top: 0; position: static; \}\s*\}/)
  assert.ok(railSheet.indexOf('@media (max-width: 900px)') > railSheet.indexOf('.rr-nav {'), 'the unpin comes after the rule it modifies')
  assert.doesNotMatch(dash, /rr-nav-mobile|<optgroup|<select/)
})

test('motion is real and deferential: slide-out, pulse, and both quiet under reduced motion', () => {
  assert.match(cssCode, /\.rq-card-gone \{ transform: translateX\(30px\) rotate\(1\.2deg\); opacity: 0; \}/)
  assert.match(cssCode, /\.rq-card-flash \{ animation: rq-flash 1\.2s ease-out; \}/)
  const rm = cssCode.slice(cssCode.indexOf('@media (prefers-reduced-motion: reduce)'))
  assert.match(rm, /\.rq-card \{ transition: none; \}/)
  assert.match(rm, /\.rq-card-gone \{ transform: none; \}/)
  assert.match(rm, /\.rq-card-flash \{ animation: none;/)
  // The dashboard asks the same question before it holds the refetch for the slide.
  assert.match(dash, /window\.matchMedia\?\.\('\(prefers-reduced-motion: reduce\)'\)\?\.matches\) return/)
  assert.match(dash, /leavingItemId=\{leavingId\}/)
  assert.match(queue, /\$\{leaving \? ' rq-card-gone' : ''\}/)
})

test('the clipboard markup carries no inline presentation, and nothing from Part 1 came back', () => {
  const clipboardPart = stripJs(queue.slice(0, queue.indexOf('// ── Confirmations')))
  assert.doesNotMatch(clipboardPart, /style=\{\{/, 'the clipboard is dressed by the stylesheet, not inline')
  assert.doesNotMatch(clipboardPart, /fontFamily|borderRadius/)
  assert.match(dash, /<span className="rq-clip" aria-hidden="true"><i \/><i \/><\/span>/)
  assert.match(cssCode, /\.rq-clip \{[^}]*pointer-events: none;/)
  assert.doesNotMatch(clipboardPart, /Undo|onRemind|Remind \w+<\/button>/)
  assert.match(queue, /no manual Remind yet/)
  assert.match(clipboardPart, /Sent from this clipboard/)
  assert.match(clipboardPart, /Read the feedback/)
  // The previews are icon buttons on the head, eye then square-arrow (Residency > Support);
  // no slip carries a preview, and the head is one quiet line rather than three chips.
  const head = clipboardPart.slice(clipboardPart.indexOf('aria-label="Survey tools"'), clipboardPart.indexOf('rq-meta-row'))
  const order = ['Preview the invitation email', 'Open a sample of the survey', 'Send a test to my email', 'Re-run detection'].map(l => head.indexOf(`aria-label="${l}"`))
  assert.ok(order.every((v, i) => v > -1 && (i === 0 || v > order[i - 1])), 'eye, square-arrow, paper plane, arrows, in that order')
  assert.equal((head.match(/<Tooltip label=/g) || []).length, 4, 'every icon on the shared Tooltip')
  assert.equal((head.match(/tone="contrast"/g) || []).length, 4, 'the black semi-transparent bubble, on the dark board')
  assert.match(head, /<Eye size=\{15\}[^]*<ExternalLink size=\{15\}[^]*<Send size=\{15\}[^]*<RefreshCw size=\{15\}/)
  assert.doesNotMatch(clipboardPart, /Preview email|Preview Survey|Preview Email|rq-chip|Human-approved|rq-was|currently|'new'|rq-tools|rr-tool-test/)
  assert.match(clipboardPart, /<p className="rq-meta-line">To \{survey\.to\}/)
  assert.match(cssCode, /\.rq-iconbtn \{[^}]*width: 28px; height: 28px;/)
  // The timepoint is a smaller qualifier beside the name (Owner, 2026-09-20).
  assert.match(clipboardPart, /const \[mainTitle, qualifier\] = splitTitle\(survey\.label\)/)
  assert.match(clipboardPart, /<h2>\{mainTitle\}\{qualifier && <span className="rq-title-q">\{qualifier\}<\/span>\}<\/h2>/)
  // The Required activities node opens the recording area on the slip; the dialog is gone.
  assert.match(clipboardPart, /className="rq-node-k rq-node-toggle" aria-expanded=\{expandable\.open\}/)
  assert.match(clipboardPart, /<ActivitiesArea item=\{item\} onRecord=\{onRecordActivity\} \/>/)
  assert.match(clipboardPart, /<input type="date" className="rq-act-date" max=\{today\}/)
  assert.match(clipboardPart, /recorded in Support/)
  assert.doesNotMatch(queue, /ActivityDialog|pr-activity-dialog/)
  assert.doesNotMatch(dash, /ActivityDialog/)
  assert.match(dash, /onRecordActivity=\{recordActivity\}/)
  assert.match(cssCode, /\.rq-node-toggle\[aria-expanded="true"\] \.rq-chev \{ rotate: 90deg; \}/)
  assert.doesNotMatch(dash, /<style>\{CSS\}<\/style>|const CSS = `/)
  // The hold alert lives on the board now, in the status pair.
  assert.match(clipboardPart, /releaseLocked && \(\s*<p role="alert" className="rq-notice err">/)
})

test('no em dash in anything this change wrote', () => {
  const EM = String.fromCharCode(0x2014)
  for (const f of ['src/components/evaluation/reviewReleaseClipboard.css', 'src/components/evaluation/ReviewReleaseQueue.jsx',
    'src/components/evaluation/SurveyAutomationDashboard.jsx', 'src/styles/pageStack.css', 'src/styles/fonts.css',
    'test/reviewReleaseClipboard.test.mjs']) {
    assert.ok(!read(f).includes(EM), `${f} contains an em dash`)
  }
})
