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
  assert.equal(UNDO_WINDOW_MS, 6000, 'the Owner-approved window is 6 seconds')
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

test('LAYOUT 1: Student Pool on the left (about 40%), Unit Pool on the right (about 60%), stacked below 900px', () => {
  const tab = TAB()
  const board = tab.slice(tab.indexOf('className={`pb-board'))
  assert.ok(board.indexOf('aria-label="Student Pool"') > -1)
  assert.ok(board.indexOf('aria-label="Student Pool"') < board.indexOf('aria-label="Unit Pool"'),
    'the Student Pool comes first in the grid')
  const css = CSS()
  assert.match(css, /\.pb-board \{[^}]*grid-template-columns: minmax\(0, 2fr\) minmax\(0, 3fr\);/)
  assert.match(css, /@media \(max-width: 900px\) \{\s*\.pb-board \{ grid-template-columns: minmax\(0, 1fr\);/)
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

test('LAYOUT 3: the NGRP board keeps its own classes; this board shares none of them', () => {
  const tab = TAB()
  assert.ok(!/className="embed-(units|students)-panel|embed-unit-grid|embed-student-grid|embed-light-hdr|euc-card/.test(tab),
    'the felt board does not wear the classes the NGRP board uses')
  assert.ok(!/\.embed-|\.euc-/.test(CSS()), 'the board stylesheet restyles no embed-* or euc-* class')
  assert.match(read('src/components/ngrp/PlacementBoard.jsx'), /embed-units-panel/)
})

test('MATERIAL 1: tokens live in aspireBrand.css; classes read them; no literal radius', () => {
  const brand = read('src/styles/aspireBrand.css')
  for (const t of ['--aspire-felt:', '--aspire-felt-deep:', '--aspire-on-navy:',
    '--aspire-leather-cream:', '--aspire-piping:', '--aspire-noise-fine:', '--aspire-noise-grain:',
    '--aspire-radius-pill:']) {
    assert.ok(brand.includes(t), `${t} is a brand token`)
  }
  const materials = read('src/styles/aspireMaterials.css')
  for (const c of ['.material-felt', '.material-navy-flat', '.material-leather-cream', '.paper-note', '.material-pin', '.material-ribbon']) {
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
  assert.ok(!materials.includes('noise') || !/\.material-navy-flat \{[^}]*noise/.test(materials),
    'no texture on the header')
  assert.ok(!/url\((?!"data:|%23|\s*var)/.test(materials + CSS()), 'textures are inline data URIs, no image files')
  assert.match(CSS(), /@media \(prefers-reduced-motion: reduce\)/)
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
  assert.match(card, /aria-label=\{`Pull pin: unmatch \$\{name\} from \$\{unit\.unit_name\}`\}/)
  const note = strip(read('src/components/StudentMatchingCard.jsx'))
  assert.match(note, /role=\{interactive \? 'button' : undefined\}/)
  assert.match(note, /tabIndex=\{interactive \? 0 : undefined\}/)
  assert.match(TAB(), /role="status" aria-live="polite" data-testid="board-announcer"/)
  assert.match(CSS(), /\.pb-unit:focus-visible,\s*\.pb-unit-focused \{ box-shadow: 0 0 0 3px var\(--pb-ring\)/)
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

test('FLOW 2: the pin and the drag-back both open the SAME dialog; the write is held, then committed', () => {
  const card = CARD()
  assert.match(card, /const confirmUnmatch = pinConfirm \|\| pulledStudent/)
  assert.match(card, /onUnmatch=\{\(\) => setConfirmUnmatch\(student\)\}/)
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

test('POOL HEADER: only the School filter, and it sits after the spacer', () => {
  const tab = TAB()
  const header = tab.slice(tab.indexOf('aria-label="Student Pool"'), tab.indexOf('<div className="pb-helper">'))
  for (const gone of ['pb-search', 'pool-readiness', 'Sort students', 'pb-stepper', 'Previous student']) {
    assert.ok(!header.includes(gone), `${gone} left the Student Pool header`)
  }
  assert.ok(header.indexOf('<span className="pb-hdr-spacer" />') < header.indexOf('aria-label="School"'),
    'the School filter is on the far right')
  assert.match(header, /<StatusLegendPopover position="bottom-right" dark \/>/, 'the legend explains the pills')
  assert.match(header, /student\$\{sortedPool\.length !== 1 \? 's' : ''\}/, 'the count stays')
})

test('UNIT HEADER: only the Division filter, no sort, no Export CSV, no division pills', () => {
  const tab = TAB()
  const header = tab.slice(tab.indexOf('aria-label="Unit Pool"'), tab.indexOf('<div className="pb-legend"'))
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

test('DRAG BADGE: shown only over a board with an open slot, and it never re-renders the board', () => {
  const tab = TAB()
  const over = tab.slice(tab.indexOf('onBoardDragOver:'), tab.indexOf('onBoardDragLeave:'))
  assert.match(over, /const room = live\.matches\.filter\(m => m\.unit_id === unit\.id\)\.length < unit\.total_slots/)
  assert.match(over, /if \(room\) showBadgeAt\(e\); else hideBadge\(\)/)
  assert.match(over, /dropEffect = room \? 'move' : 'none'/)
  // Moved imperatively through a ref: a dragover at 60Hz must not set state.
  assert.match(tab, /badge\.style\.transform = `translate3d\(/)
  assert.ok(!/showBadgeAt[\s\S]{0,200}setState|setBadge/.test(tab), 'no badge state')
  assert.match(tab, /<span ref=\{badgeRef\} className="pb-drag-badge material-pin material-rank-first" aria-hidden="true">\+<\/span>/)
  assert.match(CSS(), /\.pb-drag-badge \{[^}]*position: fixed;[^}]*opacity: 0;[^}]*pointer-events: none;/)
})
