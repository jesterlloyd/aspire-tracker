// Guards for Commit 1 of Unit Leader Portal visual convergence.
// Static-source plus pure-helper tests only: no SQL, browser automation, or network calls.
//
// Run: node --test test/unitLeaderPortalVisualConvergenceCommit1.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { sortUnitLeaderStudentsByName } from '../src/portal/unit/unitLeaderStudentSort.js'

const here = dirname(fileURLToPath(import.meta.url))
const read = p => readFileSync(join(here, '..', p), 'utf8')
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const connect = strip(read('src/pages/Connect.jsx'))
const segmentedTabs = strip(read('src/components/ui/SegmentedTabs.jsx'))
const chrome = strip(read('src/portal/unit/UnitLeaderChrome.jsx'))
const portal = strip(read('src/portal/UnitLeaderPortal.jsx'))
const preceptorsWorkspace = strip(read('src/portal/unit/UnitPreceptorsWorkspace.jsx'))
const preceptorTable = strip(read('src/components/shared/PreceptorDirectoryTable.jsx'))
const sortHeader = strip(read('src/components/shared/SortHeader.jsx'))
const studentSort = strip(read('src/portal/unit/unitLeaderStudentSort.js'))
const css = read('src/index.css')
const portalCss = read('src/portal/portal.css')

test('Unit Leader unit selector reuses the canonical compact segmented tab component', () => {
  assert.match(connect, /<SegmentedTabs[\s\S]*label="ASPIRE Connect sections"/)
  assert.match(chrome, /<SegmentedTabs[\s\S]*className="ptl-unit-switcher"[\s\S]*label="Viewing"/)
  assert.match(chrome, /const items = \[\{ key: ALL_UNITS, label: 'All Assigned Units' \}, \.\.\.unitKeys\.map/)
  assert.match(segmentedTabs, /role="tablist" aria-label=\{label\}/)
  assert.match(segmentedTabs, /role="tab"/)
  assert.match(segmentedTabs, /aria-selected=\{selected\}/)
  assert.match(segmentedTabs, /tabIndex=\{selected \? 0 : -1\}/)
  assert.match(segmentedTabs, /event\.key === 'ArrowRight'/)
  assert.match(segmentedTabs, /event\.key === 'End'/)
  assert.match(css, /\.segmented-tabs \{[\s\S]*display: inline-flex;[\s\S]*max-width: 100%;[\s\S]*overflow-x: auto;/)
  assert.match(portalCss, /\.ptl-unit-switcher \{[\s\S]*justify-self: start;/)
  assert.doesNotMatch(chrome, /ptl-unit-segment|<select|id="ul-unit-switcher"/)
})

test('Messages workspace begins with the real workspace unless the concern route explicitly composes', () => {
  const messagesBranch = portal.slice(portal.indexOf("view === 'messages'"), portal.indexOf('// ── Home'))
  assert.match(messagesBranch, /view === 'messages' && composeIntent\?\.compose === 'aspire'/)
  assert.match(messagesBranch, /<PortalMessagesWorkspace[\s\S]*variant="unit_leader"/)
  assert.doesNotMatch(messagesBranch, /<AspireTeamComposer[\s\S]*startOpen=\{composeIntent\?\.compose === 'aspire'\}/)
  assert.match(read('src/portal/messages/PortalMessagesWorkspace.jsx'), /<MessageSquarePlus size=\{15\} aria-hidden="true" \/> New message/)
  assert.match(read('src/lib/messages/portalMessagesConstants.js'), /patient-care or safety concerns/)
})

test('Unit Leader Preceptors table uses the shared main-app table container and header treatment', () => {
  assert.match(preceptorsWorkspace, /<div className="am-table-wrap">\s*<PreceptorDirectoryTable/)
  assert.match(preceptorTable, /<table className="am-table preceptor-dir-table">/)
  // The header treatment moved into the shared SortHeader; the table composes it, and the staff
  // default keeps the am-th am-sortable cell so the appearance is unchanged.
  assert.match(preceptorTable, /import SortHeader from '\.\/SortHeader'/)
  assert.match(sortHeader, /thClassName = 'am-th am-sortable'/)
  assert.match(sortHeader, /<th[\s\S]*?scope="col"[\s\S]*?className=\{thClassName\}[\s\S]*?aria-sort=/)
  // UI-CONSISTENCY-2: the wrapper is a card, so it reads the card canon: no outline, the
  // shadow is the edge, the shared radius. The property this test guards, that the Unit
  // Leader table shares the main app's container, holds more strongly now, not less.
  assert.match(css, /\.am-table-wrap \{[\s\S]*border: 0; box-shadow: var\(--aspire-shadow-card\);[\s\S]*border-radius: var\(--aspire-radius-card\);[\s\S]*background: var\(--pearl\);/)
  assert.match(css, /\.am-th \{[\s\S]*font-size: var\(--aspire-th-size\);[\s\S]*font-weight: var\(--aspire-th-weight\);[\s\S]*letter-spacing: var\(--aspire-th-tracking\);[\s\S]*border-bottom: var\(--aspire-row-line\);/)
  assert.match(css, /\.preceptor-dir-sort \{[\s\S]*display: inline-flex;[\s\S]*align-items: center;/)
})

test('Current Student omits repeated unit text but keeps stacked assignment rows', () => {
  const assignmentBlock = preceptorTable.slice(preceptorTable.indexOf('function AssignmentList'), preceptorTable.indexOf('export default function PreceptorDirectoryTable'))
  assert.match(assignmentBlock, /sortAssignmentsForDisplay\(assignments\)/)
  assert.match(assignmentBlock, /rows\.map\(assignment =>/)
  assert.match(assignmentBlock, /preceptor-dir-student/)
  assert.match(assignmentBlock, /preceptor-dir-role-\$\{roleClass\}/)
  assert.doesNotMatch(assignmentBlock, /student_unit && <span className="preceptor-dir-context">/)
  assert.match(read('api/portal/unit-preceptors.js'), /student_unit:/)
})

test('Your Students defaults to stable A to Z and the Name header toggles aria-sort', () => {
  const rows = [
    { id: '3', first_name: 'Zoë', last_name: 'Ray' },
    { id: '1', first_name: 'Ana-Maria', last_name: "O'Neil" },
    { id: '2', full_name: 'ana maria Oneil' },
  ]
  assert.deepEqual(sortUnitLeaderStudentsByName(rows, 'asc').map(row => row.id), ['2', '1', '3'])
  assert.deepEqual(sortUnitLeaderStudentsByName(rows, 'desc').map(row => row.id), ['3', '1', '2'])
  assert.deepEqual(rows.map(row => row.id), ['3', '1', '2'], 'source data is not mutated')
  assert.match(studentSort, /Intl\.Collator\('en-US'[\s\S]*sensitivity: 'base'[\s\S]*ignorePunctuation: false/)
  assert.match(portal, /const \[nameSortDir, setNameSortDir\] = useState\('asc'\)/)
  assert.match(portal, /sortUnitLeaderStudentsByName\(students, nameSortDir\)/)
  assert.match(portal, /aria-sort=\{nameSortDir === 'asc' \? 'ascending' : 'descending'\}/)
  assert.match(portal, /className="ptl-stu-sort"/)
  assert.match(portal, /setNameSortDir\(current => current === 'asc' \? 'desc' : 'asc'\)/)
})

test('visual convergence changes do not widen Unit Leader data scope or controls', () => {
  assert.match(preceptorsWorkspace, /onManagePreceptorAssignments=\{openManager\}/)
  assert.doesNotMatch(preceptorsWorkspace, /showAdminActions|onEditPreceptor|onDeletePreceptor/)
  assert.doesNotMatch(portal, /Add Event|Add Availability|interviewer|cohort-wide|staff schedule/i)
  assert.match(read('src/portal/unit/unitLeaderApi.js'), /unitKey && unitKey !== ALL_UNITS \? `\?unit_key=\$\{encodeURIComponent\(unitKey\)\}` : ''/)
  assert.match(read('src/portal/unit/unitLeaderApi.js'), /getRoster = \(signal\) =>\s*apiFetch\('\/api\/portal\/unit-roster'/)
})
