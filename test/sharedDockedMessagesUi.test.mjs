// Shared docked Messages UI pass. Static-source guards only; no API calls,
// conversations, SQL, migrations, or browser automation.
//
// Run: node --test test/sharedDockedMessagesUi.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const app = read('src/portal/PortalApp.jsx')
const layer = read('src/portal/PortalUtilityLayer.jsx')
const panel = read('src/portal/PortalTeamMessagesPanel.jsx')
const thread = read('src/portal/messages/PortalMessagesThread.jsx')
const reply = read('src/portal/messages/PortalReplyComposer.jsx')
const client = read('src/lib/messages/portalMessagesApiClient.js')
const css = read('src/portal/portal.css')
const globalCss = read('src/index.css')

const panelCode = strip(panel)
const startBlock = panel.match(/const startTeamConversation = async[\s\S]*?\n  }/)?.[0] || ''

test('Student and Unit Leader mount the same docked ASPIRE Team Messages utility', () => {
  // Student, Unit Leader, and Academic Partner all mount PortalUtilityLayer; only Student and
  // Unit Leader are Messages-authorized, so only they get the docked ASPIRE Team Messages launcher.
  assert.equal((app.match(/<PortalUtilityLayer/g) || []).length, 3)
  const studentBranch = app.slice(app.indexOf("roles.includes('student')"), app.indexOf("roles.includes('unit_leader')"))
  const unitBranch = app.slice(app.indexOf("roles.includes('unit_leader')"), app.indexOf("roles.includes('academic_partner')"))
  const academicBranch = app.slice(app.indexOf("roles.includes('academic_partner')"))

  assert.match(studentBranch, /portalRole="student"/)
  assert.match(studentBranch, /portalType="student"/)
  assert.match(studentBranch, /messagesAuthorized/)
  assert.match(studentBranch, /onOpenMessages=\{goMessages\}/)
  assert.match(unitBranch, /portalRole="unit_leader"/)
  assert.match(unitBranch, /portalType="unit_leader"/)
  assert.match(unitBranch, /messagesAuthorized/)
  // Academic Partner mounts the utility layer with Messages gated on the fail-closed AP_MESSAGING_ENABLED
  // flag: with the flag off there is no docked Messages launcher and no Messages request. The launcher
  // is wired (onOpenMessages) so a single flag flip (after the Owner SQL gate) activates it.
  assert.match(academicBranch, /portalRole="academic_partner"/)
  assert.match(academicBranch, /messagesAuthorized=\{AP_MESSAGING_ENABLED\}/)
  assert.match(academicBranch, /onOpenMessages=\{\(\) => goApSection\('messages'\)\}/)

  assert.match(layer, /isUnitLeaderPortal = portalRole === 'unit_leader' && portalType === 'unit_leader'/)
  assert.match(layer, /isStudentPortal = portalRole === 'student' && portalType === 'student'/)
  assert.match(layer, /isAcademicPartnerPortal = portalRole === 'academic_partner' && portalType === 'academic_partner'/)
  // Messages is gated on messagesAuthorized (Academic Partner is fail-closed behind AP_MESSAGING_ENABLED
  // until the Owner SQL gate lands), so all three kinds share the same launcher wiring.
  assert.match(layer, /messagesEnabled = messagesAuthorized && \(isUnitLeaderPortal \|\| isStudentPortal \|\| isAcademicPartnerPortal\)/)
  assert.match(layer, /feedbackEnabled = isUnitLeaderPortal \|\| isStudentPortal \|\| isAcademicPartnerPortal/)
  assert.match(layer, /noticeVisible = enabled && isUnitLeaderPortal/)
  assert.match(layer, /variant=\{isUnitLeaderPortal \? 'unit_leader' : isAcademicPartnerPortal \? 'academic_partner' : 'student'\}/)
})

test('panel header and launch targets match the shared Messages spec', () => {
  assert.match(layer, /aria-label="Open messages with the ASPIRE Team"/)
  assert.match(panel, /<h2 id="ptl-team-message-title">Messages<\/h2>/)
  assert.match(panel, /<p id="ptl-team-message-subtitle">ASPIRE Team<\/p>/)
  assert.match(panel, /aria-label="Start a new conversation"/)
  assert.match(panel, /aria-label="Close Messages"/)
  assert.match(panel, /aria-labelledby="ptl-team-message-title"/)
  assert.match(panel, /aria-describedby="ptl-team-message-subtitle"/)
  assert.match(panel, /aria-label="Messages with the ASPIRE Team"/)
  assert.match(panel, /RotateCcw/)
  assert.match(panel, /ptl-keith-head-action ptl-team-message-new/)
  assert.match(panel, /ptl-keith-head-close ptl-team-message-close/)
  assert.doesNotMatch(panel, /Plus/)
  assert.match(css, /\.ptl-keith-head-action,[\s\S]*\.ptl-keith-head-close \{[\s\S]*min-width: 44px; min-height: 44px/)
})

test('new general conversation uses a stable request id and the final endpoint contract only', () => {
  assert.match(client, /export function startGeneralTeamConversation/)
  assert.match(client, /\/api\/portal\/team-messages-start/)
  assert.match(client, /body: \{ request_id: requestId, body \}/)
  assert.match(panel, /function createRequestId\(\)/)
  assert.match(panel, /const \[requestId, setRequestId\] = useState\(null\)/)
  assert.match(panel, /const stableRequestId = requestId \|\| createRequestId\(\)/)
  assert.match(panel, /if \(!requestId\) setRequestId\(stableRequestId\)/)
  assert.match(startBlock, /api\.startGeneralTeamConversation\(\{\s*\n\s*requestId: stableRequestId,\s*\n\s*body: normalized,\s*\n\s*\}\)/)
  assert.match(startBlock, /setRequestId\(null\)[\s\S]*setComposeMode\(false\)[\s\S]*setSelectedId\(out\?\.conversation_id \|\| null\)/)
  assert.doesNotMatch(startBlock, /student_id|studentId|unit_key|unitKey|role|profile_id|profileId|subject|category|destination/)
  assert.doesNotMatch(panelCode, /startUnitConversation|TEAM_SUBJECT|TEAM_CATEGORY|destination: 'aspire'/)
})

test('compose lifecycle creates no conversation on open, New, close, or failed retry', () => {
  assert.match(panel, /enabled: open/)
  assert.match(panel, /onClick=\{\(\) => beginFreshCompose\(\)\}/)
  assert.match(panel, /onClick=\{onClose\}/)
  assert.match(panel, /if \(!canStart \|\| startRef\.current\) return/)
  assert.match(panel, /startRef\.current = true/)
  assert.match(panel, /setPendingStart\(true\)/)
  assert.match(panel, /setErr\(e\?\.status === 409 \? mapPortalConflict\(e\?\.reason\) : mapPortalMessagesError\(e\?\.status\)\)/)
  const catchBlock = panel.match(/catch \(e\) \{[\s\S]*?\n    \}/)?.[0] || ''
  assert.doesNotMatch(catchBlock, /setDraft\(''\)|setRequestId\(null\)|setComposeMode\(false\)/)
})

test('opening selects only authorized team_general rows by thread_kind', () => {
  assert.match(panel, /function isGeneralTeamConversation\(row\) \{\s*\n\s*return row\?\.thread_kind === 'team_general'/)
  assert.match(panel, /rows\.find\(isGeneralTeamConversation\) \|\| null/)
  assert.match(panel, /selectedId \|\| latestGeneralConversation\?\.id \|\| null/)
  assert.doesNotMatch(panelCode, /!direct_student_name|direct_student_name\s*\?/)
})

test('existing replies and read-state continue through the shared portal thread APIs', () => {
  assert.match(panel, /PortalMessagesThread/)
  assert.match(panel, /PortalReplyComposer/)
  assert.match(panel, /markPortalConversationRead\(\{ conversationId: id \}\)/)
  assert.match(reply, /replyToPortalConversation/)
  assert.match(thread, /getPortalThreadPage/)
  assert.match(panel, /invalidateQueries\(\{ queryKey: \['portal_messages_list'\] \}\)/)
  assert.match(panel, /invalidateQueries\(\{ queryKey: \['portal_messages_unread'\] \}\)/)
  assert.match(panel, /portalThreadQueryKey\(activeConversationId\)/)
})

test('shared bubbles render ASPIRE Team incoming left and portal user outgoing right', () => {
  assert.match(thread, /MessageBubble/)
  assert.match(thread, /perspective="portal"/)
  assert.doesNotMatch(thread, /bubbleClassName="ptl-msg-item"/)
  assert.match(globalCss, /\.msg-bubble-row-incoming \{ justify-content: flex-start; \}/)
  assert.match(globalCss, /\.msg-bubble-row-outgoing \{ justify-content: flex-end; \}/)
  assert.match(globalCss, /\.msg-bubble-incoming \{[\s\S]*background: #eef0f4;[\s\S]*color: #1f2937/)
  assert.match(globalCss, /\.msg-bubble-outgoing \{[\s\S]*background: #3478f6;[\s\S]*color: #fff/)
  assert.match(globalCss, /\.msg-bubble-incoming::after,[\s\S]*\.msg-bubble-outgoing::after \{[\s\S]*background: inherit;/)
  const legacy = css.slice(css.indexOf('.ptl-msg-item {'), css.indexOf('.ptl-msg-author {'))
  assert.match(legacy, /width: auto;/)
  assert.doesNotMatch(legacy, /align-self: flex|background: #3478f6|background: #eef0f4|max-width: min\(78%/)
})

test('static boundaries exclude SQL, Academic Partner Messages, and desktop student notice', () => {
  for (const source of [app, layer, panel, css]) {
    assert.doesNotMatch(source, /CREATE TABLE|ALTER TABLE|supabase\/migrations|migration_/)
    assert.doesNotMatch(source, /Academic Partner Messages|academic_partner_message/)
  }
  const studentBranch = app.slice(app.indexOf("roles.includes('student')"), app.indexOf("roles.includes('unit_leader')"))
  assert.doesNotMatch(studentBranch, /desktopNotice/)
  assert.match(layer, /const feedbackEnabled = isUnitLeaderPortal \|\| isStudentPortal/)
  assert.match(layer, /const noticeVisible = enabled && isUnitLeaderPortal/)
  assert.match(layer, /\{feedbackEnabled && \(/)
  assert.match(layer, /\{noticeVisible && \(/)
})
