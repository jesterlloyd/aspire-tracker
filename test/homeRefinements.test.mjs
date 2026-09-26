// test/homeRefinements.test.mjs
//
// HOME-1, the Owner's refinements of 2026-09-25: the Requests by school filters (counted in
// students), Email Academic Partners (a launch that selects every Academic Partner contact),
// the rewritten Academic Partner Placement Request template and the [Cohort Request Password]
// guard, the Cohort Pulse wave, the pill buttons, and Unit Setup as a compact table.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
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

test('CAPACITY FILTERS: service-line totals use the canonical division and selected status rows', () => {
  const overview = read('src/components/OverviewTab.jsx')
  assert.match(overview, /getUnit\(u\?\.unit_name\)\?\.division \|\| u\?\.division/)
  assert.match(overview, /filteredCapacityByServiceLine\(\{[\s\S]{0,180}capacityRows: capacityFiltered/)
  assert.ok(overview.indexOf('const capacityFiltered') < overview.indexOf('const serviceLineRows'))
  assert.match(overview, /capacityFiltered\.filter\(r => capacityDivisionOf\(r\) === row\.serviceLine\)/)
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

test('PULSE: no wave runs through the Cohort Pulse arrows', () => {
  // Owner, 2026-09-25, reversing the day's earlier request: "the wave of light that runs through
  // the cohort pulse, I don't think I like that. remove."
  const css = read('src/components/home/home.css')
  assert.doesNotMatch(css, /hm-wave|\.hm-stage::after/)
  assert.doesNotMatch(read('src/components/home/CohortPulse.jsx'), /--hm-i/)
  // The current stage is still the one solid arrow.
  assert.match(css, /\.hm-stage\.is-cur \{ background: var\(--hm-navy\); color: var\(--hm-on-navy\); \}/)
})

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

test('UNIT SETUP 5: the panel is the standard side drawer, wider, with no accent edge', () => {
  // Owner, 2026-09-25: "remove the blue outline on the side. follow every other modal like this".
  const panel = read('src/components/UnitSetupPanel.jsx')
  assert.match(panel, /import DetailDrawer from '\.\/ui\/DetailDrawer'/)
  assert.match(panel, /<DetailDrawer open title="Unit Setup" onClose=\{close\} width=\{860\} footer=\{footer\}>/)
  assert.doesNotMatch(panel, /fullscreen-panel/)
  const css = read('src/components/unitSetup.css')
  assert.doesNotMatch(css, /border-left:\s*3px/, 'the blue edge is gone')
  assert.doesNotMatch(css, /fullscreen-panel/)
  // The pinned search stays inside the body, or the drawer scrolls sideways.
  assert.doesNotMatch(css, /\.us-tools \{[^}]*margin: 0 -/)
})

test('CLASSIC DESK 2: square paper, shadows not outlines, a torn edge, glass, one top line', () => {
  const css = read('src/components/home/home.css')
  assert.match(css, /\.hm-classic \.hm-notepad, \.hm-classic \.hm-report, \.hm-classic \.hm-sheet, \.hm-classic \.hm-tape,\s*\.hm-classic \.hm-grp, \.hm-classic \.hm-caught \{ border-radius: 0; \}/)
  assert.match(css, /\.hm-classic \.ds\[data-level="plain"\] \{\s*border: 0;\s*border-radius: 0;\s*box-shadow:/)
  // The folder keeps its shape: it is not paper.
  assert.match(css, /\.hm-classic \.hm-folder \{[^}]*border-radius: 0 var\(--aspire-radius-card\)/)
  // The tear is a drawing below the paper, so the paper keeps its shadow; no clip-path.
  assert.doesNotMatch(css, /\.hm-classic \.hm-tape \{[^}]*clip-path/)
  assert.match(css, /\.hm-classic \.hm-tape::after \{[^}]*bottom: -13px;[^}]*repeat-x;/)
  // An inline SVG needs its hashes escaped, or the image silently fails to draw.
  for (const u of css.match(/url\("data:image\/svg\+xml,[^"]*"\)/g) || []) assert.doesNotMatch(u, /#/)
  assert.match(css, /\.hm-clip \{[^}]*background: url\("data:image\/svg\+xml,/)
  assert.match(css, /\.hm-window-glass \{[^}]*linear-gradient\(118deg/)
  // Today and Cohort Pulse share a top; the picker clears the double rule.
  assert.match(css, /\.hm-classic \.hm-duo > \.hm-notepad \{ margin-top: 0; \}/)
  assert.doesNotMatch(css, /\.hm-classic \.hm-notepad \{ margin-top:/)
  assert.match(css, /\.hm-classic \.hm-notepad \.hm-today-picker \{ margin-top: 12px; \}/)
})

test('CLASSIC DESK 3: Placement is one sheet, with no stack of paper under it', () => {
  // Owner, 2026-09-25: "remove the stack of paper in classic theme - Placement".
  assert.doesNotMatch(read('src/components/home/PlacementCard.jsx'), /material-pagestack/)
  assert.doesNotMatch(read('src/components/home/home.css'), /pagestack|pageStack/)
})

test('UNIT SETUP 6: the unused units CSV import is gone, and Unit Setup is the one writer of the default', () => {
  // ImportUnitsCSV lost its only mount in 6ec83040 and was deleted on 2026-09-25. The default
  // shift it last wrote (b5a8febb) is still pinned where it lives: DEFAULT_SHIFT in
  // unitSetupModel.js, tested above ('No Preference', and a stored 'Either' reads as it).
  assert.equal(existsSync(join(root, 'src/components/ImportUnitsCSV.jsx')), false)
  assert.doesNotMatch(read('src/index.css'), /\.col-mapper|\.req-star/, 'its private styles went with it')
})

test('WINDOW: the scenery shows in both styles, flush to the top, in a square window', () => {
  // Owner, 2026-09-25: "the skyline isn't showing in modern theme", "it looks lower", "the frame
  // doesn't have rounded corners, it's a window".
  const banner = read('src/components/home/HomeBanner.jsx')
  // One wrapper in both styles: a style switch changes a class, never rebuilds the card.
  assert.match(banner, /<div className=\{classic \? 'hm-window' : 'hm-frameless'\}>\{scene\}<\/div>/)
  assert.match(banner, /<SkylineCard fullName=\{fullName\}/)
  assert.doesNotMatch(banner, /if \(!classic\) return undefined/, 'the service clock is hidden in both styles')
  assert.match(banner, /\.mast\{margin-top:0!important;border-radius:0!important;box-shadow:none!important\}/, 'the service card\'s own margin, corner and shadow are taken back')
  const css = read('src/components/home/home.css')
  const block = (sel) => { const i = css.indexOf(sel + ' {'); return css.slice(i, css.indexOf('}', i)) }
  assert.doesNotMatch(block('.hm-window'), /border-radius/)
  assert.doesNotMatch(block('.hm-sill'), /border-radius/)
  // The scene grows to fit its content: a definite width, a ratio, and no clip of its own.
  assert.match(block('.hm-window-scene'), /width: 100%;\s*aspect-ratio: 5 \/ 1;/)
  assert.doesNotMatch(block('.hm-window-scene'), /overflow|min-height/)
})

test('WINDOW: the weather is clickable and its city picker covers the page', () => {
  // Owner, 2026-09-25: "I can't change location/cities". The content layer lay over the weather.
  const css = read('src/components/home/home.css')
  assert.match(css, /\.hm-window-content \{[^}]*pointer-events: none;/)
  assert.match(css, /\.hm-window-content \.hm-cmdwrap \{ pointer-events: auto; \}/)
  assert.match(css, /\.hm-classic > \.hm-hero \{ z-index: 5; \}/)
})

test('WINDOW: the glass reflection travels as the page scrolls, and holds still under reduced motion', () => {
  const banner = read('src/components/home/HomeBanner.jsx')
  assert.match(banner, /function useScrollGlare\(sceneRef, glareRef, enabled\)/)
  assert.match(banner, /prefers-reduced-motion: reduce\)'\)\.matches\) return undefined/)
  assert.match(banner, /addEventListener\('scroll', onScroll, \{ capture: true, passive: true \}\)/)
  assert.match(banner, /<div className="hm-window-glare" ref=\{glareRef\} \/>/)
  assert.match(read('src/components/home/home.css'), /\.hm-window-glare \{[^}]*transform: translate3d\(var\(--hm-glare-x, 0px\), 0, 0\);/)
})

test('LAUNCHER: the quick actions show only while the launcher is in use', () => {
  // Owner, 2026-09-25: "the tiles should only show up when I click on the search bar".
  const l = read('src/components/home/Launcher.jsx')
  assert.match(l, /onBlur=\{\(e\) => \{ if \(!e\.currentTarget\.contains\(e\.relatedTarget\)\) setInUse\(false\) \}\}/)
  assert.match(l, /<div className="hm-chips" aria-label="Quick actions" hidden=\{!inUse\}>/)
  // A click lands before anything hides: the chip keeps the field focused.
  assert.match(l, /onMouseDown=\{\(e\) => e\.preventDefault\(\)\} onClick=\{\(\) => onRun\?\.\(a\)\}/)
  assert.match(l, /if \(!query\) inputRef\.current\?\.blur\(\)/)
  assert.match(read('src/components/home/home.css'), /\.hm-chips\[hidden\] \{ display: none; \}/)
})

test('WINDOW: a card built after the first still gets the banner\'s style, and the corner is one edge', () => {
  // Owner, 2026-09-25: switching style showed the service's greeting over ours and a gap on top,
  // until a reload; and the rounded corners showed a dark fringe.
  const banner = read('src/components/home/HomeBanner.jsx')
  assert.match(banner, /for \(const card of host\.querySelectorAll\('skyline-card'\)\)/)
  assert.match(banner, /new MutationObserver\(\(records\) => \{\s*if \(records\.some\(r => \[\.\.\.r\.addedNodes\]\.some\(isCard\)\)\) start\(\)/)
  assert.match(banner, /mo\.observe\(host, \{ childList: true, subtree: true \}\)/)
  const css = read('src/components/home/home.css')
  const i = css.indexOf('.hm-window-scene {')
  assert.doesNotMatch(css.slice(i, css.indexOf('}', i)), /background/, 'the scene draws no curve of its own')
  assert.match(css, /\.hm-window-scene \.mast-host \{ position: absolute; inset: 0; overflow: hidden; border-radius: inherit; background: var\(--aspire-navy\); \}/)
})
