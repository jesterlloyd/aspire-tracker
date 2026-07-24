// Guards for Commit 2 of the Preceptor Assignment Manager refinement.
// Static/pure only; no SQL, migrations, browser automation, or network calls.
//
// Run: node --test test/preceptorAssignmentManagerRefinement.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import {
  assignmentManagerStudentDisplay,
  PRECEPTOR_ASSIGNMENT_MANAGER_TITLE,
} from '../src/portal/unit/unitPreceptorAssignments.js'

const here = dirname(fileURLToPath(import.meta.url))
const read = p => readFileSync(join(here, '..', p), 'utf8')
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const manager = strip(read('src/portal/unit/UnitLeaderPreceptorManager.jsx'))
const assignmentModule = strip(read('src/portal/unit/unitPreceptorAssignments.js'))
const staff = strip(read('src/components/PreceptorsTable.jsx'))
const unitWorkspace = strip(read('src/portal/unit/UnitPreceptorsWorkspace.jsx'))
const portal = strip(read('src/portal/UnitLeaderPortal.jsx'))
const endpoint = strip(read('api/portal/unit-preceptors.js'))
const css = read('src/portal/portal.css')

test('title is exactly shared title case across surfaces', () => {
  assert.equal(PRECEPTOR_ASSIGNMENT_MANAGER_TITLE, 'Manage Preceptor Assignments')
  assert.match(assignmentModule, /PRECEPTOR_ASSIGNMENT_MANAGER_TITLE = 'Manage Preceptor Assignments'/)
  assert.match(manager, /<h2 id="ptl-asn-title">\{PRECEPTOR_ASSIGNMENT_MANAGER_TITLE\}<\/h2>/)
  assert.doesNotMatch(manager, /Manage preceptor assignments/)
  assert.match(staff, /<UnitLeaderPreceptorManager/)
  assert.match(portal, /<UnitLeaderPreceptorManager/)
  assert.match(unitWorkspace, /<UnitLeaderPreceptorManager/)
})

test('subtitle uses one normalized safe display model with name, unit, and shift when available', () => {
  assert.deepEqual(assignmentManagerStudentDisplay({
    first_name: 'Daria',
    last_name: 'Klienert',
    unit_key: '8 South',
    shift: 'Night',
  }), {
    name: 'Daria Klienert',
    unit: '8 South',
    shift: 'Night',
    subtitle: 'Daria Klienert · 8 South · Night',
  })
  assert.equal(assignmentManagerStudentDisplay({
    full_name: 'Vivian Huang',
    unit_key: '6 NW',
  }).subtitle, 'Vivian Huang · 6 NW')
  assert.doesNotMatch(assignmentManagerStudentDisplay({ first_name: 'Vivian' }).subtitle, /-|·\s*$/)
  assert.match(manager, /const studentContext = assignmentManagerStudentDisplay\(student\)/)
  assert.match(manager, /\{studentContext\.subtitle && <p className="ptl-muted">\{studentContext\.subtitle\}<\/p>\}/)
})

test('both directory callers pass student unit and shift into the shared modal context', () => {
  assert.match(staff, /unit_key: assignment\.student_unit/)
  assert.match(staff, /shift: assignment\.student_shift/)
  assert.match(staff, /student_shift: student\.shift \|\| student\.shift_assigned \|\| student\.assigned_shift_type \|\| student\.shift_availability/)
  assert.match(unitWorkspace, /unit_key: assignment\.student_unit/)
  assert.match(unitWorkspace, /shift: assignment\.student_shift/)
  assert.match(endpoint, /student_shift: student\.shift \|\| student\.shift_availability \|\| null/)
})

test('modal presentation uses compact white sections, internal scrolling, and 44px actions', () => {
  assert.match(css, /\.ptl-asn-manager \{[\s\S]*display: flex; flex-direction: column;[\s\S]*overflow: hidden;/)
  assert.match(css, /\.ptl-asn-body \{[\s\S]*overflow-y: auto;/)
  assert.match(css, /\.ptl-asn-section \{[\s\S]*border: 1px solid #e5e7eb;[\s\S]*background: #fff;/)
  assert.match(css, /\.ptl-asn-row-action \{[\s\S]*min-height: 44px;[\s\S]*border: 1px solid #d1d5db;/)
  assert.match(css, /\.ptl-asn-section \.ptl-btn-small,[\s\S]*\.ptl-asn-actions button \{ min-height: 44px; \}/)
})

test('assignment rows show details and compact contextual actions', () => {
  assert.match(manager, /assignment\.preceptor\.home_unit\?\.name/)
  assert.match(manager, /assignment\.preceptor\.shift/)
  assert.match(manager, /Started \$\{fmtDate\(assignment\.start_date\)\}/)
  assert.match(manager, /className="ptl-asn-row-action"/)
  assert.match(manager, /className="ptl-asn-row-action ptl-asn-row-action-danger"/)
  assert.match(manager, /aria-label=\{`Replace \$\{label\} assignment for \$\{row\.preceptor\.full_name\}`\}/)
  assert.match(manager, /aria-label=\{`End \$\{label\} assignment for \$\{row\.preceptor\.full_name\}`\}/)
  assert.doesNotMatch(manager, /className="ptl-linklike" disabled=\{readOnly\}[\s\S]*Replace/)
})

test('empty states and authorized actions are exact and unchanged', () => {
  assert.match(manager, /No active Primary assignment/)
  assert.match(manager, /No active \{label\} assignments/)
  assert.match(manager, /Change Primary/)
  assert.match(manager, /Add \{label\}/)
  assert.match(manager, /Replace/)
  assert.match(manager, /End/)
  assert.match(manager, /Only assignment <code>\{intent\.assignmentId\}<\/code> will end/)
})

test('staff and Unit Leader candidate scopes remain distinct', () => {
  assert.match(staff, /loadStaffAssignments/)
  assert.match(staff, /mutateStaffPreceptorAssignment/)
  assert.match(unitWorkspace, /<UnitLeaderPreceptorManager student=\{manager\}/)
  assert.doesNotMatch(unitWorkspace, /mutateStaffPreceptorAssignment|usePreceptors/)
  assert.match(manager, /loadPreceptors = getUnitPreceptors/)
  assert.match(manager, /mutateAssignment = mutateUnitPreceptorAssignment/)
})
