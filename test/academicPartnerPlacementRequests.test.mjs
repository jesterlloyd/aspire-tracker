// AP Placement Requests, Commit 2: the Academic Partner Placement Requests workspace. Source-guard
// tests over the view + the list endpoint. Submission is GATED on a provenance schema change, so the
// submit control is disabled and the POST path fails closed; these tests assert that gate, the
// read-only list, the cohort + server-verified password flow, refresh integration, and the absence
// of drafts / editing / withdrawal / Request-a-Change / audit-history controls.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const read = (p) => readFileSync(join(root, p), 'utf8')
const stripJs = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const view = read('src/portal/ap/PlacementRequestsView.jsx')
const viewCode = stripJs(view)
const endpoint = read('api/portal/school-placement-requests.js')
const client = read('src/portal/ap/academicPartnerApi.js')

test('the placement-requests view exists and is wired into the AP portal', () => {
  assert.ok(existsSync(join(root, 'src/portal/ap/PlacementRequestsView.jsx')))
  const portal = read('src/portal/AcademicPartnerPortal.jsx')
  assert.match(portal, /import PlacementRequestsView from '\.\/ap\/PlacementRequestsView'/)
  assert.match(stripJs(portal), /if \(view === 'placement-requests'\) \{\s*return <PlacementRequestsView \/>/)
})

test('the list is read-only and shows the approved public-safe fields, with a status pill + legend', () => {
  assert.match(view, /getSchoolPlacementRequests/)
  for (const col of ['Student', 'Cohort', 'ASPIRE status', 'Requested rotation', 'Confirmed unit', 'Primary preceptor', 'Submitted']) {
    assert.ok(view.includes(col), `list shows the ${col} column`)
  }
  assert.match(view, /<StatusPill status=\{s\.status\} \/>/)
  assert.match(view, /<StatusLegendPopover showStaffDetail=\{false\} \/>/)
})

test('the shared portal Refresh re-fetches the request list', () => {
  assert.match(view, /import \{ useRegisterPortalRefresh \} from '\.\.\/PortalRefresh'/)
  assert.match(view, /useRegisterPortalRefresh\(reload\)/)
})

test('a new request resolves the cohort and verifies the password server-side before the form', () => {
  // Same cohort + password behavior as the public form, via the same RPCs (verified before the form).
  assert.match(view, /accepting_submissions/)
  assert.match(view, /rpc\('school_form_requires_password'/)
  assert.match(view, /rpc\('verify_school_form_password'/)
  assert.match(view, /gate === 'password'/)
  assert.match(view, /gate === 'open'/)
  // The password is only transient client state; it is never persisted or logged here.
  assert.doesNotMatch(viewCode, /localStorage|sessionStorage|console\.(log|warn|error)\([^)]*pwd/)
})

test('the school is prefilled and locked to the caller authorized school', () => {
  assert.match(view, /\.\.\.emptyCoordinator\(\), school: schoolKey/)
  assert.match(view, /value=\{coord\.school\} disabled/)
})

test('submission is GATED: the submit control is disabled and no submit call is wired live', () => {
  // The button is disabled with a truthful pending banner; it does not POST.
  assert.match(view, /submission is being finalized/)
  assert.match(view, /<button type="button" className="ptl-btn" disabled/)
  assert.match(view, /Submission activation pending\./)
  // The view never calls the submit endpoint in this phase (only the read list is fetched).
  assert.doesNotMatch(viewCode, /submitSchoolPlacementRequest/)
})

test('no drafts, editing, withdrawal, Request-a-Change, or audit-history controls are present', () => {
  assert.doesNotMatch(viewCode, /\bDraft\b|Save draft|Withdraw|Request a Change|Request Change|Under Review|Audit|Edit request/i)
  // No Needs Clarification / changes_requested surfaced to the Academic Partner.
  assert.doesNotMatch(viewCode, /Needs Clarification|changes_requested/)
})

// ── The list endpoint ────────────────────────────────────────────────────────────────────────────

test('the list endpoint reuses the shared AP authorization and never trusts a request-supplied scope', () => {
  assert.match(endpoint, /verifyPortalAcademicPartnerCaller\(req\)/)
  assert.match(endpoint, /resolveSchoolScopedStudents\(db, scopes, STUDENT_COLUMNS\)/)
  assert.doesNotMatch(stripJs(endpoint), /\.from\('user_school_scopes'\)/)   // scope only via the shared helper
  assert.doesNotMatch(stripJs(endpoint), /req\.query|req\.params/)            // no request-supplied scope
})

test('the POST submit path fails closed on the provenance gate (503), without writing', () => {
  assert.match(endpoint, /if \(req\.method === 'POST'\) \{/)
  assert.match(endpoint, /submission_not_enabled/)
  assert.match(endpoint, /provenance_pending_migration/)
  // The auth chain runs before the gate, so an unauthorized caller is rejected first.
  assert.match(stripJs(endpoint), /verifyPortalAcademicPartnerCaller\(req\)[\s\S]*if \(req\.method === 'POST'\)/)
  // No student write occurs in this endpoint yet.
  assert.doesNotMatch(stripJs(endpoint), /\.insert\(|\.update\(|\.upsert\(/)
})

test('the client exposes the list (GET) and the gated submit (POST) calls', () => {
  assert.match(client, /getSchoolPlacementRequests = \(signal\) =>/)
  assert.match(client, /'\/api\/portal\/school-placement-requests', \{ method: 'GET', signal \}/)
  assert.match(client, /submitSchoolPlacementRequest = \(payload, signal\) =>/)
})
