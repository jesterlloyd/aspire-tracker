// Unit Leader Portal utility layer guards. Static and pure-source tests only.
// Run: node --test test/unitLeaderPortalUtilityLayer.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const app = read('src/portal/PortalApp.jsx')
const shell = read('src/portal/PortalShell.jsx')
const layer = read('src/portal/PortalUtilityLayer.jsx')
const button = read('src/portal/PortalUtilityButton.jsx')
const dialog = read('src/portal/PortalFeedbackDialog.jsx')
const focus = read('src/portal/usePortalDialogFocus.js')
const client = read('src/lib/portalFeedbackApiClient.js')
const validation = read('src/lib/portalFeedbackValidation.js')
const css = read('src/portal/portal.css')
const unitPortal = read('src/portal/UnitLeaderPortal.jsx')
const studentPortal = read('src/portal/StudentPortal.jsx')
const academicPortal = read('src/portal/AcademicPartnerPortal.jsx')
const appRoot = read('src/App.jsx')

const appCode = strip(app)
const dialogCode = strip(dialog)
const layerCode = strip(layer)
const clientCode = strip(client)

test('utility layer mounts once through PortalShell and is Unit Leader-only', () => {
  assert.match(shell, /utilityLayer = null/)
  assert.match(shell, /\{utilityLayer\}/)
  assert.match(app, /import PortalUtilityLayer from '\.\/PortalUtilityLayer'/)
  assert.equal((app.match(/<PortalUtilityLayer/g) || []).length, 1)
  const studentBranch = app.slice(app.indexOf("roles.includes('student')"), app.indexOf("roles.includes('unit_leader')"))
  const unitBranch = app.slice(app.indexOf("roles.includes('unit_leader')"), app.indexOf("roles.includes('academic_partner')"))
  const academicBranch = app.slice(app.indexOf("roles.includes('academic_partner')"))
  assert.doesNotMatch(studentBranch, /PortalUtilityLayer|utilityLayer=/)
  assert.match(unitBranch, /enabled/)
  assert.match(unitBranch, /portalRole="unit_leader"/)
  assert.match(unitBranch, /portalType="unit_leader"/)
  assert.match(unitBranch, /unread=\{unread\}/)
  assert.match(unitBranch, /onOpenMessages=\{goMessages\}/)
  assert.doesNotMatch(academicBranch, /PortalUtilityLayer|utilityLayer=/)
  assert.doesNotMatch(unitPortal, /PortalUtilityLayer/)
  assert.doesNotMatch(studentPortal, /PortalUtilityLayer|PortalFeedbackDialog|portalFeedbackApiClient/)
  assert.doesNotMatch(academicPortal, /PortalUtilityLayer|PortalFeedbackDialog|portalFeedbackApiClient/)
  assert.doesNotMatch(appRoot, /PortalUtilityLayer|PortalFeedbackDialog/)
})

test('Feedback / Bug launcher is visible, lower-left, accessible, and suppressible', () => {
  assert.match(layer, /label="Feedback \/ Bug"/)
  assert.match(layer, /side="left"/)
  assert.match(css, /\.ptl-utility-button-left \{ left: max\(20px, env\(safe-area-inset-left\)\)/)
  assert.match(css, /min-height: 44px/)
  assert.match(button, /aria-label=\{badge > 0 \? `\$\{label\}, \$\{badge\} unread` : label\}/)
  assert.match(layer, /useUtilitySuppression/)
  assert.match(layerCode, /document\.querySelector\('\[aria-modal="true"\]:not\(\.ptl-feedback-dialog\), \.ptl-drawer, \.ptl-sheet, \.ptl-asn-manager'\)/)
  assert.match(layerCode, /INPUT', 'TEXTAREA', 'SELECT'/)
  assert.match(layerCode, /window\.matchMedia\('\(max-width: 760px\)'\)/)
  assert.match(layer, /\{!suppressed && \(/)
})

test('feedback dialog has required accessible behavior and no attachments', () => {
  assert.match(dialog, /role="dialog"/)
  assert.match(dialog, /aria-modal="true"/)
  assert.match(dialog, /aria-labelledby="ptl-feedback-title"/)
  assert.match(dialog, /aria-describedby="ptl-feedback-desc"/)
  assert.match(dialog, /usePortalDialogFocus/)
  assert.match(focus, /event\.key === 'Escape'/)
  assert.match(focus, /event\.key !== 'Tab'/)
  assert.match(focus, /previous\?\.focus\?\.\(\)/)
  assert.match(dialog, /disabled=\{submitting\}/)
  assert.match(dialog, /submittingRef\.current/)
  assert.match(dialog, /role="status" aria-live="polite"/)
  assert.match(dialog, /setForm\(emptyForm\(\)\)/)
  assert.match(dialog, /Something went wrong\. Your text is still here/)
  assert.match(dialog, /Attachments and screenshots are not included/)
  assert.doesNotMatch(dialogCode, /dangerouslySetInnerHTML|file upload|type="file"/i)
})

test('feedback and bug modes expose the correct fields and validation', () => {
  assert.match(dialog, /Send Feedback/)
  assert.match(dialog, /Report a Bug/)
  assert.match(dialog, /name="feedback-mode"/)
  assert.match(dialog, /mode === 'bug'/)
  for (const field of ['expected_behavior', 'actual_behavior', 'reproduction_steps']) {
    assert.match(dialog, new RegExp(field))
  }
  assert.match(dialog, /viewport_width: Math\.max\(1, Math\.round\(window\.innerWidth \|\| 1\)\)/)
  assert.match(dialog, /viewport_height: Math\.max\(1, Math\.round\(window\.innerHeight \|\| 1\)\)/)
  assert.match(dialog, /FIELD_LIMIT = 5000/)
  assert.match(dialog, /hasHtml/)
  assert.match(validation, /unexpected_fields/)
})

test('payload privacy stays on the approved allowlist only', () => {
  for (const allowed of [
    'request_id', 'type', 'message', 'pathname', 'section', 'build_sha', 'environment',
    'expected_behavior', 'actual_behavior', 'reproduction_steps', 'viewport_width', 'viewport_height',
  ]) {
    assert.match(client, new RegExp(`\\b${allowed}\\b`))
  }
  for (const forbidden of [
    'profile_id', 'user_id', 'school', 'student_id', 'preceptor_id',
    'actor_profile_id', 'email', 'thread_id', 'userAgent', 'navigator.userAgent',
    'raw_error',
  ]) {
    assert.doesNotMatch(clientCode + dialogCode, new RegExp(forbidden, 'i'), forbidden)
  }
  assert.match(client, /\/api\/portal\/feedback-submit/)
  assert.match(client, /access_token/)
  assert.match(client, /Authorization: `Bearer \$\{token\}`/)
  assert.doesNotMatch(client.match(/export function buildPortalFeedbackPayload[\s\S]*?^}/m)?.[0] || '', /access_token/i)
  assert.doesNotMatch(client, /\.from\('portal_feedback_|portal_feedback_submissions|portal_feedback_deliveries/)
})

test('request id lifecycle supports retries and clears only on terminal intent changes', () => {
  assert.match(client, /STORAGE_PREFIX = 'aspire\.portalFeedback\.requestId\.v1:'/)
  assert.match(client, /createPortalFeedbackRequestId/)
  assert.match(client, /clearPortalFeedbackRequestId/)
  assert.match(dialog, /const \[requestId, setRequestId\] = useState/)
  assert.match(dialog, /if \(submittingRef\.current\) return/)
  assert.match(dialog, /clearPortalFeedbackRequestId\(INTENT_KEY\)/)
  assert.match(dialog, /request_id: requestId/)
  assert.match(dialog, /request_id_payload_conflict/)
  assert.match(dialog, /rate_limited/)
  assert.match(dialog, /ASPIRE received your submission/)
  assert.match(client, /catch \{\s*\/\/ Storage can be/)
})

test('Messages launcher reuses existing unread and route only', () => {
  assert.match(layer, /label="Messages"/)
  assert.match(layer, /side="right"/)
  assert.match(css, /\.ptl-utility-button-right \{ right: max\(20px, env\(safe-area-inset-right\)\)/)
  assert.match(layer, /badge=\{unread\}/)
  assert.match(layer, /current=\{onMessagesRoute\}/)
  assert.match(layer, /onOpenMessages\?\.\(\)/)
  assert.match(layer, /document\.querySelector\('\.ptl-msg-head h2, \.ptl-section-title, h1, h2'\)/)
  assert.match(layer, /heading\.setAttribute\('tabindex', '-1'\)/)
  assert.match(layer, /heading\?\.focus\?\.\(\)/)
  assert.doesNotMatch(layer, /usePortalUnreadCount|PortalMessagesWorkspace/)
  assert.equal((app.match(/usePortalUnreadCount/g) || []).length, 2) // import + one call
})

test('desktop notice trigger, suppression, and persistence are exact', () => {
  assert.match(layer, /window\.matchMedia\('\(max-width: 1023px\)'\)/)
  assert.match(layer, /This portal is optimized for desktop use\. For the best experience, open it on a laptop or larger screen\./)
  assert.match(layer, /Continue anyway/)
  assert.match(layer, /pathname\.startsWith\('\/portal\/messages'\)/)
  assert.match(layer, /aspire\.portal\.desktopNotice\.v1:\$\{profileId\}:\$\{role\}/)
  assert.match(layer, /NOTICE_DAYS = 30/)
  assert.match(layer, /JSON\.parse\(raw\)/)
  assert.match(layer, /setSessionDismissedKey\(noticeKey\)/)
  assert.match(layer, /setStoredDismissedKey\(noticeKey\)/)
  assert.doesNotMatch(layerCode, /navigator\.userAgent|device|platform/i)
})

test('responsive placement, safe areas, and bottom nav clearance are present', () => {
  assert.match(css, /z-index: 25/)
  assert.match(css, /bottom: calc\(20px \+ env\(safe-area-inset-bottom\)\)/)
  assert.match(css, /bottom: calc\(76px \+ env\(safe-area-inset-bottom\)\)/)
  assert.match(css, /max-width: calc\(50vw - 24px\)/)
  assert.match(css, /white-space: normal/)
  assert.match(css, /@media \(max-width: 760px\)[\s\S]*\.ptl-modal \{ width: 100%; max-height: 92vh; border-radius: 16px 16px 0 0; \}/)
})

test('static boundaries remain locked', () => {
  for (const source of [app, shell, layer, dialog, client, validation, css]) {
    assert.doesNotMatch(source, /academic_partner_message|Academic Partner Messages|user_school_scopes/)
    assert.doesNotMatch(source, /CREATE TABLE|ALTER TABLE|supabase\/migrations|migration_/)
    assert.doesNotMatch(source, /MESSAGE_FROM|MESSAGE_REPLY_TO|noreply@aspire-program\.com|aspire@cshs\.org/)
  }
  assert.doesNotMatch(dialog + layer + client, /Student Portal feedback|Academic Partner feedback/)
})
