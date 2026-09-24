// PLACEMENT-BOARD-FELT-1 (2026-09-17): Rotation > Placement Board as felt, cream
// leather, flat nightfall headers and paper. Functional proofs for the Undo window, the 3rd-choice rank, and the
// board's ordering and grouping; source proofs for the layout, the materials, the
// accessibility contract, and the boundaries that must not move (NGRP's classes,
// no invented AI recommendation, one write path).
// Run: node --test test/placementBoardFelt.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createPendingUnmatch, UNDO_WINDOW_MS } from '../src/lib/pendingUnmatch.js'
import { matchQualityFor, matchRankOf, derivePrefCounts } from '../src/lib/placementDisplay.js'
import {
  preferenceRankOf, orderUnitsForStudent, groupPoolForUnit, orderPool, pinFor, matchPhrase,
} from '../src/lib/placementBoardView.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(root, p), 'utf8')
const strip = (src) => src.replace(/^\s*\/\/[^\n]*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')

// ── A controllable clock for the Undo window ────────────────────────────────
function fakeTimers() {
  let next = 1
  const timers = new Map()
  return {
    setTimer: (fn, ms) => { const id = next++; timers.set(id, { fn, ms }); return id },
    clearTimer: (id) => { timers.delete(id) },
    fireAll: () => { const all = [...timers.values()]; timers.clear(); all.forEach(t => t.fn()) },
    pending: () => [...timers.values()],
  }
}

const tick = () => new Promise(resolve => setImmediate(resolve))

// ── 1. The Undo window ──────────────────────────────────────────────────────

test('UNDO 1: nothing is written while the window is open, and Undo writes nothing', async () => {
  const clock = fakeTimers()
  const states = []
  let commits = 0
  const held = createPendingUnmatch({ ...clock, onChange: s => states.push(s) })
  held.hold({ matchId: 'm1', studentId: 's1' }, async () => { commits++ })
  assert.equal(clock.pending()[0].ms, UNDO_WINDOW_MS)
  // Ten, not six: this window is the board's only safeguard now that the
  // confirmation dialog is gone (Owner, 2026-09-17).
  assert.equal(UNDO_WINDOW_MS, 10000, 'the Owner-approved window is 10 seconds')
  assert.equal(commits, 0)
  assert.equal(held.current().phase, 'waiting')
  assert.equal(held.undo(), true)
  assert.equal(held.current(), null)
  assert.equal(clock.pending().length, 0, 'the timer is cancelled')
  await tick()
  assert.equal(commits, 0, 'Undo is a zero-write operation')
  assert.equal(states.at(-1), null)
})

test('UNDO 2: when the window closes the captured unmatch runs exactly once', async () => {
  const clock = fakeTimers()
  let commits = 0
  const held = createPendingUnmatch({ ...clock })
  held.hold({ matchId: 'm1' }, async () => { commits++ })
  clock.fireAll()
  assert.equal(held.current().phase, 'committing')
  assert.equal(held.undo(), false, 'Undo is too late once the write has started')
  await held.flush()
  await tick()
  assert.equal(commits, 1)
  assert.equal(held.current(), null)
})

test('UNDO 3: flush commits early, is idempotent, and resolves true only when it wrote', async () => {
  const clock = fakeTimers()
  let commits = 0
  const held = createPendingUnmatch({ ...clock })
  assert.equal(await held.flush(), false, 'nothing held, nothing written')
  held.hold({ matchId: 'm1' }, async () => { commits++ })
  const [a, b] = await Promise.all([held.flush(), held.flush()])
  assert.equal(a, true)
  assert.equal(b, true)
  assert.equal(commits, 1, 'two flushes, one write')
  assert.equal(clock.pending().length, 0)
})

test('UNDO 4: one hold at a time, and a failed write still ends the hold', async () => {
  const clock = fakeTimers()
  const held = createPendingUnmatch({ ...clock })
  held.hold({ matchId: 'm1' }, async () => { throw new Error('network') })
  assert.throws(() => held.hold({ matchId: 'm2' }, async () => {}), /already held/)
  await held.flush()
  assert.equal(held.current(), null, 'the board falls back to whatever the data says')
})

// ── 2. The 3rd-choice rank ──────────────────────────────────────────────────

test('RANK 1: the stored value is decided once, from the preferences at placement', () => {
  const s = { unit_preference_1: '6 NE', unit_preference_2: '3 South', unit_preference_3: '5 SCCT' }
  assert.equal(matchQualityFor(s, '6 NE'), 'top_choice')
  assert.equal(matchQualityFor(s, '3 South'), 'second_choice')
  assert.equal(matchQualityFor(s, '5 SCCT'), 'third_choice')
  assert.equal(matchQualityFor(s, '4 North'), 'other')
  assert.equal(matchQualityFor({}, ''), 'other', 'no unit name never matches an empty preference')
})

test('RANK 2: displays read the stored rank; legacy other stays other', () => {
  assert.equal(matchRankOf({}, { match_quality: 'third_choice' }), 'third')
  assert.equal(matchRankOf({}, { match_quality: 'other' }), 'other')
  const counts = derivePrefCounts(
    [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
    [{ student_id: 'a', match_quality: 'third_choice' }, { student_id: 'b', match_quality: 'other' }, { student_id: 'c' }],
  )
  assert.deepEqual(counts, { top: 0, second: 0, third: 1, other: 1, notRecorded: 1 })
  assert.deepEqual(pinFor({}, { match_quality: 'third_choice' }), { glyph: '3', tone: 'third', spoken: '3rd choice' })
  assert.equal(pinFor({}, {}).spoken, 'match rank not recorded', 'absent data says so')
  assert.equal(matchPhrase('third_choice'), '3rd choice match')
  assert.equal(matchPhrase('other'), 'not one of their top 3')
})

test('RANK 3: createMatch stores through the shared rule; every reader knows third_choice', () => {
  const app = read('src/staff/StaffApp.jsx')
  const fn = strip(app.slice(app.indexOf('const createMatch = async'), app.indexOf('const unmatch = async')))
  assert.match(fn, /const match_quality = matchQualityFor\(student, unit\.unit_name\)/)
  assert.ok(!/'other'/.test(fn), 'no second copy of the rank rule in the handler')
  assert.match(read('src/components/StudentListPanel.jsx'), /'third_choice'\s+\?\s+'3rd choice'/)
})

// ── 3. Ordering and grouping ────────────────────────────────────────────────

const UNITS = ['4 North', '5 SCCT', '6 NE', '3 South'].map((unit_name, i) => ({ id: `u${i}`, unit_name }))
const MAYA = { id: 'maya', unit_preference_1: '6 NE', unit_preference_2: '3 South', unit_preference_3: '5 SCCT' }

test('ORDER 1: a selected student brings their 1st, 2nd and 3rd choice boards to the top, in rank order', () => {
  const { ordered, highlights } = orderUnitsForStudent(UNITS, MAYA)
  assert.deepEqual(ordered.map(u => u.unit_name), ['6 NE', '3 South', '5 SCCT', '4 North'])
  assert.deepEqual([...highlights.entries()], [['u2', 1], ['u3', 2], ['u1', 3]])
  const none = orderUnitsForStudent(UNITS, null)
  assert.equal(none.ordered, UNITS, 'no selection restores the original order')
  assert.equal(none.highlights.size, 0)
})

test('ORDER 2: a choice filtered out of the view is absent, never added back', () => {
  const { ordered, highlights } = orderUnitsForStudent(UNITS.filter(u => u.unit_name !== '3 South'), MAYA)
  assert.deepEqual(ordered.map(u => u.unit_name), ['6 NE', '5 SCCT', '4 North'])
  assert.equal(highlights.get('u1'), 3, 'the 3rd choice keeps its own rank')
})

test('GROUP 1: a selected unit regroups the pool and keeps the pool order inside each group', () => {
  const pool = [
    { id: 'a', unit_preference_2: '4 North' },
    { id: 'b', unit_preference_1: '4 North' },
    { id: 'c' },
    { id: 'd', unit_preference_3: '4 North' },
    { id: 'e', unit_preference_1: '4 North' },
  ]
  const groups = groupPoolForUnit(pool, { unit_name: '4 North' })
  assert.deepEqual(groups.map(g => [g.key, g.label, g.students.map(s => s.id), g.dimmed]), [
    ['first', 'Picked 4 North as 1st choice', ['b', 'e'], false],
    ['lower', 'Picked as 2nd or 3rd choice', ['a', 'd'], false],
    ['rest', 'All other students', ['c'], true],
  ])
  assert.deepEqual(groupPoolForUnit([{ id: 'c' }], { unit_name: '4 North' }).map(g => g.key), ['rest'],
    'empty groups are dropped')
  assert.equal(preferenceRankOf({ unit_preference_2: 'X' }, 'X'), 2)
})

test('GROUP 2: no AI recommendation is invented anywhere on the board', () => {
  const view = read('src/lib/placementBoardView.js')
  assert.match(view, /ASPIRE stores no AI placement\s+\*\s+recommendation/)
  for (const f of ['src/components/MatchingTab.jsx', 'src/components/EmbedUnitCard.jsx',
    'src/components/StudentMatchingCard.jsx', 'src/lib/placementBoardView.js']) {
    const code = strip(read(f))
    assert.ok(!/AI recommended|ai_recommend/i.test(code), `${f} shows no AI recommendation`)
  }
})

// ── 4. Layout and materials (source) ────────────────────────────────────────

const TAB = () => strip(read('src/components/MatchingTab.jsx'))
const CARD = () => strip(read('src/components/EmbedUnitCard.jsx'))
const CSS = () => read('src/components/placement/placementBoard.css')

test('LAYOUT 1: Students on the left (about 40%), Units on the right (about 60%), stacked below 900px', () => {
  const tab = TAB()
  const board = tab.slice(tab.indexOf('className={`pb-board'))
  // INTERVIEW-BOARD-1 (Owner, 2026-09-17): "Pool" left every matching board's
  // vocabulary. A column is named for what it holds.
  assert.ok(!tab.includes('Student Pool') && !tab.includes('Unit Pool'))
  assert.ok(board.indexOf('aria-label="Students"') > -1)
  assert.ok(board.indexOf('aria-label="Students"') < board.indexOf('aria-label="Units"'),
    'the students come first in the grid')
  const css = CSS()
  assert.match(css, /\.pb-board \{[^}]*grid-template-columns: minmax\(0, 2fr\) minmax\(0, 3fr\);/)
  assert.match(css, /@media \(max-width: 900px\) \{[\s\S]*?\.pb-board \{ grid-template-columns: minmax\(0, 1fr\);/)
  assert.match(css, /minmax\(max\(270px, calc\(\(100% - var\(--aspire-gap-card\)\) \/ 2\)\), 1fr\)/,
    'boards are at least 270px, two across on desktop')
})

test('LAYOUT 2: Placement at a Glance has no title row and is the shared snapshot card', () => {
  const tab = TAB()
  const overview = tab.slice(tab.indexOf('function PlacementOverview'), tab.indexOf('export const getInterviewStatus'))
  assert.match(overview, /<section className="snap pb-glance" aria-label="Placement at a Glance">/)
  assert.match(overview, /<div className="glance-kpis snap-kpis">/)
  assert.ok(!/ov-panel-title/.test(overview), 'no visible title')
  assert.equal((overview.match(/<KPICell\b/g) || []).length, 5)
})

test('LAYOUT 2B: the picker stays visible while the KPI band scrolls away and the board fills the viewport', () => {
  const css = CSS()
  const rotation = read('src/components/RotationTab.jsx')
  assert.match(rotation, /className="rotation-view-picker"/)
  assert.match(rotation, /className="rotation-matrix-view"/)
  assert.match(css, /\.rotation-workspace \{[\s\S]*?height: calc\(100vh - 124px\);/)
  assert.match(css, /\.rotation-matrix-view \{[\s\S]*?overflow-y: auto;/)
  assert.match(css, /\.pb-board \{[\s\S]*?min-height: calc\(100vh - 180px\);/)
})

test('LAYOUT 3: both matching boards wear the SAME classes (INTERVIEW-BOARD-1)', () => {
  // This was the opposite assertion until 2026-09-17: the NGRP board kept the old
  // embed-* system while this one moved on. The Owner's rule is that every matching
  // board in the app is the same board, so the Interview Board now shares pb-*, the
  // materials, and the drag hook - and neither board wears embed-* any more.
  const tab = TAB()
  const interview = read('src/components/ngrp/InterviewBoard.jsx')
  for (const src of [tab, interview]) {
    assert.ok(!/className="embed-(units|students)-panel|embed-unit-grid|embed-student-grid|embed-light-hdr|euc-card/.test(src))
  }
  assert.ok(!/\.embed-|\.euc-/.test(CSS()), 'the board stylesheet restyles no embed-* or euc-* class')
  for (const cls of ['pb-board', 'pb-pool', 'pb-unit', 'pb-note', 'material-board', 'material-navy-flat', 'paper-note']) {
    assert.ok(interview.includes(cls), `the Interview Board uses ${cls}`)
  }
  assert.match(interview, /import \{ useBoardDrag \} from '\.\.\/placement\/useBoardDrag'/)
})

test('MATERIAL 1: tokens live in aspireBrand.css; classes read them; no literal radius', () => {
  const brand = read('src/styles/aspireBrand.css')
  for (const t of ['--aspire-board:', '--aspire-board-deep:', '--aspire-on-navy:',
    '--aspire-leather-cream:', '--aspire-piping:', '--aspire-noise-fine:', '--aspire-noise-grain:',
    '--aspire-radius-pill:']) {
    assert.ok(brand.includes(t), `${t} is a brand token`)
  }
  const materials = read('src/styles/aspireMaterials.css')
  for (const c of ['.material-board', '.material-board-head', '.material-navy-flat', '.material-leather-cream', '.paper-note', '.material-pin', '.material-ribbon']) {
    assert.ok(materials.includes(`${c} {`), `${c} exists`)
  }
  for (const [name, css] of [['aspireMaterials.css', materials], ['placementBoard.css', CSS()]]) {
    assert.ok(!/border-radius:\s*[0-9.]+px/.test(css), `${name} writes no literal px radius`)
  }
  // Owner, 2026-09-17: paper has SHARP corners, and it is the only square surface.
  assert.match(materials, /\.paper-note \{[^}]*border: 0;[^}]*border-radius: 0;/)
  assert.match(CSS(), /\.pb-unit \{[^}]*border-radius: var\(--aspire-radius-card\);/, 'boards stay rounded')
  // The dashed stitching retired: the gold piping is the header's only edge.
  assert.ok(!materials.includes('::after'), 'no stitching rule remains')
  assert.ok(!materials.includes('--aspire-stitch'), 'and its token went with it')
  assert.match(materials, /\.material-navy-flat::before \{[^}]*var\(--aspire-piping\)/)
  // Owner, 2026-09-17: the header is FLAT nightfall with white ink, not textured leather.
  assert.match(materials, /\.material-navy-flat \{[^}]*background: var\(--aspire-navy\);[^}]*color: var\(--aspire-on-navy\);/)
  // Owner, 2026-09-17: the board surface is a PALE tint, textured with soft-light only.
  assert.match(materials, /\.material-board \{[^}]*background-blend-mode: soft-light, normal;/)
  // A unit board's header is pastel with nightfall ink, and carries no piping: on this
  // board nightfall means a POOL header and nothing else.
  assert.match(materials, /\.material-board-head \{[^}]*background: var\(--aspire-board-head\);[^}]*color: var\(--aspire-on-board-strong\);/)
  assert.match(read('src/components/EmbedUnitCard.jsx'), /<header className="material-board-head pb-unit-hdr">/)
  assert.ok(!/\.material-board-head[^{]*\{[^}]*::before/.test(materials), 'no piping on a board header')
  // The RULE is about declarations, not prose. A comment that records why multiply was
  // rejected on a surface is exactly what should survive in this file, and the first
  // draft of this test failed one written on the leather. Strip comments, then look.
  const decls = materials.replace(/\/\*[\s\S]*?\*\//g, '')
  assert.ok(!/multiply/.test(decls), 'no multiply blend: that is what made the felt heavy')
  assert.ok(!materials.includes('noise') || !/\.material-navy-flat \{[^}]*noise/.test(materials),
    'no texture on the header')
  assert.ok(!/url\((?!"data:|%23|\s*var)/.test(materials + CSS()), 'textures are inline data URIs, no image files')
  assert.match(CSS(), /@media \(prefers-reduced-motion: reduce\)/)
})

test('MODERN 1: the placement workflow becomes two clean panels without changing its component tree', () => {
  const css = CSS()
  assert.match(css, /\[data-style="modern"\] \.pb-pool \{[\s\S]*?border: 1px solid[\s\S]*?box-shadow:/)
  assert.match(css, /\[data-style="modern"\] \.pb-pool-hdr\.material-navy-flat \{[\s\S]*?background: var\(--nightfall/)
  assert.match(css, /\[data-style="modern"\] \.pb-pool-body\.material-leather-cream \{[\s\S]*?background-image: none;[\s\S]*?box-shadow: none;/)
  assert.match(css, /\[data-style="modern"\] \.pb-pool-note\.paper-note \{[\s\S]*?transform: none;[\s\S]*?box-shadow: none;/)
  assert.match(css, /\[data-style="modern"\] \.pb-unit-body\.material-board \{[\s\S]*?min-height: 88px;[\s\S]*?background-image: none;[\s\S]*?box-shadow: none;/)
  assert.match(CARD(), /appearanceStyle === 'modern'[\s\S]*?<X size=\{15\}/)
  assert.match(css, /\[data-style="modern"\] \.pb-ribbon\.material-ribbon \{[\s\S]*?display: none;/)
  assert.match(css, /\[data-style="modern"\] \.pb-choice-pill \{[\s\S]*?display: inline-flex;/)
  assert.match(CARD(), /className=\{`material-rank-\$\{RANK_TONE\[highlightRank\]\} pb-choice-pill`\}/)
  assert.match(css, /\[data-theme="dark"\]\[data-style="modern"\] \.pb-unit-hdr\.material-board-head \{[\s\S]*?background: #273345;/)
  assert.match(css, /\[data-style="modern"\] \.pb-unit-focused:hover \{[\s\S]*?box-shadow: 0 0 0 3px/)
  assert.match(css, /\.pb-unit-drop \.pb-open-slot \{[\s\S]*?background: #EAF7EF;/,
    'Classic and Modern share the same pastel valid-drop state')
  assert.ok(!css.includes('.pb-open-slot::before'), 'the add affordance follows the student name, not the slot')
  assert.match(css, /\.pb-drag-badge \{[\s\S]*?border-radius: 50%;/,
    'the circular Plus icon is shared by Classic and Modern')
  assert.ok(!TAB().includes('data-style='), 'the board keeps one component tree for both styles')
})

test('MATERIAL 2: white numbers on every rank colour meet WCAG AA (4.5:1)', () => {
  const brand = read('src/styles/aspireBrand.css')
  const lin = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 }
  const lum = hex => { const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)); return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b) }
  for (const rank of ['first', 'second', 'third', 'other']) {
    const hex = (brand.match(new RegExp(`--aspire-rank-${rank}: (#[0-9A-Fa-f]{6});`)) || [])[1]
    assert.ok(hex, `--aspire-rank-${rank} is defined`)
    const ratio = 1.05 / (lum(hex) + 0.05)
    assert.ok(ratio >= 4.5, `white on ${rank} ${hex} is ${ratio.toFixed(2)}:1`)
  }
  // The slot label on the pale board surface.
  const onBoard = lum('#4A5560'), board = lum('#EDF0F7')
  assert.ok((board + 0.05) / (onBoard + 0.05) >= 4.5, 'slot label on the board surface')
  // White ink, and the soft variant, on the flat nightfall header.
  const navy = lum('#1D2567')
  assert.ok(1.05 / (navy + 0.05) >= 4.5, 'white text on nightfall')
  const soft = 0.78 * 255 + 0.22 * 0x1D   // the .78 white blend over navy, per channel
  assert.ok((lum('#' + [soft, 0.78 * 255 + 0.22 * 0x25, 0.78 * 255 + 0.22 * 0x67]
    .map(v => Math.round(v).toString(16).padStart(2, '0')).join('')) + 0.05) / (navy + 0.05) >= 4.5,
    'the soft secondary text on nightfall')
})

// ── 5. Accessibility and interaction contract (source) ──────────────────────

test('A11Y 1: boards and notes are keyboard targets with the specified labels', () => {
  const card = CARD()
  assert.match(card, /role="group"\s+tabIndex=\{0\}\s+aria-label=\{`\$\{unit\.unit_name\} board, \$\{filledCount\} of \$\{unit\.total_slots\} filled`\}/)
  assert.match(card, /if \(\(e\.key === 'Enter' \|\| e\.key === ' '\) && e\.target === e\.currentTarget\)/)
  assert.match(card, /appearanceStyle === 'modern'[\s\S]*?`Unmatch \$\{name\} from \$\{unit\.unit_name\}`[\s\S]*?`Pull pin: unmatch \$\{name\} from \$\{unit\.unit_name\}`/)
  const note = strip(read('src/components/StudentMatchingCard.jsx'))
  assert.match(note, /role=\{interactive \? 'button' : undefined\}/)
  assert.match(note, /tabIndex=\{interactive \? 0 : undefined\}/)
  assert.match(TAB(), /role="status" aria-live="polite" data-testid="board-announcer"/)
  // The ring must survive a hover: `.pb-unit:hover` is the more specific selector, so
  // without the :hover pair the selection outline vanished under the pointer.
  assert.match(CSS(), /\.pb-unit:focus-visible,\s*\.pb-unit-focused,\s*\.pb-unit-focused:hover \{ box-shadow: 0 0 0 3px var\(--pb-ring\)/)
  assert.match(CSS(), /\.pb-unit-drop,\s*\.pb-unit-drop:hover \{/)
})

test('A11Y 2: rank is never colour alone - pins carry a number, ribbons and chips carry words', () => {
  const card = CARD()
  assert.match(card, /<span aria-hidden="true">\{pin\.glyph\}<\/span>/)
  assert.match(card, /#\{highlightRank\} choice\{isFull \? ' · Full' : ''\}/)
  assert.match(strip(read('src/components/StudentMatchingCard.jsx')), /#\{pickRank\} pick/)
})

test('FLOW 1: every placement path goes through requestPlacement, which writes a held unmatch first', () => {
  const tab = TAB()
  const req = tab.slice(tab.indexOf('const requestPlacement = async'), tab.indexOf('const handleSlotClick'))
  assert.ok(req.indexOf('await flushPending()') > -1)
  assert.ok(req.indexOf('await flushPending()') < req.indexOf('unitMatchCount'),
    'the capacity guard reads live counts only after the held unmatch lands')
  assert.match(req, /`\$\{unit\.unit_name\} is full\.`, 'Pull a pin to free a slot\.'/)
  assert.match(tab, /const handleBoardActivate = unit => \{\s*if \(selectedStudent\) \{ handleSlotClick\(unit\); return \}\s*handleUnitFocus\(unit\)/)
})

test('FLOW 2: the pin and the drag-back both unmatch directly; the write is held, then committed', () => {
  const card = CARD()
  // Owner, 2026-09-17: no confirmation dialog on this board. The pin pulls the
  // student, the drag-back does the same thing, and the Undo window is the safeguard.
  assert.ok(!card.includes('unmatch-confirm-modal'), 'the confirmation dialog is gone')
  assert.ok(!card.includes('confirmUnmatch'), 'and so is its state')
  assert.match(card, /onUnmatch=\{\(\) => onUnmatch\(student\)\}/)
  assert.match(card, /onUnmatch\(resolveMatchedStudent\(match, studentMap\) \|\| pulledRaw\)/,
    'the drag-back path takes the same handler')
  const tab = TAB()
  const un = tab.slice(tab.indexOf('const handleUnmatch = async'), tab.indexOf('const handleUndo'))
  assert.ok(un.indexOf('await flushPending()') > -1)
  assert.match(un, /scheduler\.hold\(/)
  assert.match(un, /\(\) => commitUnmatch\(student, unit\),/)
  assert.ok(!/\bonUnmatch\(/.test(un), 'the handler never calls the unmatch directly')
  assert.match(un, /action: \{ label: 'Undo', onClick: handleUndo \}/)
  assert.match(tab, /useEffect\(\(\) => \(\) => \{ scheduler\.flush\(\) \}, \[cohortId\]\)/,
    'a held unmatch is written before a cohort switch or unmount, never dropped')
})

test('FLOW 3: the toast can carry one action and be dismissed by id', () => {
  const hook = read('src/hooks/useToast.js')
  assert.match(hook, /action = null/)
  assert.match(hook, /return id;/)
  assert.match(hook, /dismiss: \(id\) => removeToast\(id\)/)
  assert.match(read('src/components/Toast.jsx'), /onClick=\{\(\) => \{ toast\.action\.onClick\?\.\(\); onRemove\(toast\.id\) \}\}/)
})

// ── 6. The Owner's refinements (2026-09-17) ─────────────────────────────────

test('POOL ORDER: alphabetical, not-yet-interviewed last, and a pick outranks both', () => {
  const pool = [
    { id: 'z', last_name: 'Zane', status: 'Interviewed' },
    { id: 'a', last_name: 'Adams', status: 'Form Received' },      // not interviewed
    { id: 'b', last_name: 'Brooks', status: 'Interviewed' },
    { id: 'n', last_name: 'Nair', status: 'Form Sent', unit_preference_1: '4 North' },
  ]
  assert.deepEqual(orderPool(pool, null).map(s => s.last_name), ['Brooks', 'Zane', 'Adams', 'Nair'],
    'alphabetical, with the not-yet-interviewed at the bottom')
  assert.deepEqual(orderPool(pool, { unit_name: '4 North' }).map(s => s.last_name),
    ['Nair', 'Brooks', 'Zane', 'Adams'],
    'a not-interviewed student who picked the unit outranks interviewed students who did not')
  // Within one preference tier, interviewed still comes first.
  const tie = [
    { id: 'p', last_name: 'Park', status: 'Form Received', unit_preference_1: '6 NE' },
    { id: 'c', last_name: 'Chen', status: 'Interviewed', unit_preference_1: '6 NE' },
  ]
  assert.deepEqual(orderPool(tie, { unit_name: '6 NE' }).map(s => s.last_name), ['Chen', 'Park'])
})

test('STUDENTS HEADER: only the School filter, and it sits after the spacer', () => {
  const tab = TAB()
  const header = tab.slice(tab.indexOf('aria-label="Students"'), tab.indexOf('pb-pool-body'))
  for (const gone of ['pb-search', 'pool-readiness', 'Sort students', 'pb-stepper', 'Previous student']) {
    assert.ok(!header.includes(gone), `${gone} left the students header`)
  }
  assert.ok(header.indexOf('<span className="pb-hdr-spacer" />') < header.indexOf('aria-label="School"'),
    'the School filter is on the far right')
  assert.match(header, /<StatusLegendPopover position="bottom-right" dark \/>/, 'the legend is visible on the Nightfall header')
  assert.match(header, /student\$\{sortedPool\.length !== 1 \? 's' : ''\}/, 'the count stays')
})

test('UNITS HEADER: only the Division filter, no sort, no Export CSV, no division pills', () => {
  const tab = TAB()
  const header = tab.slice(tab.indexOf('aria-label="Units"'), tab.indexOf('<div className="pb-legend"'))
  // Owner, 2026-09-17: both helper strips are gone; the board explains itself.
  assert.ok(!tab.includes('pb-helper'), 'no helper strip remains')
  assert.ok(!tab.includes('Click a unit to surface'), 'and neither does its copy')
  assert.ok(header.indexOf('<span className="pb-hdr-spacer" />') < header.indexOf('aria-label="Division"'),
    'the Division filter is on the far right')
  for (const gone of ['Sort units', 'Export CSV', 'exportCSV']) {
    assert.ok(!tab.includes(gone), `${gone} left the board`)
  }
  // The pill on each board header is gone; the shift chips stay.
  const card = CARD()
  assert.match(card, /<div className="pb-unit-chips">\{shiftChips\}<\/div>/)
  assert.ok(!card.includes('UNIT_DIVISION_MAP'), 'the card no longer resolves a division at all')
})

test('NOTE: status pill always, availability pill only when it warrants a look, top 3 down the side', () => {
  const note = strip(read('src/components/StudentMatchingCard.jsx'))
  assert.match(note, /const availabilityWarning = readiness\.level === 'review' \|\| readiness\.level === 'restricted'/)
  assert.match(note, /\{availabilityWarning && \(/)
  assert.ok(!note.includes('Availability confirmed'), 'the confirmed state says nothing on the board')
  assert.match(note, /<ol className="pb-note-top3" aria-label="Top 3 units">/)
  assert.match(note, /open === 0 \? ' \(Full\)' : ''/)
  const css = CSS()
  assert.match(css, /\.pb-note-main \{ display: flex;/)
  assert.match(css, /\.pb-note-top3 \{[^}]*max-width: 46%;/, 'the list is a column beside the name, not under it')
})

test('DRAG GHOST: one shared implementation draws it, badge only over a target with room', () => {
  // INTERVIEW-BOARD-1: dragging lives in useBoardDrag so the Placement Board and the
  // Interview Board cannot drift apart. The board supplies only what it MEANS.
  const drag = strip(read('src/components/placement/useBoardDrag.jsx'))
  const tab = TAB()
  assert.match(tab, /useBoardDrag\(\{/)
  assert.match(tab, /hasRoom: \(unitId\) => \{[\s\S]{0,260}length < unit\.total_slots/)
  assert.match(tab, /\{dragLayer\}/, 'the shared layer is rendered')
  assert.ok(!tab.includes('pb-drag-ghost'), 'the board no longer hand-rolls the ghost')

  // The browser's own drag image is suppressed, so the layer MUST draw something:
  // otherwise nothing visibly moves (the Owner saw exactly that).
  assert.match(drag, /setDragImage\(dragImage, 0, 0\)/)
  assert.match(drag, /<div ref=\{ghostRef\} className="pb-drag-ghost" aria-hidden="true">/)
  assert.match(drag, /<span ref=\{badgeRef\} className="pb-drag-badge"><Plus size=\{16\} strokeWidth=\{3\} \/><\/span>/)
  assert.match(drag, /<span ref=\{ghostNameRef\} className="pb-drag-ghost-name" \/>/)
  assert.ok(drag.indexOf('ref={badgeRef}') < drag.indexOf('ref={ghostNameRef}'), 'the add icon sits beside and before the student name')
  assert.match(drag, /ghostNameRef\.current\.textContent = payload\.name/)
  // The badge appears only where a drop will be accepted.
  assert.match(drag, /if \(room\) showBadgeAt\(e\); else hideBadge\(\)/)
  assert.match(drag, /dropEffect = room \? 'move' : 'none'/)
  assert.match(drag, /const onDocumentDragOver = useCallback\(/,
    'the document handler keeps one identity so later drags do not inherit stale listeners')
  assert.match(drag, /document\.removeEventListener\('dragover', onDocumentDragOver\)/)
  assert.match(drag, /const startDrag = \(e, payload\) => \{\s*badgeWanted\.current = false\s*hideBadge\(\)/,
    'each new drag resets the icon before evaluating its current target')
  // Moved imperatively through refs: a dragover at 60Hz must not set state.
  assert.match(drag, /ghost\.style\.transform = `translate3d\(/)
  assert.ok(!/showBadgeAt[\s\S]{0,200}setState|setBadge/.test(drag), 'no badge state')
  // `drag` fires on the source everywhere; `dragover` covers drop targets that swallow it.
  assert.match(drag, /document\.addEventListener\('drag', onDocumentDrag\)/)
  // A target's dragleave arrives AFTER the next target's dragover, so leave events
  // must never decide the badge.
  assert.match(drag, /const onDocumentDragOver = useCallback\(\(e\) => \{[\s\S]{0,220}if \(!badgeWanted\.current\) hideBadge\(\)/)
  assert.match(CSS(), /\.pb-drag-ghost \{[^}]*position: fixed;[^}]*opacity: 0;[^}]*pointer-events: none;/)
})
