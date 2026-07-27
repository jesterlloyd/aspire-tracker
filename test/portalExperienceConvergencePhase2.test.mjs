// Portal experience convergence Phase 2 static/pure guards.
// Run: node --test test/portalExperienceConvergencePhase2.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { sortPreceptorDirectoryRows } from '../src/lib/preceptorDirectory.js'
import {
  buildAssignmentMutationPayload,
  collectStudentAssignments,
} from '../src/portal/unit/unitPreceptorAssignments.js'

const here = dirname(fileURLToPath(import.meta.url))
const read = p => readFileSync(join(here, '..', p), 'utf8')
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const staffDirectory = strip(read('src/components/PreceptorsTable.jsx'))
const unitDirectory = strip(read('src/portal/unit/UnitPreceptorsWorkspace.jsx'))
const sharedTable = strip(read('src/components/shared/PreceptorDirectoryTable.jsx'))
// The sortable-header treatment was extracted into a shared SortHeader that the table imports.
const sortHeader = strip(read('src/components/shared/SortHeader.jsx'))
const manager = strip(read('src/portal/unit/UnitLeaderPreceptorManager.jsx'))
const staffEndpoint = strip(read('api/preceptor-assignment-manage.js'))
const portalEndpoint = strip(read('api/portal/unit-preceptor-manage.js'))

test('main app and Unit Leader use the shared preceptor directory table foundation', () => {
  assert.match(staffDirectory, /PreceptorDirectoryTable/)
  assert.match(unitDirectory, /PreceptorDirectoryTable/)
  assert.match(sharedTable, /preceptor-dir-avatar/)
  // The table composes the shared SortHeader, which carries the canonical aria-sort treatment.
  assert.match(sharedTable, /import SortHeader from '\.\/SortHeader'/)
  assert.match(sortHeader, /aria-sort=/)
  assert.match(sharedTable, /Primary: 'primary'/)
  assert.match(sharedTable, /preceptor-dir-role-\$\{roleClass\}/)
  assert.match(sharedTable, /showAdminActions/)
  assert.match(staffDirectory, /showAdminActions/)
  assert.doesNotMatch(unitDirectory, /showAdminActions/)
})

test('correct assignment link label is canonical', () => {
  const sources = [staffDirectory, unitDirectory, sharedTable].join('\n')
  assert.match(sharedTable, /Manage Preceptor Assignments/)
  assert.doesNotMatch(sources, /Manage student assignments/)
})

test('shared sorting is deterministic and keyboard-exposed', () => {
  const rows = [
    { full_name: 'Zed Nurse', home_unit: { name: '5N' }, active_assignment_count: 1, assignments: [] },
    { full_name: 'Ana Nurse', home_unit: { name: '5N' }, active_assignment_count: 3, assignments: [] },
    { full_name: 'Bob Nurse', home_unit: { name: '4N' }, active_assignment_count: 3, assignments: [] },
  ]
  assert.deepEqual(sortPreceptorDirectoryRows(rows, { sortBy: 'count', sortDir: 'desc' }).map(r => r.full_name), [
    'Bob Nurse', 'Ana Nurse', 'Zed Nurse',
  ])
  assert.match(sortHeader, /<button[\s\S]*?type="button"[\s\S]*?className="preceptor-dir-sort"/)
  assert.match(sortHeader, /aria-label=\{`Sort by \$\{children\}/)
})

test('Current Student rows preserve all roles and exact manager context', () => {
  const roster = [{
    id: 'p1',
    full_name: 'Primary One',
    home_unit: { name: '5N' },
    shift: 'Day',
    assignments: [
      { id: 'a1', student_id: 's1', role: 'Primary', student_name: 'Ana Lee', status: 'active' },
      { id: 'a2', student_id: 's1', role: 'Secondary', student_name: 'Ana Lee', status: 'active' },
      { id: 'a3', student_id: 's1', role: 'Coverage', student_name: 'Ana Lee', status: 'active' },
    ],
  }]
  assert.deepEqual(collectStudentAssignments(roster, 's1').map(row => [row.id, row.role]), [
    ['a1', 'primary'], ['a2', 'secondary'], ['a3', 'coverage'],
  ])
  assert.match(sharedTable, /onSelect: triggerEl => manage\(row, triggerEl\)/)
  assert.doesNotMatch(sharedTable, /onManageAssignment\(assignment/)
  assert.match(staffDirectory, /activeAssignmentRows/)
})

test('main-app directory opens the shared manager through staff authority, not Unit Leader scope', () => {
  assert.match(staffDirectory, /<UnitLeaderPreceptorManager/)
  assert.match(staffDirectory, /mutateStaffPreceptorAssignment/)
  assert.match(staffEndpoint, /verifyStaffCaller/)
  assert.match(staffEndpoint, /assign_primary_preceptor/)
  assert.match(staffEndpoint, /set_secondary_coverage_preceptor/)
  assert.doesNotMatch(staffEndpoint, /verifyPortalUnitLeaderCaller|unit_leader/)
  assert.match(portalEndpoint, /verifyPortalUnitLeaderCaller/)
})

test('exact-row assignment payload guarantees remain unchanged', () => {
  const replace = buildAssignmentMutationPayload({
    action: 'set_secondary', op: 'replace', role: 'secondary',
    studentId: 's1', assignmentId: 'a2', preceptorId: 'p2',
  }, 'request-replace')
  assert.equal(replace.assignment_id, 'a2')
  assert.equal(replace.role, 'secondary')
  const end = buildAssignmentMutationPayload({
    action: 'set_secondary', op: 'end', role: 'coverage',
    studentId: 's1', assignmentId: 'a3',
  }, 'request-end')
  assert.deepEqual(end, {
    action: 'set_secondary',
    op: 'end',
    role: 'coverage',
    student_id: 's1',
    request_id: 'request-end',
    assignment_id: 'a3',
  })
  assert.match(manager, /Only assignment <code>\{intent\.assignmentId\}<\/code> will end/)
})
