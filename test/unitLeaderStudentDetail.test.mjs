// UL-PORTAL: guards for the student detail drawer.
//
// Static-source and pure-function guards, in this repo's existing node:test style.
// No jsdom and no testing-library: a component-rendering harness would be a new test
// architecture, and this pass deliberately does not introduce one.
//
// These assert the properties a future edit could silently break, and they are
// written to fail loudly if it does: the approved field set, the ABSENCE of every
// excluded field, server-mediated file access, the authorized milestone path, the
// non-content states, focus management, and the impossibility of client-side scope
// widening.
//
// NOTE ON METHOD: every negative assertion runs against COMMENT-STRIPPED source. The
// prose in these files legitimately names the excluded fields in order to explain
// why they are excluded, and a naive regex over raw text matches that explanation
// instead of real code. That mistake has bitten this suite before.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')

const drawer   = read('src/portal/unit/StudentDetailDrawer.jsx')
const portal   = read('src/portal/UnitLeaderPortal.jsx')
const api      = read('src/portal/unit/unitLeaderApi.js')
const endpoint = read('api/portal/unit-student-detail.js')
const css      = read('src/portal/portal.css')

const stripJs = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const drawerCode   = stripJs(drawer)
const portalCode   = stripJs(portal)
const apiCode      = stripJs(api)
const endpointCode = stripJs(endpoint)

// ── The detail action exists and is reachable ───────────────────────────────
test('every student row is an open-profile control that renders the drawer', () => {
  // The visual redesign made the whole row the open-profile affordance instead of a
  // separate "View details" button. The property is unchanged: one click opens the
  // safe drawer.
  // The row is a <tr role="button"> whose click opens the drawer.
  assert.match(portalCode, /role="button"/)
  assert.match(portalCode, /onClick=\{\(e\) => open_\(e\.currentTarget\)\}/)
  assert.match(portalCode, /<StudentDetailDrawer/,
    'the roster still renders the drawer')
})

test('the row action names the student, so a screen reader knows which row', () => {
  assert.match(portalCode, /aria-label=\{`Open details for \$\{studentName\(s\)\}`\}/,
    'a bare label repeated down a column is ambiguous')
})

test('the open-profile control is the row itself, separate from the kebab menu', () => {
  const row = portalCode.slice(portalCode.indexOf('function StudentRow'), portalCode.indexOf('function StudentKebab'))
  // The row button opens the profile; the kebab is a sibling holding the write-lite
  // actions. A button nested in a button would be invalid, so the kebab opens after
  // the row button closes.
  // The kebab lives in the Actions cell, which stops propagation so a kebab click is
  // never a row click.
  assert.match(row, /className="ptl-stu-actioncell"[\s\S]{0,80}stopPropagation/)
  assert.match(row, /<StudentKebab/)
})

// ── Only approved fields are rendered ───────────────────────────────────────
const APPROVED_LABELS = [
  'School', 'Cohort', 'Matched unit', 'Rotation dates', 'Shift', 'Hours',
  'Attendance', 'Preceptor', 'Work or school email', 'Personal email', 'Phone',
  'Resume',
]

test('the drawer renders every approved field label', () => {
  for (const label of APPROVED_LABELS) {
    assert.match(drawerCode, new RegExp(`label="${label}"`),
      `the drawer must render the approved field ${label}`)
  }
})

test('the drawer renders the student name, the photo, and milestone history', () => {
  assert.match(drawerCode, /aria-label=\{`Details for \$\{name\}`\}/)
  assert.match(drawerCode, /<StudentPhoto/)
  assert.match(drawerCode, /Milestone history/)
})

// ── Excluded fields are absent ──────────────────────────────────────────────
// The whole point of the Unit Leader scope. Each of these is approved for ASPIRE
// staff and NOT for a Unit Leader, so any appearance in this surface is a defect.
const EXCLUDED = [
  'rubric', 'interview_notes', 'interview_score',
  'survey', 'readiness',
  'certificate',
  'onboarding_document', 'document_url',
  'admin_notes', 'internal_note', 'review_reason',
  'support_needed', 'learning_highlight',
]

test('no excluded field is referenced anywhere in the detail surface', () => {
  for (const field of EXCLUDED) {
    for (const [name, source] of [['drawer', drawerCode], ['endpoint', endpointCode]]) {
      assert.ok(!source.includes(field),
        `${name} must never reference the excluded field ${field}`)
    }
  }
})

test('the detail endpoint never selects the support narrative', () => {
  // The roster proved this pattern: a count is fine, the note text is not.
  assert.doesNotMatch(endpointCode, /select\([^)]*support_needed/)
  assert.match(endpointCode, /\.select\('shift_date'\)/,
    'the attendance rollup must select only the shift date')
})

test('the drawer shows a support COUNT at most, never raw support text', () => {
  assert.ok(!drawerCode.includes('support.narrative'))
  assert.ok(!drawerCode.includes('{s.support_needed'))
})

// ── Files go through the server-mediated endpoint only ──────────────────────
test('photo and resume both use the server-mediated file endpoint', () => {
  assert.match(drawerCode, /getStudentFileUrl\(studentId, 'headshot'\)/)
  assert.match(drawerCode, /getStudentFileUrl\(studentId, 'resume'\)/)
})

test('the drawer never constructs a public or storage URL', () => {
  for (const forbidden of [
    'supabase.storage', 'getPublicUrl', 'createSignedUrl',
    '/storage/v1/object/public', 'student-files',
  ]) {
    assert.ok(!drawerCode.includes(forbidden),
      `the drawer must not reference ${forbidden}`)
  }
})

test('the detail endpoint returns availability booleans, never a file path or URL', () => {
  assert.match(endpointCode, /has_photo:/)
  assert.match(endpointCode, /has_resume:/)
  for (const forbidden of ['signed_url', 'createSignedUrl', 'getPublicUrl', 'headshot_url:', 'resume_url:']) {
    assert.ok(!endpointCode.includes(forbidden),
      `the detail endpoint must not return ${forbidden}`)
  }
})

test('the resume link is minted at click time, so it cannot be served stale', () => {
  const resume = drawerCode.slice(drawerCode.indexOf('function ResumeAction'),
    drawerCode.indexOf('export default'))
  assert.match(resume, /const open = async \(\) => \{/)
  assert.match(resume, /getStudentFileUrl\(studentId, 'resume'\)/)
  assert.match(resume, /window\.open\(url/)
  // No URL is held in state between renders.
  assert.ok(!/useState\([^)]*url/.test(resume), 'the resume URL must not be stored in state')
})

test('an expired photo link is refreshed once, then stops and offers a control', () => {
  const photo = drawerCode.slice(drawerCode.indexOf('function StudentPhoto'),
    drawerCode.indexOf('function ResumeAction'))
  assert.match(photo, /onError=/, 'an expired link surfaces as an image load error')
  assert.match(photo, /if \(attempt === 0\) \{ invalidateStudentPhoto\(cacheKey\); setAttempt\(1\) \}/,
    'the first failure invalidates only this photo and requests one fresh link, never the whole cache')
  assert.match(photo, /else setExpired\(true\)/,
    'a later failure must stop, so a broken object cannot spin against the endpoint')
  assert.match(photo, /Reload photo/, 'a manual retry control must exist')
})

// ── Milestone history uses the authorized endpoint ──────────────────────────
test('milestone history comes from the authorized unit-scoped endpoint', () => {
  assert.match(drawerCode, /getMilestones\(unitKey, ac\.signal\)/)
  assert.match(drawerCode, /\.filter\(m => m\.student_id === studentId\)/,
    'the browser narrows for presentation only; the server has already bounded the set')
})

test('the drawer reads only the three authorized endpoints', () => {
  const imported = drawerCode.match(/getStudentDetail|getMilestones|getStudentFileUrl/g) || []
  assert.ok(imported.length > 0)
  // No direct fetch and no direct Supabase client: every read goes through the
  // authenticated api layer, which attaches the caller's JWT.
  assert.ok(!drawerCode.includes('fetch('), 'the drawer must not call fetch directly')
  assert.ok(!drawerCode.includes("from '../../lib/supabase'"),
    'the drawer must not talk to Supabase directly')
})

// ── Every required non-content state exists ─────────────────────────────────
test('the drawer implements loading, empty, denied, and error states', () => {
  assert.match(drawerCode, /detailStatus === 'loading' && <LoadingState/)
  assert.match(drawerCode, /detailStatus === 'denied' && \(/)
  assert.match(drawerCode, /detailStatus === 'error' && \(/)
  assert.match(drawerCode, /detailStatus === 'ready' && !d && \(/)
})

test('a permission answer renders as denied, not as an error', () => {
  assert.match(drawerCode, /res\.status === 403 \|\| res\.status === 404\) setDetail\(\{ forId: studentId, status: 'denied'/,
    '403 and 404 must not be presented as something to retry')
})

test('the denied state is worded for this student, not for the whole portal', () => {
  assert.match(drawerCode, /title="Details not available"/,
    'the default DeniedState copy is about having no assigned unit, which would mislead here')
})

test('milestone history has its own loading, empty, and error states', () => {
  assert.match(drawerCode, /milestoneStatus === 'loading'/)
  assert.match(drawerCode, /milestoneStatus === 'error'/)
  assert.match(drawerCode, /milestoneStatus === 'ready' && milestones\.rows\.length === 0/)
})

test('loading is derived, never assigned in an effect body', () => {
  // The repo forbids react-hooks/set-state-in-effect. Deriving also prevents a slow
  // response for a previous student painting over the one on screen.
  assert.match(drawerCode, /const detailStatus = detail\.forId === studentId \? detail\.status : 'loading'/)
  assert.match(drawerCode, /const milestoneStatus = milestones\.forId === studentId \? milestones\.status : 'loading'/)
})

// ── Keyboard and focus management ───────────────────────────────────────────
test('the drawer is a modal dialog with an accessible name', () => {
  assert.match(drawerCode, /role="dialog"/)
  assert.match(drawerCode, /aria-modal="true"/)
  assert.match(drawerCode, /aria-label=\{`Details for/)
})

test('Escape closes the drawer', () => {
  assert.match(drawerCode, /e\.key === 'Escape'/)
  assert.match(drawerCode, /onClose\?\.\(\)/)
})

test('Tab is trapped and cycles in both directions', () => {
  assert.match(drawerCode, /e\.key !== 'Tab'/)
  assert.match(drawerCode, /e\.shiftKey && document\.activeElement === first/)
  assert.match(drawerCode, /document\.activeElement === last/)
  assert.match(drawerCode, /e\.preventDefault\(\)/)
})

test('focus moves into the drawer on open and returns to the trigger on close', () => {
  assert.match(drawerCode, /closeRef\.current\?\.focus\?\.\(\)/, 'focus must move in on open')
  assert.match(drawerCode, /if \(prev\?\.focus\) prev\.focus\(\)/, 'focus must return on close')
  assert.match(drawerCode, /returnFocusRef\?\.current/)
})

test('focus returns to the exact row that opened the drawer', () => {
  assert.match(portalCode, /detailTriggerRef\.current = triggerEl/,
    'the opening element itself must be captured, not just the list')
  assert.match(portalCode, /onClick=\{\(e\) => open_\(e\.currentTarget\)\}/)
  assert.match(portalCode, /returnFocusRef=\{detailTriggerRef\}/)
})

test('the close control has a visible affordance and an accessible name', () => {
  assert.match(drawerCode, /aria-label="Close student details"/)
})

// ── Mobile behavior is represented ──────────────────────────────────────────
test('the drawer goes full width on a phone', () => {
  const mobile = css.slice(css.indexOf('UL-PORTAL: the student detail drawer'))
  assert.match(mobile, /@media \(max-width: 760px\)/)
  assert.match(mobile, /\.ptl-detail-drawer \{ max-width: 100%; \}/)
  assert.match(mobile, /\.ptl-detail-grid \{ grid-template-columns: 1fr; \}/,
    'the two-column detail grid must collapse to one column on a phone')
})

test('the drawer rides the existing Compass drawer shell', () => {
  assert.match(drawerCode, /className="ptl-drawer ptl-detail-drawer"/,
    'reuse the approved shell rather than inventing a parallel one')
  assert.match(drawerCode, /ptl-drawer-backdrop/)
})

// ── No client-side scope widening is possible ───────────────────────────────
test('the detail request sends a student id and nothing that could widen scope', () => {
  const fn = apiCode.slice(apiCode.indexOf('export const getStudentDetail'))
  assert.match(fn, /unit-student-detail\?student_id=\$\{encodeURIComponent\(studentId\)\}/)
  for (const forbidden of ['unit_key=', 'role=', 'is_admin', 'canEdit', 'scope=', 'all=']) {
    assert.ok(!fn.slice(0, fn.indexOf('\n\n')).includes(forbidden),
      `the detail request must not carry ${forbidden}`)
  }
})

test('the endpoint re-derives authorization and never trusts a requested unit', () => {
  assert.match(endpointCode, /verifyPortalUnitLeaderCaller\(req\)/)
  assert.match(endpointCode, /authorizeStudentForUnitLeader\(db, scopes, studentId\)/)
  assert.ok(!endpointCode.includes('req.query.unit_key'),
    'the unit must come from the student placement, never from the request')
  assert.ok(!endpointCode.includes('req.body'),
    'a GET must not read authorization material from a body')
})

test('the endpoint fails closed and does not enumerate', () => {
  assert.match(endpointCode, /if \(!decision\.allowed\) return res\.status\(404\)/,
    'out of scope and nonexistent must be indistinguishable')
  assert.match(endpointCode, /catch \{\s*return res\.status\(500\)/,
    'a thrown scope resolution must not fall through to a successful read')
})

test('the endpoint is read only', () => {
  assert.match(endpointCode, /req\.method !== 'GET'/)
  for (const write of ['.insert(', '.update(', '.upsert(', '.delete(']) {
    assert.ok(!endpointCode.includes(write),
      `the detail endpoint must not ${write}`)
  }
})

test('the endpoint never authorizes from a name, an email, or a role string', () => {
  for (const forbidden of ['is_staff', 'isAdmin', 'canEdit', 'full_name ===', 'email ===']) {
    assert.ok(!endpointCode.includes(forbidden),
      `authorization must never use ${forbidden}`)
  }
})

// ── The rotation sentinel is never shown as a date ──────────────────────────
test('the pending-review sentinel is treated as not set, never rendered', () => {
  assert.match(endpointCode, /ROTATION_SENTINEL = '1900-01-01'/)
  assert.match(endpointCode, /start === ROTATION_SENTINEL \|\| end === ROTATION_SENTINEL\) return null/,
    "1900-01-01 means pending admin review and must never reach a Unit Leader as a date")
})

// ── The contact fields stay off the bulk roster ─────────────────────────────
test('contact details are served per student, not shipped with the whole roster', () => {
  const roster = stripJs(read('api/portal/unit-roster.js'))
  for (const field of ['personal_email', 'phone:', 'school_email']) {
    assert.ok(!roster.includes(field),
      `the roster must not project ${field}; the detail endpoint serves it per student`)
  }
})

// ── Placeholder discipline ──────────────────────────────────────────────────
test('every empty value renders as the standard placeholder', () => {
  assert.match(drawerCode, /import \{[\s\S]*?EMPTY,[\s\S]*?\} from '\.\/unitLeaderApi'/)
  assert.match(drawerCode, /orDash\(/)
  assert.ok(!drawerCode.includes("'N/A'") && !drawerCode.includes('"N/A"'),
    'the approved empty placeholder is a single dash')
})

// ── House style ─────────────────────────────────────────────────────────────
test('no em dash in the detail drawer sources', () => {
  // Built from its code point on purpose. Writing the character literally here would
  // put an em dash INTO the file this very guard is meant to keep clean, and the
  // repo-wide scan would flag the test that enforces the rule.
  const EM_DASH = String.fromCharCode(0x2014)
  for (const [name, source] of [
    ['drawer', drawer], ['endpoint', endpoint], ['api client', api],
  ]) {
    assert.ok(!source.includes(EM_DASH), `${name} must not contain an em dash`)
  }
})
