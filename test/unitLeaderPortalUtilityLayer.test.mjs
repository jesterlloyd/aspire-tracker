// Unit Leader Portal corrected utility layer guards. Static and pure-source tests only.
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
const portalFeedback = read('src/portal/PortalFeedbackPanel.jsx')
const sharedFeedback = read('src/components/shared/SharedFeedbackPanel.jsx')
const staffFeedback = read('src/components/FeedbackPanel.jsx')
const teamPanel = read('src/portal/PortalTeamMessagesPanel.jsx')
const focus = read('src/portal/usePortalDialogFocus.js')
const client = read('src/lib/portalFeedbackApiClient.js')
const validation = read('src/lib/portalFeedbackValidation.js')
const css = read('src/portal/portal.css')
const globalCss = read('src/index.css')
const unitApi = read('src/portal/unit/unitLeaderApi.js')
const unitPortal = read('src/portal/UnitLeaderPortal.jsx')
const studentPortal = read('src/portal/StudentPortal.jsx')
const academicPortal = read('src/portal/AcademicPartnerPortal.jsx')
const appRoot = read('src/App.jsx')

const layerCode = strip(layer)
const portalFeedbackCode = strip(portalFeedback)
const sharedFeedbackCode = strip(sharedFeedback)
const teamPanelCode = strip(teamPanel)
const clientCode = strip(client)

test('utility layer mounts through PortalShell for Student, Unit Leader, and Academic Partner (Feedback)', () => {
  assert.match(shell, /utilityLayer = null/)
  assert.match(shell, /\{utilityLayer\}/)
  assert.match(app, /import PortalUtilityLayer from '\.\/PortalUtilityLayer'/)
  assert.equal((app.match(/<PortalUtilityLayer/g) || []).length, 3)
  const studentBranch = app.slice(app.indexOf("roles.includes('student')"), app.indexOf("roles.includes('unit_leader')"))
  const unitBranch = app.slice(app.indexOf("roles.includes('unit_leader')"), app.indexOf("roles.includes('academic_partner')"))
  const academicBranch = app.slice(app.indexOf("roles.includes('academic_partner')"))
  assert.match(studentBranch, /portalRole="student"/)
  assert.match(studentBranch, /portalType="student"/)
  assert.match(studentBranch, /messagesAuthorized/)
  assert.match(studentBranch, /unread=\{unread\}/)
  assert.match(studentBranch, /onOpenMessages=\{goMessages\}/)
  assert.doesNotMatch(studentBranch, /desktopNotice/)
  assert.match(unitBranch, /portalRole="unit_leader"/)
  assert.match(unitBranch, /portalType="unit_leader"/)
  assert.match(unitBranch, /unread=\{unread\}/)
  assert.match(unitBranch, /onOpenMessages=\{goMessages\}/)
  // Academic Partner mounts the utility layer for Feedback only: Messages unauthorized, no unread,
  // no onOpenMessages.
  assert.match(academicBranch, /portalRole="academic_partner"/)
  assert.match(academicBranch, /portalType="academic_partner"/)
  assert.match(academicBranch, /messagesAuthorized=\{AP_MESSAGING_ENABLED\}/)
  // The launcher is wired (unread + onOpenMessages) so a single flag flip activates it post-migration;
  // with the flag off it stays fail-closed (no launcher mounts).
  assert.match(academicBranch, /onOpenMessages=\{\(\) => goApSection\('messages'\)\}/)
  assert.doesNotMatch(unitPortal, /PortalUtilityLayer/)
  assert.doesNotMatch(studentPortal, /PortalUtilityLayer|PortalFeedbackPanel|portalFeedbackApiClient/)
  assert.doesNotMatch(academicPortal, /PortalUtilityLayer|PortalFeedbackPanel|portalFeedbackApiClient/)
  assert.doesNotMatch(appRoot, /PortalUtilityLayer|PortalFeedbackPanel/)
})

test('main app and Unit Leader portal consume the same canonical feedback UI', () => {
  assert.match(staffFeedback, /SharedFeedbackPanel/)
  assert.match(portalFeedback, /SharedFeedbackPanel/)
  assert.match(sharedFeedback, /Send Feedback/)
  assert.match(sharedFeedback, /Report a bug, suggest a feature, or ask a question\./)
  for (const category of ['Bug Report', 'Feature Idea', 'Question']) {
    assert.match(sharedFeedback, new RegExp(category))
  }
  assert.match(globalCss, /\.shared-feedback-launcher/)
  assert.match(globalCss, /linear-gradient\(135deg, #930045, #6d0033\)/)
  assert.match(globalCss, /\.shared-feedback-panel/)
  assert.doesNotMatch(layer + css, /Feedback \/ Bug|ptl-utility-button|ptl-feedback-dialog/)
})

test('Unit Leader feedback transport maps categories to the durable backend without losing category identity', () => {
  assert.match(portalFeedback, /submitPortalFeedbackReport/)
  assert.match(client, /\/api\/portal\/feedback-submit/)
  assert.match(portalFeedback, /category === 'Bug Report' \? 'bug' : 'feedback'/)
  assert.match(portalFeedback, /messageWithCategory\(category, message\)/)
  assert.match(portalFeedback, /request_id: requestId/)
  assert.match(portalFeedback, /createPortalFeedbackRequestId\(intentKey\)/)
  assert.match(portalFeedback, /clearPortalFeedbackRequestId\(intentKey\)/)
  assert.match(sharedFeedback, /submittingRef\.current/)
  for (const field of ['expected_behavior', 'actual_behavior', 'reproduction_steps']) {
    assert.match(sharedFeedback + portalFeedback, new RegExp(field))
  }
  assert.match(portalFeedback, /viewport_width: Math\.max\(1, Math\.round\(window\.innerWidth \|\| 1\)\)/)
  assert.match(portalFeedback, /viewport_height: Math\.max\(1, Math\.round\(window\.innerHeight \|\| 1\)\)/)
  assert.match(validation, /unexpected_fields/)
})

test('feedback payload privacy stays on the approved allowlist only', () => {
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
    assert.doesNotMatch(clientCode + portalFeedbackCode, new RegExp(forbidden, 'i'), forbidden)
  }
  assert.match(client, /access_token/)
  assert.match(client, /Authorization: `Bearer \$\{token\}`/)
  assert.doesNotMatch(client.match(/export function buildPortalFeedbackPayload[\s\S]*?^}/m)?.[0] || '', /access_token/i)
  assert.doesNotMatch(client, /\.from\('portal_feedback_|portal_feedback_submissions|portal_feedback_deliveries/)
})

test('lower-right Messages is a circular docked ASPIRE Team panel, not a navigation pill', () => {
  assert.match(layer, /ptl-team-message-launcher/)
  assert.match(layer, /aria-label="Open messages with the ASPIRE Team"/)
  assert.match(css, /\.ptl-team-message-launcher/)
  assert.match(css, /width: 52px; height: 52px/)
  assert.match(css, /\.ptl-team-message-panel/)
  assert.match(css, /right: max\(24px, env\(safe-area-inset-right\)\)/)
  assert.match(teamPanel, /ASPIRE Team/)
  assert.match(teamPanel, /Messages/)
  assert.match(teamPanel, /Open full Messages/)
  assert.match(teamPanel, /onOpenFullMessages/)
  assert.doesNotMatch(layer, /document\.querySelector\('\.ptl-msg-head h2, \.ptl-section-title, h1, h2'\)/)
  assert.doesNotMatch(layer, /label="Messages"|side="right"|current=\{onMessagesRoute\}/)
})

test('docked Messages panel reuses existing portal Messages APIs and shared unread cache', () => {
  for (const apiName of [
    'listPortalConversations', 'markPortalConversationRead', 'startGeneralTeamConversation',
  ]) assert.match(teamPanel, new RegExp(apiName))
  assert.match(teamPanel, /PortalMessagesThread/)
  assert.match(teamPanel, /PortalReplyComposer/)
  assert.doesNotMatch(teamPanel, /startUnitConversation|destination: 'aspire'|studentId|student_id/)
  assert.match(unitApi, /\/api\/portal\/unit-messages-start/)
  assert.match(teamPanel, /queryKey: \['portal_messages_list'\]/)
  assert.match(teamPanel, /invalidateQueries\(\{ queryKey: \['portal_messages_unread'\] \}\)/)
  assert.match(teamPanel, /portalThreadQueryKey\(activeConversationId\)/)
  assert.match(teamPanel, /isGeneralTeamConversation/)
  assert.match(teamPanel, /thread_kind === 'team_general'/)
  assert.doesNotMatch(teamPanel, /usePortalUnreadCount/)
  assert.doesNotMatch(teamPanel + layer, /from\('messages'|from\('conversations'|supabase\.from/)
  assert.equal((app.match(/usePortalUnreadCount/g) || []).length, 2)
})

test('matched corner behavior and accessibility are explicit', () => {
  assert.match(layer, /const \[activePanel, setActivePanel\] = useState\(null\)/)
  assert.match(layer, /visiblePanel === 'feedback'/)
  assert.match(layer, /visiblePanel === 'messages'/)
  assert.match(layer, /current === 'messages' \? null : 'messages'/)
  assert.match(layer, /hidden=\{utilitiesHidden \|\| visiblePanel === 'messages'\}/)
  assert.match(layer, /visiblePanel !== 'feedback'/)
  assert.match(layer, /feedbackEnabled = isUnitLeaderPortal \|\| isStudentPortal/)
  assert.match(layer, /messagesEnabled = messagesAuthorized && \(isUnitLeaderPortal \|\| isStudentPortal \|\| isAcademicPartnerPortal\)/)
  assert.match(layer, /const visiblePanel = suppressed \? null : activePanel/)
  assert.match(layerCode, /\[aria-modal="true"\]:not\(\.shared-feedback-panel\):not\(\.ptl-team-message-panel\)/)
  assert.match(layerCode, /INPUT', 'TEXTAREA', 'SELECT'/)
  assert.match(layerCode, /window\.matchMedia\('\(max-width: 760px\)'\)/)
  assert.match(sharedFeedback, /aria-expanded=\{isOpen\}/)
  assert.match(teamPanel, /role="dialog"/)
  assert.match(teamPanel, /aria-labelledby="ptl-team-message-title"/)
  assert.match(teamPanel, /aria-describedby="ptl-team-message-subtitle"/)
  assert.match(teamPanel, /aria-label="Start a new conversation"/)
  assert.match(teamPanel, /aria-label="Close Messages"/)
  assert.match(focus, /event\.key === 'Escape'/)
  assert.match(focus, /previous\?\.focus\?\.\(\)/)
  assert.match(teamPanel, /role="status" aria-live="polite"/)
  assert.match(css + globalCss, /min-height: 52px|min-height: 44px/)
})

test('desktop notice trigger, suppression, and persistence are unchanged', () => {
  assert.match(layer, /window\.matchMedia\('\(max-width: 1023px\)'\)/)
  assert.match(layer, /This portal is optimized for desktop use\. For the best experience, open it on a laptop or larger screen\./)
  assert.match(layer, /noticeVisible = enabled && isUnitLeaderPortal/)
  assert.match(layer, /Continue anyway/)
  assert.match(layer, /pathname\.startsWith\('\/portal\/messages'\)/)
  assert.match(layer, /aspire\.portal\.desktopNotice\.v1:\$\{profileId\}:\$\{role\}/)
  assert.match(layer, /NOTICE_DAYS = 30/)
  assert.match(layer, /JSON\.parse\(raw\)/)
  assert.match(layer, /setSessionDismissedKey\(noticeKey\)/)
  assert.match(layer, /setStoredDismissedKey\(noticeKey\)/)
  assert.doesNotMatch(layerCode, /navigator\.userAgent|device|platform/i)
})

test('responsive placement and bottom-nav clearance are present', () => {
  assert.match(globalCss, /bottom: calc\(82px \+ env\(safe-area-inset-bottom\)\)/)
  assert.match(css, /bottom: calc\(82px \+ env\(safe-area-inset-bottom\)\)/)
  assert.match(css, /bottom: calc\(146px \+ env\(safe-area-inset-bottom\)\)/)
  assert.match(css, /width: min\(420px, calc\(100vw - 32px\)\)/)
  assert.match(css, /height: min\(720px, calc\(100vh - 160px\)\)/)
  assert.match(css, /@media \(max-width: 760px\)[\s\S]*\.ptl-team-message-panel/)
  assert.match(css, /\.ptl-keith-head-action,[\s\S]*\.ptl-keith-head-close \{[\s\S]*min-width: 44px; min-height: 44px/)
})

test('static boundaries remain locked', () => {
  for (const source of [app, shell, layer, portalFeedback, sharedFeedback, teamPanel, client, validation, css]) {
    assert.doesNotMatch(source, /academic_partner_message|Academic Partner Messages|user_school_scopes/)
    assert.doesNotMatch(source, /CREATE TABLE|ALTER TABLE|supabase\/migrations|migration_/)
    assert.doesNotMatch(source, /MESSAGE_FROM|MESSAGE_REPLY_TO|noreply@aspire-program\.com|aspire@cshs\.org/)
    assert.doesNotMatch(source, /type="file"|file upload|dangerouslySetInnerHTML/i)
  }
  assert.doesNotMatch(portalFeedback + layer + client, /Academic Partner feedback/)
  assert.doesNotMatch(sharedFeedbackCode + teamPanelCode, /screenshot|attachment/i)
})
