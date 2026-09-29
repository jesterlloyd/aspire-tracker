// MESSAGES-PHASE4B-B1: guards for the staff-list API's migration onto the
// applied v2 RPC with explicit filter modes. Static-source assertions, matching
// the repository test stack. No real API call, RPC, conversation, or email.
//
// Run: node --test test/messagesPhase4bStaffListV2.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, p), 'utf8')
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

const api = read('../api/messages-staff-list.js')
const apiCode = strip(api)
const client = read('../src/lib/messages/messagesApiClient.js')
const inboxState = read('../src/lib/messages/inboxState.js')
const inbox = read('../src/components/connect/messages/MessagesInbox.jsx')
const connect = read('../src/pages/Connect.jsx')
const app = read('../src/App.jsx')

// MESSAGES-SIMPLIFY-1 (20261014000000) replaced the status, assignee and
// category filter modes with three views. These tests pin that contract; the
// filter-mode assertions they replace described controls that no longer exist.
test('staff-list API: three views on the v5 RPC, v4 as the code-first fallback', async (t) => {
  await t.test('calls messages_staff_list_conversations_v5 first, then v4 when it is missing', () => {
    assert.match(api, /db\.rpc\('messages_staff_list_conversations_v5', \{ \.\.\.base, p_view: view \}\)/)
    assert.match(api, /db\.rpc\('messages_staff_list_conversations_v4'/)
    assert.doesNotMatch(apiCode, /db\.rpc\('messages_staff_list_conversations'/)
  })

  await t.test('accepts needs_reply, all and done, and reads active/archived as all/done', () => {
    assert.match(api, /const VIEWS = \['needs_reply', 'all', 'done'\]/)
    assert.match(api, /const LEGACY_VIEW_NAMES = \{ active: 'all', archived: 'done' \}/)
    assert.match(api, /invalid_view/)
  })

  await t.test('the fallback maps each view onto v4 without any narrowing filter', () => {
    assert.match(api, /p_assignee_mode: 'any'/)
    assert.match(api, /p_category_mode: 'any'/)
    assert.match(api, /p_view: view === 'done' \? 'archived' : 'active'/)
    assert.match(api, /p_attention: view === 'needs_reply' \? 'needs_reply' : 'all'/)
  })

  await t.test('still requires an active Owner or Admin and never uses is_staff', () => {
    assert.match(api, /verifyStaffCaller\(req\)/)
    assert.doesNotMatch(apiCode, /is_staff/)
  })

  await t.test('no request can set a status, assignee, category or follow-up filter', () => {
    for (const q of ['req.query?.assignee', 'req.query?.category', 'req.query?.status', 'req.query?.flagged', 'req.query?.attention']) {
      assert.ok(!apiCode.includes(q), `the list endpoint still reads ${q}`)
    }
  })
})

test('validation, errors, and pagination', async (t) => {
  await t.test('a malformed view, limit or cursor is rejected with 422', () => {
    assert.match(api, /invalid_view/)
    assert.match(api, /invalid_limit|limit\.error/)
    assert.match(api, /cursor\.error/)
  })

  await t.test('an RPC validation rejection maps to 422 and the staff gate to 403', () => {
    assert.match(api, /error\.code === 'MS403' \? 403 : error\.code === 'MS400' \? 422 : 500/)
    assert.match(api, /error\.code === 'MS403' \? 'forbidden' : error\.code === 'MS400' \? 'validation_failed' : 'internal_error'/)
    // Internal SQL text is never returned.
    assert.doesNotMatch(apiCode, /error: error\.message/)
  })

  await t.test('the cursor is forwarded unchanged and stays cursor based', () => {
    assert.match(api, /p_cursor_ts: cursor\.value\.ts/)
    assert.match(api, /p_cursor_id: cursor\.value\.id/)
    assert.match(api, /nextCursorFrom\(conversations, limit\.value, 'last_message_at'\)/)
    assert.doesNotMatch(apiCode, /offset/i)
  })

  await t.test('the response carries the rows, the cursor, the view and the three counts', () => {
    assert.match(api, /conversations,\s*\n\s*next_cursor:/)
    assert.match(api, /data\?\.conversations \|\| \[\]/)
    assert.match(api, /simplify_available: simplifyAvailable/)
    assert.match(api, /counts: \{ needs_reply: data\.counts\.needs_reply, all: data\.counts\.active, done: null \}/)
  })
})

test('the browser never reaches the RPC directly', async (t) => {
  await t.test('the client calls the authenticated endpoint only', () => {
    assert.match(client, /'\/api\/messages-staff-list'/)
    assert.doesNotMatch(strip(client), /\.rpc\(/)
    assert.doesNotMatch(strip(client), /messages_staff_list_conversations/)
  })

  await t.test('the inbox sends only a view, search and cursor', () => {
    assert.match(inboxState, /query\.view = INBOX_VIEWS\.includes\(view\) \? view : DEFAULT_VIEW/)
    assert.doesNotMatch(strip(inboxState), /query\.(assignee|category|status|flagged)/)
    assert.doesNotMatch(strip(inboxState), /clientOnly/)
  })

  await t.test('the inbox offers no assignee, category or status control', () => {
    assert.doesNotMatch(inbox, /'unassigned'|'uncategorized'|label: 'Me'/)
    assert.doesNotMatch(inbox, /<select/)
  })
})

test('regression: migrations, Connect, and dormancy', async (t) => {
  await t.test('all five applied migrations are unchanged', () => {
    const m = (f) => read(`../supabase/migrations/${f}`)
    assert.match(m('20260716000000_messages_phase1_schema_foundation.sql'), /CREATE TABLE IF NOT EXISTS public\.conversations\b/)
    assert.match(m('20260716000001_messages_phase2_notification_delivery_foundation.sql'), /message_notification_deliveries/)
    assert.match(m('20260716000002_messages_phase3_api_foundation.sql'), /messages_staff_list_conversations\(/)
    assert.match(m('20260716000003_messages_phase3_delivery_invariant_fix.sql'), /message_assert_valid_delivery/)
    assert.match(m('20260716000004_messages_phase4_staff_inbox_filter_modes.sql'), /messages_staff_list_conversations_v2/)
  })

  await t.test('Messages is gated in Connect; App.jsx is untouched', () => {
    assert.match(connect, /const VALID_TABS = new Set\(\['contacts', 'outreach', 'messages', 'broadcasts'\]\)/)
    assert.match(connect, /const canUseMessages = \['owner', 'admin'\]\.includes\(userProfile\?\.role\)/, 'Messages is activated in Phase 4B2b-ii and gated to an active Owner or Admin')
    assert.match(connect, /const canUseMessages = \['owner', 'admin'\]\.includes\(userProfile\?\.role\)/, 'Messages is activated in Phase 4B2b-ii and gated to an active Owner or Admin')
    assert.doesNotMatch(app, /MessagesInbox/)
    assert.doesNotMatch(app, /\/connect\/messages/)
  })

  await t.test('Student Portal Messages is activated and mounted only in the student branch', () => {
    // Phase 5B-ii ACTIVATED Student Portal Messages. These guards no longer assert
    // dormancy; they assert the boundary that replaced it. PortalApp is the sole
    // activation point, so PortalShell, StudentPortal, and App.jsx stay untouched.
    const papp = read('../src/portal/PortalApp.jsx')
    assert.match(papp, /<PortalMessagesWorkspace\s[\s\S]*?active=\{studentView === 'messages'\}/,
      'Messages is mounted only in the active student branch')
    assert.doesNotMatch(read('../src/portal/PortalShell.jsx'), /PortalMessagesWorkspace|PortalNav/)
    assert.doesNotMatch(read('../src/portal/StudentPortal.jsx'), /PortalMessagesWorkspace|PortalNav/)
    assert.doesNotMatch(read('../src/App.jsx'), /PortalMessagesWorkspace/)
  })
})
