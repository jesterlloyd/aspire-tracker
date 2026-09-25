// test/homeRefinements.test.mjs
//
// HOME-1, the Owner's refinements of 2026-09-25: the Requests by school filters (counted in
// students), Email Academic Partners (a launch that selects every Academic Partner contact),
// the rewritten Academic Partner Placement Request template and the [Cohort Request Password]
// guard, the Cohort Pulse wave, the pill buttons, and Unit Setup as a compact table.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { REQUEST_FILTERS, requestCounts, filterRequestRows, requestsBySchool } from '../src/lib/home/placementSummaryModel.js'
import { REQUIRED_PLACEHOLDERS, unfilledPlaceholders, unfilledMessage } from '../src/lib/connect/requiredPlaceholders.js'
import { buildBulkTemplate } from '../src/lib/outreachTemplates.js'
import { LAUNCH_KINDS } from '../src/lib/connect/launchContext.js'
import {
  DEFAULT_SHIFT, shiftChoice, clampSlots, buildSetup, setupTotals, divisionTotals, visibleDivisions, matchesSearch,
} from '../src/lib/unitSetupModel.js'
import { SHIFT_OPTIONS } from '../src/lib/constants.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(root, p), 'utf8')

// ── Requests by school filters ───────────────────────────────────────────────

const students = [
  { id: 'a', school: 'APU', status: 'Placed', matched_unit_id: 'u1' },
  { id: 'b', school: 'APU', status: 'Pending Outreach', matched_unit_id: null },
  { id: 'c', school: 'CSULA', status: 'Form Sent', matched_unit_id: null },
  { id: 'd', school: 'CSULA', status: 'Active Rotation', matched_unit_id: 'u2' },
  { id: 'e', school: 'UCLA', status: 'Pending Outreach', matched_unit_id: null },
]

test('REQUESTS 1: the filters count students: All, Placed, Needs outreach (Pending Outreach only)', () => {
  assert.deepEqual(REQUEST_FILTERS.map(f => f.label), ['All', 'Placed', 'Needs outreach'])
  assert.deepEqual(requestCounts(students), { all: 5, placed: 2, needs_outreach: 2 })
  assert.equal(REQUEST_FILTERS.find(f => f.key === 'needs_outreach').test({ status: 'Form Sent' }), false,
    'the Owner\'s definition: the form has not gone out yet')
})

test('REQUESTS 2: a filter keeps the schools holding a matching student, with their full totals', () => {
  const rows = requestsBySchool({ students })
  assert.deepEqual(filterRequestRows(rows, 'all').map(r => r.school), ['APU', 'CSULA', 'UCLA'])
  assert.deepEqual(filterRequestRows(rows, 'placed').map(r => r.school), ['APU', 'CSULA'])
  assert.deepEqual(filterRequestRows(rows, 'needs_outreach').map(r => r.school), ['APU', 'UCLA'])
  assert.equal(filterRequestRows(rows, 'placed')[0].students, 2, 'the row keeps its own totals')
})

test('REQUESTS 3: At a Glance draws the chips over Requests by school and filters its rows', () => {
  const ov = read('src/components/OverviewTab.jsx')
  assert.match(ov, /REQUEST_FILTERS\.map\(f => \(\s*<button key=\{f\.key\} type="button" className="hm-fchip" aria-pressed=\{requestFilter === f\.key\}/)
  assert.match(ov, /requestRows=\{shownRequestRows\}/)
})

// ── Email Academic Partners ──────────────────────────────────────────────────

test('LAUNCH 1: Email Academic Partners launches Send to Many with the template and every partner', () => {
  assert.equal(LAUNCH_KINDS.ACADEMIC_PARTNER_REQUEST, 'academic_partner_request')
  const ov = read('src/components/OverviewTab.jsx')
  assert.match(ov, /kind: LAUNCH_KINDS\.ACADEMIC_PARTNER_REQUEST,[\s\S]{0,200}templateKey: 'academic_partner_placement'/)
  assert.match(ov, /<NavigationPill icon=\{Mail\} onClick=\{handleEmailAcademicPartners\}>Email Academic Partners<\/NavigationPill>/)
  // A reminder: nothing to confirm on return, the context simply retires.
  assert.match(ov, /if \(ctx\.kind === LAUNCH_KINDS\.ACADEMIC_PARTNER_REQUEST\) \{ clearLaunchContext\(\); return \}/)
  const ov2 = read('src/components/connect/OutreachView.jsx')
  assert.match(ov2, /LAUNCH_KINDS\.ACADEMIC_PARTNER_REQUEST\) \{\s*return \{ source: 'contacts', contactCategory: 'Academic Partner', selectAllInCategory: true \}/)
  const comp = read('src/components/connect/BulkManualComposer.jsx')
  assert.match(comp, /initialAudience\?\.selectAllInCategory \? initialAudience\?\.contactCategory : null/)
  assert.match(comp, /c\.is_active !== false && isValidEmail\(c\.email\) && getContactCategories\(c\)\.includes\(cat\)/)
})

// ── The template and the password guard ─────────────────────────────────────

test('TEMPLATE: asks for this cohort\'s requests, two real buttons, and the password stand-in', () => {
  const t = buildBulkTemplate('academic_partner_placement')
  assert.match(t.subject, /Submit Your Student Placement Requests for \[Cohort\]/)
  assert.match(t.richBody, /data-aspire-block="button" data-label="Open Placement Requests" data-url="[^"]*\/portal\/ap\/placement-requests"/)
  assert.match(t.richBody, /data-aspire-block="button" data-label="Open the Request Form" data-url="[^"]*\/school-form"/)
  assert.match(t.richBody, /<strong>\[Cohort Request Password\]<\/strong>/)
  assert.match(t.body, /\[Cohort Request Password\]/)
  assert.doesNotMatch(t.richBody, /&lt;strong&gt;/, 'bold runs are real tags, not escaped text')
  // Reads correctly whether [Cohort] is a name or the composer's fallback phrase.
  assert.doesNotMatch(t.body, /the \[Cohort\]/)
})

test('GUARD 1: the password stand-in blocks review and send, in the composer and on the server', () => {
  assert.deepEqual(REQUIRED_PLACEHOLDERS, ['[Cohort Request Password]'])
  assert.deepEqual(unfilledPlaceholders('Subject', 'Use [Cohort Request Password] to sign in'), ['[Cohort Request Password]'])
  assert.deepEqual(unfilledPlaceholders('Subject', 'Use Spring27! to sign in'), [])
  assert.match(unfilledMessage(['[Cohort Request Password]']), /Replace \[Cohort Request Password\]/)
  const comp = read('src/components/connect/BulkManualComposer.jsx')
  assert.match(comp, /const unfilled = unfilledPlaceholders\(subject, body\)/)
  assert.match(comp, /const canSend = \(\s*unfilled\.length === 0 &&/)
  assert.match(comp, /disabled=\{recipients\.length === 0 \|\| !subject\.trim\(\) \|\| !body\.trim\(\) \|\| unfilled\.length > 0\}/)
  const api = read('api/connect-send-bulk-message.js')
  assert.equal((api.match(/code: 'unfilled_placeholder'/g) || []).length, 2, 'both the single and the bulk path refuse')
})

// ── Buttons and the pulse ────────────────────────────────────────────────────

test('BUTTONS: the three Placement actions are the canonical white pill, not the green .ov-send-btn', () => {
  const ov = read('src/components/OverviewTab.jsx')
  assert.match(ov, /import \{ NavigationPill \} from '\.\/ui\/NavigationPill'/)
  for (const label of ['Send Capacity Request', 'Send Reminder to Pending Units', 'Email Academic Partners']) {
    assert.match(ov, new RegExp(`>${label}</NavigationPill>`), label)
  }
  const toolbar = ov.slice(ov.indexOf('const capacityToolbar'), ov.indexOf('const requestsToolbar'))
  assert.doesNotMatch(toolbar, /ov-send-btn/)
  const pill = read('src/components/ui/navigationPill.css')
  assert.match(pill, /\.nav-pill:active:not\(:disabled\) \{[^}]*background: var\(--color-accent-primary, #1d2567\)/)
})

test('PULSE: a wave travels left to right, arrow by arrow, and stops under reduced motion', () => {
  const css = read('src/components/home/home.css')
  assert.match(css, /\.hm-stage::after \{[\s\S]*?animation: hm-wave [\s\S]*?animation-delay: calc\(var\(--hm-i, 0\) \* 0\.32s\)/)
  assert.match(css, /@keyframes hm-wave \{\s*0% \{ transform: translateX\(-110%\); \}/)
  assert.match(css, /prefers-reduced-motion: reduce\)[\s\S]*?\.hm-stage::after \{ display: none; \}/)
  // The current stage keeps its solid fill; the wave is a translucent layer under the figures.
  assert.match(css, /\.hm-stage\.is-cur \{ background: var\(--hm-navy\); color: var\(--hm-on-navy\); \}/)
  assert.match(css, /\.hm-stage b, \.hm-stage span \{ position: relative; z-index: 1; \}/)
  assert.match(read('src/components/home/CohortPulse.jsx'), /style=\{\{ '--hm-i': i \}\}/)
})

// ── Unit Setup ───────────────────────────────────────────────────────────────

test('UNIT SETUP 1: a new unit\'s shift is one the dropdown offers; a legacy value reads as No Preference', () => {
  assert.ok(SHIFT_OPTIONS.includes(DEFAULT_SHIFT))
  assert.equal(shiftChoice('Either'), 'No Preference')
  assert.equal(shiftChoice('Night Shift Preferred'), 'Night Shift Preferred')
  const s = buildSetup([{ unit_name: '4 South', division: 'Medical' }], [])
  assert.equal(s['4 South'].shift, 'No Preference')
  assert.equal(s['4 South'].checked, false)
})

test('UNIT SETUP 2: slots stay 1 to 99; the summary compares slots with proceeding students', () => {
  assert.deepEqual([clampSlots(0), clampSlots('7'), clampSlots(500), clampSlots('x')], [1, 7, 99, 1])
  const setup = { A: { checked: true, slots: 3 }, B: { checked: true, slots: 2 }, C: { checked: false, slots: 9 } }
  const people = [{ status: 'Placed' }, { status: 'Interviewed' }, { status: 'Declined' }, { status: 'Not Proceeding' }]
  assert.deepEqual(setupTotals(setup, people), { units: 2, slots: 5, proceeding: 2, short: 0, spare: 3, covered: true })
  assert.deepEqual(setupTotals({ A: { checked: true, slots: 1 } }, people), { units: 1, slots: 1, proceeding: 2, short: 1, spare: 0, covered: false })
  assert.deepEqual(divisionTotals([{ unit_name: 'A' }, { unit_name: 'C' }], setup), { participating: 1, total: 2, slots: 3 })
})

test('UNIT SETUP 3: search and Participating only narrow the service lines', () => {
  const catalog = [
    { unit_name: '6 NE', division: 'Critical Care', patient_population: 'Heart Transplant' },
    { unit_name: '4 South', division: 'Medical', patient_population: 'Oncology' },
    { unit_name: '5 South', division: 'Medical', patient_population: 'Safety Quad' },
  ]
  const setup = { '6 NE': { checked: true }, '4 South': { checked: false }, '5 South': { checked: true } }
  assert.deepEqual(visibleDivisions(catalog, setup).map(([d, u]) => [d, u.length]), [['Critical Care', 1], ['Medical', 2]])
  assert.deepEqual(visibleDivisions(catalog, setup, { query: 'oncology' }).map(([d]) => d), ['Medical'])
  assert.deepEqual(visibleDivisions(catalog, setup, { participatingOnly: true }).map(([, u]) => u.map(x => x.unit_name)), [['6 NE'], ['5 South']])
  assert.equal(matchesSearch(catalog[0], 'critical'), true)
})

test('UNIT SETUP 4: the redesign changed the drawing, not what is saved', () => {
  const panel = read('src/components/UnitSetupPanel.jsx')
  // The save is the one it always was: the same record, updates by id, inserts, and an
  // unchecked unit is marked not participating, never deleted.
  assert.match(panel, /slots_remaining:\s+Math\.max\(0, cfg\.slots - filledCount\)/)
  assert.match(panel, /shift_preference:\s+cfg\.shift/)
  assert.match(panel, /toUpdate\.push\(\{ id: cfg\.existingId, is_participating: false \}\)/)
  assert.match(panel, /supabase\.from\('units'\)\.insert\(toInsert\)/)
  assert.doesNotMatch(panel, /from\('units'\)\s*\.delete\(/, 'a unit row is never deleted')
  // The new drawing: search, Participating only, stepper, Details, and the pinned summary.
  assert.match(panel, /aria-label="Search units"/)
  assert.match(panel, /ariaLabel="Which units"/)
  assert.match(panel, /className="us-stepper"/)
  assert.match(panel, /className="us-details-btn"[^>]*aria-expanded=/)
  assert.match(panel, /className=\{`us-summary\$\{totals\.covered \? ' is-covered' : ' is-short'\}`\} role="status"/)
  assert.match(panel, /import '\.\/unitSetup\.css'/)
  assert.doesNotMatch(read('src/index.css'), /\.usp-|\.fsp-/, 'the retired rules are gone')
})

test('INK: the segmented picker and the Placement notice keep a readable pair in dark', () => {
  // Measured in a browser 2026-09-25: white on the lifted dark accent was 3.03:1 and the
  // resting ink 3.27:1. Dark mode defines both inks; light leaves them undefined so the
  // picker renders exactly what it did.
  const picker = read('src/components/shared/SegmentedPicker.jsx')
  assert.match(picker, /var\(--seg-active-ink,#fff\)/)
  assert.match(picker, /var\(--seg-rest-ink,var\(--text-secondary,#4A5560\)\)/)
  const theme = read('src/styles/theme.css')
  const dark = theme.slice(theme.indexOf(':root[data-theme="dark"] {'))
  assert.match(dark, /--seg-active-ink:\s*#0F1419/)
  assert.match(dark, /--seg-rest-ink:\s*#AAB4C0/)
  assert.doesNotMatch(theme.slice(0, theme.indexOf(':root[data-theme="dark"] {')), /--seg-(active|rest)-ink:/)
  // Classic dark keeps its papers light, so the shared warning notice keeps its light pair (1.52:1 otherwise).
  const home = read('src/components/home/home.css')
  const block = home.slice(home.indexOf('[data-theme="dark"] .hm-classic {'))
  assert.match(block.slice(0, block.indexOf('}')), /--chart-warn-ink: #8B5E1A; --chart-warn-bg: #FBF3E0;/)
})
