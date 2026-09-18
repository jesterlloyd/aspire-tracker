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
  bookMetrics, PAGE_WIDTH, SPREAD_WIDTH, SPREAD_FLOOR, LEGIBLE_SCALE, MIN_PAGE, MIN_BOOK_H, CHROME,
} from '../src/components/rubric/useBookScale.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(root, p), 'utf8')

const session = read('src/components/RubricSession.jsx')
const bookCss = read('src/components/rubric/rubricBook.css')
const ribbon  = read('src/components/rubric/FlagRibbon.jsx')
const indexCss = read('src/index.css')
const BODY_PX = 14   // .rb-choice, the page's body size

// ── 1. One layout, scaled, with two floors ──────────────────────────────────

test('BOOK 1: a wide window gets the spread at its natural size', () => {
  const m = bookMetrics(1600, 1000)
  assert.equal(m.mode, 'spread')
  assert.equal(m.scale, 1)
  assert.equal(m.pageWidth, PAGE_WIDTH)
})

test('BOOK 2: the spread scales down rather than reflowing, until it stops being readable', () => {
  const mid = bookMetrics(1300, 1000)
  assert.equal(mid.mode, 'spread')
  assert.ok(mid.scale < 1 && mid.scale > SPREAD_FLOOR, `expected a scaled spread, got ${mid.scale}`)
  // The floor is where the spread turns into one page, and it is a floor on LEGIBILITY.
  const atFloor = bookMetrics(Math.round(SPREAD_WIDTH * SPREAD_FLOOR) + 2, 1000)
  assert.equal(atFloor.mode, 'spread')
  const belowFloor = bookMetrics(Math.round(SPREAD_WIDTH * SPREAD_FLOOR) - 20, 1000)
  assert.equal(belowFloor.mode, 'single')
})

test('BOOK 3: one page never renders body text below 12px, from a tablet down to a phone', () => {
  for (const width of [1000, 900, 820, 768, 600, 430, 390]) {
    const m = bookMetrics(width, 900)
    assert.equal(m.mode, 'single', `${width} should be a single page`)
    const rendered = BODY_PX * m.scale
    assert.ok(rendered >= 11.9, `at ${width}px the body text renders at ${rendered.toFixed(1)}px`)
  }
})

test('BOOK 4: the page fits the window it is given, and never scrolls sideways', () => {
  for (const width of [1600, 1200, 1000, 768, 430, 390, 320]) {
    const m = bookMetrics(width, 900)
    const natural = (m.mode === 'spread' ? SPREAD_WIDTH : m.pageWidth + CHROME)
    assert.ok(natural * m.scale <= width + 1, `${width}px: the book renders ${Math.round(natural * m.scale)}px wide`)
    assert.ok(m.pageWidth >= MIN_PAGE, `${width}px: page shrank to ${m.pageWidth}`)
    assert.ok(m.pageWidth <= PAGE_WIDTH, `${width}px: page grew past its design width`)
  }
})

test('BOOK 5: the book fills the height it is given, and a short window gets a minimum', () => {
  const tall = bookMetrics(1600, 1200)
  assert.equal(tall.bookHeight, 1200)            // scale 1, so the book IS the stage
  const scaled = bookMetrics(1300, 900)
  assert.equal(scaled.bookHeight, Math.round(900 / scaled.scale))
  assert.equal(bookMetrics(1600, 200).bookHeight, MIN_BOOK_H)
})

test('BOOK 6: a missing measurement never produces a broken book', () => {
  for (const m of [bookMetrics(0, 0), bookMetrics(undefined, undefined), bookMetrics(NaN, NaN)]) {
    assert.ok(m.scale > 0 && m.scale <= 1)
    assert.ok(m.pageWidth >= MIN_PAGE)
    assert.ok(m.bookHeight >= MIN_BOOK_H)
  }
})

// ── 2. The spread ───────────────────────────────────────────────────────────

test('SPREAD 1: a cover, two pages, a seam and an index, in that order', () => {
  const order = ['rb-cover material-leather-tan', 'rb-page rb-page-left', 'rb-seam', 'rb-page rb-page-right', 'rb-index']
  let at = -1
  for (const cls of order) {
    const next = session.indexOf(cls)
    assert.ok(next > at, `${cls} is missing or out of order`)
    at = next
  }
  // The cover is a material, and the material is defined once, with the others.
  assert.match(read('src/styles/aspireMaterials.css'), /\.material-leather-tan\s*\{/)
  assert.match(read('src/styles/aspireBrand.css'), /--aspire-leather-tan:/)
})

test('SPREAD 2: the candidate is on the LEFT and the rubric on the RIGHT, as on the Placement Board', () => {
  assert.ok(session.indexOf('aria-label="Candidate"') < session.indexOf('aria-label="Rubric"'))
  assert.match(bookCss, /grid-template-columns: var\(--rb-left-w\) var\(--rb-right-w\) var\(--rb-rail-w\)/)
})

test('SPREAD 3: the left page carries the facts an interviewer reads while listening', () => {
  for (const fact of [
    'Scheduled Interview', 'Submitted Preferences', 'Current role',
    '1st: {d1} · 2nd: {d2} · 3rd: {d3}',
    'This unit is full. Consider exploring alternatives during the interview.',
    'GPA {parseFloat(student.cumulative_gpa).toFixed(2)}', 'View resume',
  ]) {
    assert.ok(session.includes(fact), `the left page lost: ${fact}`)
  }
  // WAVE F-2 is unchanged: the resume is still gated on the cohort entitlement.
  assert.match(session, /canViewStudentResumeInCohort\(cohortId\) && student\.resume_url/)
  assert.match(session, /openStudentFile\(\{ studentId: student\.id, kind: 'resume' \}\)/)
})

test('SPREAD 4: the head states completion, the recommendation and the live composite', () => {
  const head = session.slice(session.indexOf('className="rb-head"'), session.indexOf('className="rb-scroll"'))
  // The ASPIRE status is on the candidate page and is NOT repeated here.
  assert.ok(!head.includes('AspireStatusPill'), 'the status pill is back in the head')
  assert.match(head, /Completion/)
  assert.match(head, /data-testid="rb-completion">\{completion\}%/)
  assert.match(head, /Recommendation/)
  assert.match(head, /data-testid="rb-composite">\{composite\}/)
  assert.match(head, /\/ 15/)
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
  // A short book makes the index scroll, so the tab you are on is kept in view.
  assert.match(session, /tab\?\.scrollIntoView\(\{ block: 'nearest' \}\)/)
  assert.match(bookCss, /justify-content: safe center/)
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
  const handler = session.slice(session.indexOf('const handleFlag'), session.indexOf('const handleUnflag'))
  assert.match(handler, /flagged_for_second_interview: true \}\)/)
  assert.doesNotMatch(handler, /flag_note/)
  // Removing a flag still clears whatever note the record carried.
  const unflag = session.slice(session.indexOf('const handleUnflag'), session.indexOf('const handleRubricEdit'))
  assert.match(unflag, /flagged_for_second_interview: false, flag_note: ''/)
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
  assert.match(session, /Changing the date or time moves the booked interview/)
  assert.match(session, /\{reschedError \|\|/)
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
  // Paper is square, like the Placement Board's notes.
  assert.match(bookCss, /border-radius: 0;\n  overflow: hidden;/)
  // The pages underneath show at both fore edges.
  assert.match(bookCss, /\.rb-cover::before,\n\.rb-cover::after/)
  assert.match(bookCss, /repeating-linear-gradient\(90deg, #FFFFFF 0 1\.5px/)
  // The cover is a thin board, and it is leather rather than grain.
  assert.match(bookCss, /--rb-cover-pad: 14px/)
  assert.ok(!read('src/styles/aspireMaterials.css').slice(
    read('src/styles/aspireMaterials.css').indexOf('.material-leather-tan'),
    read('src/styles/aspireMaterials.css').indexOf('.paper-note')).includes('--aspire-noise-grain'),
    'the cover is wearing the coarse grain again')
})

test('RIBBON 4: pulled, the ribbon hangs further down the page than it rests', () => {
  const idle = Number(bookCss.match(/\.rb-ribbon \{[\s\S]*?padding: 10px 0 (\d+)px/)?.[1])
  const flagged = Number(bookCss.match(/\.rb-ribbon-on,\n\.rb-ribbon-on:hover \{[\s\S]*?padding-bottom: (\d+)px/)?.[1])
  assert.ok(flagged > idle * 2, `flagged ${flagged}px should hang well below the idle ${idle}px`)
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
