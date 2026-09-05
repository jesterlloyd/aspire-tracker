import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { PORTAL_LINKS } from '../src/lib/portalLinks.js'

const here = fileURLToPath(new URL('.', import.meta.url))
const read = path => readFileSync(join(here, '..', path), 'utf8')

const app = read('src/App.jsx')
const userMenu = read('src/components/UserMenu.jsx')
const portalApp = read('src/portal/PortalApp.jsx')
const shell = read('src/portal/PortalShell.jsx')
const portalLinks = read('src/lib/portalLinks.js')
const student = read('src/portal/StudentPortal.jsx')
const previewAccess = read('api/portal/admin-preview-access.js')
const studentPreview = read('api/portal/admin-student-preview.js')
const unitScope = read('api/lib/unitLeaderScope.js')
const schoolScope = read('api/lib/schoolScope.js')
const nursingScope = read('api/lib/nursingAcademicScope.js')
const portalCss = read('src/portal/portal.css')

test('Owner/Admin profile menu exposes the four current portals below Public site', () => {
  // PORTAL-SWITCHER-1: one list, read by the staff menu AND the portal menu, so the two
  // can never drift and a fifth portal is added in exactly one place.
  assert.deepEqual(
    PORTAL_LINKS.map(p => [p.key, p.label, p.path]),
    [
      ['student', 'Student Portal', '/portal/student'],
      ['unit_leader', 'Unit Leader Portal', '/portal/unit/home'],
      ['academic_partner', 'Academic Partner Portal', '/portal/ap/students'],
      ['nursing_academic', 'Nursing Education & Leadership Portal', '/portal/academics/calendar'],
    ],
  )
  for (const source of [userMenu, shell]) {
    assert.match(source, /from '\.\.\/lib\/portalLinks'/)
    assert.doesNotMatch(source, /'Unit Leader Portal'/, 'labels belong to the shared list, not a menu')
  }
  assert.ok(userMenu.indexOf('Public site') < userMenu.indexOf('PORTAL_LINKS.map'))
  assert.doesNotMatch(userMenu, /New Grad Residency Portal|\/portal\/ngrp/)
  assert.doesNotMatch(portalLinks, /New Grad Residency Portal|\/portal\/ngrp/)
})

test('every portal key is a real access role, an experience, and has an icon in both menus', () => {
  // The keys are the vocabulary shared with get_my_portal_access().roles and PortalApp's
  // `experience`, which is what lets one value mark the portal being viewed.
  for (const { key } of PORTAL_LINKS) {
    assert.match(portalApp, new RegExp(`includes\\('${key}'\\)`), `${key} must be a portal access role`)
    for (const [name, source] of [['staff menu', userMenu], ['portal menu', shell]]) {
      assert.match(source, new RegExp(`\\b${key}:\\s*\\w`), `${key} needs an icon in the ${name}`)
    }
  }
  assert.match(portalApp, /experience = isStudent \? 'student' : isUnitLeader \? 'unit_leader'/)
})

test('only active Owner/Admin staff routes enter preview; other staff still return to Main App', () => {
  assert.match(app, /const isOwnerAdmin = userProfile\?\.is_active !== false && \['owner', 'admin'\]\.includes\(userProfile\?\.role\)/)
  assert.match(app, /if \(isStaff && !isStaffPreviewRoute\)/)
  assert.match(app, /location\.pathname === '\/portal\/student' \|\| location\.pathname\.startsWith\('\/portal\/student\/'\)/)
  assert.match(app, /location\.pathname\.startsWith\('\/portal\/academics\/'\)/)
})

test('portal profile menu lets Owner/Admin cross to any portal, the main app, or Settings', () => {
  assert.match(shell, /<House size=\{15\} \/> Main App/)
  assert.match(shell, /<Settings size=\{15\} \/> Settings/)
  assert.match(shell, /portalSwitcher && \(/)
  assert.match(shell, /<div className="ptl-menu-group-label">Portals<\/div>/)
  // ONE predicate decides all of it, and it is the staff menu's own Owner/Admin test, so a
  // staff member offered a way ACROSS the portals is offered the way OUT from the same menu.
  assert.match(portalApp, /const staffMenu = ownerAdmin \? \{/)
  assert.match(portalApp, /portalSwitcher: \{ currentKey: previewRole \|\| experience \}/)
  assert.match(portalApp, /mainAppUrl: MAIN_APP_PATH/)
  assert.match(portalApp, /settingsUrl: STAFF_SETTINGS_PATH/)
  // All four shells read that one object; none keeps a switcher rule of its own.
  assert.equal((portalApp.match(/portalSwitcher=\{staffMenu\.portalSwitcher\}/g) || []).length, 4)
  assert.equal((portalApp.match(/mainAppUrl=\{staffMenu\.mainAppUrl\}/g) || []).length, 4)
  assert.doesNotMatch(portalApp, /mainAppUrl=\{staffPreview/)
})

test('the portal being viewed is marked and inert, so the menu says where you are', () => {
  assert.match(shell, /key === portalSwitcher\.currentKey/)
  assert.match(shell, /aria-current="page" aria-disabled="true"/)
  assert.match(shell, /className="ptl-menu-item ptl-menu-item-current"/)
  // Marked as a span, never an <a>: the current portal must not navigate to itself.
  const current = shell.slice(shell.indexOf('key === portalSwitcher.currentKey'))
  assert.ok(current.indexOf('</span>') < current.indexOf('</a>'))
  assert.match(portalCss, /\.ptl-menu-item-current/)
  assert.match(portalCss, /\.ptl-menu-wide/)
})

test('a real portal user is offered no switcher, no main app, and no Settings', () => {
  // The whole group hangs off ownerAdmin, which already requires an active staff role, so a
  // student, unit leader, academic partner or nursing academic menu is unchanged by this.
  assert.match(portalApp, /const ownerAdmin = userProfile\?\.is_active !== false && \['owner', 'admin'\]\.includes\(userProfile\?\.role\)/)
  assert.match(portalApp, /\} : \{\s*portalSwitcher: null,\s*mainAppUrl: undefined,\s*settingsUrl: undefined,/)
  for (const guarded of ['portalSwitcher', 'settingsUrl', 'mainAppUrl']) {
    assert.match(shell, new RegExp(`\\{${guarded} && \\(|\\{${guarded} &&\\n`), `${guarded} must render only when supplied`)
  }
})

test('no staff or student email is introduced into the portal bundle', () => {
  // messagesPhase5biiPortalActivation holds the same line for PortalApp; the identity block
  // in the portal menu deliberately shows the name and role only.
  assert.doesNotMatch(shell, /userEmail|\.email\b/)
  assert.doesNotMatch(portalCss, /ptl-menu-email/)
  assert.match(shell, /\{roleLabel && <span className="ptl-menu-role">\{roleLabel\}<\/span>\}/)
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
  assert.match(schoolScope, /catalogError[\s\S]*from\('students'\)[\s\S]*select\('school'\)/)
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
  assert.match(portalApp, /previewRole === 'student' \? '\/portal\/student\/messages'/)
  assert.match(portalApp, /Student messaging remains read-only in Owner\/Admin preview/)
  assert.match(student, /readOnly=\{readOnlyPreview\}/)
})

test('portal-only identity actions stay suppressed while staff preview uses staff utilities', () => {
  assert.match(portalApp, /function StaffPreviewUtilities/)
  assert.match(portalApp, /<MainMessagesLauncher \/>/)
  assert.match(portalApp, /<FeedbackPanel activeTab=\{section\}/)
  assert.match(portalApp, /previewRole === 'student' \? '\/portal\/student\/messages'/)
  assert.match(portalApp, /staffPreview && key === 'messages'[\s\S]{0,120}navigate\('\/connect\/messages'\)/)
  assert.match(portalApp, /messagesEnabled=\{staffPreview \|\| naMessagesEnabled\}/)
  assert.match(portalApp, /portalUserActionsEnabled=\{!staffPreview\}/)
  assert.match(portalApp, /\{!staffPreview && photoDialog\}/)
  assert.match(portalApp, /usePortalHeadshotUrl\(\{ enabled: isStudent && !staffPreview/)
  assert.match(portalApp, /enabled: !staffPreview && \(isStudent \|\| isUnitLeader/)
  assert.match(portalApp, /\{!staffPreview && <div style=\{\{ display: studentView === 'messages'/)
  assert.match(portalApp, /if \(staffPreview\) return/)
  assert.match(portalApp, /const tourOverlay = !staffPreview && experience \? \(/)
  assert.match(student, /canLogShift && !readOnlyPreview/)
  assert.match(student, /!readOnlyPreview && <button[^>]+Download your Certificate of Completion/)
})
