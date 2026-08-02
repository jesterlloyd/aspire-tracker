// MESSAGES-AUTOSCROLL-1: latest-message auto-scroll + the main-app Messages
// shortcut.
//
// One shared hook (useThreadAutoScroll) anchors every thread host to the
// newest message: the staff ThreadPanel, PortalMessagesThread, and therefore
// the docked PortalTeamMessagesPanel that reuses it. Scrolling is container-
// only (never the page), intentional upward reading is never interrupted (a
// restrained "New messages" chip appears instead), and reduced motion drops
// smooth scrolling. The main app gains the canonical lower-right Messages
// launcher directly above Keith, deep-linking to the one staff Messages
// surface with the shared unread query and permissions.
//
// Run: node --test test/messagesAutoScrollLauncher.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { isNearBottom, NEAR_BOTTOM_PX, SETTLE_PASSES_MS } from '../src/lib/messages/useThreadAutoScroll.js'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')
const hook = read('src/lib/messages/useThreadAutoScroll.js')
const staff = read('src/components/connect/messages/MessagesWorkspace.jsx')
const portal = read('src/portal/messages/PortalMessagesThread.jsx')
const launcher = read('src/components/MainMessagesLauncher.jsx')
const app = read('src/App.jsx')
const css = read('src/portal/portal.css')

// ── The pure near-bottom predicate ───────────────────────────────────────────

test('isNearBottom: threshold math, defaulting to 80px, tolerant of a missing element', () => {
  assert.equal(NEAR_BOTTOM_PX, 80)
  const el = (scrollHeight, scrollTop, clientHeight) => ({ scrollHeight, scrollTop, clientHeight })
  assert.equal(isNearBottom(el(1000, 520, 400)), false)   // 80px away exactly -> not near
  assert.equal(isNearBottom(el(1000, 521, 400)), true)    // 79px away -> near
  assert.equal(isNearBottom(el(1000, 600, 400)), true)    // pinned to the bottom
  assert.equal(isNearBottom(el(300, 0, 400)), true)       // no overflow at all
  assert.equal(isNearBottom(null), true)                  // unmounted -> treat as bottom
  assert.equal(isNearBottom(el(1000, 0, 400), 700), true) // custom threshold honored
})

test('the settle schedule re-pins after paint for variable-height content', () => {
  assert.deepEqual(SETTLE_PASSES_MS, [0, 120, 400])
  assert.match(hook, /if \(nearBottomRef\.current\) pinToBottom\('auto'\)/)
})

// ── Container-only scroll management ─────────────────────────────────────────

test('the hook scrolls ONLY the history container - never the page', () => {
  assert.match(hook, /el\.scrollTop = el\.scrollHeight/)
  assert.match(hook, /el\.scrollTo\(\{ top: el\.scrollHeight, behavior: 'smooth' \}\)/)
  assert.doesNotMatch(hook, /scrollIntoView/)
  assert.doesNotMatch(hook, /window\.scroll|document\.scrollingElement|document\.body\.scroll/)
})

test('reduced motion suppresses smooth scrolling', () => {
  assert.match(hook, /prefers-reduced-motion: reduce/)
  assert.match(hook, /behavior === 'smooth' && !prefersReducedMotion\(\)/)
})

test('upward reading is never interrupted; the chip appears instead', () => {
  assert.match(hook, /if \(nearBottomRef\.current\) pinToBottom\('smooth'\)\n {4}else setShowNewIndicator\(true\)/)
  // Scrolling back to the bottom clears the affordance.
  assert.match(hook, /if \(nearBottomRef\.current\) setShowNewIndicator\(false\)/)
})

test('thread open and thread switch re-anchor exactly once per thread', () => {
  assert.match(hook, /if \(anchoredThreadRef\.current === threadId\) return/)
  assert.match(hook, /anchoredThreadRef\.current = threadId/)
  // The newest-key comparator resets alongside, so the initial page never
  // triggers the incoming-message path.
  assert.match(hook, /lastNewestRef\.current = newestKey \?\? null/)
})

// ── Host wiring: the two thread owners share the ONE hook ────────────────────

test('the staff ThreadPanel wires the shared hook to its scroll container', () => {
  assert.match(staff, /import \{ useThreadAutoScroll \} from '\.\.\/\.\.\/\.\.\/lib\/messages\/useThreadAutoScroll'/)
  // Destructured at the call site (the hooks lint rule forbids member access
  // on a ref-carrying object during render).
  assert.match(staff, /\} = useThreadAutoScroll\(\{\n {4}threadId: conversationId,\n {4}ready: !isLoading && pages\.length > 0,\n {4}newestKey: newestId,\n {2}\}\)/)
  assert.match(staff, /<div ref=\{threadScrollRef\} onScroll=\{onThreadScroll\} style=\{\{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '10px 16px' \}\}>/)
  assert.match(staff, /\{showNewIndicator && \(/)
  assert.match(staff, /New messages ↓/)
})

test('PortalMessagesThread wires the same hook (docked panel inherits it)', () => {
  assert.match(portal, /import \{ useThreadAutoScroll \} from '\.\.\/\.\.\/lib\/messages\/useThreadAutoScroll'/)
  assert.match(portal, /\} = useThreadAutoScroll\(\{\n {4}threadId: conversationId,\n {4}ready: !isLoading && pages\.length > 0,\n {4}newestKey: newestId,\n {2}\}\)/)
  assert.match(portal, /<div className="ptl-msg-scroll" ref=\{threadScrollRef\} onScroll=\{onThreadScroll\}>/)
  assert.match(portal, /className="ptl-msg-newer-chip"/)
  // The hook is called BEFORE the early returns (rules of hooks).
  assert.ok(portal.indexOf('useThreadAutoScroll({') < portal.indexOf("if (!conversationId)"))
  // The wrapper hosts the chip; the scroll element keeps its exact class.
  assert.match(css, /\.ptl-msg-scrollwrap \{ position: relative; flex: 1; min-height: 0; display: flex; flex-direction: column; \}/)
  assert.match(css, /\.ptl-msg-newer-chip \{/)
})

// ── Main-app launcher: canonical shortcut above Keith ────────────────────────

test('the launcher reuses the shared staff Messages state, permissions, and surface', () => {
  assert.match(launcher, /useStaffUnreadCount\(\{ intervalMs: IDLE_UNREAD_POLL_MS, enabled: canUseMessages \}\)/)
  assert.match(launcher, /\['owner', 'admin'\]\.includes\(userProfile\?\.role\) && userProfile\?\.is_active !== false/)
  assert.match(launcher, /navigate\('\/connect\/messages'\)/)
  assert.match(launcher, /aria-label=\{unreadLabel\(unread\)\}/)
  assert.match(launcher, /\{formatUnread\(unread\)\}/)
  assert.match(launcher, /if \(!canUseMessages\) return null/)
  // No second Messages implementation: the launcher renders no thread UI.
  assert.doesNotMatch(launcher, /MessageBubble|useInfiniteQuery|getStaffThread/)
})

test('the launcher sits directly above the 60px Keith orb, canonical visuals', () => {
  assert.match(launcher, /bottom: 'calc\(96px \+ env\(safe-area-inset-bottom, 0px\)\)', right: '28px'/)
  assert.match(launcher, /width: 52, height: 52, borderRadius: '50%'/)
  assert.match(launcher, /background: '#1D2567'/)
  assert.match(launcher, /background: '#DC1E34'/)   // the canonical unread red
  assert.match(launcher, /MessageCircle size=\{24\}/)
  assert.match(launcher, /zIndex: 1000/)
  // Mounted in the App beside Keith; Keith's tooltip moved beside the orb so it
  // no longer floats up into the launcher's slot.
  assert.match(app, /<MainMessagesLauncher \/>/)
  assert.ok(app.indexOf('<MainMessagesLauncher />') > app.indexOf('<Keith'))
  assert.match(read('src/components/Keith.jsx'), /bottom: '38px',\n {10}right: '96px',/)
})

test('portal launcher parity is untouched', () => {
  const utility = read('src/portal/PortalUtilityLayer.jsx')
  assert.match(utility, /aria-label="Open messages with the ASPIRE Team"/)
  assert.match(utility, /ptl-team-message-launcher/)
  // Feedback stays lower-left everywhere (side default 'left', no override).
  assert.doesNotMatch(read('src/components/FeedbackPanel.jsx'), /side=/)
  assert.doesNotMatch(read('src/portal/PortalFeedbackPanel.jsx'), /side="right"/)
})
