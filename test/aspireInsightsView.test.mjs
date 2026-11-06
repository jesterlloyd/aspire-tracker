// ASPIRE-INSIGHTS-1, Phase 2: the page's URL, chips, formats and CSV.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  filtersFromSearch, searchFromFilters, withFilter, toggleFilter, chipsFor, clearFilters,
  fmtRate, fmtChange, deltaWords, rateText, toCsv, csvFileName, shortCohort, FILTER_DEFAULTS,
} from '../src/lib/insights/insightsView.js'
import { sanitizeFilters } from '../src/lib/insights/insightsModel.js'

test('the URL round-trips, defaults left out', () => {
  const f = { ...FILTER_DEFAULTS, cohort: 'c1', school: 'CSUN', measure: 'applied', unit: '6ne' }
  const s = searchFromFilters(f)
  assert.equal(s, '?cohort=c1&school=CSUN&unit=6ne&measure=applied')
  assert.deepEqual(filtersFromSearch(s), f)
  assert.equal(searchFromFilters(FILTER_DEFAULTS), '')
})

test('the page speaks the API\'s parameter names', () => {
  const f = filtersFromSearch('?cohort=c1&school=CSUN&pathway=internal&serviceLine=Medical&unit=6ne&shift=Night&residencyStatus=hired&measure=offered&compare=program')
  const api = sanitizeFilters(Object.fromEntries(new URLSearchParams(searchFromFilters(f))), { kind: 'staff' })
  assert.deepEqual(api.cohortIds, ['c1'])
  assert.deepEqual(api.schools, ['CSUN'])
  assert.equal(api.pathway, 'internal')
  assert.equal(api.serviceLine, 'Medical')
  assert.equal(api.shift, 'Night')
  assert.equal(api.residencyStatus, 'hired')
  assert.equal(api.measure, 'offered')
  assert.equal(api.compare, 'program')
})

test('Previous cohort needs a cohort', () => {
  assert.equal(filtersFromSearch('?compare=previous').compare, 'off')
  const f = withFilter({ ...FILTER_DEFAULTS, cohort: 'c1', compare: 'previous' }, 'cohort', '')
  assert.equal(f.compare, 'off')
})

test('a service line that does not hold the unit drops it; a second pick clears', () => {
  const units = [{ key: '6ne', name: '6 NE', serviceLine: 'Medical' }]
  assert.equal(withFilter({ ...FILTER_DEFAULTS, unit: '6ne' }, 'serviceLine', 'Surgical', units).unit, '')
  assert.equal(withFilter({ ...FILTER_DEFAULTS, unit: '6ne' }, 'serviceLine', 'Medical', units).unit, '6ne')
  const once = toggleFilter(FILTER_DEFAULTS, 'school', 'CSUN')
  assert.equal(once.school, 'CSUN')
  assert.equal(toggleFilter(once, 'school', 'CSUN').school, '')
})

test('chips name the narrowing filters, never the measure; Clear all keeps the measure', () => {
  const f = { ...FILTER_DEFAULTS, cohort: 'c1', unit: '6ne', shift: 'Night', measure: 'applied', compare: 'previous' }
  const chips = chipsFor(f, { cohorts: [{ id: 'c1', name: 'Fall 2026' }], units: [{ key: '6ne', name: '6 NE' }] })
  assert.deepEqual(chips.map(c => c.label), ['Fall 2026', '6 NE', 'Night shift'])
  const cleared = clearFilters(f)
  assert.equal(cleared.measure, 'applied')
  assert.equal(cleared.compare, 'off')
  assert.equal(cleared.cohort, '')
})

test('a withheld rate is never a number', () => {
  assert.equal(fmtRate({ count: 2, n: 3, rate: null, suppressed: true }), 'Too few')
  assert.equal(fmtRate({ count: 0, n: 0, rate: null, suppressed: true }), '–')
  assert.equal(fmtRate({ count: 13, n: 105, rate: 12.4, suppressed: false }), '12%')
  assert.equal(rateText({ count: 2, n: 3, rate: null, suppressed: true }), 'Too few to rate (n = 3)')
  assert.equal(fmtChange({ n: 24, mean: 0.4, suppressed: false }), '+0.40')
  assert.equal(fmtChange({ n: 2, mean: null, suppressed: true }), 'Too few')
  assert.equal(deltaWords(-3.6, 'Summer 2026'), '▼ 4 pts vs Summer 2026')
  assert.equal(deltaWords(0.2, 'program'), 'No change vs program')
  assert.equal(deltaWords(null, 'program'), '')
})

test('CSV: BOM, quoted commas, and no cell a spreadsheet would run', () => {
  const csv = toCsv([{ label: 'School' }, { label: 'Hired' }], [['Cal State, LA', '12%'], ['=HYPERLINK("x")', 3]])
  assert.ok(csv.startsWith('﻿'))
  assert.match(csv, /"Cal State, LA",12%/)
  assert.match(csv, /"'=HYPERLINK\(""x""\)",3/)
  assert.equal(csvFileName('pipeline', new Date('2026-11-05T12:00:00Z')), 'aspire-insights-pipeline-2026-11-05.csv')
  assert.equal(shortCohort('Fall 2025'), 'Fal ’25')
})

test('the page reads tokens, not literal radii, and names no student', () => {
  const css = readFileSync(new URL('../src/components/insights/insights.css', import.meta.url), 'utf8')
  assert.equal((css.match(/border-radius:\s*[0-9.]+px/g) || []).length, 0)
  const page = readFileSync(new URL('../src/components/insights/InsightsPage.jsx', import.meta.url), 'utf8')
  assert.doesNotMatch(page, /student_id|first_name|last_name/)
  // The hashed school palette fails the categorical gate; the page must not use it.
  assert.doesNotMatch(page + readFileSync(new URL('../src/components/insights/InsightsCharts.jsx', import.meta.url), 'utf8'), /naSchoolColors|schoolColor\(/)
})

test('the staff app routes /insights and the header shows it to the insights roles', () => {
  const app = readFileSync(new URL('../src/staff/StaffApp.jsx', import.meta.url), 'utf8')
  assert.match(app, /startsWith\('\/insights'\)\) return 'insights'/)
  assert.match(app, /activeTab === 'insights'/)
  const header = readFileSync(new URL('../src/components/Header/HeaderActions.jsx', import.meta.url), 'utf8')
  assert.match(header, /canViewInsights = isOwner \|\| isAdmin \|\| .*'co-lead'/)
  assert.match(header, /navigate\('\/insights'\)/)
})

test('the NE&L Portal opens Insights read-only from a Data tab, between Community Benefit and Evaluation', async () => {
  const { NAV_LABELS, alphabetizeNav } = await import('../src/lib/navigationCanon.js')
  assert.equal(NAV_LABELS.data, 'Data')
  const order = alphabetizeNav([{ label: NAV_LABELS.communityBenefit }, { label: NAV_LABELS.evaluation }, { label: NAV_LABELS.data }, { label: NAV_LABELS.programBudgets }]).map(s => s.label)
  assert.deepEqual(order, ['Budget Tracker', 'Community Benefit', 'Data', 'Evaluation'])
  const chrome = readFileSync(new URL('../src/portal/na/NursingAcademicsChrome.jsx', import.meta.url), 'utf8')
  assert.match(chrome, /key: 'data', label: NAV_LABELS\.data/)
  const app = readFileSync(new URL('../src/portal/PortalApp.jsx', import.meta.url), 'utf8')
  assert.match(app, /NA_SECTIONS = new Set\(\[[^\]]*'data'/)
  const portal = readFileSync(new URL('../src/portal/na/NursingAcademicsPortal.jsx', import.meta.url), 'utf8')
  assert.match(portal, /<InsightsPage surface="leadership"/)
  // Read-only: the portal passes no back link and the page offers no write.
  assert.doesNotMatch(portal, /<InsightsPage[^>]*backPath/)
})

test('every theme token the page reads has its own light and dark fallback (the portal loads no theme.css)', () => {
  const css = readFileSync(new URL('../src/components/insights/insights.css', import.meta.url), 'utf8')
  const used = new Set([...css.matchAll(/var\(--((?!ins-|aspire-)[a-z0-9-]+)/g)].map(m => m[1]))
  for (const t of used) {
    assert.match(css, new RegExp(`var\\(--${t}, var\\(--ins-fb-${t}\\)\\)`), `${t} falls back to --ins-fb-${t}`)
    assert.equal((css.match(new RegExp(`--ins-fb-${t}:`, 'g')) || []).length, 2, `${t} has a light and a dark fallback`)
  }
})

test('a CSV is dated by the Pacific day, not the UTC one', () => {
  // 03:00 UTC on Nov 6 is still the evening of Nov 5 in Los Angeles.
  assert.equal(csvFileName('hours', new Date('2026-11-06T03:00:00Z')), 'aspire-insights-hours-2026-11-05.csv')
})

// INSIGHTS-COLOR-1 (Owner, 2026-11-06): colourful and consistent across the board.
test('the chart palette is the validated eight-slot order, light and dark, and the tiles wear the KPI card accents', async () => {
  const css = readFileSync(new URL('../src/components/insights/insights.css', import.meta.url), 'utf8')
  const slots = mode => {
    const block = mode === 'dark' ? css.slice(css.indexOf("[data-theme='dark'] .ins {")) : css
    return [1, 2, 3, 4, 5, 6, 7, 8].map(i => block.match(new RegExp(`--ins-c${i}: (#[0-9a-f]{6})`))[1])
  }
  // The dataviz reference palette, in its validated order (adjacent pairs pass for every reader).
  assert.deepEqual(slots('light'), ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'])
  assert.deepEqual(slots('dark'), ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'])
  // KPIBand's ACCENT_PALETTE pairs, tint then ink, restated: the tiles read like every KPI card.
  const kpi = readFileSync(new URL('../src/components/KPIBand.jsx', import.meta.url), 'utf8')
  for (const [name, tint] of [['nightfall', '#EDEEF4'], ['sage', '#EEF7F0'], ['marina', '#EDF5F4'], ['dawn', '#FBF5E8'], ['chroma', '#F8EDF2'], ['periwinkle', '#EDF0F7']]) {
    assert.match(css, new RegExp(`\\.ins-a-${name} \\{ --ins-tile-tint: ${tint};`))
    assert.ok(kpi.includes(name === 'nightfall' ? `tint:      '${tint}'` : tint) || kpi.includes(tint), `${name} tint is the KPI card's`)
  }
  const page = readFileSync(new URL('../src/components/insights/InsightsPage.jsx', import.meta.url), 'utf8')
  // A tile is a figure, not a filter: not a button.
  assert.doesNotMatch(page.slice(page.indexOf('function Tile('), page.indexOf('function Tiles(')), /<button/)
  // A school keeps its slot on every card: one colour map, read by every school chart.
  assert.match(page, /const colorOf = slotsFor\(data\.schools\)/)
  for (const card of ['bySchoolCard', 'hostedCard', 'caseyFinkCard', 'hoursCard']) assert.match(page, new RegExp(`${card}\\(data[^)]*colorOf\\)`))
})

test('a slot is never reused: a ninth school is the comparison grey', async () => {
  const page = readFileSync(new URL('../src/components/insights/InsightsPage.jsx', import.meta.url), 'utf8')
  const src = page.slice(page.indexOf('const CAT_SLOTS'), page.indexOf('const PATHWAY_COLORS'))
  const slotsFor = new Function(`${src.replace(/\/\*\*[\s\S]*?\*\//, '')}; return slotsFor`)()
  const names = Array.from({ length: 9 }, (_, i) => `School ${i}`)
  const of = slotsFor(names)
  assert.equal(new Set(names.slice(0, 8).map(of)).size, 8)
  assert.equal(of('School 8'), 'var(--ins-other)')
  assert.equal(of('Unknown'), 'var(--ins-other)')
})

test('a scale ends just above its largest value, and a rate never past 100', async () => {
  const { niceMax, hbarHeight, funnelHeight } = await import('../src/lib/insights/chartGeometry.js')
  assert.equal(niceMax(21.4, 100), 25)
  assert.equal(niceMax(90, 100), 100)
  assert.equal(niceMax(99, 100), 100)
  assert.equal(niceMax(8), 10)
  assert.equal(niceMax(0.45), 0.5)
  assert.equal(niceMax(0), 1)
  assert.equal(hbarHeight([{}, {}]), 68)
  assert.equal(hbarHeight([{}, {}], 10), 84)
  assert.equal(funnelHeight([{ count: 1 }, { count: null }]), 40)
})
