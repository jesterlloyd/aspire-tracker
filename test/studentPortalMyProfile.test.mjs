// STUDENT-PORTAL-PROFILE-1: Student Portal My Profile - view, edit, and lock.
//
// Functional tests drive the pure modules directly (the canonical lock condition, the
// editable-field allowlist, the prefill inverse mapping, and the endpoint's per-field
// normalizer). Source guards - the repository's endpoint-testing style - pin the
// authorization chain, the server-enforced lock and stale-write protection, the
// single-canonical-row update semantics, the audit shape, the accidental-submission
// fix, and no-regression for the public /student-form.
//
// Run: node --test test/studentPortalMyProfile.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { isStudentProfileLocked, PROFILE_EDITABLE_STATUSES, PROFILE_LOCKED_MESSAGE } from '../src/lib/studentProfileLock.js'
import {
  STUDENT_EDITABLE_FIELDS, REQUIRED_ON_SAVE, parsePriorExperience, buildFormValuesFromStudent,
} from '../src/lib/studentProfileFields.js'
import { normalizeField } from '../api/portal/my-profile.js'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')

const endpoint   = read('api/portal/my-profile.js')
const intakeApi  = read('api/student-intake-submit.js')
const formPage   = read('src/components/StudentIntakeFormPage.jsx')
const myProfile  = read('src/portal/MyProfile.jsx')
const portalApp  = read('src/portal/PortalApp.jsx')
const portalNav  = read('src/portal/PortalNav.jsx')
const studentUpd = read('api/student-update.js')
const sidePanel  = read('src/components/StudentSidePanel.jsx')
const appJsx     = read('src/App.jsx')

// ── The canonical lock condition ─────────────────────────────────────────────────────

test('profile is editable through Form Received and locks at Interview Scheduled', () => {
  for (const status of PROFILE_EDITABLE_STATUSES) {
    assert.equal(isStudentProfileLocked({ status, interview_scheduled_date: null }), false, status)
  }
  for (const status of ['Interview Scheduled', 'Interviewed', 'Placed', 'Active Rotation', 'Completed', 'Declined', 'Not Proceeding']) {
    assert.equal(isStudentProfileLocked({ status, interview_scheduled_date: null }), true, status)
  }
})

test('a booked interview locks the profile even if status lags (fails closed)', () => {
  assert.equal(isStudentProfileLocked({ status: 'Form Received', interview_scheduled_date: '2026-08-15' }), true)
  assert.equal(isStudentProfileLocked(null), true, 'no record -> locked')
  assert.equal(isStudentProfileLocked({}), false, 'brand-new record (Pending Outreach default) is editable')
})

test('the lock notice is the approved copy, verbatim', () => {
  assert.equal(PROFILE_LOCKED_MESSAGE,
    'Your profile is now locked because your interview has been scheduled. Contact the ASPIRE team if a correction is needed.')
})

test('the public intake endpoint enforces the SAME shared lock', () => {
  assert.match(intakeApi, /import \{ isStudentProfileLocked \} from '\.\.\/src\/lib\/studentProfileLock\.js'/)
  assert.match(intakeApi, /if \(isStudentProfileLocked\(student\)\)/)
  // The resolver now loads the scheduling marker the lock reads.
  assert.match(intakeApi, /interview_scheduled_date/)
  // The old local status list is gone (single source of truth).
  assert.doesNotMatch(intakeApi, /INTAKE_ELIGIBLE_STATUSES/)
})

// ── The student-editable allowlist ───────────────────────────────────────────────────

test('staff-owned fields are structurally outside the editable set', () => {
  const forbidden = [
    'status', 'cohort_id', 'school', 'school_email', 'interview_scheduled_date',
    'interview_outcome', 'avg_composite_score', 'matched_unit_id', 'matched_preceptor',
    'preceptor_id', 'cs_link_complete', 'cs_cedars_status', 'approved_hours', 'pending_hours',
    'hours_required', 'notes', 'flagged_for_second_interview', 'badge_created',
    'resume_url', 'headshot_url', 'submitted_via', 'updated_at',
    'availability_ack', 'privacy_ack', 'student_form_privacy_ack_name', 'name',
  ]
  for (const f of forbidden) {
    assert.ok(!STUDENT_EDITABLE_FIELDS.includes(f), `${f} must not be student-editable`)
  }
  // And the set is exactly what /student-form collects as editable answers.
  for (const f of ['first_name', 'last_name', 'personal_email', 'phone', 'unit_preference_1',
    'interest_statement', 'unavailable_weekdays', 'unavailable_weekdays_reason',
    'personal_blackout_dates', 'weekends_available', 'nights_available', 'preferred_days']) {
    assert.ok(STUDENT_EDITABLE_FIELDS.includes(f), `${f} should be student-editable`)
  }
})

test('endpoint rejects unexpected fields instead of ignoring them, and only updates', () => {
  assert.match(endpoint, /const ALLOWED_KEYS = \['action', 'student_id', 'expected_updated_at', \.\.\.STUDENT_EDITABLE_FIELDS,\s*\n\s*\.\.\.\(action === 'submit' \? SUBMIT_ONLY_KEYS : \[\]\)\]/)
  // The first-submission-only keys are exactly the documents + acknowledgments; an
  // ordinary edit ('save') can never smuggle them.
  assert.match(endpoint, /const SUBMIT_ONLY_KEYS = \['resume_url', 'headshot_url', 'availability_ack', 'privacy_ack', 'privacy_ack_name'\]/)
  assert.match(endpoint, /unexpected\.length > 0/)
  // The canonical row is UPDATED in place; this endpoint can never create a student.
  assert.match(endpoint, /\.from\('students'\)\s*\n\s*\.update\(patch\)/)
  assert.doesNotMatch(endpoint, /from\('students'\)[\s\S]{0,120}?\.insert\(/)
})

// ── Authorization chain ──────────────────────────────────────────────────────────────

test('endpoint authorization mirrors the portal pattern: JWT -> grant -> links -> own record only', () => {
  assert.match(endpoint, /verifyPortalCaller\(req\)/)
  assert.match(endpoint, /hasActiveRoleGrant\(db, auth\.profile\.id, 'student'\)/)
  assert.match(endpoint, /getActiveStudentLinks\(db, auth\.profile\.id\)/)
  // A requested id outside the caller's links is a 403 (cannot read or write another student).
  assert.match(endpoint, /if \(!studentIds\.includes\(wanted\)\) \{ res\.status\(403\)/)
  // No role other than 'student' is granted anything here (UL/AP get 403 via the grant check).
  assert.doesNotMatch(endpoint, /unit_leader|academic_partner/)
})

// ── Lock + stale-write enforcement on the server ─────────────────────────────────────

test('the lock and the submission gates are enforced server-side with the shared helpers', () => {
  assert.match(endpoint, /import \{ isStudentProfileLocked, PROFILE_LOCKED_MESSAGE \} from/)
  // 'save' only after submission; 'submit' only before it; the lock guards BOTH.
  assert.match(endpoint, /if \(action === 'save' && student\.submitted_via !== 'student_form'\) \{\s*\n\s*return res\.status\(409\)\.json\(\{ error: 'not_submitted'/)
  assert.match(endpoint, /if \(isStudentProfileLocked\(student\)\) \{\s*\n\s*return res\.status\(403\)\.json\(\{ error: 'profile_locked', message: PROFILE_LOCKED_MESSAGE \}\)/)
})

test('stale writes are impossible: conditioned UPDATE + 409, token required', () => {
  assert.match(endpoint, /if \(!expectedUpdatedAt\) \{/)
  assert.match(endpoint, /\.eq\('id', targetId\)\s*\n\s*\.eq\('updated_at', expectedUpdatedAt\)/)
  assert.match(endpoint, /error: 'stale_write'/)
})

test('audit records identity, role, source, and changed FIELD NAMES - never values', () => {
  assert.match(endpoint, /action_type: 'student_profile_self_update'/)
  assert.match(endpoint, /user_role: 'student'/)
  assert.match(endpoint, /metadata: \{ source: 'portal_my_profile', kind: action, fields: changedFields \}/)
  // No field VALUES flow into the audit row (the metadata carries names only).
  assert.doesNotMatch(endpoint, /metadata:[^}]*patch/)
})

// ── Field validation parity (functional, via the exported normalizer) ────────────────

test('normalizeField mirrors intake rules field-for-field', () => {
  assert.deepEqual(normalizeField('ssn_last4', '1234'), { value: '1234' })
  assert.ok(normalizeField('ssn_last4', '12a4').error)
  assert.deepEqual(normalizeField('cumulative_gpa', '3.75'), { value: 3.75 })
  assert.ok(normalizeField('cumulative_gpa', '9').error)
  assert.ok(normalizeField('personal_email', 'not-an-email').error)
  assert.deepEqual(normalizeField('personal_email', ' Ada@X.EDU '), { value: 'ada@x.edu' })
  assert.ok(normalizeField('interest_statement', 'too short').error)
  assert.ok(normalizeField('shift_availability', 'Whenever').error)
  assert.deepEqual(normalizeField('shift_availability', 'Day Shift Preferred'), { value: 'Day Shift Preferred' })
  // Arrays pass through the canonical sanitizers (junk removed, not errored).
  assert.deepEqual(normalizeField('unavailable_weekdays', ['Mon', 'Funday']), { value: ['Mon'] })
  assert.deepEqual(normalizeField('personal_blackout_dates', ['2026-09-01', 'nope']), { value: ['2026-09-01'] })
  assert.deepEqual(normalizeField('weekends_available', true), { value: true })
  // Explicit clearing of an OPTIONAL field stores empty; preferred name clears to null.
  assert.deepEqual(normalizeField('unavailable_weekdays_reason', ''), { value: '' })
  assert.deepEqual(normalizeField('preferred_first_name', ''), { value: null })
  // A non-allowlisted key can never normalize.
  assert.ok(normalizeField('status', 'Placed').error)
})

test('required fields can be replaced but never cleared on save', () => {
  for (const f of ['first_name', 'personal_email', 'date_of_birth', 'ssn_last4', 'unit_preference_1']) {
    assert.ok(REQUIRED_ON_SAVE.includes(f), f)
  }
  assert.match(endpoint, /REQUIRED_ON_SAVE\.includes\(key\)/)
  assert.match(endpoint, /message: 'This field is required\.' \}/)
})

// ── Prefill inverse mapping (functional) ─────────────────────────────────────────────

test('parsePriorExperience inverts the intake composition', () => {
  assert.deepEqual(parsePriorExperience('No prior experience'), { has: false, roles: [], other: '' })
  assert.deepEqual(parsePriorExperience('Yes (no roles specified)'), { has: true, roles: [], other: '' })
  assert.deepEqual(parsePriorExperience('CNA, EMT, Other (barista)', ['CNA', 'EMT', 'Other']),
    { has: true, roles: ['CNA', 'EMT', 'Other'], other: 'barista' })
  assert.deepEqual(parsePriorExperience(''), { has: null, roles: [], other: '' })
})

test('buildFormValuesFromStudent produces the exact form shape', () => {
  const v = buildFormValuesFromStudent({
    school_email: 's@x.edu', first_name: 'Ada', last_name: 'Lovelace', cumulative_gpa: 3.9,
    unavailable_weekdays: ['Mon'], weekends_available: false, nights_available: null,
    prior_healthcare_experience: 'CNA', student_form_privacy_ack_at: '2026-07-01T00:00:00Z',
    student_form_privacy_ack_name: 'Ada Lovelace', availability_ack: true,
  }, ['CNA', 'Other'])
  assert.equal(v.cumulative_gpa, '3.9')            // GPA renders as a string
  assert.equal(v.weekends_available, false)
  assert.equal(v.nights_available, null)           // unanswered stays the Select… state
  assert.deepEqual(v.exp_selected_roles, ['CNA'])
  assert.equal(v.privacy_ack, true)
  assert.equal(v.availability_ack, true)
})

// ── Accidental-submission fix ────────────────────────────────────────────────────────

test('the Availability Reason field is a textarea (Enter inserts a newline)', () => {
  assert.match(formPage, /<textarea className="uf-textarea" rows=\{2\} value=\{form\.unavailable_weekdays_reason\}/)
  assert.doesNotMatch(formPage, /<input[^>]*value=\{form\.unavailable_weekdays_reason\}/)
})

test('implicit submission from single-line inputs is suppressed form-wide', () => {
  assert.match(formPage, /const preventImplicitSubmit = \(e\) => \{\s*\n\s*if \(e\.key !== 'Enter'\) return\s*\n\s*if \(e\.target instanceof HTMLInputElement\) e\.preventDefault\(\)/)
  assert.match(formPage, /<form onSubmit=\{handleSubmit\} onKeyDown=\{preventImplicitSubmit\} className="uf-form">/)
  // Enter on the blackout input performs its explicit adjacent action instead.
  assert.match(formPage, /onKeyDown=\{e => \{ if \(e\.key === 'Enter'\) \{ e\.preventDefault\(\); addBlackoutDate\(\) \} \}\}/)
})

test('only the explicit submit control submits: every other button stays type="button"', () => {
  const submitButtons = formPage.match(/type="submit"/g) || []
  assert.equal(submitButtons.length, 1, 'exactly one submit control')
  // Double-submit / locked-mode guard on the handler itself.
  assert.match(formPage, /if \(isPortalLocked \|\| submitting\) return/)
})

// ── Portal reuse of the canonical form (no iframe, no parallel copy) ─────────────────

test('the portal renders the SAME form component in three states', () => {
  assert.match(myProfile, /import StudentIntakeFormPage from '\.\.\/components\/StudentIntakeFormPage'/)
  assert.doesNotMatch(myProfile, /<iframe/i)
  assert.match(myProfile, /'Complete Your Profile'/)
  assert.match(myProfile, /'Profile Locked · Interview Scheduled'/)
  assert.match(myProfile, /'Profile Submitted · Editable'/)
  assert.match(myProfile, /Profile last updated/)
})

test('edit mode saves through the portal endpoint with the concurrency token', () => {
  assert.match(formPage, /action: 'save',\s*\n\s*student_id: portal\.student\.id,\s*\n\s*expected_updated_at: portal\.student\.updated_at/)
  assert.match(formPage, /fetch\('\/api\/portal\/my-profile'/)
  assert.match(formPage, /if \(data\.error === 'stale_write'\) portal\?\.onStale\?\.\(\)/)
  // Edit reuses the validation chain, then branches BEFORE ack/doc first-submission checks.
  assert.match(formPage, /if \(isPortalEdit\) \{ await portalSave\(\); return \}/)
})

test('locked mode: read-only fieldset, approved notice, submit control absent, profile visible', () => {
  assert.match(formPage, /<fieldset disabled=\{isPortalLocked\}/)
  assert.match(formPage, /\{isPortalLocked && \(/)
  assert.match(formPage, /PROFILE_LOCKED_MESSAGE/)
  assert.match(formPage, /\{!isPortalLocked && \(\s*\n\s*<div className="uf-submit-row">/)
  // The locked portal keeps a contact path.
  assert.match(myProfile, /Contact the ASPIRE team/)
})

test('the public /student-form is behaviorally preserved when no portal prop is given', () => {
  assert.match(formPage, /export default function StudentIntakeFormPage\(\{ portal = null \}\)/)
  // The public gate, lookup, upload, and intake-submit paths are all intact.
  assert.match(formPage, /accepting_submissions/)
  assert.match(formPage, /\/api\/student-intake-lookup/)
  assert.match(formPage, /\/api\/student-intake-submit/)
  assert.match(formPage, /signAndUploadIntakeFile/)
  // Public submit label unchanged; portal intake uses Submit Profile.
  assert.match(formPage, /'Submit Form'/)
  assert.match(formPage, /'Submit Profile'/)
})

// ── Portal navigation ────────────────────────────────────────────────────────────────

test('My Profile is a real routed destination with a nav item', () => {
  assert.match(portalApp, /location\.pathname\.startsWith\('\/portal\/profile'\) \? 'profile'/)
  assert.match(portalApp, /navigate\('\/portal\/profile'\)/)
  assert.match(portalApp, /studentView === 'profile'/)
  assert.match(portalNav, /data-tour="portal-nav-profile"/)
  assert.match(portalNav, /My Profile/)
})

// ── Owner/Admin editing (including locked profiles) ──────────────────────────────────

test('staff availability correction: Owner/Admin action with canonical sanitizers, not lock-gated', () => {
  assert.match(studentUpd, /if \(action === 'update_student_availability'\) \{\s*\n\s*if \(!canStudentManage\) return res\.status\(403\)/)
  assert.match(studentUpd, /sanitizeWeekdays\(payload\.unavailable_weekdays\)/)
  assert.match(studentUpd, /sanitizeIsoDates\(payload\.personal_blackout_dates\)/)
  assert.match(studentUpd, /coerceBoolOrNull\(payload\.weekends_available\)/)
  // Deliberately no lock check in this action: staff correction is the approved path.
  const action = studentUpd.slice(studentUpd.indexOf("action === 'update_student_availability'"), studentUpd.indexOf("action === 'update_student_status'"))
  assert.doesNotMatch(action, /isStudentProfileLocked/)
})

test('side panel: intentional Edit mode with Save/Cancel; review never mutates', () => {
  assert.match(sidePanel, /const \[availDraft, setAvailDraft\] = useState\(null\)/)
  assert.match(sidePanel, /canEdit && !availDraft && \(/)
  assert.match(sidePanel, /onClick=\{startAvailabilityEdit\}/)
  assert.match(sidePanel, /\{availSaving \? 'Saving…' : 'Save'\}/)
  assert.match(sidePanel, /onClick=\{\(\) => setAvailDraft\(null\)\}/)
  // Staff edits are attributed: activity log with field names, no values.
  assert.match(sidePanel, /actionType: 'student_availability_staff_edit'/)
  assert.match(sidePanel, /metadata: \{ fields: Object\.keys\(availDraft\), source: 'student_side_panel' \}/)
  // The provenance tag survives.
  assert.match(sidePanel, /SourceTag label="Source: Student form" tone="student"/)
})

test('side panel shows when the student last changed their profile', () => {
  assert.match(sidePanel, /queryKey: \['student_profile_self_update', student\.id\]/)
  assert.match(sidePanel, /action_type', 'student_profile_self_update'\)|\.eq\('action_type', 'student_profile_self_update'\)/)
  assert.match(sidePanel, /Student last updated their profile/)
})

test('App routes the availability domain to the dedicated action', () => {
  assert.match(appJsx, /updateStudentAvailability/)
  assert.match(appJsx, /\{ keys: \['unavailable_weekdays', 'unavailable_weekdays_reason', 'personal_blackout_dates', 'weekends_available', 'nights_available', 'preferred_days', 'availability_notes'\], helper: updateStudentAvailability \}/)
})

// ── Update semantics ─────────────────────────────────────────────────────────────────

test('save sends every editable field from the prefilled form (explicit-clear semantics)', () => {
  // The portal save payload provides each editable field, so an untouched field
  // round-trips its stored value and an emptied optional field is an explicit clear.
  for (const f of ['preferred_first_name', 'unit_preference_2', 'availability_notes', 'unavailable_weekdays_reason']) {
    assert.match(formPage, new RegExp(`${f}:\\s+form\\.${f}`), f)
  }
})

test('GET returns lock state, provenance, and unit options; documents as presence only', () => {
  assert.match(endpoint, /submitted: student\.submitted_via === 'student_form'/)
  assert.match(endpoint, /locked_message: locked \? PROFILE_LOCKED_MESSAGE : null/)
  assert.match(endpoint, /available_units: units/)
  assert.match(endpoint, /resume_on_file: !!str\(student\.resume_url\)/)
})

// ── Owner refinements (final product decisions) ──────────────────────────────────────

test('the EditProfileDrawer is retired as an editor; affordances route to My Profile', () => {
  const studentPortal = read('src/portal/StudentPortal.jsx')
  assert.doesNotMatch(studentPortal, /<EditProfileDrawer/)
  assert.doesNotMatch(studentPortal, /import EditProfileDrawer/)
  assert.match(studentPortal, /onClick=\{\(\) => onOpenProfile\?\.\(\)\}/)
  // The shell profile-menu action navigates too; the drawer state is gone entirely.
  assert.match(portalApp, /onEditProfile=\{goProfile\}/)
  assert.doesNotMatch(portalApp, /editOpen/)
  // The drawer FILE is retained for rollback (UserManagement precedent).
  assert.doesNotMatch(read('src/portal/EditProfileDrawer.jsx'), /—/)
})

test('authenticated portal intake bypasses the public acceptance gate; /student-form keeps it', () => {
  // Every portal mode skips the accepting-cohort gate; the public path still runs it.
  assert.match(formPage, /const skipGates = !!portalMode/)
  assert.match(formPage, /accepting_submissions/)
  // Portal first submission goes to the authenticated endpoint with intake parity...
  assert.match(formPage, /if \(portalMode === 'intake'\) \{ await portalSubmit\(\); return \}/)
  assert.match(formPage, /action: 'submit',\s*\n\s*student_id: portal\.student\.id,\s*\n\s*expected_updated_at: portal\.student\.updated_at/)
  // ...and uploads through the portal signer, never the email-bound public one.
  assert.match(formPage, /signAndUploadPortalFile\(\{ studentId: portal\.student\.id, kind: 'resume'/)
  assert.match(formPage, /signAndUploadPortalFile\(\{ studentId: portal\.student\.id, kind: 'headshot'/)
})

test("the endpoint's submit action has intake parity and no acceptance gate", () => {
  // No accepting-cohort resolution anywhere in the portal profile endpoints.
  assert.doesNotMatch(endpoint, /resolveAcceptingCohort/)
  const signSrc = read('api/portal/my-profile-file-sign.js')
  assert.doesNotMatch(signSrc, /resolveAcceptingCohort/)
  // Server-set submission state, the SAME documents rule as public intake, both
  // acknowledgments required, and the deduplicated form_received event.
  assert.match(endpoint, /import \{ checkDocumentsRequired \} from '\.\.\/student-intake-submit\.js'/)
  assert.match(endpoint, /patch\.submitted_via = 'student_form'/)
  assert.match(endpoint, /patch\.status = 'Form Received'/)
  assert.match(endpoint, /STUDENT_FORM_ACK_VERSION/)
  assert.match(endpoint, /body\.availability_ack !== true/)
  assert.match(endpoint, /event_type: 'form_received'/)
  // submit only before first submission; save only after (each 409s otherwise).
  assert.match(endpoint, /action === 'submit' && student\.submitted_via === 'student_form'/)
  assert.match(endpoint, /error: 'already_submitted'/)
  // The cs auto-map mirrors intake: only when cs_cedars_status is unset.
  assert.match(endpoint, /if \(derived && !str\(student\.cs_cedars_status\)\)/)
})

test('the portal upload signer authorizes by the student link and stops after submission', () => {
  const signSrc = read('api/portal/my-profile-file-sign.js')
  assert.match(signSrc, /verifyPortalCaller\(req\)/)
  assert.match(signSrc, /hasActiveRoleGrant\(db, auth\.profile\.id, 'student'\)/)
  assert.match(signSrc, /getActiveStudentLinks\(db, auth\.profile\.id\)/)
  // Post-submission document replacement stays staff-mediated (Owner decision).
  assert.match(signSrc, /student\.submitted_via === 'student_form'/)
  assert.match(signSrc, /Document changes are handled by the ASPIRE team after submission\./)
  // Same storage discipline as the public signer: validated metadata, canonical path,
  // one-path token.
  assert.match(signSrc, /validateFileMeta\(/)
  assert.match(signSrc, /canonicalPath\(student\.cohort_id, student\.id, kind, meta\.ext\)/)
  assert.match(signSrc, /createSignedUploadUrl\(cp\.path, \{ upsert: true \}\)/)
})

// ── Hygiene ──────────────────────────────────────────────────────────────────────────

test('no em dash in the new sources', () => {
  for (const src of [endpoint, myProfile, read('src/lib/studentProfileLock.js'), read('src/lib/studentProfileFields.js')]) {
    assert.doesNotMatch(src, /—/)
  }
})
