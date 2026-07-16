// MESSAGES-PHASE4B2A-B: static and pure guards for the dormant staff Messages
// workspace, thread rendering, backward pagination, read state, and polling.
// Uses the repository's node:test static-source approach; no testing-library or
// jsdom is introduced. No real API call, conversation, mark-read, notification,
// or student content.
//
// Run: node --test test/messagesPhase4b2aWorkspace.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// messagesPolling is NOT imported: it transitively loads src/lib/supabase.js,
// which throws without env. Its constants are asserted from source instead, the
// same way this repo guards other UI modules. inboxState is pure, so it imports.
import { appendPage } from '../src/lib/messages/inboxState.js'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, p), 'utf8')
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

const threadApi = read('../api/messages-staff-thread.js')
const workspace = read('../src/components/connect/messages/MessagesWorkspace.jsx')
const polling = read('../src/lib/messages/messagesPolling.js')
const inbox = read('../src/components/connect/messages/MessagesInbox.jsx')
const client = read('../src/lib/messages/messagesApiClient.js')
const connect = read('../src/pages/Connect.jsx')
const app = read('../src/App.jsx')

test('staff thread API uses v2', async (t) => {
  await t.test('calls messages_staff_get_thread_v2, never the forward-paging v1', () => {
    assert.match(threadApi, /db\.rpc\('messages_staff_get_thread_v2'/)
    assert.doesNotMatch(strip(threadApi), /rpc\('messages_staff_get_thread'/)
  })

  await t.test('passes the conversation id, limit, and cursor through', () => {
    assert.match(threadApi, /p_conversation_id: conversationId/)
    assert.match(threadApi, /p_limit: limit\.value/)
    assert.match(threadApi, /p_cursor_ts: cursor\.value\.ts/)
    assert.match(threadApi, /p_cursor_id: cursor\.value\.id/)
  })

  await t.test('returns the v2 contract including has_more and the backward cursor', () => {
    assert.match(threadApi, /conversation: data\.conversation/)
    assert.match(threadApi, /messages: data\.messages \|\| \[\]/)
    assert.match(threadApi, /events: data\.events \|\| \[\]/)
    // The RPC's own backward cursor is passed through, not re-derived forward.
    assert.match(threadApi, /next_cursor: data\.next_cursor \?\? null/)
    assert.match(threadApi, /has_more: data\.has_more === true/)
    assert.doesNotMatch(strip(threadApi), /nextCursorFrom/)
  })

  await t.test('preserves authentication, method guard, and safe errors', () => {
    assert.match(threadApi, /verifyStaffCaller\(req\)/)
    assert.match(threadApi, /methodGuard\(req, res, \['GET'\]\)/)
    assert.match(threadApi, /if \(!data\) return notFound\(res\)/)
    assert.match(threadApi, /error\.code === 'MS403' \? 403 : error\.code === 'MS400' \? 422 : 500/)
    // No internal SQL or function name is ever returned.
    assert.doesNotMatch(threadApi, /error: error\.message/)
    assert.match(threadApi, /'internal_error'/)
  })
})

test('workspace composition and dormancy', async (t) => {
  await t.test('reuses the Phase 4A inbox; no parallel inbox exists', () => {
    assert.match(workspace, /import MessagesInbox from '\.\/MessagesInbox'/)
    assert.match(workspace, /<MessagesInbox\b/)
    // The workspace does not re-implement list fetching. It may reference the
    // inbox's query key to INVALIDATE it after mark-read, which is not a fetch.
    assert.doesNotMatch(strip(workspace), /listStaffConversations/)
    assert.doesNotMatch(strip(workspace), /queryKey: \['messages_staff_list', /)
  })

  await t.test('Connect.jsx and App.jsx are unchanged and Messages is unrouted', () => {
    assert.match(connect, /const VALID_TABS = new Set\(\['contacts', 'outreach', 'broadcasts'\]\)/)
    assert.doesNotMatch(connect, /messages/i)
    assert.doesNotMatch(connect, /MessagesWorkspace|MessagesInbox/)
    assert.doesNotMatch(app, /MessagesWorkspace|MessagesInbox/)
    assert.doesNotMatch(app, /\/connect\/messages/)
  })

  await t.test('no New message, reply composer, or management controls exist', () => {
    const code = strip(workspace)
    assert.doesNotMatch(code, /New message|startStaffConversation/)
    assert.doesNotMatch(code, /replyStaffConversation|composer|textarea/i)
    assert.doesNotMatch(code, /manageStaffConversation|set_assignment|set_status|set_category|set_follow_up/)
  })

  await t.test('no Student Portal Messages UI exists', () => {
    for (const f of ['../src/portal/PortalApp.jsx', '../src/portal/PortalShell.jsx', '../src/portal/StudentPortal.jsx']) {
      assert.doesNotMatch(read(f), /MessagesWorkspace|MessagesInbox|messagesApiClient/)
    }
  })
})

test('thread rendering and pagination', async (t) => {
  await t.test('the thread query key is scoped by conversation id', () => {
    assert.match(workspace, /queryKey: \['messages_staff_thread', conversationId\]/)
    assert.match(workspace, /enabled: !!conversationId/)
  })

  await t.test('stale responses cannot replace a newer selection', () => {
    // A per-conversation key plus the passed AbortSignal means React Query owns
    // request identity; no shared mutable thread state exists.
    assert.match(workspace, /queryFn: \(\{ pageParam, signal \}\)/)
    assert.match(workspace, /\{ signal \}\)/)
    assert.doesNotMatch(strip(workspace), /setMessages\(|setThread\(/)
  })

  await t.test('Load earlier pages backward using the v2 cursor', () => {
    assert.match(workspace, /getNextPageParam: \(lastPage\) => \(lastPage\?\.has_more \? lastPage\?\.next_cursor \?\? undefined : undefined\)/)
    assert.match(workspace, /cursor_ts: pageParam\?\.cursor_ts/)
    assert.match(workspace, /cursor_id: pageParam\?\.cursor_id/)
    assert.match(workspace, /Load earlier messages/)
    assert.match(workspace, /disabled=\{isFetchingNextPage\}/)
    assert.doesNotMatch(strip(workspace), /offset/i)
  })

  await t.test('pages merge oldest-to-newest without duplicates', () => {
    // Page 0 is the newest; later pages are older, so the page order reverses
    // before merging.
    assert.match(workspace, /\[\.\.\.pages\]\.reverse\(\)\.reduce\(\(acc, p\) => appendPage\(acc, p\?\.messages \|\| \[\]\), \[\]\)/)
    // appendPage drops repeats and preserves order.
    const merged = appendPage([{ id: 'older' }], [{ id: 'older' }, { id: 'newer' }])
    assert.deepEqual(merged.map((m) => m.id), ['older', 'newer'])
  })

  await t.test('existing messages stay visible while an older page loads', () => {
    // Only the initial load renders the loading state; isFetchingNextPage only
    // disables the button.
    assert.match(workspace, /if \(isLoading\) \{/)
    assert.match(workspace, /\{isFetchingNextPage \? 'Loading' : 'Load earlier messages'\}/)
  })

  await t.test('messages render as safe plain text with preserved line breaks', () => {
    assert.match(workspace, /whiteSpace: 'pre-wrap'/)
    assert.match(workspace, /overflowWrap: 'anywhere'/)
    const code = strip(workspace)
    assert.doesNotMatch(code, /dangerouslySetInnerHTML/)
    assert.doesNotMatch(code, /innerHTML/)
    assert.doesNotMatch(code, /\bmarked\b|markdown|DOMPurify/i)
  })

  await t.test('author, role, access, and timestamps are shown accessibly', () => {
    assert.match(workspace, /m\.author_name \|\| \(isStaff \? 'ASPIRE Team' : 'Portal participant'\)/)
    assert.match(workspace, /\{isStaff \? 'ASPIRE Team' : 'Participant'\}/)
    assert.match(workspace, /participantAccessLabel\(accessActive\)/)
    assert.match(workspace, /dateTime=\{m\.created_at\}/)
    assert.match(workspace, /title=\{formatFullTimestamp\(m\.created_at\)\}/)
    assert.match(workspace, /<span style=\{srOnly\}>\{formatFullTimestamp\(m\.created_at\)\}<\/span>/)
  })

  await t.test('no email is ever rendered', () => {
    assert.doesNotMatch(strip(workspace), /\.email/)
  })

  await t.test('empty, error, retry, and no-selection states exist', () => {
    assert.match(workspace, /Select a conversation to review messages and respond\./)
    assert.match(workspace, /No messages are available in this conversation\./)
    assert.match(workspace, /role="status"[^>]*>\s*Loading conversation/)
    assert.match(workspace, /onClick=\{\(\) => refetch\(\)\}/)
    assert.match(workspace, /isError \? mapMessagesError\(error\?\.status\) : null/)
    // An inaccessible conversation clears the selection safely.
    assert.match(workspace, /if \(isError && error\?\.status === 404\) onGone\(\)/)
  })
})

test('read state', async (t) => {
  await t.test('mark-read runs only after the newest page loads successfully', () => {
    assert.match(workspace, /if \(isLoading \|\| isError \|\| !conversationId \|\| !newestAt\) return/)
    // The token keys on the NEWEST page's last message, so loading an older page
    // never re-triggers mark-read.
    assert.match(workspace, /const newestAt = pages\[0\]\?\.messages\?\.length/)
    assert.match(workspace, /const token = `\$\{conversationId\}:\$\{newestAt\}`/)
    assert.match(workspace, /if \(markedRef\.current === token\) return/)
  })

  await t.test('no client timestamp or profile id is sent', () => {
    assert.match(workspace, /api\.markStaffRead\(conversationId\)/)
    assert.match(client, /body: \{ conversation_id: conversationId \}/)
    assert.doesNotMatch(strip(client), /last_read_at|staff_profile_id/)
  })

  await t.test('unread clears only after mark-read succeeds', () => {
    assert.match(workspace, /\.then\(\(\) => \{[\s\S]*?invalidateQueries\(\{ queryKey: \['messages_staff_unread'\] \}\)/)
    assert.match(workspace, /invalidateQueries\(\{ queryKey: \['messages_staff_list'\] \}\)/)
  })

  await t.test('mark-read failure stays recoverable and non-fatal', () => {
    assert.match(workspace, /\.catch\(\(\) => \{[\s\S]*?markedRef\.current = null/)
  })

  await t.test('the inbox never marks read', () => {
    assert.doesNotMatch(strip(inbox), /markStaffRead|mark-read/)
  })
})

test('polling and visibility', async (t) => {
  await t.test('active cadence is 30 seconds and idle unread is 60 seconds', () => {
    assert.match(polling, /export const ACTIVE_POLL_MS = 30 \* 1000/)
    assert.match(polling, /export const IDLE_UNREAD_POLL_MS = 60 \* 1000/)
    assert.match(polling, /export const MOBILE_MAX_WIDTH = 900/)
  })

  await t.test('thread and unread poll at the active cadence', () => {
    assert.match(workspace, /refetchInterval: visible \? ACTIVE_POLL_MS : false/)
    assert.match(polling, /refetchInterval: visible \? intervalMs : false/)
    assert.match(workspace, /useStaffUnreadCount\(\{ intervalMs: ACTIVE_POLL_MS, api \}\)/)
  })

  await t.test('polling pauses while hidden and refreshes on focus', () => {
    assert.match(polling, /typeof document === 'undefined' \? true : !document\.hidden/)
    assert.match(polling, /document\.addEventListener\('visibilitychange', sync\)/)
    assert.match(polling, /window\.addEventListener\('focus', sync\)/)
    assert.match(polling, /refetchOnWindowFocus: true/)
  })

  await t.test('listeners are cleaned up on unmount and no setInterval is used', () => {
    assert.match(polling, /document\.removeEventListener\('visibilitychange', sync\)/)
    assert.match(polling, /window\.removeEventListener\('focus', sync\)/)
    assert.match(polling, /window\.removeEventListener\('resize', onResize\)/)
    assert.doesNotMatch(strip(polling), /setInterval/)
    assert.doesNotMatch(strip(workspace), /setInterval/)
  })

  await t.test('the idle unread hook is reusable but not mounted in Connect', () => {
    // Phase 4B2b mounts this with IDLE_UNREAD_POLL_MS for the tab badge.
    assert.match(polling, /export function useStaffUnreadCount/)
    assert.match(polling, /intervalMs = ACTIVE_POLL_MS/)
    assert.doesNotMatch(connect, /useStaffUnreadCount/)
  })

  await t.test('no Supabase Realtime is used', () => {
    assert.doesNotMatch(strip(workspace), /realtime|channel\(|subscribe\(/i)
    assert.doesNotMatch(strip(polling), /realtime/i)
  })
})

test('mobile state model', async (t) => {
  await t.test('list-first, thread on select, and Back to messages', () => {
    assert.match(workspace, /const \[mobileView, setMobileView\] = useState\('list'\)/)
    assert.match(workspace, /setMobileView\('thread'\)/)
    assert.match(workspace, /const backToList = useCallback\(\(\) => setMobileView\('list'\), \[\]\)/)
    assert.match(workspace, /Back to messages/)
  })

  await t.test('no compressed two-column layout at phone width', () => {
    assert.match(workspace, /flexDirection: narrow \? 'column' : 'row'/)
    assert.match(workspace, /const showList = !narrow \|\| mobileView === 'list'/)
    assert.match(workspace, /const showThread = !narrow \|\| mobileView === 'thread'/)
  })

  await t.test('the inbox stays mounted, so search and filters survive Back', () => {
    // Returning to the list re-shows the same mounted inbox rather than
    // remounting it, so its search, filters, and pages are preserved.
    assert.match(workspace, /\{showList && \(/)
  })

  await t.test('the Back control is keyboard accessible with a real name', () => {
    assert.match(workspace, /<button type="button" onClick=\{backToList\} style=\{backBtn\}>/)
    assert.match(workspace, /minHeight: 44/)
    assert.match(workspace, /<ArrowLeft size=\{14\} aria-hidden="true" \/> Back to messages/)
  })
})

test('privacy and safety', async (t) => {
  await t.test('nothing logs message content or persists it', () => {
    for (const [name, src] of Object.entries({ workspace, polling })) {
      assert.doesNotMatch(strip(src), /console\.(log|error|warn)/, `${name} must not log`)
      assert.doesNotMatch(strip(src), /localStorage|sessionStorage|indexedDB/i, `${name} must not persist`)
      assert.doesNotMatch(strip(src), /analytics|telemetry|gtag/i, `${name} must not add analytics`)
    }
  })

  await t.test('no direct browser RPC and no service-role credentials', () => {
    assert.doesNotMatch(strip(workspace), /\.rpc\(/)
    assert.doesNotMatch(strip(polling), /\.rpc\(/)
    assert.doesNotMatch(strip(workspace), /service_role|SERVICE_ROLE/)
  })
})

test('regression: migrations and badge files untouched', async (t) => {
  await t.test('all six migrations are present and unchanged in shape', () => {
    const m = (f) => read(`../supabase/migrations/${f}`)
    assert.match(m('20260716000000_messages_phase1_schema_foundation.sql'), /CREATE TABLE IF NOT EXISTS public\.conversations\b/)
    assert.match(m('20260716000001_messages_phase2_notification_delivery_foundation.sql'), /message_notification_deliveries/)
    assert.match(m('20260716000002_messages_phase3_api_foundation.sql'), /messages_staff_get_thread\(/)
    assert.match(m('20260716000003_messages_phase3_delivery_invariant_fix.sql'), /message_assert_valid_delivery/)
    assert.match(m('20260716000004_messages_phase4_staff_inbox_filter_modes.sql'), /messages_staff_list_conversations_v2/)
    assert.match(m('20260716000005_messages_phase4_staff_thread_reverse_pagination.sql'), /messages_staff_get_thread_v2/)
  })

  await t.test('Stage B added no SQL', () => {
    assert.doesNotMatch(strip(workspace), /CREATE OR REPLACE FUNCTION|ALTER TABLE/)
    assert.doesNotMatch(strip(threadApi), /CREATE OR REPLACE FUNCTION|ALTER TABLE/)
  })
})
