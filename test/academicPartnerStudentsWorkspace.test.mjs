// AP Phase 1, Commit 2: the Students landing workspace. Pure roster-helper tests (cohort options,
// scope, summary counts, filtering) plus source guards that the workspace reuses the shared
// masthead and state primitives, scopes by school + cohort, and adds no later-phase surfaces.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import {
  compareCohortNewest, deriveCohorts, cohortOptions, inCohortScope, summaryCounts, applyFilter,
  AP_ALL, AP_ALL_CURRENT,
} from '../src/portal/ap/academicPartnerRoster.js'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')
const stripJs = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const portal = read('src/portal/AcademicPartnerPortal.jsx')
const portalCode = stripJs(portal)
const css = read('src/portal/portal.css')

// Fixtures: two current (Active) cohorts and one historical (Completed).
const c2026b = { id: 'c-2026b', name: 'Fall 2026', status: 'Active', start_date: '2026-09-01', end_date: '2026-12-15' }
const c2026a = { id: 'c-2026a', name: 'Summer 2026', status: 'Active', start_date: '2026-06-01', end_date: '2026-08-15' }
const c2025  = { id: 'c-2025',  name: 'Fall 2025', status: 'Completed', start_date: '2025-09-01', end_date: '2025-12-15' }
const students = [
  { id: 's1', status: 'Active Rotation', cohort: c2026b },
  { id: 's2', status: 'Placed',          cohort: c2026a },
  { id: 's3', status: 'Completed',       cohort: c2025 },
  { id: 's4', status: 'Active Rotation', cohort: c2026a },
  { id: 's5', status: 'Completed',       cohort: c2026b },
]

test('cohorts sort newest first and split out the current (Active) subset', () => {
  const { cohorts, current } = deriveCohorts(students)
  assert.deepEqual(cohorts.map(c => c.id), ['c-2026b', 'c-2026a', 'c-2025'])   // newest start_date first
  assert.deepEqual(current.map(c => c.id), ['c-2026b', 'c-2026a'])             // only Active
  // compareCohortNewest is a stable newest-first comparator.
  assert.ok(compareCohortNewest(c2026b, c2025) < 0)
  assert.ok(compareCohortNewest(c2025, c2026b) > 0)
})

test('cohort options: All Current only with >1 current, cohorts newest-first, All Cohorts last', () => {
  const { options, defaultId } = cohortOptions(students)
  assert.deepEqual(options.map(o => o.id), [AP_ALL_CURRENT, 'c-2026b', 'c-2026a', 'c-2025', AP_ALL])
  assert.equal(options[0].label, 'All Current Cohorts')
  assert.equal(options.at(-1).label, 'All Cohorts')
  // Default is the NEWEST current cohort (not All Current).
  assert.equal(defaultId, 'c-2026b')
})

test('with a single current cohort there is no All Current option, and it is the default', () => {
  const one = [{ id: 'x', status: 'Placed', cohort: c2026a }, { id: 'y', status: 'Completed', cohort: c2025 }]
  const { options, defaultId } = cohortOptions(one)
  assert.deepEqual(options.map(o => o.id), ['c-2026a', 'c-2025', AP_ALL])   // no all-current
  assert.equal(defaultId, 'c-2026a')
})

test('with no current cohort, All Cohorts is the default (historical never hidden)', () => {
  const historical = [{ id: 'z', status: 'Completed', cohort: c2025 }]
  const { options, defaultId } = cohortOptions(historical)
  assert.deepEqual(options.map(o => o.id), ['c-2025', AP_ALL])
  assert.equal(defaultId, AP_ALL)
})

test('cohort scope: All, All Current, and a single cohort each select the right students', () => {
  const { currentIds } = cohortOptions(students)
  const inScope = (opt) => students.filter(s => inCohortScope(s, opt, currentIds)).map(s => s.id)
  assert.deepEqual(inScope(AP_ALL).sort(), ['s1', 's2', 's3', 's4', 's5'])
  assert.deepEqual(inScope(AP_ALL_CURRENT).sort(), ['s1', 's2', 's4', 's5'])   // excludes the Completed 2025 cohort
  assert.deepEqual(inScope('c-2026a').sort(), ['s2', 's4'])
})

test('summary counts and filtering map to real students.status values only', () => {
  const scoped = students   // treat all as the scope for the count test
  const counts = summaryCounts(scoped)
  assert.deepEqual(counts, { all: 5, rotating: 2, completed: 2 })
  assert.deepEqual(applyFilter(scoped, 'rotating').map(s => s.id).sort(), ['s1', 's4'])
  assert.deepEqual(applyFilter(scoped, 'completed').map(s => s.id).sort(), ['s3', 's5'])
  assert.equal(applyFilter(scoped, 'all').length, 5)
})

test('the KPI filters and pickers share one control row that wraps responsively', () => {
  // KPI cards left, pickers pushed right on desktop, both wrap cleanly on narrow.
  assert.match(css, /\.ptl-ap-controls \{ display: flex; flex-wrap: wrap;[^}]*\}/)
  assert.match(css, /\.ptl-ap-kpis \{ display: grid; grid-template-columns: repeat\(3, minmax\(132px, 200px\)\);/)
  assert.match(css, /\.ptl-ap-pickers \{[^}]*margin-left: auto;/)
  assert.match(css, /@media \(max-width: 640px\) \{[\s\S]*?\.ptl-ap-pickers \{ width: 100%; margin-left: 0; \}/)
  // The canonical FilterKPICard is a native button with built-in aria-pressed (selection is not
  // color-only) and hover movement; the AP page inherits the portal focus-visible ring.
  const kpi = read('src/components/KPIBand.jsx')
  assert.match(kpi, /export function FilterKPICard\(\{ value, label, sub, accent = 'nightfall', active, onClick \}\)/)
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

test('summary filters reuse the canonical FilterKPICard, exactly All / Currently Rotating / Completed', () => {
  // Reuse of the main-app pastel filter card (built-in aria-pressed + hover), not a bespoke pill.
  assert.match(portal, /import \{ FilterKPICard \} from '\.\.\/components\/KPIBand'/)
  assert.match(portal, /<FilterKPICard[\s\S]*?value=\{f\.n\}[\s\S]*?accent=\{f\.accent\}[\s\S]*?active=\{filter === f\.key\}/)
  assert.match(portal, /label: 'All Students',       n: counts\.all,       accent: 'nightfall'/)
  assert.match(portal, /label: 'Currently Rotating', n: counts\.rotating,  accent: 'marina'/)
  assert.match(portal, /label: 'Completed',          n: counts\.completed, accent: 'sage'/)
  assert.doesNotMatch(portalCode, /Needs Attention|needsAttention/)          // no Needs Attention this phase
})

test('rows are non-interactive and no later-phase surfaces are rendered', () => {
  // No drawer open handler on rows, and no later-phase sections.
  assert.doesNotMatch(portalCode, /onClick=\{\(\) => .*open|openDrawer|setDrawer|onRowClick/)
  assert.doesNotMatch(portalCode, /OnCampusNow|StudentDetailDrawer|ptl-detail-drawer|Hours & Shifts|shift-activity/)
  // The released-reports section is intentionally not in the first-release Students workspace.
  assert.doesNotMatch(portalCode, /portal_my_school_reports|Released reports/)
})
