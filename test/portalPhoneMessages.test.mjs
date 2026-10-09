// test/portalPhoneMessages.test.mjs
//
// PORTAL-PHONE-MESSAGES-1 (Owner, 2026-10-08, from the Student Portal saved to an iPhone home
// screen). Phone only (the 760px breakpoint the bottom bar uses):
//   1. an open thread fills the screen and the reply box sits at its foot, above the bar;
//   2. New message is a compose button drawn like the Messages shortcut, not a full-width bar;
//   3. Send Feedback is not shown on the Messages screen.
// Measured in a harness at 375x812: reply box 19px above the bar, the page does not scroll,
// a long thread scrolls inside and opens on the newest; desktop keeps its 560px column.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const workspace = read('src/portal/messages/PortalMessagesWorkspace.jsx')
const css = read('src/portal/portal.css')
const layer = read('src/portal/PortalUtilityLayer.jsx')
const app = read('src/portal/PortalApp.jsx')

test('1. a phone thread is the screen\'s height and its messages scroll inside it', () => {
  assert.match(workspace, /const phoneThread = narrow && showThread && Boolean\(selectedId\)/)
  assert.match(workspace, /window\.innerHeight - top - keep/)
  assert.match(workspace, /getComputedStyle\(main\)\.paddingBottom/)
  assert.match(css, /\.ptl-msg-pane-thread-phone \.ptl-msg-scroll \{ position: relative; flex: 1; min-height: 0; max-height: none; overflow-y: auto; \}/)
  assert.match(css, /\.ptl-msg-pane-thread-phone \.ptl-msg-composer \{ flex-shrink: 0; \}/)
  // Desktop keeps its own column.
  assert.match(css, /@media \(min-width: 761px\) \{[\s\S]*?\.ptl-msg-pane-thread \{ height: 560px; \}/)
})

test('2. on a phone New message is the compose button, opening the same drawer', () => {
  assert.ok(existsSync(new URL('../public/brand/messages-compose.png', import.meta.url)))
  assert.match(workspace, /\{narrow \? \(\s*\n\s*<button\s*\n\s*ref=\{newBtnRef\}\s*\n\s*type="button"\s*\n\s*className="ptl-msg-compose"\s*\n\s*onClick=\{\(\) => setNewOpen\(true\)\}\s*\n\s*aria-label="New message"/)
  assert.match(workspace, /src="\/brand\/messages-compose\.png"/)
  assert.match(workspace, /className="ptl-btn ptl-msg-btn ptl-msg-new"/, 'wider screens keep the New message button')
})

test('3. Send Feedback stays off the Messages screen on a phone, in both launcher layers', () => {
  assert.match(layer, /const feedbackLauncherHidden = utilitiesHidden \|\| \(mobile && \(visiblePanel === 'messages' \|\| onMessagesRoute\)\)/)
  assert.match(app, /hidden=\{mobile && \(activeUtility === 'messages' \|\| isFullMessagesPath\(location\.pathname\)\)\}/)
})
