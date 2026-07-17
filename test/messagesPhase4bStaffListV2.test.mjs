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

test('staff-list API uses the applied v2 RPC', async (t) => {
  await t.test('calls messages_staff_list_conversations_v2, not the Phase 3 function', () => {
    assert.match(api, /db\.rpc\('messages_staff_list_conversations_v2'/)
    assert.doesNotMatch(apiCode, /db\.rpc\('messages_staff_list_conversations'/)
  })

  await t.test('passes the explicit mode parameters', () => {
    for (const p of ['p_assignee_mode', 'p_assignee_profile_id', 'p_category_mode',
      'p_category', 'p_status', 'p_flagged', 'p_search', 'p_limit', 'p_cursor_ts', 'p_cursor_id']) {
      assert.ok(api.includes(p), `missing RPC parameter ${p}`)
    }
    // The old ambiguous single assignee parameter is gone.
    assert.doesNotMatch(apiCode, /p_assignee:/)
  })

  await t.test('still requires an active Owner or Admin and never uses is_staff', () => {
    assert.match(api, /verifyStaffCaller\(req\)/)
    assert.doesNotMatch(apiCode, /is_staff/)
  })
})

test('assignee filter modes', async (t) => {
  await t.test('all maps to any', () => {
    assert.match(api, /let assigneeMode = 'any'/)
    assert.match(api, /req\.query\?\.assignee && req\.query\.assignee !== 'all'/)
  })

  await t.test('unassigned maps to the unassigned mode', () => {
    assert.match(api, /req\.query\.assignee === 'unassigned'\) \{\s*\n\s*assigneeMode = 'unassigned'/)
  })

  await t.test('me maps to specific plus the SERVER-VERIFIED caller profile', () => {
    assert.match(api, /req\.query\.assignee === 'me'\) \{\s*\n\s*assigneeMode = 'specific';\s*\n\s*assigneeProfileId = caller\.profile\.id/)
    // A client-supplied id must never resolve Me.
    assert.doesNotMatch(apiCode, /assigneeProfileId = req\.query\.assignee;\s*\n\s*\}\s*else if.*'me'/s)
  })

  await t.test('a selected assignee maps to specific with a validated uuid', () => {
    assert.match(api, /if \(!isUuid\(req\.query\.assignee\)\) return res\.status\(422\)\.json\(\{ error: 'invalid_assignee' \}\)/)
    assert.match(api, /assigneeMode = 'specific';\s*\n\s*assigneeProfileId = req\.query\.assignee/)
  })
})

test('category filter modes', async (t) => {
  await t.test('all maps to any', () => {
    assert.match(api, /let categoryMode = 'any'/)
    assert.match(api, /req\.query\?\.category && req\.query\.category !== 'all'/)
  })

  await t.test('uncategorized maps to the uncategorized mode', () => {
    assert.match(api, /req\.query\.category === 'uncategorized'\) \{\s*\n\s*categoryMode = 'uncategorized'/)
  })

  await t.test('an approved category maps to specific and is validated', () => {
    assert.match(api, /const v = validateCategory\(req\.query\.category\)/)
    assert.match(api, /if \(!v\.ok\) return res\.status\(422\)\.json\(\{ error: v\.error \}\)/)
    assert.match(api, /categoryMode = 'specific';\s*\n\s*category = v\.value/)
  })
})

test('validation, errors, and pagination', async (t) => {
  await t.test('malformed filters are rejected with 422', () => {
    assert.match(api, /invalid_assignee/)
    assert.match(api, /invalid_flagged/)
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

  await t.test('the response contract is unchanged for existing callers', () => {
    assert.match(api, /conversations,\s*\n\s*next_cursor:/)
    assert.match(api, /data\?\.conversations \|\| \[\]/)
  })
})

test('the browser never reaches the RPC directly', async (t) => {
  await t.test('the client calls the authenticated endpoint only', () => {
    assert.match(client, /'\/api\/messages-staff-list'/)
    assert.doesNotMatch(strip(client), /\.rpc\(/)
    assert.doesNotMatch(strip(client), /messages_staff_list_conversations/)
  })

  await t.test('the inbox sends sentinels, not a resolved profile id, for Me', () => {
    assert.match(inboxState, /if \(filters\.assignee !== 'all'\) query\.assignee = filters\.assignee/)
    assert.match(inboxState, /if \(filters\.category !== 'all'\) query\.category = filters\.category/)
    // No client-only filtering remains: both are real server filters now.
    assert.doesNotMatch(strip(inboxState), /clientOnly/)
  })

  await t.test('the inbox offers Unassigned and Uncategorized now that v2 supports them', () => {
    assert.match(inbox, /\{ value: 'unassigned', label: 'Unassigned' \}/)
    assert.match(inbox, /\{ value: 'uncategorized', label: 'Uncategorized' \}/)
    assert.match(inbox, /\{ value: 'me', label: 'Me' \}/)
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
    assert.match(papp, /<PortalMessagesWorkspace active=\{studentView === 'messages'\} \/>/,
      'Messages is mounted only in the active student branch')
    assert.doesNotMatch(read('../src/portal/PortalShell.jsx'), /PortalMessagesWorkspace|PortalNav/)
    assert.doesNotMatch(read('../src/portal/StudentPortal.jsx'), /PortalMessagesWorkspace|PortalNav/)
    assert.doesNotMatch(read('../src/App.jsx'), /PortalMessagesWorkspace/)
  })
})
