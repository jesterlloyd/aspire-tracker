// APPLICANT-CHART-1 (Owner, 2026-10-05: "do not invent new things - rather, reuse"): Residency >
// Profiles & Interest opens the Student Profiles binder with the application's sheets.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { APPLICANT_SHEETS, CHART_SHEETS } from '../src/components/student/chartSheets.js'

const drawer = readFileSync(new URL('../src/components/ngrp/ApplicantDrawer.jsx', import.meta.url), 'utf8')
const css = readFileSync(new URL('../src/components/student/studentChart.css', import.meta.url), 'utf8')

test('seven sheets in the approved order, each wearing an existing Student Profiles tint', () => {
  assert.deepEqual(APPLICANT_SHEETS.map(s => s.id), ['applicant', 'application', 'documents', 'support', 'interview', 'hiring', 'activity'])
  const tints = new Set(CHART_SHEETS.map(s => s.id))
  for (const s of APPLICANT_SHEETS) assert.ok(tints.has(s.tint), `${s.id} borrows a real tint`)
  for (const t of tints) {
    assert.match(css, new RegExp(`\\.sc-sheet\\[data-tint="${t}"\\]\\s*\\{ background: var\\(--aspire-sheet-${t}\\); \\}`))
    assert.match(css, new RegExp(`\\.sc-tab\\[data-tint="${t}"\\]\\s*\\{ background: var\\(--aspire-sheet-${t}\\); \\}`))
  }
  // Modern's plain tabs must still win, so the borrowed tints sit before Modern's rules.
  assert.ok(css.indexOf('.sc-tab[data-tint="notes"]') < css.indexOf('[data-style="modern"] .sc-tab,'))
})

// RESIDENCY-SPLIT-1 fix (this commit): the first sheet reads Profile, and the split's list is a
// containing block so its pills' .sr-only labels cannot stretch the page.
test('the first sheet is labelled Profile, and the list scroll box is positioned', () => {
  assert.equal(APPLICANT_SHEETS[0].label, 'Profile')
  const tab = readFileSync(new URL('../src/components/ngrp/ProfilesTab.jsx', import.meta.url), 'utf8')
  assert.match(tab, /<div style=\{\{ flex: 1, overflowY: 'auto', minHeight: 0, position: 'relative' \}\}>/)
  assert.match(css, /\.profiles-panel-slide \.ac-chart \{ min-height: 0; \}/)
})

test('the drawer is the same binder: rings, plate, die-cut index and the shared scroll hook', () => {
  assert.match(drawer, /className="sc-binder material-leather-black material-forestack material-forestack-right"/)
  assert.match(drawer, /className="sc-rings" aria-hidden="true"/)
  assert.match(drawer, /className=\{`sc-plate\$\{chartLifted \? ' sc-plate-lifted' : ''\}`\}/)
  assert.match(drawer, /<nav className="sc-index" aria-label="Applicant chart sections">/)
  assert.match(drawer, /useChartScroll\(s\?\.id, sheets\)/)
  for (const s of APPLICANT_SHEETS) assert.match(drawer, new RegExp(`id=\\{sheetDomId\\('${s.id}'\\)\\} data-sheet="${s.id}"`), `${s.id} is rendered`)
})

test('every section the drawer had is still on a sheet, and Documents is the drawer body itself', () => {
  for (const t of ['Transition Form', 'Residency Interest', 'Eligibility', 'Activity']) assert.match(drawer, new RegExp(`title="${t}"`))
  for (const c of ['UnitChoicesSection', 'PoolSection', 'InterviewSection', 'OutcomeSection', 'PreceptorFeedbackSection', 'OverrideDialog']) assert.match(drawer, new RegExp(`<${c}\\b`))
  assert.match(drawer, /<StudentDocumentsBody student=\{row\.student\} toast=\{toast\} cycle=\{cycle\} showWho=\{false\} \/>/)
})
