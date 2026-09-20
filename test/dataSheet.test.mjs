// test/dataSheet.test.mjs
//
// TABLE-CANON-1: the DataSheet is rendered for real (react-dom/server through Vite's
// ssrLoadModule, the harness test/headerRenderSmoke.test.mjs established) and the eight
// invariants are read from the markup it produces. The packet's sheet, tabs and bubble
// sheet are rendered the same way from a fixture cohort, so a component that throws, or
// a segment that loses its label, fails here rather than in production.

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import { buildPacket, buildRosterRows, buildBubbleSheet } from '../src/lib/evaluation/responsesPacketModel.js'

let vite
before(async () => {
  vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' })
})
after(async () => { await vite?.close() })
const load = (path) => vite.ssrLoadModule(path)

function render(Component, props, label) {
  try {
    return renderToStaticMarkup(React.createElement(Component, props))
  } catch (err) {
    assert.fail(`${label} threw while rendering: ${err.constructor.name}: ${err.message}`)
  }
}
const count = (html, re) => (html.match(new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g')) || []).length

const COLS = [
  { key: 'name',   label: 'Student', min: 150, grow: 2.2, priority: 1, sortValue: r => r.name,   render: r => React.createElement('span', { className: 'ds-nm' }, r.name) },
  { key: 'status', label: 'Status',  min: 92,  grow: 1,   priority: 2, sortValue: r => r.status, render: r => React.createElement('span', { className: `ds-pill ds-pill-${r.tone}` }, r.status) },
  { key: 'score',  label: 'Score',   min: 58,  grow: 0.7, priority: 3, align: 'right', sortValue: r => r.score, render: r => React.createElement('span', { className: 'ds-num' }, r.score == null ? '–' : r.score.toFixed(2)) },
]
const ROWS = Array.from({ length: 14 }, (_, i) => ({ id: `r${i + 1}`, name: `Row ${String(i + 1).padStart(2, '0')}`, status: i % 3 ? 'Completed' : 'Sent', tone: i % 3 ? 'ok' : 'info', score: i === 4 ? null : 3 + i / 10 }))

test('full sheet: holes, a sorted header with one arrow, paired bands, a crease after ten rows, an en dash', async () => {
  const { default: DataSheet } = await load('/src/components/shared/DataSheet.jsx')
  const html = render(DataSheet, { level: 'full', title: 'Individual Responses', columns: COLS, rows: ROWS, sort: { key: 'name', dir: 'asc' }, expandable: true, expandedKeys: new Set(), renderExpanded: () => null }, 'DataSheet(full)')
  assert.equal(count(html, /ds-holes-l/), 1); assert.equal(count(html, /ds-holes-r/), 1)
  assert.match(html, /role="table"/)
  assert.equal(count(html, /role="columnheader"/), 4, 'three columns and the detail column')
  assert.equal(count(html, /aria-sort="ascending"/), 1)
  assert.equal(count(html, /aria-sort="none"/), 2)
  assert.equal(count(html, / ↑/), 1, 'the arrow appears only on the active column')
  assert.equal(count(html, / ↓/), 0)
  assert.match(html, /aria-label="Sort by Student descending"/, 'the active header offers the reverse')
  assert.match(html, /aria-label="Sort by Score ascending"/)
  // Bands: rows 1, 2, 5, 6, 9, 10 of the first page; the second page restarts.
  const bands = [...html.matchAll(/data-band="(\d)"/g)].map(m => m[1]).join('')
  assert.equal(bands, '11001100111100')
  assert.equal(count(html, /ds-crease/), 1, 'one crease after ten rows')
  assert.match(html, />continued</)
  assert.equal(count(html, /role="rowgroup"/), 3, 'header, page one, page two')
  assert.match(html, /<span class="ds-num">–<\/span>/, 'missing is an en dash')
  assert.equal(count(html, /aria-expanded="false"/), 14)
  // The weighted spread: every track is minmax(min, grow fr), the chevron is fixed.
  assert.match(html, /grid-template-columns:minmax\(150px, 2\.2fr\) minmax\(92px, 1fr\) minmax\(58px, 0\.7fr\) 28px/)
  assert.equal(count(html, /class="ds-detail"/), 0)
  assert.match(html, /aria-live="polite"/)
})

test('an expanded row opens a bordered panel, and the bands do not shift beneath it', async () => {
  const { default: DataSheet } = await load('/src/components/shared/DataSheet.jsx')
  const html = render(DataSheet, { level: 'full', columns: COLS, rows: ROWS, sort: { key: 'name', dir: 'asc' }, expandable: true, expandedKeys: new Set(['r1']), renderExpanded: r => React.createElement('div', { className: 'ds-dt' }, r.name), expandLabel: r => `Answers for ${r.name}` }, 'DataSheet(expanded)')
  assert.equal(count(html, /aria-expanded="true"/), 1)
  assert.equal(count(html, /class="ds-detail"/), 1)
  assert.match(html, /aria-colspan="4"/)
  assert.match(html, /aria-label="Answers for Row 01"/)
  const bands = [...html.matchAll(/data-band="(\d)"/g)].map(m => m[1]).join('')
  assert.equal(bands, '11001100111100', 'an open panel is a sibling row; the attribute keeps the rhythm')
})

test('plain and inline sheets drop the holes and the crease; sort and expansion still work', async () => {
  const { default: DataSheet } = await load('/src/components/shared/DataSheet.jsx')
  const plain = render(DataSheet, { level: 'plain', columns: COLS, rows: ROWS, defaultSort: { key: 'score', dir: 'desc' } }, 'DataSheet(plain)')
  assert.equal(count(plain, /ds-holes/), 0)
  assert.equal(count(plain, /ds-crease/), 0)
  assert.match(plain, /data-level="plain"/)
  assert.equal(count(plain, / ↓/), 1)
  // Descending by score, nulls last: the null row is the final row.
  const names = [...plain.matchAll(/class="ds-nm">(Row \d+)</g)].map(m => m[1])
  assert.equal(names[0], 'Row 14'); assert.equal(names[names.length - 1], 'Row 05')
  const inline = render(DataSheet, { level: 'inline', columns: COLS, rows: ROWS.slice(0, 3) }, 'DataSheet(inline)')
  assert.equal(count(inline, /ds-holes/), 0)
  assert.match(inline, /data-level="inline"/)
  const empty = render(DataSheet, { level: 'full', columns: COLS, rows: [], emptyMessage: 'Nothing here' }, 'DataSheet(empty)')
  assert.match(empty, /Nothing here/)
})

test('sortRows: reversing the active column, nulls last both ways, ties keep their order', async () => {
  const { sortRows, nextSort, compareValues } = await import('../src/components/shared/dataSheetSort.js')
  assert.deepEqual(nextSort({ key: 'a', dir: 'asc' }, 'a'), { key: 'a', dir: 'desc' })
  assert.deepEqual(nextSort({ key: 'a', dir: 'desc' }, 'b'), { key: 'b', dir: 'asc' })
  assert.equal(compareValues(null, 1, 'asc') > 0, true); assert.equal(compareValues(null, 1, 'desc') > 0, true)
  const asc = sortRows(ROWS, COLS, { key: 'score', dir: 'asc' }).map(r => r.id)
  const desc = sortRows(ROWS, COLS, { key: 'score', dir: 'desc' }).map(r => r.id)
  assert.equal(asc[asc.length - 1], 'r5'); assert.equal(desc[desc.length - 1], 'r5')
  assert.equal(asc[0], 'r1'); assert.equal(desc[0], 'r14')
})

// ── The packet, rendered ─────────────────────────────────────────────────────

function cf(id, sid, tp, cps, la, pr, q1) {
  const answers = {}
  for (let i = 1; i <= 15; i++) answers[`S1_Q${String(i).padStart(2, '0')}`] = 3
  answers.S1_Q01 = q1
  return {
    id, timepoint: tp, status: 'completed', sent_at: '2026-08-01T00:00:00Z',
    students: { id: sid, first_name: 'Adam', preferred_first_name: null, last_name: 'Friedenthal', school: 'Cal State Long Beach', program_type: 'Accelerated BSN' },
    evaluation_instruments: { slug: 'casey_fink_readiness_2024', display_name: 'Casey-Fink' },
    evaluation_responses: [{ submitted_at: '2026-09-01T00:00:00Z', responses: answers, score_s1_clinical_problem_solving: cps, score_s1_learning_activities: la, score_s1_practice_readiness: pr }],
  }
}
const FIXTURE = [
  cf('1', 'a', 'baseline', 3.0, 3.4, 3.0, 2), cf('2', 'a', 'post_rotation', 3.5, 3.4, 3.75, 4),
  cf('3', 'b', 'baseline', 3.5, 3.0, 3.25, 3), cf('4', 'b', 'post_rotation', 3.0, 3.0, 3.5, 3),
  cf('5', 'c', 'baseline', 3.0, 3.0, 3.0, 1),
]

test('the analysis sheet renders the basis before the finding, with labelled, focusable segments', async () => {
  const { AnalysisSheet, InstrumentTabs } = await load('/src/components/evaluation/ResponsesPacket.jsx')
  const packet = buildPacket(FIXTURE, 'casey_fink_readiness_2024')
  const html = render(AnalysisSheet, { packet, cohortLabel: 'Summer 2026', tableView: false }, 'AnalysisSheet')
  assert.match(html, /Casey-Fink Readiness for Practice/)
  assert.match(html, /Pre-Rotation and Post-Rotation/)
  assert.match(html, /Summer 2026/)
  assert.match(html, /ASPIRE INTELLIGENCE/)
  const basisAt = html.indexOf('class="rp-basis"'), findingAt = html.indexOf('class="rp-findtitle"')
  assert.ok(basisAt > 0 && basisAt < findingAt, 'the denominator arrives before the finding')
  assert.match(html, /class="rp-b rp-b-key"><b>5<\/b><span>Assigned<\/span>/)
  assert.match(html, /class="rp-b rp-b-key"><b>2<\/b><span>Matched pairs<\/span>/)
  assert.match(html, /class="rp-b rp-b-warn"><b>1<\/b><span>Baseline only<\/span>/)
  assert.match(html, /class="rp-b rp-b-zero"><b>0<\/b><span>Post only<\/span>/)
  // CPS: a up, b down → one green, one textured amber; no neutral segment rendered at 0.
  assert.match(html, /class="rp-seg rp-seg-up" style="width:50%" data-narrow="0" data-tip="1 of 2 higher post score" tabindex="0" role="img" aria-label="1 of 2 higher post score"/)
  assert.match(html, /class="rp-seg rp-seg-down" style="width:50%" data-narrow="0" data-tip="1 of 2 lower post score"/)
  assert.match(html, /net \+0 of 2/)
  assert.match(html, /net \+2 of 2/, 'PR: both higher')
  assert.match(html, /<b>3\.25<\/b> → <b>3\.25<\/b><span class="rp-delta">\+0\.00<\/span>/, 'CPS means and an outline delta chip')
  assert.match(html, /1 student submitted a baseline and no post-rotation response\./)
  assert.match(html, />See who</)
  assert.match(html, /This does not independently measure retention, objective competence, or financial savings\./)
  assert.equal(count(html, /<table/), 0)
  const withTable = render(AnalysisSheet, { packet, cohortLabel: 'Summer 2026', tableView: true }, 'AnalysisSheet(table)')
  assert.match(withTable, /<caption class="sr-only">Readiness: Pre-to-Post Change as a table<\/caption>/)
  assert.match(withTable, /<th class="aspire-th" scope="col">Higher<\/th>/)
  const tabs = render(InstrumentTabs, { tabs: [{ slug: 'casey_fink_readiness_2024', name: 'Casey-Fink Readiness for Practice', completed: 5, assigned: 5, pct: 100 }, { slug: 'post_rotation_evaluation', name: "Student's Feedback on ASPIRE", completed: 0, assigned: 0, pct: 0 }], selected: 'casey_fink_readiness_2024', onSelect: () => {} }, 'InstrumentTabs')
  assert.equal(count(tabs, /aria-pressed="true"/), 1); assert.equal(count(tabs, /aria-pressed="false"/), 1)
  assert.match(tabs, /5 of 5 · 100%/)
  assert.match(tabs, /<span class="rp-meter" aria-hidden="true"><i style="width:100%"><\/i><\/span>/)
})

test('the bubble sheet draws before, after and unchanged as three marks, with the shift', async () => {
  const { default: BubbleSheet } = await load('/src/components/evaluation/BubbleSheet.jsx')
  const packet = buildPacket(FIXTURE, 'casey_fink_readiness_2024')
  const row = buildRosterRows(packet.instrument, packet.rows).find(r => r.id === '1')
  const sheet = buildBubbleSheet(packet.instrument, row, packet.byStudent, null)
  const html = render(BubbleSheet, { sheet, name: row.name }, 'BubbleSheet')
  assert.match(html, /Adam Friedenthal/)
  assert.match(html, /before<\/span>/); assert.match(html, /after<\/span>/); assert.match(html, /unchanged<\/span>/)
  // Item 1: before 2, after 4.
  assert.match(html, /aria-label="before 2, after 4"><span class="rp-bub"><span aria-hidden="true">1<\/span><\/span><span class="rp-bub rp-bub-pre"><span aria-hidden="true">2<\/span><\/span><span class="rp-bub"><span aria-hidden="true">3<\/span><\/span><span class="rp-bub rp-bub-post"><span aria-hidden="true">4<\/span><\/span><\/span><span class="rp-shift rp-shift-up">\+2<\/span>/)
  // Item 2: 3 → 3 is one mark.
  assert.match(html, /aria-label="before 3, after 3">[^]*?class="rp-bub rp-bub-both"/)
  assert.match(html, /rp-shift-same">0</)
  assert.match(html, /Item text is licensed/)
  assert.doesNotMatch(html, /Recognizing a change/)
})
