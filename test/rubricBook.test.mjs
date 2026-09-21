// RUBRIC-BOOK-1 (2026-09-17): the Interview Rubric as a bound book.
// Functional proofs for the sizing rule (one layout, two floors) and the flag ribbon's
// thresholds; source proofs for the spread, the index down the fore edge, the scale's
// wording, the read-only book, and the machinery that must survive a redesign: the
// 30-second auto-save, the browser draft, the appointment as the source of truth, and
// the write path that creates exactly one rubric row.
// Run: node --test test/rubricBook.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  bookMetrics, CHROME, SPREAD_MIN, LEFT_SHARE, RIGHT_SHARE, COVER_PAD, COVER_PAD_X,
  RAIL_WIDTH, MIN_BOOK_H, BOTTOM_GAP,
} from '../src/components/rubric/useBookScale.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(root, p), 'utf8')

const session = read('src/components/RubricSession.jsx')
const bookCss = read('src/components/rubric/rubricBook.css')
const ribbon  = read('src/components/rubric/FlagRibbon.jsx')
const indexCss = read('src/index.css')
const boardCss = read('src/components/placement/placementBoard.css')
const constants = await import('../src/lib/constants.js')

// ── 1. The book takes the room it is given, and the PAGES absorb the change ─

test('BOOK 1: the book is the Placement Board\'s column, not the window', () => {
  // The board sits inside .app-main with a 20px gutter; the book does the same, so
  // the two workspaces line up with each other and with the cards above them.
  assert.match(boardCss, /\.pb-board \{[\s\S]*?margin: var\(--aspire-gap-card\) 20px 0;/)
  assert.match(bookCss, /\.rb-stage \{[\s\S]*?padding: 0 20px var\(--aspire-gap-card\);/)
  assert.match(indexCss, /\.app-main \{ width: min\(100% - 140px, 1580px\)/)
  // The book fills that column: no width of its own, no cap competing with it.
  assert.match(bookCss, /\.rb-book \{\s*\n\s*width: 100%;/)
  assert.ok(!/\.rb-book \{[^}]*max-width/.test(bookCss), 'the book carries its own max-width again')
})

test('BOOK 2: nothing is scaled; resizing changes the pages, not the book', () => {
  // Owner, 2026-09-17: the cover keeps one thickness at every width.
  assert.ok(!bookCss.includes('transform: scale('), 'the book is being transform-scaled again')
  assert.ok(!bookCss.includes('--rb-scale'), 'the scale variable is back')
  assert.match(bookCss, /--rb-cover-pad: 14px/)
  assert.match(bookCss, /--rb-cover-pad-x: calc\(var\(--rb-cover-pad\) \+ var\(--rb-stack-w\)\)/)
  assert.equal(COVER_PAD_X, COVER_PAD + 8)
  // The paper flexes in the proportion the pages were designed in.
  assert.match(bookCss, /minmax\(var\(--rb-left-min\), var\(--rb-left-share\)\)/)
  assert.match(bookCss, /--rb-left-share: 42\.5fr/)
  assert.match(bookCss, /--rb-right-share: 57\.5fr/)
  assert.equal(LEFT_SHARE + RIGHT_SHARE, 100)
})

test('BOOK 3: the pages take everything the cover and the index do not', () => {
  for (const width of [1540, 1332, 1144, 1004]) {
    const m = bookMetrics(width, 900)
    assert.equal(m.mode, 'spread')
    assert.equal(m.pages.left + m.pages.right, width - CHROME, `${width}px: the paper does not add up`)
    // The cover and the index never move with the width.
    assert.equal(CHROME, RAIL_WIDTH + (2 * COVER_PAD_X))
  }
})

test('BOOK 4: below SPREAD_MIN the book shows one page instead of two narrow ones', () => {
  assert.equal(bookMetrics(SPREAD_MIN, 900).mode, 'spread')
  assert.equal(bookMetrics(SPREAD_MIN - 1, 900).mode, 'single')
  const single = bookMetrics(760, 900)
  assert.equal(single.pages.left, 0)
  assert.equal(single.pages.right, 760 - CHROME)
})

test('BOOK 5: the whole book is on screen, bottom cover included', () => {
  // The shell claims what is left below its own top edge, less a gap, rather than
  // guessing the chrome above it with calc(100vh - 164px).
  assert.match(session, /\$\{shellHeight\}px/)
  assert.match(bookCss, /height: var\(--rb-shell-h, calc\(100vh - 164px\)\)/)
  const hook = read('src/components/rubric/useBookScale.js')
  assert.match(hook, /window\.innerHeight - top - BOTTOM_GAP/)
  assert.ok(BOTTOM_GAP > 0)
})

test('BOOK 6: a missing measurement never produces a broken book', () => {
  for (const m of [bookMetrics(0, 0), bookMetrics(undefined, undefined), bookMetrics(NaN, NaN)]) {
    assert.ok(m.pages.right >= 0)
    assert.ok(m.bookHeight >= MIN_BOOK_H)
    assert.ok(m.mode === 'single' || m.mode === 'spread')
  }
})

// ── 2. The spread ───────────────────────────────────────────────────────────

test('SPREAD 1: a cover, two pages, a seam and an index, in that order', () => {
  const order = ['rb-cover material-leather-cognac-hide', 'rb-page rb-page-left', 'rb-seam', 'rb-page rb-page-right', 'rb-index']
  let at = -1
  for (const cls of order) {
    const next = session.indexOf(cls)
    assert.ok(next > at, `${cls} is missing or out of order`)
    at = next
  }
  // The cover is a material, and the material is defined once, with the others.
  // CONTACTS-BOOK-3 (Owner): cognac, the leather the address book is bound in; the tan
  // is retired so the app's two books are one leather.
  assert.match(read('src/styles/aspireMaterials.css'), /\.material-leather-cognac-hide\s*\{/)
  assert.match(read('src/styles/aspireBrand.css'), /--aspire-leather-cognac:/)
  assert.ok(!read('src/styles/aspireBrand.css').includes('--aspire-leather-tan'), 'the tan came back')
})

test('SPREAD 2: the candidate is on the LEFT and the rubric on the RIGHT, as on the Placement Board', () => {
  assert.ok(session.indexOf('aria-label="Candidate"') < session.indexOf('aria-label="Rubric"'))
  assert.match(bookCss, /\.rb-page-left  \{ grid-column: 1;/)
  assert.match(bookCss, /\.rb-page-right \{ grid-column: 2;/)
  assert.match(bookCss, /\.rb-index      \{ grid-column: 3;/)
})

test('SPREAD 3: the left page carries the facts an interviewer reads while listening', () => {
  for (const fact of [
    'Background', 'Submitted Preferences', 'Interest Statement', 'Availability', 'Current role',
    '1st: {d1} · 2nd: {d2} · 3rd: {d3}',
    'This unit is full. Consider exploring alternatives during the interview.',
    'GPA {parseFloat(student.cumulative_gpa).toFixed(2)}', 'resumeActionLabel(student.resume_url)',
  ]) {
    assert.ok(session.includes(fact), `the left page lost: ${fact}`)
  }
  // In that order, and WITHOUT the appointment: Section 1 owns the date and time, and
  // repeating them here as read-only text said nothing twice (Owner, 2026-09-17).
  const left = session.slice(session.indexOf('aria-label="Candidate"'), session.indexOf('className="rb-seam"'))
  const at = (label) => left.indexOf(`>${label}</div>`)
  assert.ok(at('Background') < at('Submitted Preferences'), 'Background does not open the page')
  assert.ok(at('Submitted Preferences') < at('Interest Statement'))
  assert.ok(at('Interest Statement') < at('Availability'))
  assert.ok(!left.includes('Scheduled Interview'), 'the appointment is repeated on the left page')
  // Background is exactly the four answers the Owner named.
  const rows = session.slice(session.indexOf('const backgroundRows'), session.indexOf('].filter(([, v]) => v)'))
  for (const label of ['Current role', 'Cedars-Sinai affiliation', 'Healthcare experience', 'Shift preference']) {
    assert.ok(rows.includes(label), `Background lost ${label}`)
  }
  // WAVE F-2 is unchanged: the resume is still gated on the cohort entitlement.
  assert.match(session, /canViewStudentResumeInCohort\(cohortId\) && student\.resume_url/)
  assert.match(session, /openStudentFile\(\{ studentId: student\.id, kind: 'resume' \}\)/)
})

test('SPREAD 4: the head states completion, the guide and the live composite, and nothing else', () => {
  const head = session.slice(session.indexOf('data-testid="rb-head"'), session.indexOf('</header>'))
  // Neither the ASPIRE status nor the recommendation is repeated here: the first is on
  // the candidate page, the second is Section 7's own answer (Owner, 2026-09-17).
  assert.ok(!head.includes('AspireStatusPill'), 'the status pill is back in the head')
  assert.ok(!head.includes('rb-recommendation'), 'the recommendation is back in the head')
  assert.match(head, /Completion/)
  assert.match(head, /data-testid="rb-completion">\{completion\}%/)
  assert.match(head, /data-testid="rb-guide-toggle"/)
  assert.match(head, /data-testid="rb-composite">\{composite\}/)
  assert.match(head, /\/ 15/)
  // The save state moved to the toolbar rather than costing the head a second line.
  assert.match(session, /<BackButton label="Back to Interview List" onClick=\{onBack\} \/>\s*\n\s*\{saveIndicator\}/)
  // The composite is still the sum of the three domains, computed in one place.
  assert.match(session, /const composite = \(form\.cj_score \|\| 0\) \+ \(form\.pp_score \|\| 0\) \+ \(form\.ga_score \|\| 0\)/)
})

// ── 3. The index down the fore edge ─────────────────────────────────────────

test('INDEX 1: seven tabs, numbered, labelled, and pointing at the seven sections', () => {
  assert.match(session, /const SECTION_IDS = \['s1', 's2', 's3', 's4', 's5', 's6', 's7'\]/)
  for (const id of ['s1', 's2', 's3', 's4', 's5', 's6', 's7']) {
    assert.ok(session.includes(`id="${id}"`) || session.includes('id={`s${snum}`}'), `section ${id} has no anchor`)
  }
  assert.match(session, /\{String\(i \+ 1\)\.padStart\(2, '0'\)\}/)
  assert.match(session, /steps\.map\(\(s, i\) =>/)
})

test('INDEX 2: the number leads, the tab you are reading is marked, and nothing else is', () => {
  // Owner, 2026-09-17: "01 Info", not "Info 01", and no check mark. Progress is a
  // percentage in the head, so a tab carries one job: where you are.
  const tab = session.slice(session.indexOf('steps.map((s, i) =>'), session.indexOf('</nav>'))
  const numberSpan = tab.indexOf('<span className="rb-tab-num">')
  const labelSpan = tab.indexOf('<span>{s.label}</span>')
  assert.ok(numberSpan > -1 && labelSpan > numberSpan, 'the label still comes before the number')
  assert.match(tab, /\{String\(i \+ 1\)\.padStart\(2, '0'\)\}/)
  assert.match(session, /rb-tab-active/)
  assert.ok(!session.includes('rb-tab-done'), 'the finished mark is back on the tabs')
  assert.ok(!bookCss.includes("content: ' ✓'"), 'the check mark is back in the sheet')
  assert.match(session, /aria-label=\{`Section \$\{i \+ 1\}: \$\{s\.label\}`\}/)
})

test('INDEX 3: the index follows the page being read, and a click scrolls to it', () => {
  assert.match(session, /new IntersectionObserver/)
  assert.match(session, /setActiveStep\(visible\[0\]\.target\.id\)/)
  assert.match(session, /el\.scrollIntoView\(\{ behavior: 'smooth', block: 'start' \}\)/)
  // On one page, jumping to a section also turns to the page that holds it.
  assert.match(session, /if \(mode === 'single'\) setPage\('right'\)/)
  // The index NEVER scrolls (Owner, 2026-09-17): the seven tabs divide the fore edge
  // between them, and a label too long for its share ends in an ellipsis.
  assert.ok(!session.includes('scrollIntoView({ block'), 'the index scrolls again')
  assert.match(bookCss, /\.rb-tab \{[\s\S]*?flex-basis: 0;/)
  // A tab's share follows the length of its own word, so the long one is not given the
  // same room as "Goal" and then clipped.
  assert.match(session, /flexGrow: s\.label\.length \+ 5/)
  assert.match(bookCss, /\.rb-tab > span \{ min-height: 0; overflow: hidden; text-overflow: ellipsis; \}/)
  assert.ok(!/\.rb-index \{[^}]*overflow-y: auto/.test(bookCss), 'the index can scroll again')
  // Too short a window for seven words: the numbers carry it, and the aria-label still
  // says the section's name.
  assert.match(bookCss, /@media \(max-height: 899px\) \{\s*\n\s*\.rb-tab > span:not\(\.rb-tab-num\) \{ display: none; \}/)
})

// ── 4. The scale ────────────────────────────────────────────────────────────

test('SCALE 1: the five steps read Limited to Highly Aligned', () => {
  assert.match(session, /const SCORE_LABELS = \['', 'Limited', 'Developing', 'Adequate', 'Strong', 'Highly Aligned'\]/)
  // The guide explains the same five words, in the same order.
  const guide = session.slice(session.indexOf('const SCORE_GUIDE'), session.indexOf('const REC_OPTIONS'))
  for (const [n, label] of [[1, 'Limited'], [2, 'Developing'], [3, 'Adequate'], [4, 'Strong'], [5, 'Highly Aligned']]) {
    assert.match(guide, new RegExp(`s: ${n}, label: '${label}'`))
  }
})

test('SCALE 2: the stored value is the number, so thresholds and averages are untouched', () => {
  assert.match(session, /saveMeaningful\(sField, s\)/)
  assert.match(session, /if \(avg >= 12\)\s+return 'Recommend'/)
  assert.match(session, /below the Recommend threshold of 12\/15/)
  // No word from the scale is ever written to the row.
  assert.doesNotMatch(session, /cj_score: '(Limited|Developing|Adequate|Strong|Highly Aligned)'/)
})

test('SCALE 3: a rating is a radio group, so it is reachable and announced', () => {
  assert.match(session, /role="radiogroup" aria-label=\{`Rate \$\{title\}`\}/)
  assert.match(session, /role="radio" aria-checked=\{sel\} disabled=\{locked\}/)
})

// ── 5. The ribbon ───────────────────────────────────────────────────────────

test('RIBBON 1: a pull down flags, a pull up unflags, and both have a keyboard equal', () => {
  // Node cannot import .jsx, so the thresholds are read from the source they live in.
  const pullDown = Number(ribbon.match(/export const PULL_TO_FLAG = (\d+)/)?.[1])
  const pullUp   = Number(ribbon.match(/export const PULL_TO_UNFLAG = (\d+)/)?.[1])
  assert.ok(pullDown > 0 && pullUp > 0, 'the pull thresholds are gone')
  assert.match(ribbon, /if \(!flagged && dy >= PULL_TO_FLAG\) \{ onFlag\?\.\(\); return \}/)
  assert.match(ribbon, /if \(flagged && dy <= -PULL_TO_UNFLAG\) onUnflag\?\.\(\)/)
  assert.match(ribbon, /if \(e\.key === 'Enter' \|\| e\.key === ' '\)/)
  assert.match(ribbon, /if \(moved\.current < CLICK_SLOP\) \{ toggle\(\); return \}/)
  // It is a real button, with its state spoken.
  assert.match(ribbon, /<button/)
  assert.match(ribbon, /aria-pressed=\{flagged\}/)
})

test('RIBBON 2: a new flag carries NO note (Owner, 2026-09-17)', () => {
  const setFlag = session.slice(session.indexOf('const setFlag'), session.indexOf('const handleFlag'))
  assert.match(setFlag, /\? \{ flagged_for_second_interview: true \}/)
  // Setting a flag writes the flag ALONE; only removing one clears an older note.
  assert.match(setFlag, /: \{ flagged_for_second_interview: false, flag_note: '' \}/)
  assert.ok(!/true \}[^\n]*flag_note/.test(setFlag), 'a new flag writes a note again')
  // A note written before this change is still shown rather than quietly dropped.
  assert.match(session, /data-testid="flag-legacy-note">Earlier note/)
})

test('RIBBON 3: the page says what the ribbon does, in both states', () => {
  assert.match(session, /Flagged for the placement huddle\. The ASPIRE team sees this candidate first\./)
  assert.match(session, /Not flagged\. Pull the ribbon down to flag for the placement huddle\./)
})

// ── 6. Read-only is the same book ───────────────────────────────────────────

test('READ-ONLY 1: one book, with the pen put down', () => {
  assert.match(session, /data-rb-readonly=\{readOnly \? 'true' : 'false'\}/)
  // No toolbar, no ribbon, no actions; the index still navigates.
  assert.match(session, /\{!readOnly && \(\s*<div className="rb-toolbar">/)
  assert.match(session, /\{!readOnly && \(\s*<FlagRibbon/)
  assert.match(session, /\{!locked && \(\s*<>/)
  // Every field has a locked rendering.
  const readouts = session.match(/className="rb-readonly/g) || []
  assert.ok(readouts.length >= 8, `expected the locked renderings, found ${readouts.length}`)
  // A colleague's rubric opens in the same component, read-only.
  assert.match(session, /<RubricSession[\s\S]*?readOnly[\s\S]*?initialRubric=\{viewingRubric\}/)
})

// ── 7. What a redesign must not break ───────────────────────────────────────

test('KEPT 1: the 30-second auto-save, the browser draft and the session refresh survive', () => {
  assert.match(session, /\}, 30_000\)/)
  assert.match(session, /aspire\.rubric\.draft\.\$\{student\.id\}\.\$\{userId\}/)
  assert.match(session, /setInterval\(checkSession, 15 \* 60 \* 1000\)/)
  assert.match(session, /Draft restored/)
})

test('KEPT 2: Section 1 still moves the real booking, and reports a refusal', () => {
  assert.match(session, /moveInterviewBooking\(student\.id, \{ date: nextDate, time: nextTime \}\)/)
  // The explanatory sentence is gone; the refusal is not.
  assert.ok(!session.includes('Changing the date or time moves the booked interview'))
  assert.match(session, /<p className="rb-note-band rb-note-band-err">\{reschedError\}<\/p>/)
})

test('KEPT 3: one row per interviewer, created on the first meaningful edit', () => {
  assert.match(session, /const persist = async \(updates, createIfNeeded = false\)/)
  assert.match(session, /if \(!createIfNeeded \|\| !effectiveInterviewerName\) \{ setSaveStatus\('idle'\); return false \}/)
  assert.match(session, /Select your name in Section 1 to begin saving your rubric\./)
  assert.match(session, /validationErrors\.length > 0/)
})

test('KEPT 4: the questions still include the one you actually asked', () => {
  assert.match(session, /Other \/ custom question/)
  assert.match(session, /Type the custom question asked/)
  assert.match(session, /otherClicked\[key\] \|\| \(!!form\[qField\] && !questions\.includes\(form\[qField\]\)\)/)
})

// ── 8. Canon ────────────────────────────────────────────────────────────────

test('CANON 1: the book sheet writes no literal radius; every corner is a token', () => {
  const literals = bookCss.match(/border-radius:\s*[0-9.]+px/g) || []
  assert.deepEqual(literals, [], `literal radii in rubricBook.css: ${literals.join(', ')}`)
  assert.match(bookCss, /border-radius: var\(--aspire-radius-book\)/)
  assert.match(bookCss, /border-radius: var\(--aspire-radius-control\)/)
})

test('CANON 2: the old rubric layout is gone, not left behind as a second design', () => {
  for (const dead of [
    '.iv-section-title', '.iv-domain-card', '.iv-question-card', '.iv-score-tile',
    '.iv-composite-card', '.iv-rec-tiles', '.rub-panels', '.rub-left-section',
    '.rub-progress-bar', '.rub-script-card', '.rub-flag-btn',
  ]) {
    assert.ok(!indexCss.includes(dead + ' ') && !indexCss.includes(dead + ','),
      `${dead} still has rules in index.css`)
  }
  // The session wears none of the old LAYOUT classes. RubricCard, the small card for a
  // colleague's finished rubric, still shares .iv-input / .iv-readonly with the
  // Interviews worklist; those are form primitives, not this screen's layout.
  for (const dead of [
    'iv-section', 'iv-domain-card', 'iv-question-card', 'iv-score-tile', 'iv-composite-card',
    'iv-rec-tiles', 'iv-form-body', 'rub-left', 'rub-right', 'rub-panels', 'rub-progress-bar',
    'rub-script-card', 'rub-session',
  ]) {
    assert.ok(!session.includes(`"${dead}`) && !session.includes(`${dead} `),
      `the session still wears ${dead}`)
  }
})

test('CANON 3: the book is one stylesheet, imported by the component that uses it', () => {
  assert.match(session, /import '\.\/rubric\/rubricBook\.css'/)
  assert.match(bookCss, /@import '\.\.\/\.\.\/styles\/aspireMaterials\.css'/)
  assert.ok(!indexCss.includes('.rb-'), 'book rules leaked into the entry stylesheet')
})

test('HEAD 1: completion counts the same nine answers that gate Mark Complete', () => {
  assert.match(session, /const REQUIRED_ANSWERS = 9/)
  assert.match(session, /const completion = locked\s*\n\s*\? 100\s*\n\s*: Math\.round\(\(\(REQUIRED_ANSWERS - validationErrors\.length\) \/ REQUIRED_ANSWERS\) \* 100\)/)
  // The gate really does list nine, so the percentage cannot drift from it.
  const list = session.slice(session.indexOf('const validationErrors'), session.indexOf('].filter(Boolean) : []'))
  assert.equal((list.match(/&& '/g) || []).length, 9, 'the gate no longer asks for nine answers')
  // The candidate page keeps the status pill; only the head gave it up.
  assert.match(session, /<div className="rb-chiprow"><AspireStatusPill student=\{student\} \/><\/div>/)
})

test('BOOK 7: the book is a bound object: a heavy fold, square pages, a stack of sheets', () => {
  // The gutter is a band that darkens into one line, not a hairline.
  const seam = bookCss.slice(bookCss.indexOf('.rb-seam {'), bookCss.indexOf('.rb-clasp {'))
  assert.match(seam, /width: 28px/)
  assert.match(seam, /var\(--aspire-book-seam\)/)
  assert.ok((seam.match(/rgba\(20, 24, 36/g) || []).length >= 6, 'the fold lost its falloff')
  // Paper is square, like the Placement Board's notes, and nothing clips the spread
  // any more, so the ribbon can hang over the cover.
  assert.match(bookCss, /\.rb-spread \{[\s\S]*?border-radius: 0;/)
  assert.ok(!/\.rb-spread \{[^}]*overflow: hidden/.test(bookCss), 'the spread clips again')
  // The pages underneath (BOOK-FORE-1, Owner, 2026-09-19). A sewn book shows its pages
  // as FORE EDGES, a block of many edges on each side, and shows nothing at the bottom,
  // because an open book has no loose bottom edge. What this test is for is unchanged:
  // the book must SHOW the sheets it holds.
  assert.match(bookCss, /@import '\.\.\/\.\.\/styles\/pageStack\.css';/)
  assert.match(read('src/components/RubricSession.jsx'), /className="rb-cover material-leather-cognac-hide material-forestack"/)
  assert.match(bookCss, /\.rb-cover\.material-forestack \{[\s\S]*?--fore-w: var\(--rb-stack-w\);/)
  // Both fore edges, and NOTHING below: the cover's padding is two values, so the bottom
  // board is the same leather as the top and holds no overhang.
  const shared = read('src/styles/pageStack.css')
  assert.match(shared, /\.material-forestack::before \{[\s\S]*?left: calc\(var\(--stack-inset-l\) - var\(--fore-w\)\);/)
  assert.match(shared, /\.material-forestack::after \{[\s\S]*?right: calc\(var\(--stack-inset-r\) - var\(--fore-w\)\);/)
  // The page LAYS ON the block (Owner, 2026-09-19): at a 6px crop "it feels like the page
  // is not laying on top of the stack because it's too low on top and too high at the
  // bottom". A physical book's top sheet and the block under it are the same height; you
  // see the block because it is WIDER. One pixel, not six.
  const crop = shared.match(/--fore-crop: (\d+)px;/)
  assert.ok(crop && Number(crop[1]) <= 2, `the block sits ${crop?.[1]}px in from the page; it should lie under it`)
  // The cover is hide, not cork: a uniform fine speckle on a flat tone is what cork is.
  const materials = read('src/styles/aspireMaterials.css')
  const tan = materials.match(/\.material-leather-cognac-hide \{[\s\S]*?\n\}/)[0]
  assert.match(tan, /var\(--aspire-noise-hide\)/, 'the cover went back to dust')
  assert.ok(!tan.includes('--aspire-noise-fine'), 'the fine speckle is what read as cork')
  // Lit from one side: the same texture twice, offset, is what makes a relief out of a
  // pattern. One copy is not a grain, it is a stain.
  assert.equal((tan.match(/var\(--aspire-noise-hide\)/g) || []).length, 2)
  assert.match(tan, /background-position: -2px -2px, 2px 2px/)
  const brand = read('src/styles/aspireBrand.css')
  const hide = brand.match(/--aspire-noise-hide:[^\n]*/)[0]
  const freq = Number(hide.match(/baseFrequency='\.(\d+)'/)[1].padEnd(2, '0')) / 100
  assert.ok(freq > 0.1 && freq < 0.4, `a ${(1 / freq).toFixed(1)}px cell is dust or cloud, not a pebble`)
  assert.match(bookCss, /padding: var\(--rb-cover-pad\) var\(--rb-cover-pad-x\);/)
  assert.ok(!bookCss.includes('--rb-cover-pad-b'), 'the book grew a bottom edge again')
  assert.match(bookCss, /\.rb-spread \{[\s\S]*?z-index: 1;/)
  // The spine: tan leather with one dark band down the gutter, aligned to the SEAM
  // rather than to the middle of the cover, and reaching into the leather above and
  // below the pages, which is the only place it shows.
  assert.match(read('src/components/RubricSession.jsx'), /<i className="rb-spine" aria-hidden="true" \/>/)
  const spine = bookCss.match(/\.rb-spine \{[\s\S]*?\n\}/)[0]
  assert.match(spine, /grid-column: 1;/)
  assert.match(spine, /justify-self: end;/)
  assert.match(spine, /margin-top: calc\(-1 \* var\(--rb-cover-pad\)\);/)
  assert.match(spine, /margin-bottom: calc\(-1 \* var\(--rb-cover-pad\)\);/)
  assert.match(spine, /var\(--aspire-book-spine-crease\) 50%/)
  // One page has no gutter, so it has no fold.
  assert.match(bookCss, /\.rb-shell\[data-rb-mode='single'\] \.rb-spine \{ display: none; \}/)
  // The strip at the head turns into the gutter with the paper it is printed on.
  const head = bookCss.match(/\.rb-head \{[\s\S]*?\n\}/)[0]
  assert.match(head, /background-image: linear-gradient\(90deg,/)
  // The shading stops BEFORE the text starts, and is written from the same token as the
  // padding so the two cannot drift. Ink on this band is 6.43:1 and must never have to
  // be measured against the dark end of a gradient instead.
  assert.match(head, /padding: 9px var\(--rb-head-pad-x\);/)
  assert.match(head, /rgba\(20, 24, 36, 0\) calc\(var\(--rb-head-pad-x\) - 4px\)/)
  // The cover is a thin board, and it is leather rather than grain.
  assert.match(bookCss, /--rb-cover-pad: 14px/)
  assert.ok(!read('src/styles/aspireMaterials.css').slice(
    read('src/styles/aspireMaterials.css').indexOf('.material-leather-cognac-hide'),
    read('src/styles/aspireMaterials.css').indexOf('.paper-note')).includes('--aspire-noise-grain'),
    'the cover is wearing the coarse grain again')
})

test('RIBBON 4: pulled, the ribbon hangs lower and the word travels with it', () => {
  const idle = bookCss.match(/\.rb-ribbon \{[\s\S]*?padding: (\d+)px 0 (\d+)px/)
  const flagged = bookCss.match(/\.rb-ribbon-on,\n\.rb-ribbon-on:hover \{[\s\S]*?padding: (\d+)px 0 (\d+)px/)
  assert.ok(idle && flagged, 'the ribbon lost its two states')
  const idleLen = Number(idle[1]) + Number(idle[2])
  const flaggedLen = Number(flagged[1]) + Number(flagged[2])
  assert.ok(flaggedLen > idleLen * 2, `flagged ${flaggedLen}px should hang well below the idle ${idleLen}px`)
  // The label travels with it rather than staying pinned to the top.
  assert.ok(Number(flagged[1]) > Number(idle[1]), 'the word did not move down with the ribbon')
})

test('RIBBON 5: it hangs from the BOOK, so scrolling the page never carries it away', () => {
  // It is a sibling of the pages, not a child of the one that scrolls.
  const spread = session.slice(session.indexOf('<div className="rb-spread">'), session.indexOf('aria-label="Candidate"'))
  assert.match(spread, /<FlagRibbon/)
  assert.match(bookCss, /\.rb-ribbon \{[\s\S]*?grid-column: 1;/)
  assert.match(bookCss, /\.rb-ribbon \{[\s\S]*?justify-self: end;/)
  // And it overhangs the cover the way a sewn bookmark does.
  assert.match(bookCss, /margin-top: calc\(-1 \* var\(--rb-cover-pad\)\)/)
})

test('GUIDE 1: the scoring guide opens from the head, reachable at any scroll position', () => {
  const head = session.slice(session.indexOf('data-testid="rb-head"'), session.indexOf('className="rb-scroll"'))
  assert.match(head, /data-testid="rb-guide-toggle"/)
  assert.match(head, /Scoring Guide/)
  // The panel is a sibling of the scroller, so scrolling the page cannot hide it.
  assert.ok(session.indexOf('rb-guide-drawer') < session.indexOf('className="rb-scroll"'))
  assert.match(bookCss, /\.rb-guide-drawer \{[\s\S]*?flex-shrink: 0;/)
  // The five steps are the ones the scale uses.
  assert.match(session, /\{SCORE_GUIDE\.map\(row =>/)
})

test('ORDER 1: Section 1 comes first, and the opening script no longer repeats Section 2', () => {
  const scroll = session.slice(session.indexOf('className="rb-scroll"'))
  assert.ok(scroll.indexOf('Section 1: Interview Info') < scroll.indexOf('Interview Opening Script'),
    'the script still stands between the reader and the first field')
  assert.ok(scroll.indexOf('Interview Opening Script') < scroll.indexOf('Section 2: Unit Preferences'))
  assert.ok(!session.includes('can you share your top three unit choices and tell me'),
    'the script asks for the top three again')
  // Section 2 still asks it, which is why the script does not.
  assert.match(session, /Section 2: Unit Preferences and Rationale[\s\S]*?can you share your top three unit choices and why/)
})

test('SCROLLBAR 1: a page\'s scrollbar is the fold\'s grey, not a black bar on paper', () => {
  assert.match(bookCss, /scrollbar-color: rgba\(24, 32, 63, 0\.18\) transparent/)
  assert.match(bookCss, /::-webkit-scrollbar-thumb \{\s*\n\s*background: rgba\(24, 32, 63, 0\.18\)/)
})

test('SCRIPT 1: the closing script says only what the page does not', () => {
  const closing = session.slice(session.indexOf('Closing the interview'), session.indexOf('{!locked && ('))
  // Section 6 already asks the closing question and takes the notes.
  assert.ok(!closing.includes('what questions do you have for us'), 'the closing question is repeated')
  assert.ok(!closing.includes('Take notes'), 'the note-taking instruction is back')
  assert.ok(!closing.includes('résumé'), 'the resume paragraph is back')
  assert.ok(!closing.includes('Matching can take some time'), 'the patience line is back')
  assert.match(closing, /You will hear from us either way/)
  // Section 6 is where that question lives, and it still does.
  assert.match(session, /Section 6: Student Questions[\s\S]*?what questions do you have for us/)
})

test('CANON 4: the book does not follow the theme, controls included', () => {
  // The materials are theme-independent by canon. The app's dark rules are element
  // selectors, so the book names its own controls to out-rank them; without this a
  // white page fills with black fields in dark mode.
  assert.match(bookCss, /\[data-theme='dark'\] \.rb-shell \.rb-input/)
  assert.match(bookCss, /\[data-theme='dark'\] \.rb-shell \.rb-textarea/)
  assert.match(bookCss, /\[data-theme='dark'\] \.rb-shell \.rb-choice/)
  assert.match(indexCss, /\[data-theme="dark"\] select,/)   // the rule being out-ranked
})

// ── 9. The Owner's refinements, 2026-09-17 ──────────────────────────────────

test('HEAD 2: completion left, the guide centred, the composite right, on ONE line', () => {
  const head = session.slice(session.indexOf('data-testid="rb-head"'), session.indexOf('</header>'))
  assert.ok(head.indexOf('rb-completion') < head.indexOf('rb-guide-toggle'), 'completion is not first')
  assert.ok(head.indexOf('rb-guide-toggle') < head.indexOf('rb-head-score'), 'the guide is not in the middle')
  // One row, and a padding that keeps it to one line.
  assert.match(bookCss, /\.rb-head-score \{ flex: 1 1 0; display: flex; align-items: baseline; justify-content: flex-end;/)
  // The gutter's shading is written from the same token as the padding (BOOK-FORE-1),
  // so that the strip can turn into the fold without the text ever landing on the
  // dark end of it.
  assert.match(bookCss, /\.rb-head \{[\s\S]*?--rb-head-pad-x: 34px;/)
  assert.match(bookCss, /\.rb-head \{[\s\S]*?padding: 9px var\(--rb-head-pad-x\);/)
  assert.ok(!bookCss.includes('.rb-head-line'), 'the head is stacking again')
})

test('HEAD 3: the right page is ruled like the left one', () => {
  assert.match(bookCss, /\.rb-section \{[\s\S]*?border-top: 1px solid var\(--aspire-page-rule\);/)
  assert.match(bookCss, /\.rb-scroll > \.rb-section:first-of-type \{ padding-top: 0; border-top: 0; \}/)
})

test('AVAILABILITY 1: the form answers appear when there are any, as structural facts', () => {
  assert.match(session, /getAvailabilityReadiness\(\{ student \}\)/)
  assert.match(session, /const availabilityAnswered = student\.availability_ack != null/)
  assert.match(session, /availability && \(/)
  // AVAILABILITY-CANON-1B: the facts are the shared helper's, which are structural only.
  const avail = read('src/lib/availability.js')
  assert.match(avail, /PRIVACY-SAFE structural facts only/)
  // Owner, 2026-09-17: no readiness pill and no acknowledgement line. In the room, what
  // matters is which days the student can work; the rest is the Placement Board's.
  assert.ok(!session.includes('availability-level'), 'the readiness pill is back')
  assert.match(session, /facts\.filter\(f => !f\.startsWith\('Acknowledged'\)\)/)
  assert.ok(!bookCss.includes('rb-chip-avail-'), 'the pill styles are back')
})

test('GPA 1: the chip is banded, and below the 3.0 floor it reads red', () => {
  const { gpaBand, GPA_BAND_COLORS, GPA_FLOOR } = constants
  assert.equal(GPA_FLOOR, 3.0)
  assert.equal(gpaBand(3.9), 'strong')
  assert.equal(gpaBand(3.5), 'strong')
  assert.equal(gpaBand(3.2), 'watch')
  assert.equal(gpaBand(3.0), 'watch')
  assert.equal(gpaBand(2.88), 'below')      // Wynter Brown, Winter 2027
  assert.equal(gpaBand(0), null)
  assert.equal(gpaBand(null), null)
  assert.equal(gpaBand('not a number'), null)
  assert.equal(GPA_BAND_COLORS.below.color, '#991b1b')
  // One rule, used by the book and by the roster list.
  assert.match(session, /rb-chip-gpa-\$\{gpaBand\(student\.cumulative_gpa\)\}/)
  assert.match(read('src/components/StudentListPanel.jsx'), /GPA_BAND_COLORS\[gpaBand\(s\.cumulative_gpa\)\]/)
})

test('SCROLL 1: the rubric page has no scrollbar; the index is the position', () => {
  assert.match(bookCss, /\.rb-scroll \{ scrollbar-width: none; \}/)
  assert.match(bookCss, /\.rb-scroll::-webkit-scrollbar \{ display: none; \}/)
  // The candidate page keeps its quiet one.
  assert.match(bookCss, /\.rb-page \{\s*\n\s*scrollbar-width: thin;/)
})

test('RULE 1: a section rule spans the page, as the left page\'s rules do', () => {
  assert.match(bookCss, /\.rb-section \{\s*\n\s*margin: 0 -34px 30px;\s*\n\s*padding: 22px 34px 0;/)
})

test('FLAG 3: the rubric refreshes through onRefreshStudents, never the writer', () => {
  // onStudentUpdate is updateStudent(id, updates): called with no arguments it returns
  // immediately, which is why the ribbon used to spring back until a page reload.
  const setFlag = session.slice(session.indexOf('const setFlag'), session.indexOf('const handleFlag'))
  assert.match(setFlag, /if \(onRefreshStudents\) await onRefreshStudents\(\)/)
  assert.ok(!/await onStudentUpdate\(/.test(setFlag), 'the flag calls the writer again')
  // The reschedule path had the same no-op call, and is fixed with it.
  const resched = session.slice(session.indexOf('const reschedule ='), session.indexOf('const handleReset'))
  assert.match(resched, /if \(onRefreshStudents\) await onRefreshStudents\(\)/)
  // And the tab hands down a real refetch, awaited.
  assert.match(read('src/components/InterviewRubricTab.jsx'),
    /onRefreshStudents=\{async \(\) => \{ await onRefreshStudents\?\.\(\) \}\}/)
})

test('FLAG 2: a flagged row wears the ribbon\'s red, not amber', () => {
  const list = read('src/components/InterviewRubricTab.jsx')
  assert.match(list, /var\(--aspire-red-editorial, #B3282D\)/)
  assert.ok(!list.includes("'#F59E0B'"), 'the flag strip is amber again')
})

test('SCRIPT 2: the closing script sits between the last question and the decision', () => {
  const scroll = session.slice(session.indexOf('className="rb-scroll"'))
  const s6 = scroll.indexOf('Section 6: Student Questions')
  const closing = scroll.indexOf('Interview Closing Script')
  const s7 = scroll.indexOf('Section 7: Your Recommendation')
  assert.ok(s6 < closing && closing < s7, 'the closing script is not between Sections 6 and 7')
})

test('FLAG 1: the record is the truth, and a refused write is reported', () => {
  // The screen no longer keeps its own copy of the flag: it reads the student row, so
  // leaving the rubric and coming back cannot show a flag that was saved as gone.
  assert.match(session, /const isFlagged = flagPending \?\? !!student\.flagged_for_second_interview/)
  assert.ok(!session.includes('setIsFlagged('), 'the flag keeps a second copy again')
  // The write refreshes the roster, which is where the flag is read.
  const setFlag = session.slice(session.indexOf('const setFlag'), session.indexOf('const handleFlag'))
  assert.match(setFlag, /if \(onRefreshStudents\) await onRefreshStudents\(\)/)
  assert.match(setFlag, /catch \(e\)/)
  assert.match(setFlag, /toast\?\.error\(/)
  assert.match(setFlag, /finally \{\s*\n\s*setFlagPending\(null\)/)
})

test('RESUME 1: the button says what it will actually do', () => {
  const fileUtils = read('src/lib/fileUtils.js')
  assert.match(fileUtils, /export function resumeActionLabel/)
  assert.match(session, /\{resumeActionLabel\(student\.resume_url\)\}/)
})

test('QUIET 1: no Refresh control, and the schedule band speaks only on a refusal', () => {
  // Opening the rubric IS the refresh, so the button that repeated it is gone.
  assert.ok(!session.includes('loadUnitAvailability'), 'the Refresh control is back')
  assert.ok(!session.includes('Changing the date or time moves the booked interview'),
    'the reschedule notice is back')
})
