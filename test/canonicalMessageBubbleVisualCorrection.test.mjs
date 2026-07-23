// Guards for the canonical ASPIRE message bubble visual correction.
// Run: node --test test/canonicalMessageBubbleVisualCorrection.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { messageBubbleDirection } from '../src/lib/messages/messageBubbleDirection.js'

const here = dirname(fileURLToPath(import.meta.url))
const read = p => readFileSync(join(here, '..', p), 'utf8')

const bubble = read('src/components/shared/MessageBubble.jsx')
const globalCss = read('src/index.css')
const portalCss = read('src/portal/portal.css')
const portalThread = read('src/portal/messages/PortalMessagesThread.jsx')
const staffWorkspace = read('src/components/connect/messages/MessagesWorkspace.jsx')

test('one shared bubble component remains authoritative across portal and staff surfaces', () => {
  assert.match(portalThread, /MessageBubble/)
  assert.match(staffWorkspace, /MessageBubble/)
  assert.doesNotMatch(bubble, /ptl-msg-item-staff|ptl-msg-item-me|ptl-msg-item-head|ptl-msg-time|ptl-msg-body/)
  assert.doesNotMatch(portalThread, /bubbleClassName="ptl-msg-item"/)
})

test('rows align by direction and never carry colored full-row backgrounds', () => {
  assert.match(globalCss, /\.msg-bubble-row \{[\s\S]*display: flex;[\s\S]*flex-direction: row;[\s\S]*width: 100%;[\s\S]*background: transparent;/)
  assert.match(globalCss, /\.msg-bubble-row-incoming \{ justify-content: flex-start; \}/)
  assert.match(globalCss, /\.msg-bubble-row-outgoing \{ justify-content: flex-end; \}/)
  assert.match(globalCss, /\.msg-bubble-row-neutral \{ justify-content: center; \}/)
})

test('bubbles shrink-wrap content and cap width at desktop and mobile sizes', () => {
  const block = globalCss.slice(globalCss.indexOf('.msg-bubble {'), globalCss.indexOf('.msg-bubble-incoming'))
  assert.match(block, /display: inline-flex;/)
  assert.match(block, /width: auto;/)
  assert.match(block, /max-width: min\(70%, 620px\);/)
  assert.doesNotMatch(block, /width: 100%/)
  assert.match(globalCss, /@media \(max-width: 760px\) \{\s*\n\s*\.msg-bubble \{ max-width: 86%; \}/)
})

test('long content wraps safely without horizontal overflow', () => {
  assert.match(globalCss, /\.msg-bubble-body \{[\s\S]*white-space: pre-wrap;[\s\S]*overflow-wrap: anywhere;[\s\S]*word-break: break-word;/)
  assert.match(globalCss, /\.msg-bubble-time \{[\s\S]*white-space: normal;[\s\S]*overflow-wrap: anywhere;/)
})

test('incoming and outgoing tails exist and neutral/system bubbles have no tail', () => {
  assert.match(globalCss, /\.msg-bubble-incoming::after,[\s\S]*\.msg-bubble-outgoing::after \{[\s\S]*content: '';/)
  assert.match(globalCss, /\.msg-bubble-incoming::after \{[\s\S]*left: -4px;[\s\S]*clip-path: polygon\(100% 0, 0 100%, 100% 76%\);/)
  assert.match(globalCss, /\.msg-bubble-outgoing::after \{[\s\S]*right: -4px;[\s\S]*clip-path: polygon\(0 0, 100% 100%, 0 76%\);/)
  assert.match(globalCss, /\.msg-bubble-neutral::after \{ content: none; \}/)
})

test('legacy portal bubble rules are neutralized and cannot force bar sizing', () => {
  const legacy = portalCss.slice(portalCss.indexOf('.ptl-msg-item {'), portalCss.indexOf('.ptl-msg-author {'))
  assert.match(portalCss, /Legacy compatibility only/)
  assert.match(legacy, /width: auto;/)
  assert.match(legacy, /max-width: none;/)
  assert.doesNotMatch(legacy, /width: 100%|max-width: min\(78%|background: #3478f6|background: #eef0f4|align-self: flex/)
})

test('viewer-relative direction logic remains unchanged', () => {
  assert.equal(messageBubbleDirection({ author_role: 'staff' }, 'portal'), 'incoming')
  assert.equal(messageBubbleDirection({ author_role: 'student' }, 'portal'), 'outgoing')
  assert.equal(messageBubbleDirection({ author_type: 'staff' }, 'staff'), 'outgoing')
  assert.equal(messageBubbleDirection({ author_type: 'student' }, 'staff'), 'incoming')
  assert.equal(messageBubbleDirection({ author_role: 'system' }, 'staff'), 'neutral')
})

test('sender and timestamp metadata remain accessible', () => {
  assert.match(bubble, /message from \$\{displayName\}, sent \$\{fullTime\}/)
  assert.match(bubble, /dateTime=\{message\?\.created_at \|\| undefined\}/)
  assert.match(bubble, /title=\{fullTime\}/)
  assert.match(bubble, /directionLabel/)
})
