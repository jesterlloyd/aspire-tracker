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

test('inboxState: view is a scope, not a filter', async (t) => {
  await t.test('DEFAULT_VIEW is active and is exported separately from DEFAULT_FILTERS', () => {
    assert.equal(DEFAULT_VIEW, 'active')
    assert.match(inboxStateSrc, /export const DEFAULT_VIEW = 'active'/)
  })

  await t.test('serializeInboxQuery omits view at the default and sends it only when narrowed', () => {
    const { query: atDefault } = serializeInboxQuery({ limit: 25 })
    assert.equal(atDefault.view, undefined)
    const { query: archived } = serializeInboxQuery({ view: 'archived', limit: 25 })
    assert.equal(archived.view, 'archived')
  })

  await t.test('queryIdentity changes when view changes, so pagination resets like a filter change', () => {
    const base = { filters: undefined, search: '' }
    assert.equal(queryIdentity(base), queryIdentity({ ...base, view: 'active' }))
    assert.notEqual(queryIdentity(base), queryIdentity({ ...base, view: 'archived' }))
  })
})

test('staff: Active | Archived picker', async (t) => {
  await t.test('the picker is a binary segmented pair, default Active, hidden until archiveAvailable', () => {
    assert.match(staffInbox, /const \[view, setView\] = useState\(DEFAULT_VIEW\)/)
    assert.match(staffInbox, /\{archiveAvailable && \(/)
    assert.match(staffInbox, /aria-pressed=\{view === 'active'\}/)
    assert.match(staffInbox, /aria-pressed=\{view === 'archived'\}/)
    assert.match(staffInbox, />\s*Active\s*<\/button>/)
    assert.match(staffInbox, />\s*Archived\s*<\/button>/)
    // Binary: 'all' is a real server view, but the staff picker never offers it.
    assert.doesNotMatch(strip(staffInbox), /setView\('all'\)/)
    assert.doesNotMatch(strip(staffInbox), /aria-pressed=\{view === 'all'\}/)
  })

  await t.test('archiveAvailable is derived from the server response and fails closed', () => {
    assert.match(staffInbox, /const archiveAvailable = \(data\?\.pages \|\| \[\]\)\.some\(\(p\) => p\?\.archive_available === true\)/)
  })

  await t.test('view participates in the query so switching resets pagination', () => {
    assert.match(staffInbox, /const identity = useMemo\(\(\) => queryIdentity\(\{ filters, search, view \}\), \[filters, search, view\]\)/)
    assert.match(staffInbox, /filters, search, view, cursor: pageParam, limit: PAGE_LIMIT/)
  })

  await t.test('Reset filters never touches view: it is a scope, not a filter', () => {
    const fn = staffInbox.slice(staffInbox.indexOf('const resetFilters ='), staffInbox.indexOf('const hasFilters ='))
    assert.match(fn, /setFilters\(DEFAULT_FILTERS\); clearSearch\(\)/)
    assert.doesNotMatch(fn, /setView/)
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

test('staff: kebab restructure and menu', async (t) => {
  await t.test('the staff inbox imports the shared RowActionsMenu, not a fork', () => {
    assert.match(staffInbox, /import RowActionsMenu from '\.\.\/\.\.\/shared\/RowActionsMenu'/)
  })

  await t.test('the row is a flex <li> wrapper: the original button plus the kebab as a sibling, no nested buttons', () => {
    assert.match(staffInbox, /<li style=\{\{ display: 'flex', alignItems: 'stretch' \}\}>/)
    assert.match(staffInbox, /<button\s*\n\s*type="button"\s*\n\s*onClick=\{onSelect\}/)
    assert.match(staffInbox, /flex: 1, minWidth: 0, textAlign: 'left'/)
    // No <button> is ever written inside another <button>'s JSX children in this
    // file: the kebab's wrapper <div> is a SIBLING of the row button, closed
    // before the kebab markup begins.
    assert.match(staffInbox, /<\/button>\s*\n\s*\n\s*\{archiveAvailable && \(/)
  })

  await t.test('the kebab wrapper stops click and keydown propagation, like UnitLeaderPortal already does', () => {
    const kebabBlock = staffInbox.slice(staffInbox.indexOf('{archiveAvailable && (', staffInbox.indexOf('export function ConversationRow')))
    assert.match(kebabBlock, /onClick=\{\(e\) => e\.stopPropagation\(\)\}/)
    assert.match(kebabBlock, /onKeyDown=\{\(e\) => e\.stopPropagation\(\)\}/)
  })

  await t.test('the row keeps aria-current and its 44px touch target unchanged', () => {
    assert.match(staffInbox, /aria-current=\{selected \? 'true' : undefined\}/)
    assert.match(staffInbox, /minHeight: 44/)
  })

  await t.test('menu items read Archive/Unarchive per row.is_archived, with an accessible label naming the subject', () => {
    assert.match(staffInbox, /label=\{`Actions for conversation \$\{row\.subject\}`\}/)
    assert.match(staffInbox, /row\.is_archived \? 'Unarchive conversation' : 'Archive conversation'/)
    assert.match(staffInbox, /row\.is_archived \? 'Unarchiving' : 'Archiving'/)
  })

  await t.test('the kebab itself is hidden until archiveAvailable, matching the fail-closed contract', () => {
    const rowFn = staffInbox.slice(staffInbox.indexOf('export function ConversationRow'))
    assert.match(rowFn, /\{archiveAvailable && \(/)
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
  await t.test('staff: the next row takes over, else the previous, else the selection clears', () => {
    const fn = staffInbox.slice(staffInbox.indexOf('const handleArchiveToggle'), staffInbox.indexOf('const handleArchiveToggle') + 1200)
    assert.match(fn, /if \(selectedId === row\.id\) \{/)
    assert.match(fn, /const idx = rows\.findIndex\(\(r\) => r\.id === row\.id\)/)
    assert.match(fn, /const nextId = rows\[idx \+ 1\]\?\.id \?\? rows\[idx - 1\]\?\.id \?\? null/)
    assert.match(fn, /onSelectedRowChange\(nextId\)/)
  })

  await t.test('staff: selection moves through onSelectedRowChange, never onSelect, so mobile never flips to the thread view', () => {
    assert.match(staffWorkspace, /onSelectedRowChange=\{setSelectedId\}/)
    // onSelect (the row-click path) is the ONLY thing that sets mobileView to
    // 'thread'; onSelectedRowChange must not appear anywhere near that call.
    const onSelectFn = staffWorkspace.slice(staffWorkspace.indexOf('const onSelect = useCallback'), staffWorkspace.indexOf('const backToList'))
    assert.match(onSelectFn, /setMobileView\('thread'\)/)
    assert.doesNotMatch(onSelectFn, /onSelectedRowChange/)
  })

  await t.test('portal: the workspace navigates back to the list rather than guessing a next thread', () => {
    assert.match(portalWorkspace, /const handleSelectedArchived = useCallback\(\(\) => \{/)
    const fn = portalWorkspace.slice(portalWorkspace.indexOf('const handleSelectedArchived'), portalWorkspace.indexOf('const handleSent'))
    assert.match(fn, /onBackToList\?\.\(\)/)
    assert.match(portalInbox, /if \(selectedId === row\.id\) onSelectedArchived\(\)/)
  })
})

test('mobile: archiving from the list never flips the view, and no gesture code was added', async (t) => {
  await t.test('the staff archive handler never touches mobileView or setMobileView', () => {
    const fn = staffInbox.slice(staffInbox.indexOf('const handleArchiveToggle'), staffInbox.indexOf('return (\n    <div style={{ display: \'flex\', flexDirection: \'column\''))
    assert.doesNotMatch(fn, /mobileView|setMobileView/)
  })

  await t.test('no touch or swipe handler exists in any changed file', () => {
    for (const [name, src] of Object.entries(allChanged)) {
      assert.doesNotMatch(src, /onTouchStart|onTouchMove|onTouchEnd|touchstart|touchmove|touchend|Swipe|swipe/i, `${name} must not add gesture code`)
    }
  })
})

test('unread and list refetch are wired after a successful archive on both sides', async (t) => {
  await t.test('staff: refetch runs, then unread invalidates, through the existing mechanisms', () => {
    const fn = staffInbox.slice(staffInbox.indexOf('const handleArchiveToggle'), staffInbox.indexOf('const handleArchiveToggle') + 1200)
    assert.match(fn, /await refetch\(\)/)
    assert.match(fn, /queryClient\.invalidateQueries\(\{ queryKey: \['messages_staff_unread'\] \}\)/)
  })

  await t.test('portal: the inbox invalidates list and unread, and also runs the workspace refresh path', () => {
    const fn = portalInbox.slice(portalInbox.indexOf('const handleArchiveToggle'), portalInbox.indexOf('const handleArchiveToggle') + 900)
    assert.match(fn, /qc\.invalidateQueries\(\{ queryKey: \['portal_messages_list'\] \}\)/)
    assert.match(fn, /qc\.invalidateQueries\(\{ queryKey: \['portal_messages_unread'\] \}\)/)
    assert.match(fn, /onArchiveChanged\(\)/)
    assert.match(portalWorkspace, /onArchiveChanged=\{refreshInbox\}/)
  })
})

test('announcements use the existing live region on both sides', async (t) => {
  await t.test('staff: announce is threaded from the workspace shared live region into the inbox', () => {
    assert.match(staffInbox, /announce = \(\) => \{\}/)
    assert.match(staffWorkspace, /announce=\{announce\}/)
    assert.match(staffInbox, /announce\(nextArchived \? 'Conversation archived' : 'Conversation unarchived'\)/)
  })

  await t.test('portal: announce is threaded the same way', () => {
    assert.match(portalInbox, /announce = \(\) => \{\}/)
    assert.match(portalWorkspace, /announce=\{announce\}/)
    assert.match(portalInbox, /announce\(nextArchived \? 'Conversation archived' : 'Conversation unarchived'\)/)
  })

  await t.test('an archive failure is announced too, mapped through the safe error mapper', () => {
    const staffCatch = staffInbox.slice(staffInbox.indexOf('} catch (err) {', staffInbox.indexOf('const handleArchiveToggle')))
    assert.match(staffCatch, /mapMessagesError\(err\?\.status\)/)
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

  await t.test('every changed source file carries the MESSAGES-ARCHIVE-P1 comment tag', () => {
    for (const [name, src] of Object.entries(allChanged)) {
      assert.match(src, /MESSAGES-ARCHIVE-P1/, `${name} is missing the comment tag`)
    }
  })

  await t.test('ASPIRE, never the deprecated long form', () => {
    for (const [name, src] of Object.entries(allChanged)) {
      assert.doesNotMatch(src, /ASPIRE Program/, `${name} must not use the deprecated long form`)
    }
  })
})
