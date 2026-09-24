import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  reconcileStudentRotationActivity,
  groupStudentActivityByDate,
} from '../src/lib/studentRotationActivityCore.js'

const here = dirname(fileURLToPath(import.meta.url))
const read = path => readFileSync(join(here, '..', path), 'utf8')

const migration = read('supabase/migrations/20260901010000_student_rotation_activity.sql')
const endpoint = read('api/portal/my-rotation-activity.js')
const manageEndpoint = read('api/portal/my-shift-log-manage.js')
const component = read('src/portal/StudentRotationActivity.jsx')
const portal = read('src/portal/StudentPortal.jsx')
const portalApp = read('src/portal/PortalApp.jsx')
const portalLinks = read('src/lib/portalLinks.js')
const nav = read('src/portal/PortalNav.jsx')

test('an actual log replaces a planned shift on the same date without duplicating a clinical record', () => {
  const activity = reconcileStudentRotationActivity(
    [{ id: 'log-1', shift_date: '2026-09-10', lifecycle_state: 'completed', total_hours: 8 }],
    [
      { id: 'plan-1', shift_date: '2026-09-10', preceptor_name: 'Jordan Bell' },
      { id: 'plan-2', shift_date: '2026-09-12', preceptor_name: 'Jordan Bell' },
    ],
  )
  assert.deepEqual(activity.map(item => [item.id, item.kind]), [
    ['log-1', 'logged'],
    ['plan-2', 'planned'],
  ])
  assert.equal(groupStudentActivityByDate(activity).get('2026-09-10').length, 1)
})

test('withdrawn logs do not suppress a still-active plan', () => {
  const activity = reconcileStudentRotationActivity(
    [{ id: 'log-1', shift_date: '2026-09-10', lifecycle_state: 'voided' }],
    [{ id: 'plan-1', shift_date: '2026-09-10', preceptor_name: 'Jordan Bell' }],
  )
  assert.deepEqual(activity.map(item => item.kind), ['planned'])
})

test('planned shifts are structurally separate from hour-bearing shift logs', () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.student_shift_plans/)
  assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS uq_student_shift_plans_active_day[\s\S]*?\(student_id, shift_date\)[\s\S]*?WHERE cancelled_at IS NULL/)
  const table = migration.slice(migration.indexOf('CREATE TABLE IF NOT EXISTS public.student_shift_plans'), migration.indexOf(');', migration.indexOf('CREATE TABLE IF NOT EXISTS public.student_shift_plans')))
  for (const forbidden of ['total_hours', 'status', 'approved', 'attestation', 'checked_in_at']) {
    assert.ok(!table.includes(forbidden), `${forbidden} does not belong to a plan`)
  }
  assert.match(migration, /REVOKE ALL ON public\.student_shift_plans FROM PUBLIC, anon, authenticated, service_role/)
  assert.match(migration, /GRANT SELECT, INSERT, UPDATE ON public\.student_shift_plans TO service_role/)
  assert.doesNotMatch(migration, /GRANT[^;]*DELETE[^;]*student_shift_plans/)
})

test('the plan endpoint derives identity from the portal link and reads coordinator blackout dates', () => {
  assert.match(endpoint, /verifyPortalCaller\(req\)/)
  assert.match(endpoint, /hasActiveRoleGrant\(db, auth\.profile\.id, 'student'\)/)
  assert.match(endpoint, /getActiveStudentLinks\(db, auth\.profile\.id\)/)
  assert.match(endpoint, /cohort_school_rotations/)
  assert.match(endpoint, /blackout_dates/)
  assert.match(endpoint, /student_preceptor_assignments/)
  assert.match(endpoint, /studentIds\.includes\(data\.student_id\)/)
  assert.match(endpoint, /actual_shift_exists/)
})

test('reviewed-log edits preserve review history and require a fresh approval', () => {
  assert.match(migration, /DROP INDEX IF EXISTS public\.uq_slr_one_decision_per_shift/)
  assert.match(migration, /CREATE INDEX IF NOT EXISTS idx_slr_shift_history/)
  assert.match(migration, /status IN \('Auto-Accepted', 'Pending Review', 'Approved', 'Rejected'\)/)
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.student_revise_shift_log/)
  assert.match(migration, /status\s+= 'Pending Review'/)
  assert.match(migration, /reviewed_by\s+= NULL/)
  assert.match(migration, /reviewed_at\s+= NULL/)
  assert.match(migration, /INSERT INTO public\.student_shift_log_edits/)
  assert.match(manageEndpoint, /rpc\('student_revise_shift_log'/)
  assert.match(manageEndpoint, /voidable: \['Auto-Accepted', 'Pending Review'\]\.includes\(shiftRow\.status\)/)
})

test('Student Home and navigation match the approved information architecture', () => {
  assert.match(portal, /lazyReload\(\(\) => import\('\.\/StudentRotationActivity'\), 'StudentRotationActivity'\)/)
  assert.match(portal, /<StudentRotationActivity/)
  assert.match(portal, />Rotation Progress<\/h2>/)
  assert.match(portal, />Placement Progress<\/h2>/)
  assert.match(portal, />ASPIRE Status<\/h2>/)
  assert.match(portal, />Badge and Certificates<\/h2>/)
  assert.match(portalApp, /startsWith\('\/portal\/placement'\)/)
  // PORTAL-SWITCHER-1: the preview path mapping moved to the shared portal list, which
  // PortalApp reads as portalKeyFromPath.
  assert.match(portalLinks, /pathname === '\/portal\/student' \|\| pathname\.startsWith\('\/portal\/student\/'\)/)
  assert.match(portalApp, /previewRole = ownerAdmin \? portalKeyFromPath\(location\.pathname\) : null/)
  assert.match(portalApp, /onPlacement=\{goPlacement\}/)
  // 8de00b0a: the nav's words come from src/lib/navigationCanon.js; the order is unchanged.
  const home = nav.indexOf('{NAV_LABELS.home}</span>')
  const placement = nav.indexOf('{NAV_LABELS.myPlacement}</span>')
  const messages = nav.indexOf('{NAV_LABELS.messages}</span>')
  assert.ok(home > 0 && home < placement && placement < messages)
  assert.doesNotMatch(nav, /portal-nav-action|data-tour="portal-nav-profile"/)
})

test('Rotation Activity reuses the canonical calendar and shows nonblocking date overlays', () => {
  assert.match(component, /CanonicalCalendarLayout/)
  assert.match(component, /getUsHolidaysForRange/)
  assert.match(component, /school blackout date/i)
  assert.match(component, /> Plan Shift</)
  assert.match(component, /disabled=\{readOnly\}/)
  assert.match(component, /\{empty && <span className="ptl-student-cal-add"/)
  // STUDENT-CAL-TOUCH-1 (Owner, 2026-09-14): on a touch screen the per-day pill is
  // hidden, a tap only selects the day, and the chip says what the shift is.
  const portalCss = read('src/portal/portal.css')
  assert.match(portalCss, /@media \(hover: none\) \{\s*\.ptl-student-cal-add \{ display: none; \}/)
  assert.doesNotMatch(portalCss, /^\s*\.ptl-student-cal-add \{ opacity: 1; \}/m, 'the touch rule that lit every pill is back')
  assert.match(component, /const touch = typeof window !== 'undefined' && window\.matchMedia\?\.\('\(hover: none\)'\)\.matches/)
  assert.match(component, /if \(empty && !readOnly && !touch\) openPlan\(ymd\)/)
  assert.match(component, /Planned Shift\{firstNameOf\(plan\.preceptor_name\) \? ` with \$\{firstNameOf\(plan\.preceptor_name\)\}` : ''\}/)
  assert.match(component, /It does not log clinical hours/)
  assert.match(component, /submit the actual shift through the Shift Log/)
  assert.match(component, /School blackout dates and federal holidays are informational/)
  assert.match(component, /They do not prevent planning or logging a shift/)
})
