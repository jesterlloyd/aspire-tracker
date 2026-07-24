// Guards for Commit 1 of the Preceptor Directory UI refinement.
// Static-source only: no SQL, migrations, browser automation, or network calls.
//
// Run: node --test test/preceptorDirectoryUiRefinement.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { sortPreceptorDirectoryRows } from '../src/lib/preceptorDirectory.js'

const here = dirname(fileURLToPath(import.meta.url))
const read = p => readFileSync(join(here, '..', p), 'utf8')
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const table = strip(read('src/components/shared/PreceptorDirectoryTable.jsx'))
const rowMenu = strip(read('src/components/shared/RowActionsMenu.jsx'))
const staff = strip(read('src/components/PreceptorsTable.jsx'))
const unit = strip(read('src/portal/unit/UnitPreceptorsWorkspace.jsx'))
const chrome = strip(read('src/portal/unit/UnitLeaderChrome.jsx'))
const endpoint = strip(read('api/portal/unit-preceptors.js'))
const css = read('src/index.css')
const portalCss = read('src/portal/portal.css')
const segmentedTabs = strip(read('src/components/ui/SegmentedTabs.jsx'))

test('both directories use the shared white Preceptor Directory table foundation', () => {
  assert.match(staff, /PreceptorDirectoryTable/)
  assert.match(unit, /PreceptorDirectoryTable/)
  assert.match(table, /<table className="am-table preceptor-dir-table">/)
  assert.match(css, /\.preceptor-dir-table \{[\s\S]*background: var\(--pearl\);/)
  assert.match(css, /\.preceptor-dir-table \.am-row \{ background: #fff; \}/)
  assert.doesNotMatch(portalCss, /ptl-prec-controls|background:\s*#f4f1ec[\s\S]*preceptor-dir|beige/i)
})

test('profile pictures render when available and fall back to initials without broken-image placeholders', () => {
  assert.match(table, /const avatarUrl = row\.avatar_url \|\| row\.profile_image_url \|\| \(emailKey \? contactAvatarMap\[emailKey\] : null\)/)
  assert.match(table, /const showPhoto = avatarUrl && !failed/)
  assert.match(table, /onError=\{\(\) => setFailedUrl\(avatarUrl\)\}/)
  assert.match(table, /preceptorInitials\(row\.full_name\)/)
  assert.match(table, /role="img" aria-label=\{`\$\{row\.full_name \|\| 'Preceptor'\} profile`\}/)
  assert.doesNotMatch(table, /style\.display = 'none'|style=\{\{ display: 'none' \}\}/)
  assert.match(endpoint, /\.from\('contacts'\)[\s\S]*\.select\('email, avatar_url'\)/)
  assert.match(endpoint, /avatar_url: emailKey \? contactAvatarMap\[emailKey\] \|\| null : null/)
})

test('Unit Leader controls are compact and preserve search and filters without a large filter card', () => {
  assert.match(unit, /className="ptl-prec-toolbar"/)
  assert.match(unit, />\+ Add Preceptor<\/button>/)
  assert.match(unit, /type="search"[\s\S]*placeholder="Name or email"/)
  assert.match(unit, /<details className="ptl-prec-filter-menu">/)
  assert.match(unit, /<summary className="ptl-btn ptl-btn-quiet">Filters<\/summary>/)
  assert.match(unit, /<option value="active">Active<\/option>/)
  assert.match(unit, /<option value="cross">Cross-unit only<\/option>/)
  assert.doesNotMatch(unit, /className="ptl-card ptl-prec-controls"|<span className="ptl-label">Sort<\/span>|<option value="count">Assignment count<\/option>/)
})

test('the Unit Leader unit selector uses the shared segmented-control language', () => {
  assert.match(chrome, /SegmentedTabs/)
  assert.match(chrome, /label="Viewing"/)
  assert.match(chrome, /label: 'All Assigned Units'/)
  assert.match(chrome, /items=\{items\}/)
  assert.match(chrome, /onChange=\{onChange\}/)
  assert.match(segmentedTabs, /role="tablist" aria-label=\{label\}/)
  assert.match(segmentedTabs, /role="tab"/)
  assert.match(segmentedTabs, /aria-selected=\{selected\}/)
  assert.match(segmentedTabs, /event\.key === 'ArrowRight'/)
  assert.match(segmentedTabs, /event\.key === 'Home'/)
  assert.doesNotMatch(chrome, /id="ul-unit-switcher"|<select[\s\S]*All assigned units/i)
  assert.match(css, /\.segmented-tabs \{[\s\S]*display: inline-flex;[\s\S]*overflow-x: auto;[\s\S]*border-radius: 7px;/)
  assert.match(css, /\.segmented-tabs-item\[aria-selected="true"\] \{[\s\S]*background: var\(--color-accent-primary, #1D2567\);[\s\S]*color: #fff;/)
  assert.match(portalCss, /\.ptl-unit-switcher \{[\s\S]*justify-self: start;/)
})

test('one canonical row kebab drives staff and Unit Leader row actions with role-specific items', () => {
  assert.match(table, /RowActionsMenu/)
  assert.match(table, /label=\{`Open actions for \$\{row\.full_name \|\| 'preceptor'\}`\}/)
  assert.match(table, /label: 'Manage Preceptor Assignments'/)
  assert.match(table, /label: 'Edit Preceptor'/)
  assert.match(table, /label: 'Delete Preceptor'/)
  assert.match(staff, /showAdminActions/)
  assert.match(unit, /onManagePreceptorAssignments=\{openManager\}/)
  assert.doesNotMatch(unit, /showAdminActions|onEditPreceptor|onDeletePreceptor/)
  assert.match(rowMenu, /aria-haspopup="menu"/)
  assert.match(rowMenu, /event\.key === 'Escape'/)
  assert.match(rowMenu, /btnRef\.current\?\.focus\(\)/)
  assert.match(rowMenu, /createPortal\(/)
})

test('Current Student contains assignment data only and keeps multiple active assignments', () => {
  const assignmentBlock = table.slice(table.indexOf('function AssignmentList'), table.indexOf('export default function PreceptorDirectoryTable'))
  assert.match(assignmentBlock, /preceptor-dir-student/)
  assert.match(assignmentBlock, /preceptor-dir-role-\$\{roleClass\}/)
  assert.doesNotMatch(assignmentBlock, /student_unit && <span className="preceptor-dir-context">/)
  assert.doesNotMatch(assignmentBlock, /Manage Preceptor Assignments|button|onClick/)
  assert.match(table, /sortAssignmentsForDisplay\(assignments\)/)
})

test('sortable headers cover the directory fields and preserve stable tie-breaking', () => {
  for (const key of ['name', 'unit', 'shift', 'status', 'current_student', 'count', 'association']) {
    assert.match(table, new RegExp(`sortKey="${key}"|sortKey="${key === 'count' ? 'count' : key}"`))
  }
  const rows = [
    { id: 'b', full_name: 'Same Name', shift: 'Night', is_active: true, assignments: [] },
    { id: 'a', full_name: 'Same Name', shift: 'Night', is_active: true, assignments: [] },
  ]
  assert.deepEqual(sortPreceptorDirectoryRows(rows, { sortBy: 'shift', sortDir: 'asc' }).map(row => row.id), ['a', 'b'])
})
