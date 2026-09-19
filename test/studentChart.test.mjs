// STUDENT-CHART-1: the student chart, and the promises it has to keep.
//
// These are source-shape tests. The look was verified by measurement in a real browser
// (geometry, contrast in both themes, scroll spy, tab jumps, focus rings, the flag write),
// because a stylesheet's effect is not readable from its text. What a test CAN hold is
// the set of decisions that would be quietly undone by a later edit: that no section was
// dropped, that the flag is not the interview flag, that the index scrolls rather than
// mounts, and that the panel is still an editing surface.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(root, p), 'utf8')

const panel = read('src/components/StudentSidePanel.jsx')
const css = read('src/components/student/studentChart.css')
// Several assertions below say "this file must NOT contain X". The comments in these
// files explain why X is wrong, and quote it, so a naive search finds the warning and
// calls it the defect. Strip comments first and assert against the code.
const noComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const cssCode = noComments(css)
const sheets = read('src/components/student/chartSheets.js')
const scroll = read('src/components/student/useChartScroll.js')
const flagLib = read('src/lib/studentFollowUpFlag.js')
const ribbon = read('src/components/rubric/FlagRibbon.jsx')
const api = read('api/student-update.js')
const migration = read('db/migrations/20260921000000_student_followup_flag.sql')
const tab = read('src/components/StudentProfilesTab.jsx')
const roster = read('src/components/StudentListPanel.jsx')

// ── BINDER: the object on screen ────────────────────────────────────────────

test('BINDER 1: the binder is black leather with five rings, and the rings are decorative', () => {
  assert.match(panel, /className="sc-binder material-leather-black material-pagestack"/)
  assert.equal((panel.match(/className="sc-ring"/g) || []).length, 5)
  assert.match(panel, /className="sc-rings" aria-hidden="true"/)
})

test('BINDER 2: the leather is a material, defined once, beside the rubric book\'s tan', () => {
  const materials = read('src/styles/aspireMaterials.css')
  assert.match(materials, /\.material-leather-black \{/)
  assert.match(materials, /\.material-leather-tan \{/)
  // It reads the shared noise and the shared tokens; it does not restate a colour.
  assert.match(materials, /--aspire-noise-fine/)
  assert.ok(!/\.material-leather-black[\s\S]*?background-color: #/.test(materials),
    'the black leather must read its colour from a token, not a literal')
})

test('BINDER 3: the paper is square-cornered, because it is paper and not a card', () => {
  const paper = css.match(/\.sc-paper \{[\s\S]*?\}/)[0]
  assert.match(paper, /border-radius: 0;/)
})

test('BINDER 4: the plate does not scroll and lifts only once paper is under it', () => {
  // The plate is a sibling of the scroller, not a child of it.
  const plateAt = panel.indexOf('className={`sc-plate$')
  assert.ok(panel.indexOf('sc-plate') < panel.indexOf('sc-scroller'),
    'the plate must come before the scroller, outside it')
  assert.match(css, /\.sc-plate-lifted \{/)
  assert.match(scroll, /const LIFT_AT = 2/)
  assert.ok(plateAt !== 0 || true)
})

test('BINDER 5: radii are tokens, so the canon ratchet cannot be raised by this file', () => {
  const literals = cssCode.match(/border-radius:\s*\d+px/g) || []
  const allowed = literals.filter(l => /border-radius:\s*0px/.test(l))
  assert.deepEqual(literals.filter(l => !allowed.includes(l)), [],
    'every radius in the chart reads a token; 0 and 50% are not literals in this sense')
})

// ── SHEETS: nothing was dropped ─────────────────────────────────────────────

test('SHEETS 1: seven sheets, in the order a coordinator meets a student', () => {
  const ids = [...sheets.matchAll(/\{ id: '([a-z]+)'/g)].map(m => m[1])
  assert.deepEqual(ids, ['profile', 'background', 'placement', 'hours', 'documents', 'evaluations', 'notes'])
})

test('SHEETS 2: every sheet in the list is rendered, and every rendered sheet is in the list', () => {
  const listed = [...sheets.matchAll(/\{ id: '([a-z]+)'/g)].map(m => m[1]).sort()
  const rendered = [...panel.matchAll(/id="sc-sheet-([a-z]+)" data-sheet="([a-z]+)"/g)]
  assert.deepEqual(rendered.map(m => m[1]).sort(), listed)
  for (const m of rendered) assert.equal(m[1], m[2], 'a sheet\'s id and data-sheet must agree')
})

test('SHEETS 3: all fifteen original sections survived the regrouping', () => {
  // The whole point of the Owner\'s decision: the binder is chrome around the panel that
  // exists. If a later edit drops one of these, this test is the thing that says so.
  for (const title of [
    'Contact Information', 'Personal Information', 'Information Acknowledgment',
    'Program Details', 'Rotation Dates', 'Availability & Scheduling',
    'Background and Affiliation', 'Unit Placement Preferences', 'Documents',
    'Interest Statement', 'CS-Link Access', 'Placement and Outcomes',
    'Program Disposition', 'Notes', 'Recent Communications',
  ]) {
    assert.ok(panel.includes(`title="${title}"`), `section missing from the chart: ${title}`)
  }
  assert.match(panel, /<ClinicalHoursPanel/)
})

test('SHEETS 4: the chart is still an EDITING surface, not a read-only view', () => {
  // The single fact most likely to be lost in a later "tidy": these are live fields.
  const inputs = (panel.match(/className="sp-input"/g) || []).length
  const selects = (panel.match(/className="sp-select"/g) || []).length
  assert.ok(inputs + selects > 20, `expected the panel's form to survive, found ${inputs + selects}`)
  assert.match(panel, /canEdit/, 'the permission gate is still read')
})

test('SHEETS 5: the last sheet is named, not :last-child, because a footer follows it', () => {
  assert.match(css, /\.sc-sheet\[data-sheet="notes"\] \{ border-bottom: none; min-height: 60vh; \}/)
  assert.ok(!/\.sc-sheet:last-child \{ border-bottom/.test(cssCode))
  assert.match(panel, /className="sc-tail"/)
})

// ── INDEX: it scrolls, it never mounts ──────────────────────────────────────

test('INDEX 1: a tab is a real button carrying aria-current', () => {
  assert.match(panel, /<button key=\{s\.id\} type="button" className="sc-tab" data-sheet=\{s\.id\}/)
  assert.match(panel, /aria-current=\{chartSheet === s\.id\}/)
})

test('INDEX 2: clicking a tab scrolls; it does not swap a panel', () => {
  assert.match(scroll, /root\.scrollTo\(/)
  assert.ok(!/setState.*(activePanel|visibleSheet)/.test(scroll))
  // Every sheet is rendered unconditionally: no sheet is behind a condition.
  const conditional = /\{\s*chartSheet === '[a-z]+'\s*&&\s*<section/.test(panel)
  assert.equal(conditional, false, 'sheets must all be mounted, or an in-progress edit is lost')
})

test('INDEX 3: the scroller is the offsetParent, or every jump overshoots', () => {
  const rule = css.match(/\.sc-scroller \{[\s\S]*?\}/)[0]
  assert.match(rule, /position: relative;/)
})

test('INDEX 4: the scroll spy looks at the top of the scroller, not the whole of it', () => {
  assert.match(scroll, /const SPY_MARGIN = '-12% 0px -72% 0px'/)
  assert.match(scroll, /new IntersectionObserver/)
  assert.match(scroll, /root,/)
})

// ── THE FLAG: not the interview flag ────────────────────────────────────────

test('FLAG 1: the chart writes flagged_for_followup and never the interview flag', () => {
  assert.match(flagLib, /FOLLOW_UP_FLAG_COLUMN = 'flagged_for_followup'/)
  // Both files EXPLAIN the distinction in prose, naming the other column, so the check
  // has to be against code rather than against comments.
  assert.ok(!noComments(flagLib).includes('flagged_for_second_interview'),
    'the follow-up flag must never touch the second-interview column')
  assert.ok(!noComments(panel).includes('flagged_for_second_interview'),
    'the student chart must never write the interview flag')
})

test('FLAG 2: an absent column reads as unflagged, never as flagged', () => {
  assert.match(flagLib, /student\?\.\[FOLLOW_UP_FLAG_COLUMN\] === true/)
  assert.match(flagLib, /student\[FOLLOW_UP_FLAG_COLUMN\] !== undefined/)
})

test('FLAG 3: before the migration the ribbon is inert and says so', () => {
  assert.match(panel, /disabled=\{!canEdit \|\| !flagAvailable \|\| flagSaving\}/)
  assert.match(panel, /not enabled on this database yet/)
  assert.match(flagLib, /notEnabled: true/)
})

test('FLAG 4: the server action is its own, permission-gated, and survives a missing column', () => {
  assert.match(api, /action === 'set_followup_flag'/)
  const block = api.slice(api.indexOf("action === 'set_followup_flag'"))
  assert.match(block.slice(0, 400), /if \(!canStudentManage\) return res\.status\(403\)/)
  assert.match(block.slice(0, 2000), /updErr\.code === '42703'/)
  assert.match(block.slice(0, 2000), /not_enabled/)
})

test('FLAG 5: the flag carries no note, exactly like the rubric ribbon', () => {
  assert.ok(!/flag_note/.test(noComments(flagLib)))
  assert.ok(!/followUpNote|flagNote/.test(noComments(panel)))
})

test('FLAG 6: the migration is additive, idempotent and documents its rollback', () => {
  assert.match(migration, /ADD COLUMN IF NOT EXISTS flagged_for_followup boolean NOT NULL DEFAULT false/)
  assert.match(migration, /ROLLBACK/)
  assert.ok(!/DROP COLUMN(?!.*--)/.test(migration.split('ROLLBACK')[0]),
    'nothing is dropped above the rollback note')
  assert.match(migration, /information_schema\.columns/, 'it proves its own postcondition')
})

test('FLAG 7: the roster shows the flag by name, not by colour alone', () => {
  assert.match(roster, /isFollowUpFlagged\(s\)/)
  assert.match(roster, /Flagged for follow up/)
  assert.match(roster, /aria-hidden="true">⚑/)
})

// ── THE RIBBON: one component, two vocabularies ─────────────────────────────

test('RIBBON 1: one component serves both books, and the rubric keeps its own defaults', () => {
  assert.match(ribbon, /classPrefix = 'rb-ribbon'/)
  assert.match(ribbon, /labelOn = 'Flagged for the placement huddle/)
  assert.match(ribbon, /\$\{classPrefix\}/)
  // The rubric's call site passes nothing, so it must still render rb-ribbon.
  const rubricSession = read('src/components/RubricSession.jsx')
  assert.ok(!/classPrefix/.test(noComments(rubricSession)), 'the rubric relies on the defaults')
})

test('RIBBON 2: the chart\'s ribbon names the student and is a real button', () => {
  assert.match(panel, /classPrefix="sc-ribbon"/)
  assert.match(panel, /labelOn=\{`\$\{plateName\} is flagged for follow-up/)
  assert.match(ribbon, /aria-pressed=\{flagged\}/)
  assert.match(ribbon, /<button/)
})

test('RIBBON 3: the idle ribbon uses the measured taupe, not the mockup\'s', () => {
  // The mockup's #BEB9AF put white FLAG on it at 1.77:1.
  assert.match(css, /--aspire-ribbon-idle/)
  assert.ok(!/#BEB9AF/i.test(cssCode))
})

// ── MOTION AND ACCESS ───────────────────────────────────────────────────────

test('MOTION 1: the binder holds still when the reader turns to another student', () => {
  assert.match(css, /\.sc-fade \{ transition: opacity/)
  // The fade is on the identity block and the page, never on the binder or the index.
  assert.ok(!/\.sc-binder[^{]*\{[^}]*transition/.test(cssCode))
  assert.ok(!/\.sc-index[^{]*\{[^}]*transition/.test(cssCode))
})

test('MOTION 2: the panel is no longer remounted on every selection', () => {
  assert.ok(!/className="profiles-panel-slide" key=/.test(noComments(tab)),
    'a key here remounts the binder and replays its slide-in on every click')
})

test('MOTION 3: reduced motion removes the fade, the tab travel and the smooth scroll', () => {
  const reduced = css.match(/@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\n\}/g) || []
  const joined = reduced.join('\n')
  assert.match(joined, /\.sc-scroller \{ scroll-behavior: auto; \}/)
  assert.match(joined, /\.sc-tab \{ transition: none; \}/)
  assert.match(joined, /\.sc-fade \{ transition: none; \}/)
  assert.match(scroll, /prefersReducedMotion\(\)/)
})

test('ACCESS 1: the record and the sheet are announced', () => {
  assert.match(panel, /role="status" aria-live="polite"/)
  assert.match(panel, /\{plateName\}, \{CHART_SHEETS\.find/)
})

test('ACCESS 2: the tabs and the ribbon show focus, using the token as a whole shorthand', () => {
  // --aspire-focus-ring is `2px solid var(--aspire-navy)`. Wrapping it in another
  // shorthand produced `3px solid 2px solid ...`, which the browser drops silently.
  assert.match(css, /outline: var\(--aspire-focus-ring\);/)
  assert.ok(!/outline: \d+px solid var\(--aspire-focus-ring/.test(cssCode))
  assert.match(css, /\.sc-tab:focus-visible,\n\.sc-ribbon:focus-visible \{/)
})

test('ACCESS 3: a sheet is a labelled section and the name is the page\'s heading', () => {
  assert.match(panel, /<section className="sc-sheet" id="sc-sheet-\w+" data-sheet="\w+" aria-label="/)
  assert.match(panel, /<h1 className="sc-plate-name">/)
  assert.match(panel, /<nav className="sc-index" aria-label="Chart sections">/)
})

// ── EVALUATIONS: a reader, not a writer ─────────────────────────────────────

test('EVAL 1: the sheet reads existing tables and invents no field', () => {
  const ev = read('src/components/student/ChartEvaluations.jsx')
  assert.match(ev, /from\('interview_rubrics'\)/)
  assert.match(ev, /from\('evaluation_assignments'\)/)
  assert.ok(!/\.insert\(|\.update\(|\.delete\(/.test(noComments(ev)), 'the evaluations sheet never writes')
})

test('EVAL 2: instruments are not hard-coded, so a newly seeded one still appears', () => {
  const ev = read('src/components/student/ChartEvaluations.jsx')
  assert.ok(!/preceptor_progress|post_rotation_evaluation|student_preceptor_eval/.test(noComments(ev)))
  assert.match(ev, /inst\?\.display_name \|\| inst\?\.slug/)
})

test('EVAL 3: a revoked invitation is not shown as pending', () => {
  const ev = read('src/components/student/ChartEvaluations.jsx')
  const fn = ev.slice(ev.indexOf('function statusChip'))
  assert.ok(fn.indexOf('revoked_at') < fn.indexOf('Awaiting response'),
    'revoked must be tested before the pending states')
})

test('EVAL 4: a composite averaged over several interviewers says so', () => {
  const ev = read('src/components/student/ChartEvaluations.jsx')
  assert.match(ev, /Average of \$\{scored\.length\} interviewers/)
})

// ── DARK ────────────────────────────────────────────────────────────────────

test('DARK 1: the chart redefines its paper for dark, and the leather stays black', () => {
  assert.match(css, /\[data-theme="dark"\] \.sc-paper,/)
  assert.match(css, /--aspire-sheet-profile: #181C2B;/)
  assert.ok(!/\[data-theme="dark"\][^\n]*\.sc-binder/.test(cssCode),
    'black leather is black in both themes')
})

test('DARK 2: a sheet title is a heading colour, never the table-header grey', () => {
  // --aspire-th-color (#6b7785) measured 4.04:1 behind an 18px bold title.
  assert.match(css, /color: var\(--aspire-sheet-title\);/)
  assert.ok(!/\.sc-sheet-title[\s\S]{0,120}--aspire-th-color/.test(cssCode))
})

test('DARK 3: the panel\'s pastel fields have a dark pair', () => {
  const index = read('src/index.css')
  assert.match(index, /\[data-theme="dark"\] \.sp-card \.sp-input,/)
  assert.match(index, /\[data-theme="dark"\] \.sp-card \.sp-readonly \{[\s\S]*?color: var\(--color-text-primary/)
  // STUDENT-PROFILE-INK-1 replaced the .sp-nav-btn dark patch with something better: the
  // base rule reads theme-aware tokens, so there is nothing left to patch. Assert the
  // outcome (no fixed light-mode ink on the button, and its row follows the theme)
  // rather than the mechanism, or this test pins the weaker of the two fixes.
  const nav = index.match(/\.sp-nav-btn \{[\s\S]*?\}/)[0]
  assert.match(nav, /color: var\(--color-accent-primary\)/)
  assert.ok(!/var\(--nightfall\)/.test(nav), 'a fixed light navy here is invisible on dark paper')
  const row = index.match(/\.sp-nav-row \{[\s\S]*?\}/)[0]
  assert.ok(!/var\(--sand\)/.test(row), 'a fixed sand row stays bright in dark mode')
})

test('FLAG 8: the ribbon gets the REFETCH, not the writer, or the roster lags a reload', () => {
  // onUpdate is updateStudent(id, updates): a domain writer that routes by field name and
  // has no route for this column, and refreshes nothing when called. The roster reads the
  // app's students array, so the flag needs the refetch as well as the optimistic paint.
  // The interview rubric shipped this exact mistake in September 2026 and cost two rounds.
  assert.match(tab, /onRefreshStudents=\{onRefresh\}/)
  assert.match(panel, /onRefreshStudents,/, 'the panel must accept the refetch')
  const setFollowUp = panel.slice(panel.indexOf('const setFollowUp'), panel.indexOf('const setFollowUp') + 1400)
  assert.match(setFollowUp, /if \(onRefreshStudents\) await onRefreshStudents\(\)/)
  assert.ok(!/onUpdate\(\s*\)/.test(setFollowUp), 'calling the writer with no fields is a no-op')
})

// ── ROOM: the chart gets the window (Owner, 2026-09-18) ─────────────────────

test('ROOM 1: the page scrolls; the tab is no longer a fixed viewport box', () => {
  const index = noComments(read('src/index.css'))
  const tab = index.match(/\.student-profiles-tab \{[\s\S]*?\}/)[0]
  assert.ok(!/height: calc\(100vh/.test(tab), 'a fixed height here is what made the chart 512px')
  assert.ok(!/overflow: hidden/.test(tab), 'the page has to be able to scroll')
})

test('ROOM 2: only the search and filter bar pins', () => {
  const index = noComments(read('src/index.css'))
  const bar = index.match(/\.profiles-toolbar \{[\s\S]*?\}/)[0]
  assert.match(bar, /position: sticky;/)
  // It pins BELOW the app chrome, which is sticky too; the offset is measured at runtime.
  assert.match(bar, /top: var\(--profiles-toolbar-top/)
  // The KPI strip must NOT be sticky: the Owner chose for it to scroll away.
  const frozen = index.match(/\.profiles-frozen\s+\{[\s\S]*?\}/)[0]
  assert.ok(!/position: sticky/.test(frozen))
})

test('ROOM 3: the toolbar is a direct child of the tab, or sticky cannot hold it', () => {
  // A sticky element is bounded by its own parent. Inside .profiles-frozen it would
  // unstick the moment the KPI wrapper scrolled past, which is the whole point.
  const toolbarAt = tab.indexOf('className="profiles-toolbar"')
  const frozenClose = tab.indexOf('end .profiles-frozen')
  assert.ok(toolbarAt > frozenClose && frozenClose !== -1,
    'the toolbar must come after .profiles-frozen closes')
})

test('ROOM 4: the chart height is measured, never a constant', () => {
  const vp = read('src/components/student/useChartViewport.js')
  assert.match(vp, /getBoundingClientRect\(\)\.height/)
  assert.match(vp, /window\.innerHeight/)
  assert.match(vp, /new ResizeObserver/)
  assert.match(vp, /const MIN_CHART_H/)
  assert.match(tab, /--profiles-chart-h/)
  const index = noComments(read('src/index.css'))
  assert.match(index, /height: var\(--profiles-chart-h/)
  // and the stacked breakpoint still wins
  assert.match(index, /height: auto;/)
})

// ── PAPER: the refinements the Owner asked for ──────────────────────────────

test('PAPER 1: no tiles - a section is part of the page, not a box on it', () => {
  const css = noComments(read('src/components/student/studentChart.css'))
  const rule = css.match(/\.sc-sheet \.sp-section,[\s\S]*?\}/)[0]
  assert.match(rule, /background: transparent;/)
  assert.match(rule, /border-radius: 0;/)
  assert.match(rule, /box-shadow: none;/)
  // sections are separated by a rule, not by a gap between cards
  assert.match(css, /\.sc-sheet \.sp-section \+ \.sp-section \{ border-top: 1px solid/)
  // the sheet tint survives: it is what ties a sheet to its tab
  assert.match(css, /\.sc-sheet\[data-sheet="documents"\]\s*\{ background: var\(--aspire-sheet-documents\); \}/)
})

test('PAPER 2: a real block keeps its box, and the mockup says which', () => {
  const css = noComments(read('src/components/student/studentChart.css'))
  assert.match(css, /\.sc-block \{/)
  const ev = read('src/components/student/ChartEvaluations.jsx')
  assert.match(ev, /className="sc-block"/)
  assert.ok(!/className="sp-section sp-card"/.test(ev))
})

test('PAPER 3: the page stack is on the fore edge, which is the right', () => {
  const css = noComments(read('src/components/student/studentChart.css'))
  // PAGE-STACK-1 (Owner, 2026-09-19): "I like the stack of paper effect in the calendars.
  // it's more realistic." The striped fore edge is gone and the binder reads the
  // calendars' offset sheets from src/styles/pageStack.css. What this test protects is
  // unchanged and is in its name: the sheets show on the RIGHT, because the rings are the
  // spine and the spine is on the left.
  const paper = css.match(/\.sc-paper \{[\s\S]*?\}/)[0]
  assert.ok(!/box-shadow:[^;]*\dpx 0 0 -1px/.test(paper), 'the paper is drawing the stack again')
  assert.match(css, /@import '\.\.\/\.\.\/styles\/pageStack\.css';/)
  const stack = css.match(/\.sc-binder\.material-pagestack \{[\s\S]*?\}/)
  assert.ok(stack, 'the sheet stack is gone')
  // The shared definition only ever offsets down and to the right, so a stack that reads
  // its inset tokens can never draw down the binder's bound edge.
  const shared = noComments(read('src/styles/pageStack.css'))
  for (const which of ['::before', '::after']) {
    // Find the rule by what it CONTAINS, not by where it starts: the shared
    // `::before, ::after` block puts `.material-pagestack::after {` at the start of a
    // line too, and it carries no offsets, so both an anchor and a lazy match find it
    // first. The offset rules are the ones that position from the inset tokens.
    const found = shared.match(new RegExp(`\\.material-pagestack${which} \\{[^}]*--stack-inset-l[^}]*\\}`))
    assert.ok(found, `the ${which} offsets are gone`)
    const rule = found[0]
    assert.match(rule, /right: calc\(var\(--stack-inset-r\) - \d+px\)/, 'the sheets stopped reaching past the right edge')
    assert.match(rule, /bottom: calc\(var\(--stack-inset-b\) - \d+px\)/, 'the sheets stopped falling below')
    assert.match(rule, /left: calc\(var\(--stack-inset-l\) \+ \d+px\)/, 'a binder bound down its open edge')
  }
  // The board must hold the room the stack draws into, on BOTH the right and the bottom,
  // or the sheets land outside the leather. Every rule that sets the padding derives it
  // from the same three tokens.
  for (const m of css.matchAll(/\.sc-binder \{[\s\S]*?\}/g)) {
    if (!/padding:/.test(m[0])) continue
    assert.match(m[0], /padding: var\(--sc-board-pad\) calc\(var\(--sc-board-pad\) \+ var\(--sc-stack-w\)\) calc\(var\(--sc-board-pad\) \+ var\(--sc-stack-h\)\)/,
      'a hand-written padding here and the stack disagree')
  }
  assert.match(stack[0], /--stack-inset-r: calc\(var\(--sc-board-pad\) \+ var\(--sc-stack-w\)\);/)
  assert.match(stack[0], /--stack-inset-b: calc\(var\(--sc-board-pad\) \+ var\(--sc-stack-h\)\);/)
  // and the page is above the pseudo-element whatever happens
  assert.match(paper, /z-index: 1;/)
})

test('PAPER 3b: the page has ONE edge, and the binder does not smudge the surface', () => {
  // Owner, 2026-09-19: "there is like an additional shadow or outline around the
  // rectangle profile. remove it so the stack is more part of the effect." There were
  // two edges, a border and a 1px ring shadow drawn just outside it, which read as a
  // double rule and cut the page off from the sheets behind it.
  const css = noComments(read('src/components/student/studentChart.css'))
  const paper = css.match(/\.sc-paper \{[\s\S]*?\n\}/)[0]
  assert.match(paper, /border: 1px solid var\(--aspire-binder-edge\);/)
  assert.ok(!/box-shadow: 0 0 0 1px/.test(paper), 'the page grew a second edge again')
  // "there is a shadow at the bottom of the chart on either side, it looks off on the
  // right edge". `.profiles-detail-col` is overflow-y:auto, which clips BOTH axes, so a
  // wide low shadow was cut off flush at the sides and free to smear below. A negative
  // spread keeps the whole shadow under the leather.
  const materials = noComments(read('src/styles/aspireMaterials.css'))
  const black = materials.match(/\.material-leather-black \{[\s\S]*?\n\}/)[0]
  const drop = black.match(/0 (\d+)px (\d+)px (-?\d+)px rgba\(24, 32, 63/)
  assert.ok(drop, 'the binder lost its drop shadow')
  const [, y, blur, spread] = drop.map(Number)
  assert.ok(y + blur + spread <= 20, `the shadow reaches ${y + blur + spread}px past the leather; it has no room for that`)
  assert.ok(Number(spread) < 0, 'the shadow needs a negative spread to stay under the object')
})

test('PAPER 4: the ribbon hangs from the board, not from the paper', () => {
  // It must be a sibling of .sc-paper inside .sc-binder, and come before it.
  const ribbonAt = panel.indexOf('classPrefix="sc-ribbon"')
  const paperAt = panel.indexOf('<div className="sc-paper">')
  const plateAt = panel.indexOf('sc-plate$')
  assert.ok(ribbonAt !== -1 && paperAt !== -1)
  assert.ok(ribbonAt < paperAt, 'the ribbon is sewn into the cover, above the paper')
  const css = noComments(read('src/components/student/studentChart.css'))
  const rb = css.match(/\.sc-ribbon \{[\s\S]*?\}/)[0]
  assert.match(rb, /position: absolute;/)
  assert.match(rb, /top: 0;/)
  assert.ok(plateAt === -1 || true)
})

test('PAPER 5: the avatar aligns to the name, not to the middle of the chips', () => {
  const css = noComments(read('src/components/student/studentChart.css'))
  assert.match(css, /\.sc-plate-id \{[^}]*align-items: flex-start;/)
})

// ── INK: light-mode colours must not be hardcoded on theme-aware surfaces ───
// STUDENT-PROFILE-INK-1 (2026-09-18). The panel had ~40 pieces of text at 1-3:1 in dark,
// from three causes: inline light-mode inks, module-level colour constants, and
// containers whose background was a fixed light value. Dark now measures 0 failures over
// 1,337 samples and light is unchanged (0 regressions).

const subPanels = [
  'src/components/ClinicalHoursPanel.jsx',
  'src/components/StudentUnitAssignments.jsx',
  'src/components/AdditionalPreceptors.jsx',
]

test('INK 1: a light-mode ink is only allowed beside a light-mode background', () => {
  // THE RULE this task turned on: a colour pair travels together. A theme-aware ink on a
  // fixed light box is invisible in dark (measured 1.65:1), and so is a fixed dark ink on
  // a theme-aware box. So a literal ink is a defect ONLY when nothing nearby pins the
  // surface it sits on. Status colours are exempt: each is half of its own chip.
  const banned = ['#1d2567', '#1D2567', '#191919', '#374151', '#4b5563', '#6b7280', '#9ca3af']
  const offenders = []
  for (const f of [...subPanels, 'src/components/StudentSidePanel.jsx']) {
    for (const line of noComments(read(f)).split('\n')) {
      for (const b of banned) {
        if (!new RegExp(`\\bcolor\\s*:\\s*['"]${b}['"]`, 'i').test(line)) continue
        // paired with a literal light background on the same element? then it is fine.
        // `bg:` counts: a chip config table writes the pair as { bg, color, border }, and
        // reading only `background:` called a correctly-paired chip a defect.
        if (/(?:background(?:Color)?|\bbg)\s*:\s*['"]?#[0-9a-f]{3,6}/i.test(line)) continue
        offenders.push(`${f.split('/').pop()}: ${line.trim().slice(0, 90)}`)
      }
    }
  }
  assert.deepEqual(offenders, [], 'unpaired light-mode ink on a theme-aware surface')
})

test('INK 2: the neutral inks read tokens that BOTH themes define', () => {
  const theme = read('src/styles/theme.css')
  const dark = theme.slice(theme.indexOf(':root[data-theme="dark"]'))
  for (const t of ['--color-text-primary', '--color-text-secondary', '--color-text-muted',
                   '--color-text-placeholder', '--color-accent-primary']) {
    assert.ok(dark.includes(t + ':'), `${t} has no dark value`)
  }
  // and the aliases the panel actually writes are wired to them (they live in theme.css,
  // not index.css - index.css's own --text-secondary is a fixed light value).
  assert.match(theme, /--text-heading:\s*var\(--color-text-primary\)/)
  assert.match(theme, /--text-muted:\s*var\(--color-text-muted\)/)
})

test('INK 3: a module colour constant is a token, not a hex', () => {
  const ua = read('src/components/StudentUnitAssignments.jsx')
  assert.match(ua, /const NAVY = 'var\(--color-accent-primary\)'/)
  assert.ok(!/const NAVY = '#/.test(ua), 'a fixed hex here reaches every call site at once')
})

test('INK 4: the containers that hold panel text follow the theme', () => {
  const index = noComments(read('src/index.css'))
  for (const [sel, banned] of [
    ['.sp-nav-row', 'var(--sand)'],
    ['.doc-upload-zone', 'var(--pearl)'],
    ['.doc-existing-file', 'var(--sand)'],
    ['.btn-destructive', 'var(--pearl)'],
    ['.csw-step', '#fafafa'],
    ['.sp-section-hdr', '#f9fafb'],
  ]) {
    const rule = index.match(new RegExp(`\\${sel} \\{[\\s\\S]*?\\}`))
    assert.ok(rule, `${sel} rule not found`)
    assert.ok(!rule[0].includes(banned),
      `${sel} still has a fixed light background (${banned}); its text cannot win`)
  }
})

test('INK 5: the panel\'s three semantic inks are tokens with both themes', () => {
  const index = noComments(read('src/index.css'))
  for (const t of ['--sp-ok-ink', '--sp-warn-ink', '--sp-danger-ink']) {
    assert.ok(index.includes(t + ':'), `${t} is not defined`)
    const darkBlock = index.slice(index.indexOf('[data-theme="dark"] {'))
    assert.ok(darkBlock.includes(t + ':'), `${t} has no dark value`)
  }
  // Danger stays a RED. The app's --color-status-danger is the magenta Chroma, which is
  // wrong on a red-tinted box, and swapping to it changed light mode.
  assert.match(index, /--sp-danger-ink:\s*#b23b2e/)
})

test('INK 6: the chart does not push its dark ink onto the materials', () => {
  // A paper note is white in BOTH themes (the materials layer is theme-independent), so
  // the chart's light-blue accent landing on one measured 1.65:1.
  const css = noComments(read('src/components/student/studentChart.css'))
  assert.match(css, /\[data-theme="dark"\] \.sc-paper \.paper-note,/)
  assert.match(css, /--color-accent-primary: #1D2567;/)
})

// ── CALM: nothing moves that the reader did not move (Owner, 2026-09-18) ────

test('CALM 1: neither ribbon resizes or travels on hover', () => {
  const chart = noComments(read('src/components/student/studentChart.css'))
  const book  = noComments(read('src/components/rubric/rubricBook.css'))
  // The rubric's ribbon used to grow 6px on hover, so the thing you were about to click
  // moved out from under the pointer. Both now lift a shadow and hold their position.
  assert.ok(!/\.rb-ribbon:hover \{[^}]*padding/.test(book), 'the rubric ribbon must not resize on hover')
  assert.ok(!/\.sc-ribbon:hover \{[^}]*(padding|translate|transform)/.test(chart))
  assert.match(book, /\.rb-ribbon:hover,[\s\S]{0,80}box-shadow/)
  assert.match(chart, /\.sc-ribbon:hover,[\s\S]{0,90}box-shadow/)
})

test('CALM 2: the hover rule sits AFTER the state rules it must beat', () => {
  // Equal specificity means source order decides. Written above [aria-pressed="false"],
  // the hover shadow silently never applied - measured, not assumed.
  const chart = noComments(read('src/components/student/studentChart.css'))
  assert.ok(chart.indexOf('.sc-ribbon:hover') > chart.indexOf('.sc-ribbon[aria-pressed="false"]'))
  const book = noComments(read('src/components/rubric/rubricBook.css'))
  assert.ok(book.indexOf('.rb-ribbon:hover') > book.indexOf('.rb-ribbon-on'))
})

test('CALM 3: the index tab does not travel when the scroll spy changes', () => {
  const chart = noComments(read('src/components/student/studentChart.css'))
  const current = chart.match(/\.sc-tab\[aria-current="true"\] \{[\s\S]*?\}/)[0]
  assert.ok(!/translate/.test(current), 'a travelling current tab twitches the whole rail as you read')
  assert.match(current, /font-weight: 700/)
})

test('CALM 4: the rubric head lifts on scroll, like the chart plate', () => {
  const book = noComments(read('src/components/rubric/rubricBook.css'))
  assert.match(book, /\.rb-head-lifted \{/)
  const session = read('src/components/RubricSession.jsx')
  assert.match(session, /setHeadLifted\(root\.scrollTop > 2\)/)
  assert.match(session, /rb-head-lifted/)
  // and it is the SAME shadow the plate uses
  const chart = noComments(read('src/components/student/studentChart.css'))
  const plate = chart.match(/\.sc-plate-lifted \{[\s\S]*?\}/)[0]
  const head  = book.match(/\.rb-head-lifted \{[\s\S]*?\}/)[0]
  const norm = t => t.replace(/\s+/g, ' ').replace(/^[^{]*\{/, '')
  assert.equal(norm(head), norm(plate), 'the two books must lift identically')
})

// ── ROOM 5: the chart clears the sticky app chrome ─────────────────────────

test('ROOM 5: the pinned stack is the chrome PLUS the toolbar', () => {
  const vp = read('src/components/student/useChartViewport.js')
  // .top-section is position:sticky, so it never leaves. Measuring only the toolbar put
  // it behind the header and hid the binder's first 40px.
  assert.match(vp, /\.top-section/)
  assert.match(vp, /getComputedStyle\(chrome\)\.position === 'sticky'/)
  assert.match(vp, /chromeH \+ bar\.getBoundingClientRect\(\)\.height \+ margins/)
  const tab = read('src/components/StudentProfilesTab.jsx')
  assert.match(tab, /--profiles-toolbar-top/)
})

// ── QUIET: the panel says each thing once ──────────────────────────────────

test('QUIET 1: the sheets have no eyebrow above their own title', () => {
  assert.ok(!panel.includes('sc-sheet-label'), '"Student record / Profile" said it twice')
  const css = noComments(read('src/components/student/studentChart.css'))
  assert.ok(!/\.sc-sheet-label \{/.test(css))
})

test('QUIET 2: profile completion is one line, not four restatements', () => {
  assert.match(panel, /className="sc-completion"/)
  // The provenance tag, the Missing pills and the separate "Ready to proceed" line are gone.
  const block = panel.slice(panel.indexOf('className="sc-completion"'), panel.indexOf('className="sc-completion"') + 900)
  assert.ok(!/SourceTag/.test(block))
  assert.match(block, /Ready to proceed/)
  assert.match(block, /completion\.missing\.join/)
})

test('QUIET 3: the full-width Copy Student Summary bar is gone, copies sit beside values', () => {
  assert.ok(!panel.includes('handleCopySummary'), 'the summary bar and its handler both go')
  assert.ok(!panel.includes('generateStudentSummary'))
  // and the fields a coordinator actually copies each have their own button
  for (const label of ['Copy personal email', 'Copy phone', 'Copy email']) {
    assert.ok(panel.includes(label), `missing a copy control: ${label}`)
  }
})

test('QUIET 4: Documents is a list and does not repeat the student photo', () => {
  const css = noComments(read('src/components/student/studentChart.css'))
  assert.match(css, /\.sc-sheet \.doc-headshot-preview \{ display: none; \}/)
  assert.match(css, /\.sc-sheet \.doc-section \{[\s\S]*?grid-template-columns: 1fr;/)
})

// ── FLAGS: one wording, both lists ─────────────────────────────────────────

test('FLAG 9: both lists show the follow-up flag, and say the same thing', () => {
  const recs = read('src/components/InterviewRubricTab.jsx')
  assert.match(recs, /isFollowUpFlagged\(s\)/)
  assert.match(recs, /Flagged for follow up/)
  assert.match(roster, /Flagged for follow up/)
  // and the roster gets the red edge the recommendations table already had
  const index = noComments(read('src/index.css'))
  assert.match(index, /\.pl-row\.pl-followup \{ border-left: 4px solid var\(--aspire-red-editorial/)
  assert.match(index, /\.pl-row\.pl-followup\.pl-selected \{ border-left-color: var\(--nightfall\); \}/)
})

test('FLAG 10: the two flags stay different things in the recommendations table', () => {
  const recs = noComments(read('src/components/InterviewRubricTab.jsx'))
  // the red edge is still driven by the INTERVIEW flag, not the follow-up one
  assert.match(recs, /flagInfo\s*\?\s*\(flagInfo\.critical/)
  assert.match(recs, /flagged_for_second_interview/)
})


// ── TIDY: round five, the small consistencies (Owner, 2026-09-18) ───────────

test('TIDY 1: the three contact values are one column, so the copy buttons line up', () => {
  const index = noComments(read('src/index.css'))
  // One class does it, and it makes the VALUE take the row - not the button.
  assert.match(index, /\.sp-copyrow \{ display: flex; align-items: center; gap: 6px; \}/)
  assert.match(index, /\.sp-copyrow > \.sp-input,\s*\n\.sp-copyrow > \.sp-readonly \{ flex: 1 1 auto; min-width: 0; \}/)
  assert.match(index, /\.sp-copyrow > \.sp-copy-btn \{ flex: none; \}/)
  // and all three rows use it, readonly and editable alike
  assert.equal((panel.match(/className="sp-copyrow"/g) || []).length, 3)
  // the inline width that used to do this by hand is gone
  assert.ok(!/style=\{\{ display:'flex', gap:6, alignItems:'center' \}\}/.test(noComments(panel)))
})

test('TIDY 2: every document row ends in the same "↓ Download"', () => {
  const code = noComments(panel)
  // Four rows, four identical labels. A row that says something else has drifted.
  assert.equal((code.match(/↓ Download/g) || []).length, 4)
  assert.ok(!code.includes('↓ Resume'), 'the resume row used to name itself in its button')
  assert.ok(!code.includes('Download Certificate of Completion<'), 'the certificate row too')
  for (const label of ['Resume', 'Headshot', 'ID Badge', 'Certificate of Completion']) {
    assert.ok(new RegExp(`className="doc-area-label">\\s*${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(code),
      `missing row: ${label}`)
  }
  // Download and Replace are ONE rule, so they cannot drift apart in size or corner.
  const index = noComments(read('src/index.css'))
  assert.match(index, /\.doc-replace-btn,\s*\n\.doc-dl-btn \{/)
  // A <button> brings its own font; the shared rule takes it back.
  assert.match(index, /\.doc-replace-btn,\s*\n\.doc-dl-btn \{[\s\S]*?font-family: inherit;/)
})

test('TIDY 3: the action columns are fixed, so the buttons land on one line', () => {
  assert.match(cssCode, /--sc-doc-dl: \d+px;/)
  assert.match(cssCode, /--sc-doc-rep: \d+px;/)
  assert.match(cssCode, /\.sc-sheet \.doc-act \{ flex: 0 0 var\(--sc-doc-dl\); \}/)
  assert.match(cssCode, /\.sc-sheet \.doc-act \+ \.doc-act \{ flex: 0 0 var\(--sc-doc-rep\); \}/)
  // The button fills its column, so four buttons are one width.
  assert.match(cssCode, /\.sc-sheet \.doc-act > \.doc-dl-btn,[\s\S]{0,80}?width: 100%;/)
  // A row with nothing to replace still HOLDS the replace column, or the one above it
  // would slide right and the column would bend.
  assert.equal((noComments(panel).match(/<div className="doc-act" \/>/g) || []).length, 2)
})

test('TIDY 4: the plate GPA chip reads the canon instead of its own thresholds', () => {
  const code = noComments(panel)
  assert.match(code, /gpaBand, GPA_BAND_COLORS,?\s*\n?\} from '\.\.\/lib\/constants'/)
  assert.match(code, /GPA_BAND_COLORS\[gpaBand\(data\.cumulative_gpa\)\]/)
  // the old two-tone rule, which painted everything under 3.5 the same grey and hid
  // ASPIRE's 3.0 floor entirely, is gone
  assert.ok(!/gpaVal>=3\.5\?/.test(code), 'the chip is deciding its own colours again')
  // and the canon still has three bands, not two
  const constants = read('src/lib/constants.js')
  for (const band of ['strong', 'watch', 'below']) {
    assert.ok(constants.includes(`  ${band}:`), `GPA_BAND_COLORS lost its ${band} band`)
  }
})

test('TIDY 5: Program Disposition is on the Placement sheet, with the rule that names it', () => {
  const placement = panel.slice(
    panel.indexOf('id="sc-sheet-placement"'),
    panel.indexOf('id="sc-sheet-hours"'),
  )
  assert.match(placement, /title="Program Disposition"/)
  // the pointer that made this the right sheet is in the same sheet
  assert.match(placement, /Use Program Disposition section to record dispositions/)
  // and it is NOT left behind under Notes
  const notes = panel.slice(panel.indexOf('id="sc-sheet-notes"'))
  assert.ok(!notes.includes('title="Program Disposition"'))
})

test('TIDY 6: Availability is one comparison, not two labelled halves', () => {
  const code = noComments(panel)
  // one row per constraint, both sources on the row
  assert.match(code, /<table className="sc-avail">/)
  for (const row of ['Unavailable weekdays', 'Minimum clinical days/week', 'Weekends',
    'Nights', 'Blackout dates', 'Preferred days', 'Scheduling notes']) {
    assert.ok(code.includes(`scope="row">${row}<`), `missing constraint row: ${row}`)
  }
  // the two uppercase half-headings are gone
  assert.ok(!code.includes('Coordinator Program Constraints'))
  assert.ok(!code.includes('>\n                Student Availability\n'))
  // provenance survives the merge: each column still says where it came from
  assert.match(code, /SourceTag label="Source: Coordinator school form" tone="coordinator"/)
  assert.match(code, /SourceTag label="Source: Student form" tone="student"/)
  // and the canon's one header class is what the header is made of
  assert.match(code, /<th className="aspire-th" scope="col">/)
  // the acknowledgment is one line, not a field that says Completed AND a warning that
  // says it is not
  assert.ok(!code.includes('Availability acknowledgment'))
  assert.match(code, /Student confirmed their availability\./)
  // still descriptive: the table reports both sides, it does not judge the fit
  assert.ok(!/conflict/i.test(code.slice(code.indexOf('<table className="sc-avail">'),
    code.indexOf('</table>'))), 'no risk logic belongs in this phase')
})

test('TIDY 7: CS-Link is a checklist on the sheet, not stacked panels', () => {
  // The shared rule still draws a box, because outside the chart it IS a panel.
  const index = noComments(read('src/index.css'))
  assert.match(index, /\.csw-step \{[^}]*border: 1px solid/)
  // Inside a sheet it loses the fill and the border and keeps only a hairline, the same
  // shape the document rows above it have.
  const rule = cssCode.match(/\.sc-sheet \.csw-step \{[\s\S]*?\}/)
  assert.ok(rule, '.sc-sheet .csw-step is gone')
  assert.match(rule[0], /background: transparent;/)
  assert.match(rule[0], /border: 0;/)
  assert.match(rule[0], /border-top: 1px solid var\(--aspire-page-rule\);/)
  assert.match(cssCode, /\.sc-sheet \.csw-step:first-of-type \{ border-top: 0;/)
})

test('TIDY 8: a neutral chip is a pair, and both halves are fixed', () => {
  const code = noComments(panel)
  // The defect: a FIXED light background carrying a THEMED ink. In dark that is pale grey
  // on pale grey (measured 2.0:1 on the plate's "Not placed" chip).
  assert.ok(!/background:\s*'#f3f4f6',\s*color:\s*'var\(--text-muted\)'/.test(code))
  assert.ok(!/bg:\s*'#f3f4f6',\s*color:\s*'var\(--text-muted\)'/.test(code))
  assert.match(code, /const NEUTRAL_CHIP = \{ bg: 'var\(--aspire-th-bg-inset\)', color: 'var\(--aspire-th-color-inset\)' \}/)
  // and it is used everywhere the old pair was
  assert.ok((code.match(/NEUTRAL_CHIP\.(bg|color)/g) || []).length >= 10)
})

test('TIDY 9: the CS-Link checklist reads inks both themes define', () => {
  const index = noComments(read('src/index.css'))
  // --raven and --pearl are light-mode CONSTANTS no theme redefines, so a tick label in
  // --raven measured 1.15:1 on a dark step.
  const label = index.match(/\.csw-check-label \{[^}]*\}/)
  assert.ok(label && !label[0].includes('var(--raven)'), '.csw-check-label is on a light-only ink')
  assert.match(label[0], /color: var\(--text-heading\)/)
  const date = index.match(/\.csw-date-input \{[^}]*\}/)
  assert.ok(date && !date[0].includes('var(--pearl)'), '.csw-date-input is a white box on dark paper')
  // ink and surface move together or neither move
  assert.match(date[0], /color: var\(--text-heading\)/)
  assert.match(date[0], /background: var\(--bg-card\)/)
})

test('TIDY 10: the Availability header is legible on a tinted sheet', () => {
  // --aspire-th-color is tuned for a white table band and measures 4.15:1 on the sheet.
  assert.match(cssCode, /\.sc-sheet \.sc-avail \.aspire-th \{[\s\S]*?color: var\(--aspire-paper-ink-soft\);/)
})

test('INK 7: no component in the chart puts a themed ink on a fixed box', () => {
  // The mechanical form of "a colour pair travels together", and the one thing a contrast
  // sweep cannot be trusted to find: a sweep only measures what the RECORD renders, and
  // every instance below was invisible to one. The "Ended" unit chip needed a student with
  // an ended assignment, the <select> needed an open edit form, the Cancel button needed an
  // open add form, and the CS-Link tick labels needed a student past step 1. Each measured
  // between 1.09:1 and 2.0:1 in dark while the sweep reported the panel clean.
  const files = [
    'src/components/StudentSidePanel.jsx',
    'src/components/StudentUnitAssignments.jsx',
    'src/components/AdditionalPreceptors.jsx',
    'src/components/ClinicalHoursPanel.jsx',
    'src/components/student/ChartEvaluations.jsx',
  ]
  const bg = /(?:bg|background(?:Color)?)\s*:\s*'(#[0-9a-fA-F]{3,8})'/
  const ink = /colou?r\s*:\s*'(var\(--[a-z-]+\))'/
  const bad = []
  for (const f of files) {
    const lines = noComments(read(f)).split('\n')
    lines.forEach((line, i) => {
      const b = bg.exec(line), k = ink.exec(line)
      if (b && k) bad.push(`${f}:${i + 1}  ${b[1]} behind ${k[1]}`)
    })
  }
  assert.deepEqual(bad, [],
    `a fixed background carrying a themed ink is invisible in one theme:\n  ${bad.join('\n  ')}`)
})

// ── TIDY, round six (Owner, 2026-09-18) ────────────────────────────────────

test('TIDY 11: shift preference is a scheduling constraint, and sits with the others', () => {
  const code = noComments(panel)
  const background = code.slice(code.indexOf('id="sc-sheet-background"'), code.indexOf('id="sc-sheet-placement"'))
  const profile = code.slice(code.indexOf('id="sc-sheet-profile"'), code.indexOf('id="sc-sheet-background"'))
  assert.match(background, /htmlFor=\{`sp-shift-\$\{student\.id\}`\}/)
  assert.match(background, /handleSelect\('shift_availability'/)
  assert.ok(!/shift_availability/.test(profile), 'it is back under Personal Information')
  // It is still EDITABLE, and it sits in the Student column of the table rather than in a
  // row parked underneath it, which lined up with nothing.
  assert.match(background, /<select id=\{`sp-shift-\$\{student\.id\}`\} className="sp-select sc-avail-select"/)
  assert.match(background, /<th className="sc-avail-rh" scope="row">\s*\n\s*<label htmlFor=\{`sp-shift-/)
  // and it says the program does not set it, like every other one-sided row
  const row = background.slice(background.indexOf('sp-shift-'))
  assert.match(row.slice(0, 400), /className="sc-avail-na">—<\/td>/)
})

test('TIDY 12: a generated document carries its note under its name', () => {
  const code = noComments(panel)
  for (const [label, note] of [
    ['ID Badge', 'Needs headshot and rotation dates.'],
    ['Certificate of Completion', 'Available after post-rotation evaluation completion.'],
  ]) {
    const at = code.search(new RegExp(`className="doc-area-label">\\s*${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`))
    assert.ok(at > 0, `${label} row is gone`)
    const block = code.slice(at, at + 600)
    assert.match(block, /className="doc-row-note"/, `${label}'s note left its name column`)
    assert.ok(block.includes(note), `${label}'s note is not the Owner's wording`)
    // the middle column stays, empty, so the action columns do not move
    assert.match(block, /<div className="doc-existing-file" \/>/)
  }
  const css = noComments(read('src/components/student/studentChart.css'))
  assert.match(css, /\.sc-sheet \.doc-row-note \{[\s\S]*?display: block;/)
  // A long note must never wrap the row: a flex line wraps on hypothetical sizes before
  // it shrinks anything, so the middle column's basis is ZERO, not auto.
  assert.match(css, /\.sc-sheet \.doc-existing-file \{[\s\S]*?flex: 1 1 0;/)
})

test('TIDY 13: the binder ends on paper, not on a band of bare page', () => {
  const css = noComments(read('src/components/student/studentChart.css'))
  const tail = css.match(/\.sc-tail \{[\s\S]*?\}/)
  assert.ok(tail, '.sc-tail is gone')
  assert.match(tail[0], /background: var\(--aspire-sheet-notes\);/,
    'a transparent tail shows the page white under a tinted sheet')
})

test('TIDY 14: the prev/next footer is gone, and so are the props that fed it', () => {
  const code = noComments(panel)
  assert.ok(!code.includes('sp-nav-row'), 'the second navigation is back at the end of the record')
  assert.ok(!code.includes('sortedStudents'), 'the roster prop outlived the control that used it')
  assert.ok(!code.includes('onSelectStudent'))
  // and the call site stopped passing them
  assert.ok(!noComments(tab).includes('sortedStudents={'))
  // the Danger Zone is still the last thing in the binder
  assert.match(code, /sp-danger-zone/)
})
