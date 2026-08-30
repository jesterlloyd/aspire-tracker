import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = fileURLToPath(new URL('.', import.meta.url))
const read = path => readFileSync(join(here, '..', path), 'utf8')

const app = read('src/App.jsx')
const userMenu = read('src/components/UserMenu.jsx')
const portalApp = read('src/portal/PortalApp.jsx')
const shell = read('src/portal/PortalShell.jsx')
const student = read('src/portal/StudentPortal.jsx')
const previewAccess = read('api/portal/admin-preview-access.js')
const studentPreview = read('api/portal/admin-student-preview.js')
const unitScope = read('api/lib/unitLeaderScope.js')
const schoolScope = read('api/lib/schoolScope.js')
const nursingScope = read('api/lib/nursingAcademicScope.js')

test('Owner/Admin profile menu exposes the four current portals below Public site', () => {
  for (const [label, path] of [
    ['Student Portal', '/portal/student'],
    ['Unit Leader Portal', '/portal/unit/home'],
    ['Academic Partner Portal', '/portal/ap/students'],
    ['Nursing Education & Leadership Portal', '/portal/academics/calendar'],
  ]) {
    assert.match(userMenu, new RegExp(label.replace(/[&]/g, '\\&')))
    assert.match(userMenu, new RegExp(path.replaceAll('/', '\\/')))
  }
  assert.ok(userMenu.indexOf('Public site') < userMenu.indexOf('PORTAL_LINKS.map'))
  assert.doesNotMatch(userMenu, /New Grad Residency Portal|\/portal\/ngrp/)
})

test('only active Owner/Admin staff routes enter preview; other staff still return to Main App', () => {
  assert.match(app, /const isOwnerAdmin = userProfile\?\.is_active !== false && \['owner', 'admin'\]\.includes\(userProfile\?\.role\)/)
  assert.match(app, /if \(isStaff && !isStaffPreviewRoute\)/)
  assert.match(app, /location\.pathname === '\/portal\/student'/)
  assert.match(app, /location\.pathname\.startsWith\('\/portal\/academics\/'\)/)
})

test('portal profile menu returns previewing staff to the Main App', () => {
  assert.match(shell, /<House size=\{15\} \/> Main App/)
  assert.match(portalApp, /mainAppUrl=\{staffPreview \? '\/aggregate' : undefined\}/)
})

test('preview access is server-derived and never provisions a portal account', () => {
  assert.match(previewAccess, /verifyOwnerAdminCaller\(req\)/)
  assert.match(previewAccess, /PREVIEW_ROLES\.has\(role\)/)
  assert.match(portalApp, /admin-preview-access\?role=\$\{encodeURIComponent\(previewRole\)\}/)
  assert.match(previewAccess, /from\('students'\)/)
  assert.match(previewAccess, /if \(role !== 'student'\)/)
  assert.doesNotMatch(previewAccess, /from\('units'\)|from\('schools'\)/)
  assert.doesNotMatch(previewAccess, /user_role_grants|user_student_links|user_unit_scopes|user_school_scopes|\.insert\(|\.update\(|\.delete\(/)
})

test('scoped portals provide Owner/Admin server scope without weakening portal grants', () => {
  assert.match(unitScope, /isOwnerAdminProfile\(caller\.profile\)/)
  assert.match(unitScope, /const scopes = unitKeys\.map\(unit_key => \(\{ unit_key, cohort_id: null \}\)\)/)
  assert.match(schoolScope, /isOwnerAdminProfile\(auth\.profile\)/)
  assert.match(schoolScope, /from\('schools'\)/)
  assert.match(nursingScope, /isOwnerAdminProfile\(caller\.profile\)/)
  assert.match(nursingScope, /staffPreview: true/)
  for (const source of [unitScope, schoolScope, nursingScope]) {
    assert.match(source, /hasActiveRoleGrant|nursing_academic_role_required/)
  }
})

test('Student preview is selected inside the portal and remains read-only', () => {
  assert.match(student, /<PortalHeaderControls>/)
  assert.match(student, /aria-label="Viewing student"/)
  assert.match(student, /admin-student-preview\?student_id=/)
  assert.match(student, /readOnly=\{readOnlyPreview\}/)
  assert.match(studentPreview, /verifyOwnerAdminCaller\(req\)/)
  assert.match(studentPreview, /buildStudentPortalSummary\(db, \[studentId\]\)/)
  assert.doesNotMatch(studentPreview, /\.insert\(|\.update\(|\.delete\(|student_edit_shift_log|student_void_shift_log/)
})

test('portal-only identity actions are suppressed during staff preview', () => {
  assert.match(portalApp, /messagesEnabled=\{!staffPreview\}/)
  assert.match(portalApp, /enabled=\{!staffPreview\}/)
  assert.match(portalApp, /portalUserActionsEnabled=\{!staffPreview\}/)
  assert.match(portalApp, /\{!staffPreview && photoDialog\}/)
  assert.match(portalApp, /usePortalHeadshotUrl\(\{ enabled: isStudent && !staffPreview/)
  assert.match(portalApp, /enabled: !staffPreview && \(isStudent \|\| isUnitLeader/)
  assert.match(portalApp, /\{!staffPreview && <div style=\{\{ display: studentView === 'messages'/)
  assert.match(portalApp, /if \(staffPreview\) return/)
  assert.match(portalApp, /const tourOverlay = !staffPreview && experience \? \(/)
  assert.match(student, /activeRotation && !readOnlyPreview/)
  assert.match(student, /!readOnlyPreview && <button[^>]+Download your Certificate of Completion/)
})
