// MESSAGES-ARCHIVE-P1: client-half regression guards for the Active | Archived
// picker and the per-row archive/unarchive kebab, on both the staff Connect
// Messages inbox and the Student/Unit Leader/Academic Partner Portal inbox.
// Static-source and pure-function assertions, matching the repository's
// node:test stack (no testing-library, no jsdom). No real API call, RPC,
// conversation, or student content.
//
// Companion server-half guards: test/messagesArchiveServer.test.mjs
// Companion contract: api/messages-staff-manage.js { action: 'archive', ... },
//                      api/portal/messages-archive.js.
//
// Run: node --test test/messagesArchiveUi.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { DEFAULT_VIEW, serializeInboxQuery, queryIdentity } from '../src/lib/messages/inboxState.js'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

const staffInbox = read('src/components/connect/messages/MessagesInbox.jsx')
const staffWorkspace = read('src/components/connect/messages/MessagesWorkspace.jsx')
const staffClient = read('src/lib/messages/messagesApiClient.js')
const portalInbox = read('src/portal/messages/PortalMessagesInbox.jsx')
const portalWorkspace = read('src/portal/messages/PortalMessagesWorkspace.jsx')
const portalClient = read('src/lib/messages/portalMessagesApiClient.js')
const inboxStateSrc = read('src/lib/messages/inboxState.js')

const allChanged = {
  staffInbox, staffWorkspace, staffClient, portalInbox, portalWorkspace, portalClient, inboxStateSrc,
}
// Files that still carry the per-person archive (the portal side and the client).
const archiveFiles = { staffClient, portalInbox, portalWorkspace, portalClient }

// MESSAGES-SIMPLIFY-1 (20261014000000): the staff inbox no longer archives per
// person. Done is shared (status resolved) and threads archived before that
// build stay under View done. These replace the staff Active/Archived tests.
test('inboxState: the view picks Needs reply, All or Done', async (t) => {
  await t.test('DEFAULT_VIEW is needs_reply', () => {
    assert.equal(DEFAULT_VIEW, 'needs_reply')
    assert.match(inboxStateSrc, /export const DEFAULT_VIEW = 'needs_reply'/)
  })

  await t.test('serializeInboxQuery always sends the view', () => {
    assert.equal(serializeInboxQuery({ limit: 25 }).query.view, 'needs_reply')
    assert.equal(serializeInboxQuery({ view: 'done', limit: 25 }).query.view, 'done')
  })

  await t.test('queryIdentity changes when view changes, so pagination resets', () => {
    const base = { search: '' }
    assert.equal(queryIdentity(base), queryIdentity({ ...base, view: 'needs_reply' }))
    assert.notEqual(queryIdentity(base), queryIdentity({ ...base, view: 'done' }))
  })
})

test('staff: Done replaces per-person archive', async (t) => {
  await t.test('View done toggles the Done view and back', () => {
    assert.match(staffInbox, /const \[view, setView\] = useState\(DEFAULT_VIEW\)/)
    assert.match(staffInbox, /setView\(\(current\) => \(current === 'done' \? lastOpenView : 'done'\)\)/)
  })

  await t.test('the staff inbox has no archive control', () => {
    assert.doesNotMatch(strip(staffInbox), /RowActionsMenu|setConversationArchived|Archive conversation/)
  })
})

test('portal: Active | Archived picker', async (t) => {
  await t.test('the picker lives in the workspace header, binary, default active, hidden until archiveAvailable', () => {
    assert.match(portalWorkspace, /const \[view, setView\] = useState\('active'\)/)
    assert.match(portalWorkspace, /const \[archiveAvailable, setArchiveAvailable\] = useState\(false\)/)
    assert.match(portalWorkspace, /\{showHead && archiveAvailable && \(/)
    assert.match(portalWorkspace, /aria-pressed=\{view === 'active'\}/)
    assert.match(portalWorkspace, /aria-pressed=\{view === 'archived'\}/)
    assert.doesNotMatch(strip(portalWorkspace), /setView\('all'\)/)
  })

  await t.test('the picker is hidden in the phone thread view, same gate as the rest of the header', () => {
    // showHead already collapses to false on the phone thread view; the picker
    // block is gated on the SAME showHead flag, not a separate one.
    assert.match(portalWorkspace, /const showHead = !narrow \|\| mobileView === 'list'/)
    const pickerBlock = portalWorkspace.slice(
      portalWorkspace.indexOf('{showHead && archiveAvailable && ('),
      portalWorkspace.indexOf('{showHead && archiveAvailable && (') + 400,
    )
    assert.match(pickerBlock, /showHead && archiveAvailable/)
  })

  await t.test('archiveAvailable is reported UP from the inbox, which owns the list query', () => {
    assert.match(portalInbox, /const archiveAvailable = \(data\?\.pages \|\| \[\]\)\.some\(\(p\) => p\?\.archive_available === true\)/)
    assert.match(portalInbox, /onArchiveAvailable\(archiveAvailable\)/)
    assert.match(portalWorkspace, /onArchiveAvailable=\{setArchiveAvailable\}/)
  })

  await t.test('the inbox requests the archived scope only when the workspace picker selects it', () => {
    assert.match(portalInbox, /view: view === 'archived' \? 'archived' : undefined/)
    // The default (active) request is byte-identical to before Phase 1, so the
    // Home preview hook and the docked ASPIRE Team panel sharing this query key
    // are unaffected.
    assert.match(portalInbox, /const queryKey = view === 'archived' \? \['portal_messages_list', 'archived'\] : \['portal_messages_list'\]/)
  })
})

test('portal: kebab restructure and menu', async (t) => {
  await t.test('the portal inbox imports the shared RowActionsMenu, not a fork', () => {
    assert.match(portalInbox, /import RowActionsMenu from '\.\.\/\.\.\/components\/shared\/RowActionsMenu'/)
  })

  await t.test('the row button keeps its pinned shape: key, type, role="listitem", first in the wrapper', () => {
    assert.match(portalInbox, /<button\s*\n\s*key=\{c\.id\}\s*\n\s*type="button"\s*\n\s*role="listitem"/)
  })

  await t.test('a flex wrapper holds the row button plus the kebab as a sibling, no nested buttons', () => {
    assert.match(portalInbox, /<div key=\{c\.id\} style=\{\{ display: 'flex', alignItems: 'stretch', gap: 6 \}\}>/)
    assert.match(portalInbox, /style=\{\{ flex: 1, minWidth: 0 \}\}/)
  })

  await t.test('the kebab wrapper stops click and keydown propagation', () => {
    const kebabBlock = portalInbox.slice(portalInbox.indexOf('{archiveAvailable && ('))
    assert.match(kebabBlock, /onClick=\{\(e\) => e\.stopPropagation\(\)\}/)
    assert.match(kebabBlock, /onKeyDown=\{\(e\) => e\.stopPropagation\(\)\}/)
  })

  await t.test('menu items read Archive/Unarchive per row.is_archived, with an accessible label naming the subject', () => {
    assert.match(portalInbox, /label=\{`Actions for conversation \$\{c\.subject\}`\}/)
    assert.match(portalInbox, /c\.is_archived \? 'Unarchive conversation' : 'Archive conversation'/)
    assert.match(portalInbox, /c\.is_archived \? 'Unarchiving' : 'Archiving'/)
  })

  await t.test('role="list" and role="listitem" semantics are preserved', () => {
    assert.match(portalInbox, /role="list" aria-label="Your conversations"/)
    assert.match(portalInbox, /role="listitem"/)
  })
})

test('client API modules expose the new functions against the right contract', async (t) => {
  await t.test('staff: setConversationArchived posts action archive to the existing manage endpoint', () => {
    assert.match(staffClient, /export function setConversationArchived\(conversationId, archived, \{ signal \} = \{\}\) \{/)
    const fn = staffClient.slice(staffClient.indexOf('export function setConversationArchived'))
    assert.match(fn, /manageStaffConversation\(\{/)
    assert.match(fn, /action: 'archive', conversation_id: conversationId, archived: !!archived,/)
    // No new endpoint path: it reuses /api/messages-staff-manage.
    assert.doesNotMatch(strip(staffClient), /\/api\/messages-staff-archive/)
  })

  await t.test('portal: portalSetConversationArchived posts to the dedicated archive endpoint', () => {
    assert.match(portalClient, /export function portalSetConversationArchived\(\{ conversationId, archived, signal \} = \{\}\) \{/)
    const fn = portalClient.slice(portalClient.indexOf('export function portalSetConversationArchived'))
    assert.match(fn, /'\/api\/portal\/messages-archive'/)
    assert.match(fn, /body: \{ conversation_id: conversationId, archived: !!archived \}/)
  })

  await t.test('portal: listPortalConversations passes view through and never breaks the default request shape', () => {
    assert.match(portalClient, /export function listPortalConversations\(\{ limit, cursor, view, signal \} = \{\}\) \{/)
    const fn = portalClient.slice(
      portalClient.indexOf('export function listPortalConversations'),
      portalClient.indexOf('export function getPortalThreadPage'),
    )
    assert.match(fn, /view,/)
  })

  await t.test('no new endpoint besides the one the server contract defines', () => {
    const paths = [...strip(portalClient).matchAll(/'(\/api\/[^']+)'/g)].map((m) => m[1])
    assert.ok(paths.includes('/api/portal/messages-archive'))
    assert.ok(paths.includes('/api/portal/messages-list'))
  })

  await t.test('neither new function sends a forbidden routing field', () => {
    // Scoped to the two NEW functions only: messagesApiClient.js legitimately
    // names these fields elsewhere, in its own FORBIDDEN_WRITE_FIELDS guard.
    const staffFn = staffClient.slice(staffClient.indexOf('export function setConversationArchived'))
    const portalFn = portalClient.slice(portalClient.indexOf('export function portalSetConversationArchived'))
    for (const f of ['recipient_email', 'recipient_kind', 'event_type', 'idempotency_key']) {
      assert.doesNotMatch(staffFn, new RegExp(f))
      assert.doesNotMatch(portalFn, new RegExp(f))
    }
  })
})

test('selection handling when the OPEN thread is archived/unarchived out of view', async (t) => {
  await t.test('portal: the workspace navigates back to the list rather than guessing a next thread', () => {
    assert.match(portalWorkspace, /const handleSelectedArchived = useCallback\(\(\) => \{/)
    const fn = portalWorkspace.slice(portalWorkspace.indexOf('const handleSelectedArchived'), portalWorkspace.indexOf('const handleSent'))
    assert.match(fn, /onBackToList\?\.\(\)/)
    assert.match(portalInbox, /if \(selectedId === row\.id\) onSelectedArchived\(\)/)
  })
})

test('mobile: archiving from the list never flips the view, and no gesture code was added', async (t) => {
  await t.test('no touch or swipe handler exists in any changed file', () => {
    for (const [name, src] of Object.entries(allChanged)) {
      assert.doesNotMatch(src, /onTouchStart|onTouchMove|onTouchEnd|touchstart|touchmove|touchend|Swipe|swipe/i, `${name} must not add gesture code`)
    }
  })
})

test('unread and list refetch are wired after a successful archive on both sides', async (t) => {
  await t.test('portal: the inbox invalidates list and unread, and also runs the workspace refresh path', () => {
    const fn = portalInbox.slice(portalInbox.indexOf('const handleArchiveToggle'), portalInbox.indexOf('const handleArchiveToggle') + 900)
    assert.match(fn, /qc\.invalidateQueries\(\{ queryKey: \['portal_messages_list'\] \}\)/)
    assert.match(fn, /qc\.invalidateQueries\(\{ queryKey: \['portal_messages_unread'\] \}\)/)
    assert.match(fn, /onArchiveChanged\(\)/)
    assert.match(portalWorkspace, /onArchiveChanged=\{refreshInbox\}/)
  })
})

test('announcements use the existing live region on both sides', async (t) => {
  await t.test('portal: announce is threaded the same way', () => {
    assert.match(portalInbox, /announce = \(\) => \{\}/)
    assert.match(portalWorkspace, /announce=\{announce\}/)
    assert.match(portalInbox, /announce\(nextArchived \? 'Conversation archived' : 'Conversation unarchived'\)/)
  })

  await t.test('a portal archive failure is announced too, mapped through the safe error mapper', () => {
    const portalCatch = portalInbox.slice(portalInbox.indexOf('} catch (err) {', portalInbox.indexOf('const handleArchiveToggle')))
    assert.match(portalCatch, /mapPortalMessagesError\(err\?\.status\) \|\| mapMessagesError\(err\?\.status\)/)
  })
})

test('hygiene', async (t) => {
  await t.test('no em dash was introduced', () => {
    for (const [name, src] of Object.entries(allChanged)) {
      assert.doesNotMatch(src, /—/, `${name} must not use an em dash`)
    }
  })

  await t.test('every file that still archives carries the MESSAGES-ARCHIVE-P1 comment tag', () => {
    for (const [name, src] of Object.entries(archiveFiles)) {
      assert.match(src, /MESSAGES-ARCHIVE-P1/, `${name} is missing the comment tag`)
    }
  })

  await t.test('ASPIRE, never the deprecated long form', () => {
    for (const [name, src] of Object.entries(allChanged)) {
      assert.doesNotMatch(src, /ASPIRE Program/, `${name} must not use the deprecated long form`)
    }
  })
})
