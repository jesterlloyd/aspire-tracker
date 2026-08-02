// MESSAGES-DOCK-1: the main-app Messages dock + Keith mutual exclusion.
//
// The launcher no longer deep-links to Connect: it opens the docked Messages
// panel hosting the ONE staff MessagesWorkspace in single-pane docked mode
// (same inbox, thread host, New message dialog, permissions, unread query,
// read-state rules, and useThreadAutoScroll). Keith and Messages share one
// explicit lower-right dock: opening one closes the other, the launcher
// relocates while Keith is open so nothing covers Keith's composer, Escape
// closes the active panel, and focus returns to the launcher.
//
// Run: node --test test/messagesDockKeith.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')
const dock = read('src/components/MainMessagesLauncher.jsx')
const workspace = read('src/components/connect/messages/MessagesWorkspace.jsx')
const keith = read('src/components/Keith.jsx')
const panels = read('src/lib/floatingPanels.js')

// ── The launcher opens the docked panel, not a navigation ────────────────────

test('the launcher opens docked Messages; Connect is a restrained secondary action', () => {
  assert.match(dock, /const openPanel = \(\) => \{\n {4}announceFloatingPanelOpen\('main-messages'\)/)
  assert.match(dock, /onClick=\{openPanel\}/)
  // Navigation exists ONLY behind the explicit header action.
  assert.match(dock, /const openInConnect = \(\) => \{\n {4}closePanel\(false\)\n {4}navigate\('\/connect\/messages'\)\n {2}\}/)
  assert.match(dock, /Open in ASPIRE Connect/)
  const clickIdx = dock.indexOf('onClick={openPanel}')
  assert.ok(clickIdx > -1, 'the launcher click opens the panel')
  assert.doesNotMatch(dock.slice(0, clickIdx), /onClick=\{openInConnect\}/, 'navigation is never the launcher behavior')
})

test('the panel hosts the ONE workspace in docked mode - no duplicate implementation', () => {
  assert.match(dock, /import MessagesWorkspace from '\.\/connect\/messages\/MessagesWorkspace'/)
  assert.match(dock, /<MessagesWorkspace\n {16}docked\n {16}initialSelectedId=\{lastSelectedId\}\n {16}onSelectionChange=\{setLastSelectedId\}\n {14}\/>/)
  assert.doesNotMatch(dock, /MessageBubble|useInfiniteQuery|getStaffThread|MessagesInbox|ThreadPanel/)
  // The page stays visible behind a transparent backdrop.
  assert.match(dock, /background: 'transparent' \}\} \/>/)
})

// ── Session state: first open vs reopen ──────────────────────────────────────

test('first open shows the list; reopen restores the last thread and re-anchors', () => {
  // Dock memory survives close/reopen; the panel unmounts on close, so the
  // remounted ThreadPanel re-anchors through useThreadAutoScroll.
  assert.match(dock, /const \[lastSelectedId, setLastSelectedId\] = useState\(null\)/)
  assert.match(workspace, /docked = false, initialSelectedId = null, onSelectionChange,/)
  assert.match(workspace, /useState\(initialSelectedId\)/)
  assert.match(workspace, /useState\(initialSelectedId \? 'thread' : 'list'\)/)
  // docked forces the single-pane phone layout regardless of window width.
  assert.match(workspace, /const narrow = useIsNarrow\(\) \|\| docked/)
  // Selection changes flow back to the dock's memory.
  assert.match(workspace, /onSelectionChange\?\.\(id\)/)
  // An unavailable thread falls back to the conversation list.
  assert.match(workspace, /onGone=\{\(\) => \{ setSelectedId\(null\); setMobileView\('list'\) \}\}/)
})

test('unread behavior is the shared query and existing read-state rules', () => {
  assert.match(dock, /useStaffUnreadCount\(\{ intervalMs: IDLE_UNREAD_POLL_MS, enabled: canUseMessages \}\)/)
  assert.match(dock, /\['owner', 'admin'\]\.includes\(userProfile\?\.role\) && userProfile\?\.is_active !== false/)
  // The dock itself never marks anything read - only ThreadPanel's existing
  // newest-page rule does that.
  assert.doesNotMatch(dock, /mark|read_at|markRead/i)
})

// ── Keith mutual exclusion and the one dock ──────────────────────────────────

test('opening either tool closes the other through the shared registry', () => {
  assert.match(dock, /onFloatingPanelOpen\(\(source\) => \{\n {4}if \(source !== 'main-messages'\) setOpen\(false\)\n {4}if \(source === 'keith'\) setKeithOpen\(true\)\n {2}\}\)/)
  assert.match(keith, /if \(source !== 'keith'\) setIsOpen\(false\);/)
  assert.match(keith, /announceFloatingPanelOpen\('keith'\)/)
  // The registry gained the symmetric closed edge, and Keith announces it.
  assert.match(panels, /export function announceFloatingPanelClosed\(source\)/)
  assert.match(panels, /export function onFloatingPanelClosed\(fn\)/)
  assert.match(keith, /announceFloatingPanelClosed\('keith'\)/)
})

test('the launcher relocates while Keith is open and hides while its own panel is open', () => {
  assert.match(dock, /const launcherPos = keithOpen\n {4}\? \{ bottom: 'calc\(24px \+ env\(safe-area-inset-bottom, 0px\)\)', right: '96px' \}\n {4}: \{ bottom: 'calc\(96px \+ env\(safe-area-inset-bottom, 0px\)\)', right: '28px' \}/)
  assert.match(dock, /\{!open && \(\n {8}<button/)
  // The tooltip never renders in the relocated (Keith-open) state either.
  assert.match(dock, /\{hover && !open && !keithOpen && \(/)
})

test('Escape closes the active panel and focus returns to the right launcher', () => {
  // Focus is DEFERRED: the launcher is hidden while the panel is open, so it
  // must remount on close before it can receive focus.
  assert.match(dock, /if \(e\.key === 'Escape'\) \{\n {8}setOpen\(false\)\n {8}announceFloatingPanelClosed\('main-messages'\)/)
  assert.match(dock, /setTimeout\(\(\) => launcherRef\.current\?\.focus\(\), 0\)/)
  assert.match(dock, /aria-label="Close messages"/)
  assert.match(dock, /const closePanel = \(restoreFocus = true\) => \{/)
  // Keith gained the same Escape behavior.
  assert.match(keith, /if \(e\.key === 'Escape'\) setIsOpen\(false\);/)
})

// ── Geometry: no overlap at desktop or narrow widths ─────────────────────────

test('panel geometry mirrors the corner-drawer convention and clears Keith\'s orb', () => {
  assert.match(dock, /bottom: 'calc\(96px \+ env\(safe-area-inset-bottom, 0px\)\)', right: 24,/)
  assert.match(dock, /width: 'min\(420px, calc\(100vw - 32px\)\)'/)
  assert.match(dock, /height: 'min\(720px, calc\(100vh - 160px\)\)'/)
  assert.match(dock, /role="dialog"/)
  assert.match(dock, /aria-label="Messages"/)
})

test('the Connect workspace and the portals are untouched', () => {
  // Connect still mounts the full workspace without docked props.
  assert.match(read('src/pages/Connect.jsx'), /<MessagesWorkspace refreshKey=\{refreshKey\} onOpenStudent=\{onNavigateToStudent\} \/>/)
  // The portal docked panel keeps its own launcher and thread host.
  assert.match(read('src/portal/PortalUtilityLayer.jsx'), /aria-label="Open messages with the ASPIRE Team"/)
  // The shared auto-scroll contract stays pinned in both thread hosts.
  assert.match(workspace, /useThreadAutoScroll\(\{/)
  assert.match(read('src/portal/messages/PortalMessagesThread.jsx'), /useThreadAutoScroll\(\{/)
})
