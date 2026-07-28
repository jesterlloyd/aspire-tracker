// Portal experience convergence Phase 1 static/pure guards.
// Run: node --test test/portalExperienceConvergencePhase1.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { messageBubbleDirection } from '../src/lib/messages/messageBubbleDirection.js'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const sharedFeedback = read('src/components/shared/SharedFeedbackPanel.jsx')
const portalFeedback = read('src/portal/PortalFeedbackPanel.jsx')
const layer = read('src/portal/PortalUtilityLayer.jsx')
const app = read('src/portal/PortalApp.jsx')
const endpoint = read('api/portal/feedback-submit.js')
const panel = read('src/portal/PortalTeamMessagesPanel.jsx')
const portalThread = read('src/portal/messages/PortalMessagesThread.jsx')
const portalWorkspace = read('src/portal/messages/PortalMessagesWorkspace.jsx')
const portalReply = read('src/portal/messages/PortalReplyComposer.jsx')
const staffWorkspace = read('src/components/connect/messages/MessagesWorkspace.jsx')
const bubble = read('src/components/shared/MessageBubble.jsx')
const bubbleDirection = read('src/lib/messages/messageBubbleDirection.js')
const css = read('src/portal/portal.css')
const globalCss = read('src/index.css')

test('shared feedback copy and Student durable feedback activation are canonical', () => {
  assert.match(sharedFeedback, /Send Feedback/)
  assert.match(sharedFeedback, /Report a bug, suggest a feature, or ask a question\./)
  assert.match(read('src/components/FeedbackPanel.jsx'), /SharedFeedbackPanel/)
  assert.match(portalFeedback, /submitPortalFeedbackReport/)
  // The portal label now names all three portals.
  assert.match(portalFeedback, /portalType === 'student' \? 'Student Portal'/)
  assert.match(portalFeedback, /portalType === 'academic_partner' \? 'Academic Partner Portal'/)
  assert.match(portalFeedback, /: 'Unit Leader Portal'/)
  // Feedback (not Messages) is enabled for the Academic Partner too.
  assert.match(layer, /feedbackEnabled = isUnitLeaderPortal \|\| isStudentPortal \|\| isAcademicPartnerPortal/)
  assert.match(layer, /portalType=\{isStudentPortal \? 'student' : isAcademicPartnerPortal \? 'academic_partner' : 'unit_leader'\}/)
  const studentBranch = app.slice(app.indexOf("roles.includes('student')"), app.indexOf("roles.includes('unit_leader')"))
  const academicBranch = app.slice(app.indexOf("roles.includes('academic_partner')"))
  assert.match(studentBranch, /PortalUtilityLayer/)
  assert.doesNotMatch(studentBranch, /desktopNotice/)
  // Academic Partner mounts the utility layer; Messages is gated on the fail-closed server capability.
  assert.match(academicBranch, /PortalUtilityLayer/)
  assert.match(academicBranch, /messagesAuthorized=\{apMessagesEnabled\}/)
})

test('portal feedback endpoint accepts Student, Unit Leader, and Academic Partner', () => {
  assert.match(endpoint, /verifyPortalFeedbackCaller/)
  assert.match(endpoint, /verifyPortalStudentCaller/)
  assert.match(endpoint, /verifyPortalUnitLeaderCaller/)
  assert.match(endpoint, /actorKind: 'student'/)
  assert.match(endpoint, /actorKind: 'unit_leader'/)
  assert.match(endpoint, /actorKind: 'academic_partner'/)
  assert.match(endpoint, /unit_leader_active_scope_required/)
  assert.match(endpoint, /reporterContext: auth\.actorKind === 'student'/)
  // AP is authorized by an ACTIVE academic_partner grant (no school scope needed for feedback,
  // which carries no student data); the endpoint does not read school scope for feedback.
  assert.match(endpoint, /hasActiveRoleGrant\([^)]*'academic_partner'\)/)
  assert.doesNotMatch(endpoint, /verifyPortalSchool|user_school_scopes/)
  assert.doesNotMatch(endpoint, /parsed\.body\.(role|profile_id|student_id|school|unit)/)
})

test('docked Messages uses Keith-derived subtle controls and compact composer', () => {
  assert.match(panel, /RotateCcw/)
  assert.match(panel, /ptl-keith-head-action ptl-team-message-new/)
  assert.match(panel, /ptl-keith-head-close ptl-team-message-close/)
  assert.match(panel, /aria-label="Start a new conversation"/)
  assert.match(panel, /aria-label="Close Messages"/)
  assert.doesNotMatch(panel, /Plus/)
  assert.doesNotMatch(panel, /\+ New/)
  assert.match(panel, /ptl-msg-guidance/)
  assert.match(panel, /ptl-msg-compose-row/)
  assert.match(panel, /ptl-msg-send-circle/)
  assert.match(panel, /aria-label="Send message"/)
  assert.doesNotMatch(panel, /className="ptl-btn ptl-msg-btn"[\s\S]*Send message/)
  assert.match(css, /\.ptl-keith-head-action,[\s\S]*\.ptl-keith-head-close/)
  assert.match(css, /\.ptl-msg-send-circle \{[\s\S]*border-radius: 50%/)
})

test('portal full workspace guidance and composer placement are not repeated between input and send', () => {
  assert.match(portalWorkspace, /ptl-msg-workspace-guidance/)
  assert.match(portalWorkspace, /PORTAL_SAFETY_NOTICE/)
  assert.doesNotMatch(portalReply, /PORTAL_SAFETY_NOTICE|ptl-msg-safety|ptl-reply-safety/)
  assert.match(portalReply, /ptl-msg-compose-row/)
  assert.match(portalReply, /ptl-msg-send-circle/)
  assert.match(portalReply, /aria-label="Send message"/)
})

test('one shared message bubble presenter drives portal and staff perspectives', () => {
  assert.match(portalThread, /MessageBubble/)
  assert.match(portalThread, /perspective="portal"/)
  assert.match(staffWorkspace, /MessageBubble/)
  assert.match(staffWorkspace, /perspective="staff"/)
  assert.match(bubbleDirection, /export function messageBubbleDirection/)
  assert.match(globalCss, /\.msg-bubble-incoming \{[\s\S]*background: #eef0f4;[\s\S]*color: #1f2937/)
  assert.match(globalCss, /\.msg-bubble-outgoing \{[\s\S]*background: #3478f6;[\s\S]*color: #fff/)
  assert.match(globalCss, /\.msg-bubble-body \{[\s\S]*white-space: pre-wrap;[\s\S]*overflow-wrap: anywhere/)
  assert.equal(messageBubbleDirection({ author_type: 'staff' }, 'portal'), 'incoming')
  assert.equal(messageBubbleDirection({ author_type: 'student' }, 'portal'), 'outgoing')
  assert.equal(messageBubbleDirection({ author_role: 'staff' }, 'staff'), 'outgoing')
  assert.equal(messageBubbleDirection({ author_role: 'student' }, 'staff'), 'incoming')
})

test('Unit Leader full Messages workspace uses available width without role regression', () => {
  assert.match(css, /\.ptl-msg-workspace \{ width: 100%; max-width: none;/)
  assert.match(css, /\.ptl-msg-split \{ display: grid; grid-template-columns: 360px 1fr/)
  assert.match(portalWorkspace, /variant === 'unit_leader' \? UL_PORTAL_SUBTITLE : variant === 'academic_partner' \? AP_PORTAL_SUBTITLE : PORTAL_SUBTITLE/)
  assert.match(read('src/portal/messages/PortalMessagesInbox.jsx'), /direct_student_name/)
  assert.doesNotMatch(strip(app), /academic_partner[\s\S]{0,200}PortalMessagesWorkspace/)
})
