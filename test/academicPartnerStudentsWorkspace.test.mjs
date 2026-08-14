// AP Phase 1, Commit 2: the Students landing workspace. Pure roster-helper tests (cohort options,
// scope, summary counts, filtering) plus source guards that the workspace reuses the shared
// masthead and state primitives, scopes by school + cohort, and adds no later-phase surfaces.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import {
  compareCohortNewest, splitCohorts, cohortOptions, submissionCohortOptions, inCohortScope,
  AP_ALL, AP_ALL_CURRENT,
} from '../src/portal/ap/academicPartnerRoster.js'
import { computeStatusCounts } from '../src/lib/derivations/cohortStatus.js'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')
const stripJs = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const portal = read('src/portal/AcademicPartnerPortal.jsx')
const portalCode = stripJs(portal)
const css = read('src/portal/portal.css')

// Fixtures: two current (Active) cohorts, one historical (Completed), and one Planning + Accepting
// cohort with ZERO students (the case the roster-only inference used to hide). The CANONICAL cohort
// list comes from the endpoint newest-first, independent of the roster.
const c2026b = { id: 'c-2026b', name: 'Summer 2026', status: 'Active', start_date: '2026-06-01', end_date: '2026-08-15', accepting_submissions: false }
const c2026a = { id: 'c-2026a', name: 'Spring 2026', status: 'Active', start_date: '2026-01-01', end_date: '2026-04-15', accepting_submissions: false }
const c2025  = { id: 'c-2025',  name: 'Fall 2025', status: 'Completed', start_date: '2025-09-01', end_date: '2025-12-15', accepting_submissions: false }
const cFall2026 = { id: 'c-fall-2026', name: 'Fall 2026', status: 'Planning', start_date: '2026-09-01', end_date: '2026-12-15', accepting_submissions: true }
// Endpoint order (newest-first): the Planning+Accepting Fall cohort, the two Active, then historical.
const canonicalCohorts = [cFall2026, c2026b, c2026a, c2025]
const students = [
  { id: 's1', status: 'Active Rotation', cohort: c2026b },
  { id: 's2', status: 'Placed',          cohort: c2026a },
  { id: 's3', status: 'Completed',       cohort: c2025 },
  { id: 's4', status: 'Active Rotation', cohort: c2026a },
  { id: 's5', status: 'Completed',       cohort: c2026b },
]

test('canonical cohorts are consumed directly (not inferred from students) and split by Active status', () => {
  const { cohorts, current } = splitCohorts(canonicalCohorts)
  // Timeline order now: current (start ASC) -> upcoming -> historical (start DESC).
  assert.deepEqual(cohorts.map(c => c.id), ['c-2026a', 'c-2026b', 'c-fall-2026', 'c-2025'])
  assert.deepEqual(current.map(c => c.id), ['c-2026a', 'c-2026b'])                            // only Active, start ASC
  assert.ok(compareCohortNewest(c2026b, c2025) < 0)  // start_date newest-first comparator still exported
})

test('a Planning + Accepting cohort with ZERO student rows still appears as an option (root-cause fix)', () => {
  const { options } = cohortOptions(canonicalCohorts)
  assert.ok(options.some(o => o.id === 'c-fall-2026'), 'Fall 2026 appears even with no students')
})

test('cohort options: All Current only with >1 current, cohorts in timeline order, All Cohorts last', () => {
  const { options, defaultId } = cohortOptions(canonicalCohorts)
  assert.deepEqual(options.map(o => o.id), [AP_ALL_CURRENT, 'c-2026a', 'c-2026b', 'c-fall-2026', 'c-2025', AP_ALL])
  assert.equal(options[0].label, 'All Current Cohorts')
  assert.equal(options.at(-1).label, 'All Cohorts')
  // Default is the NEWEST current (Active) cohort by start date (Summer 2026 > Spring 2026), not the
  // Planning cohort and not All Current, even though the list now reads oldest-active first.
  assert.equal(defaultId, 'c-2026b')
})

test('with a single current cohort there is no All Current option, and it is the default', () => {
  const one = [c2026a, c2025]
  const { options, defaultId } = cohortOptions(one)
  assert.deepEqual(options.map(o => o.id), ['c-2026a', 'c-2025', AP_ALL])   // no all-current
  assert.equal(defaultId, 'c-2026a')
})

test('with no current cohort, All Cohorts is the default (historical never hidden)', () => {
  const historical = [c2025]
  const { options, defaultId } = cohortOptions(historical)
  assert.deepEqual(options.map(o => o.id), ['c-2025', AP_ALL])
  assert.equal(defaultId, AP_ALL)
})

test('the submission cohort picker offers only accepting cohorts (no All), default = nearest upcoming', () => {
  const { options, defaultId } = submissionCohortOptions(canonicalCohorts)
  assert.deepEqual(options.map(o => o.id), ['c-fall-2026'])   // only accepting; no All pseudo-option
  assert.equal(defaultId, 'c-fall-2026')                      // Fall selected though Summer/Spring are Active
})

test('cohort scope: All, All Current, and a single cohort each select the right students', () => {
  const { currentIds } = cohortOptions(canonicalCohorts)
  const inScope = (opt) => students.filter(s => inCohortScope(s, opt, currentIds)).map(s => s.id)
  assert.deepEqual(inScope(AP_ALL).sort(), ['s1', 's2', 's3', 's4', 's5'])
  assert.deepEqual(inScope(AP_ALL_CURRENT).sort(), ['s1', 's2', 's4', 's5'])   // excludes the Completed 2025 cohort
  assert.deepEqual(inScope('c-2026a').sort(), ['s2', 's4'])
})

test('the AP roster counts use the canonical shared grouping (no parallel AP grouping)', () => {
  // computeStatusCounts is the SAME grouping the main-app Student Profiles band uses.
  const counts = computeStatusCounts(students)
  assert.equal(counts.total, 5)
  assert.equal(counts.activeRotation, 2)
  assert.equal(counts.completed, 2)
  // The AP portal imports and uses it directly; the old AP-only summaryCounts/applyFilter are gone.
  assert.match(portal, /import \{ computeStatusCounts \} from '\.\.\/lib\/derivations\/cohortStatus'/)
  assert.match(portal, /computeStatusCounts\(scoped\)/)
  assert.doesNotMatch(portal, /summaryCounts|applyFilter/)
})

test('the KPI band is the canonical 8-up grid stepping 8 -> 4 -> 2, like the main app', () => {
  assert.match(css, /\.ptl-ap-kpis \{ display: grid; grid-template-columns: repeat\(8, 1fr\); gap: 10px; \}/)
  assert.match(css, /@media \(max-width: 1100px\) \{ \.ptl-ap-kpis \{ grid-template-columns: repeat\(4, 1fr\); \} \}/)
  assert.match(css, /@media \(max-width: 560px\)  \{ \.ptl-ap-kpis \{ grid-template-columns: repeat\(2, 1fr\); \} \}/)
  // The canonical FilterKPICard: native button, built-in aria-pressed (selection not color-only), hover.
  const kpi = read('src/components/KPIBand.jsx')
  // Every canonical prop must still be present. Asserted individually rather
  // than as a frozen signature: the shared primitive may gain ADDITIVE optional
  // props (e.g. ariaLabel for a card whose visible label changes with state),
  // and a whole-signature pin would fail on a change that breaks nothing.
  const sig = kpi.slice(kpi.indexOf('export function FilterKPICard('), kpi.indexOf(')', kpi.indexOf('export function FilterKPICard(')) + 1)
  for (const prop of ['value', 'label', 'sub', "accent = 'nightfall'", 'active', 'onClick']) {
    assert.ok(sig.includes(prop), `FilterKPICard must still take ${prop}`)
  }
  assert.match(kpi, /aria-pressed=\{active\}/)
  assert.match(kpi, /translateY\(-2px\)/)
})

test('the workspace reuses the shared masthead, last-visit hook, and state primitives', () => {
  assert.match(portal, /import GreetingMasthead from '\.\.\/components\/masthead\/GreetingMasthead'/)
  assert.match(portal, /import \{ useLastVisitLabel \} from '\.\.\/lib\/lastVisit'/)
  assert.match(portal, /useLastVisitLabel\(userProfile\?\.id \? `aspire:lastVisit:portal:ap:\$\{userProfile\.id\}` : null\)/)
  assert.match(portal, /<GreetingMasthead[\s\S]*?fullName=\{userProfile\?\.full_name\}[\s\S]*?contextLabel=\{cohortLabel\}/)
  assert.match(portal, /import \{ LoadingState, EmptyState, ErrorState, DeniedState \} from '\.\/unit\/UnitLeaderChrome'/)
  assert.match(css, /\.ptl-ap-page \.mast \{ margin: 0; \}/)
})

test('the school scope is in the header (selector only for multiple schools); scope is never sent to the server', () => {
  // Single school shows in the header subtitle; multiple schools get an authorized-school selector in
  // the header controls. No page-level school context row.
  assert.match(portal, /<PortalHeaderScope>\{schools\.length === 1 \? <> · \{school\.school_key\}<\/> : null\}<\/PortalHeaderScope>/)
  assert.match(portal, /schools\.length > 1 && \(/)                                       // selector only when >1
  assert.doesNotMatch(portalCode, /ptl-ap-schoolline/)
  // The roster fetch carries only the JWT; no school/cohort/scope query parameter is ever sent.
  assert.match(portal, /fetch\('\/api\/portal\/school-students', \{ headers: \{ Authorization: `Bearer \$\{token\}` \} \}\)/)
  assert.doesNotMatch(portalCode, /school-students\?|school_key=|cohort_id=|[?&]school=/)
})

test('the full canonical 8-card pathway band renders in order, with privacy-safe Not Proceeding copy', () => {
  assert.match(portal, /import \{ FilterKPICard \} from '\.\.\/components\/KPIBand'/)
  assert.match(portal, /<FilterKPICard[\s\S]*?value=\{f\.n\}[\s\S]*?sub=\{f\.sub\}[\s\S]*?accent=\{f\.accent\}[\s\S]*?active=\{sameFilter\(statusFilter, f\.payload\)\}/)
  // Exactly the eight canonical cards, in order, using canonical counts + grouping payloads.
  for (const [label, count] of [
    ['Total', 'counts.total'], ['Needs Outreach', 'counts.needsOutreach'], ['Awaiting Interview', 'counts.awaitingInterview'],
    ['Interviewed', 'counts.interviewed'], ['Placed', 'counts.placed'], ['Active Rotation', 'counts.activeRotation'],
    ['Completed', 'counts.completed'], ['Not Proceeding', 'counts.notProceeding'],
  ]) {
    assert.ok(portal.includes(`label: '${label}'`), `band has the ${label} card`)
    assert.ok(portal.includes(count), `${label} uses ${count}`)
  }
  // Not Proceeding is privacy-safe (no internal disposition detail leaked to the partner).
  assert.match(portal, /label: 'Not Proceeding',    sub: 'No longer moving forward'/)
  assert.doesNotMatch(portalCode, /not selected|withdrew|declined offer/i)
})

test('rows are non-interactive and no later-phase surfaces are rendered', () => {
  // No drawer open handler on rows, and no later-phase sections.
  assert.doesNotMatch(portalCode, /onClick=\{\(\) => .*open|openDrawer|setDrawer|onRowClick/)
  assert.doesNotMatch(portalCode, /OnCampusNow|StudentDetailDrawer|ptl-detail-drawer|Hours & Shifts|shift-activity/)
  // The released-reports section is intentionally not in the first-release Students workspace.
  assert.doesNotMatch(portalCode, /portal_my_school_reports|Released reports/)
})
