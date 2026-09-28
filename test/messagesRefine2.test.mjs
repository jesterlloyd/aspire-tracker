// test/messagesRefine2.test.mjs
//
// MESSAGES-REFINE-2 and MESSAGES-RECEIPTS-1 (2026-09-28): a calmer staff drawer
// and student view, Sent / Delivered / Read on the latest own message, and an
// emoji tooltip that follows the pointer, the keyboard, or a sliding finger.
// The receipt rule itself is proven on Postgres in
// test/messagesReadReceiptsMigration.test.mjs.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { threadBanner } from '../src/lib/messages/messagesTriage.js'

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const bubble = read('src/components/shared/MessageBubble.jsx')
const reactions = read('src/components/shared/MessageReactions.jsx')
const trigger = read('src/components/shared/useReactionTrigger.js')
const workspace = read('src/components/connect/messages/MessagesWorkspace.jsx')
const actions = read('src/components/connect/messages/ThreadActions.jsx')
const portalThread = read('src/portal/messages/PortalMessagesThread.jsx')
const portalReply = read('src/portal/messages/PortalReplyComposer.jsx')
const css = read('src/index.css')

test('receipts: one line under the latest own message, from the newest page', () => {
  assert.match(bubble, /const RECEIPT_LABEL = \{ sent: 'Sent', delivered: 'Delivered', read: 'Read' \}/)
  assert.match(bubble, /<span style=\{srOnly\}>Message status: <\/span>\{RECEIPT_LABEL\[receipt\]\}/)
  assert.match(workspace, /const receipt = pages\[0\]\?\.receipt \|\| null/)
  assert.match(workspace, /receipt=\{receipt\?\.message_id === m\.id \? receipt\.state : null\}/)
  assert.match(portalThread, /const receipt = newestPage\?\.receipt \|\| null/)
  assert.match(portalThread, /receipt=\{receipt\?\.message_id === m\.id \? receipt\.state : null\}/)
  assert.match(css, /\.msg-receipt \{[^}]*flex-basis: 100%/)
})

test('receipts: both thread endpoints prefer the new readers and fall back', () => {
  const staff = read('api/messages-staff-thread.js')
  const portal = read('api/portal/messages-thread.js')
  assert.ok(staff.indexOf("'messages_staff_get_thread_v6'") < staff.indexOf("'messages_staff_get_thread_v5'"))
  assert.ok(portal.indexOf("'messages_portal_get_thread_v5'") < portal.indexOf("'messages_portal_get_thread_v4'"))
  assert.match(staff, /receipt: data\.receipt \?\? null,/)
  assert.match(portal, /receipt: data\.receipt \?\? null,/)
})

test('tooltip: names the emoji under the pointer, keyboard focus or sliding finger', () => {
  assert.match(reactions, /className="msg-reaction-tip" aria-hidden="true"/)
  assert.match(reactions, /onPointerEnter=\{\(e\) => \{ if \(e\.pointerType === 'mouse'\) showTip\(e\.currentTarget\) \}\}/)
  assert.match(reactions, /onFocus=\{\(e\) => \{ if \(e\.currentTarget\.matches\(':focus-visible'\)\) showTip\(e\.currentTarget\) \}\}/)
  assert.doesNotMatch(reactions, /title=\{def\.label\}/, 'no native title doubling the tooltip')
  assert.match(css, /\.msg-reaction-bar\[data-placement='down'\] \.msg-reaction-tip \{ bottom: auto; top: calc\(100% \+ 6px\); \}/)
})

test('slide: a held long press picks where it is released, once per press', () => {
  assert.match(trigger, /setPressActive\(true\)\s*\n\s*setOpen\(true\)/)
  assert.match(reactions, /if \(!pressActive\) return undefined/)
  assert.match(reactions, /\}, \[pressActive\]\)/, 'subscribes once per press, never again after release')
  assert.match(reactions, /if \(el && !el\.disabled\) pickRef\.current\(el\.dataset\.key\)/)
  // Right-click and the keyboard open the bar with no press to follow.
  assert.equal((trigger.match(/setPressActive\(false\)/g) || []).length, 3)
})

test('staff drawer: a compact two-line header and a one-line status', () => {
  assert.match(workspace, /compact=\{narrow\}/)
  assert.match(workspace, /className="messages-thread-head--compact"/)
  assert.match(workspace, /aria-label="Back to messages"/)
  assert.match(workspace, /\{banner\.short \|\| banner\.label\}/)
  assert.match(actions, /messages-action-btn--icon/)
  assert.equal(threadBanner({ status: 'resolved' }, null, null).short, 'Done · reopens if they write again')
})

test('student view: subject header, no category, notice under the reply box', () => {
  assert.doesNotMatch(portalThread, /conversation\.category|ptl-msg-row-cat/)
  assert.match(portalThread, /\{closed && \(/)
  assert.match(portalReply, /placeholder="Write a message"/)
  assert.match(portalReply, /normalized\.length > MESSAGE_MAX_BODY_CHARS - 500 \? '' : ' sr-only'/)
  assert.match(portalReply, /className="ptl-label sr-only" htmlFor="ptl-reply-body"/)
})
