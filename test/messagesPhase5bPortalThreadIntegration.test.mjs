// MESSAGES-PHASE5A-B: guards for the portal thread v2 API integration and the
// dormant portal pagination foundation. Pure-function tests plus static-source
// assertions, matching the repository stack. No real API call, conversation,
// notification, or student content.
//
// Run: node --test test/messagesPhase5bPortalThreadIntegration.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import {
  PORTAL_THREAD_LIMIT_DEFAULT, PORTAL_THREAD_LIMIT_MAX, clampThreadLimit,
  portalThreadQueryKey, serializePortalThreadQuery, nextThreadCursor,
  prependOlderPage, appendNewerPage, threadPageIsCurrent,
} from '../src/lib/messages/portalThreadState.js'
import { parseCursor, parseLimit } from '../lib/server/messages/validation.js'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, p), 'utf8')
const stripJs = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

const endpoint = read('../api/portal/messages-thread.js')
const code = stripJs(endpoint)
const client = read('../src/lib/messages/portalThreadState.js')
const staffThread = read('../api/messages-staff-thread.js')

const UUID_A = '11111111-1111-4111-8111-111111111111'
const UUID_B = '22222222-2222-4222-8222-222222222222'
const TS = '2026-07-16T10:00:00.000Z'

test('endpoint: v2 RPC integration', async (t) => {
  await t.test('calls the v2 RPC with the real signature (MESSAGES-LIFECYCLE-PHASE3A-REACTIONS: v3-first, v2 fallback)', () => {
    // Reactions added messages_portal_get_thread_v3 as the preferred RPC, with
    // v2 as the pre-migration fallback; both share the same rpcArgs signature.
    assert.match(code, /db\.rpc\('messages_portal_get_thread_v3', rpcArgs\)/)
    assert.match(code, /db\.rpc\('messages_portal_get_thread_v2', rpcArgs\)/)
    for (const p of ['p_conversation_id', 'p_limit', 'p_cursor_ts', 'p_cursor_id']) {
      assert.ok(code.includes(p), `missing RPC parameter ${p}`)
    }
  })

  await t.test('the old RPC is no longer called by the endpoint', () => {
    assert.doesNotMatch(code, /rpc\('messages_portal_get_thread'/)
  })

  await t.test('the old function remains in migrations for rollback', () => {
    const p3 = read('../supabase/migrations/20260716000002_messages_phase3_api_foundation.sql')
    assert.match(p3, /CREATE OR REPLACE FUNCTION public\.messages_portal_get_thread\(/)
    // Still forward-paging: it was left exactly as applied.
    assert.match(p3, /\(m\.created_at, m\.id\) > \(p_cursor_ts, p_cursor_id\)/)
  })

  await t.test('the staff thread endpoint and RPC are unchanged', () => {
    assert.match(staffThread, /messages_staff_get_thread_v2/)
    assert.match(read('../api/messages-staff-list.js'), /messages_staff_list_conversations_v2/)
  })

  await t.test('no parallel portal thread endpoint was created', () => {
    // The existing path is preserved; Phase 5A swaps the RPC in place.
    const files = readdirSync(join(here, '../api/portal')).filter((f) => /thread/i.test(f))
    assert.deepEqual(files, ['messages-thread.js'])
  })

  await t.test('the six portal endpoints are intact and only thread changed', () => {
    // MESSAGES-ARCHIVE-P1 added exactly one sanctioned new portal endpoint,
    // messages-archive.js; MESSAGES-LIFECYCLE-PHASE3A-REACTIONS added exactly
    // one more, messages-react.js. The original six are otherwise untouched here.
    const files = readdirSync(join(here, '../api/portal')).filter((f) => f.startsWith('messages-')).sort()
    assert.deepEqual(files, ['messages-archive.js', 'messages-list.js', 'messages-mark-read.js', 'messages-react.js',
      'messages-reply.js', 'messages-start.js', 'messages-thread.js', 'messages-unread-count.js'])
    // The other portal endpoints still call their original RPCs.
    assert.match(read('../api/portal/messages-list.js'), /messages_portal_list_conversations/)
    assert.match(read('../api/portal/messages-unread-count.js'), /messages_portal_unread_count/)
  })
})

test('endpoint: methods, auth, and errors', async (t) => {
  await t.test('GET only, and unsupported methods are rejected', () => {
    assert.match(code, /methodGuard\(req, res, \['GET'\]\)/)
    // The shared guard is what returns 405.
    assert.match(read('../api/lib/messagesApi.js'), /405/)
  })

  await t.test('thread retrieval mutates nothing', () => {
    assert.doesNotMatch(code, /messages_mark_read|last_read_at|INSERT|UPDATE/)
  })

  await t.test('authentication precedes any data access', () => {
    assert.match(code, /verifyPortal(StudentCaller|MessagesCaller)\(req\)/)
    assert.ok(code.indexOf('verifyPortalMessagesCaller') < code.indexOf('db.rpc'),
      'the caller is verified before the RPC runs')
    assert.match(code, /if \(!db\) return res\.status\(401\)\.json\(\{ error: 'unauthenticated' \}\)/)
  })

  await t.test('the RPC runs as the signed-in student, not service_role', () => {
    assert.match(code, /getUserScopedDb\(req\)/)
    assert.doesNotMatch(code, /service_role|SERVICE_ROLE|serviceRole/)
  })

  await t.test('no staff authorization is used', () => {
    assert.doesNotMatch(code, /is_staff|verifyStaffCaller|is_active_owner_or_admin/)
  })

  await t.test('access is not granted by email, student_id, or assignment', () => {
    assert.doesNotMatch(code, /email/i)
    assert.doesNotMatch(code, /student_id|assigned_staff|related_student/)
  })

  await t.test('safe error mapping, with nothing internal exposed', () => {
    assert.match(code, /error\.code === 'MS400' \? 422 : 500/)
    assert.match(code, /error\.code === 'MS400' \? 'validation_failed' : 'internal_error'/)
    assert.match(code, /invalid_conversation_id/)
    assert.match(code, /return notFound\(res\)/)
    // Never leaks the RPC name, SQLSTATE, or a raw Supabase error to the client.
    assert.doesNotMatch(code, /res\.status\([0-9]+\)\.json\(\{[^}]*error: (err|error)\b/)
    assert.doesNotMatch(code, /json\([^)]*messages_portal_get_thread/)
    assert.doesNotMatch(code, /json\([^)]*\bstack\b/)
  })

  await t.test('an inaccessible conversation is non-enumerating', () => {
    // NULL covers both inaccessible and missing, and both map to 404.
    assert.match(code, /if \(!data\) return notFound\(res\)/)
  })
})

test('endpoint: pagination contract', async (t) => {
  await t.test('limit defaults to 50 and caps at 100, matching the RPC bounds', () => {
    assert.match(code, /parseLimit\(req\.query\?\.limit, \{ fallback: 50, max: 100 \}\)/)
    assert.equal(parseLimit(undefined, { fallback: 50, max: 100 }).value, 50)
    assert.equal(parseLimit(500, { fallback: 50, max: 100 }).value, 100, 'excessive values are bounded')
    assert.equal(parseLimit(0, { fallback: 50, max: 100 }).ok, false)
    assert.equal(parseLimit(-5, { fallback: 50, max: 100 }).ok, false)
    assert.equal(parseLimit('abc', { fallback: 50, max: 100 }).ok, false)
  })

  await t.test('both cursor fields are required for an older page', () => {
    assert.match(code, /parseCursor\(\{ cursorTs: req\.query\?\.cursor_ts, cursorId: req\.query\?\.cursor_id \}\)/)
    assert.deepEqual(parseCursor({}).value, { ts: null, id: null }, 'no cursor means the newest page')
    assert.equal(parseCursor({ cursorTs: TS }).ok, false, 'partial cursor rejected')
    assert.equal(parseCursor({ cursorId: UUID_A }).ok, false, 'partial cursor rejected')
    assert.equal(parseCursor({ cursorTs: 'nonsense', cursorId: UUID_A }).ok, false)
    assert.equal(parseCursor({ cursorTs: TS, cursorId: 'nope' }).ok, false)
    assert.equal(parseCursor({ cursorTs: TS, cursorId: UUID_A }).ok, true)
  })

  await t.test('a rejected cursor returns 422 and never reaches the database', () => {
    assert.match(code, /if \(!cursor\.ok\) return res\.status\(422\)\.json\(\{ error: cursor\.error \}\)/)
    assert.ok(code.indexOf('cursor.ok') < code.indexOf('db.rpc'))
  })

  await t.test('next_cursor and has_more come from the RPC, not from row counting', () => {
    assert.match(code, /next_cursor: data\.next_cursor \?\? null/)
    assert.match(code, /has_more: data\.has_more === true/)
    // The forward-cursor derivation is gone: it could only describe forward paging.
    assert.doesNotMatch(code, /nextCursorFrom/)
  })

  await t.test('no offset, page numbers, or unbounded retrieval', () => {
    assert.doesNotMatch(code, /offset|page_number|\bpage=/i)
    assert.match(code, /p_limit: limit\.value/, 'every request is bounded')
  })
})

test('endpoint: response privacy', async (t) => {
  await t.test('only the browser-safe projection is returned', () => {
    const body = code.slice(code.indexOf('return res.status(200)'), code.indexOf('  } catch (err)'))
    for (const key of ['conversation', 'messages', 'next_cursor', 'has_more']) {
      assert.ok(body.includes(key), `response key ${key} missing`)
    }
    // Explicit thread classification may decorate conversation after the
    // caller-scoped RPC authorizes it, but sensitive delivery or identity fields
    // still never leave the endpoint.
    assert.match(code, /classifyPortalConversations\(svc, \[conversation\], caller\.profile\.id\)/)
    assert.doesNotMatch(body, /email|recipient|delivery|notification|provider|auth_user_id|user_metadata/i)
  })

  await t.test('nothing sensitive is logged', () => {
    // Only a stable label and the error object reach the logger, never the body,
    // the response, or a token.
    assert.match(code, /logApiError\('portal\/messages-thread', 'rpc_failed', error\)/)
    assert.match(code, /logApiError\('portal\/messages-thread', 'threw', err\)/)
    assert.doesNotMatch(code, /console\.(log|info|warn|error)/)
    assert.doesNotMatch(code, /log[^(]*\((data|body|messages|token|authorization)/i)
  })

  await t.test('no analytics or telemetry', () => {
    assert.doesNotMatch(code, /analytics|telemetry|track\(|gtag|posthog|segment/i)
  })
})

test('dormant client: bounds and query keys', async (t) => {
  await t.test('limits mirror the RPC bounds', () => {
    assert.equal(PORTAL_THREAD_LIMIT_DEFAULT, 50)
    assert.equal(PORTAL_THREAD_LIMIT_MAX, 100)
    assert.equal(clampThreadLimit(undefined), 50)
    assert.equal(clampThreadLimit(0), 50)
    assert.equal(clampThreadLimit(-1), 50)
    assert.equal(clampThreadLimit('abc'), 50)
    assert.equal(clampThreadLimit(500), 100, 'never requests more than the backend honors')
    assert.equal(clampThreadLimit(25), 25)
  })

  await t.test('query keys are conversation-scoped', () => {
    assert.deepEqual(portalThreadQueryKey(UUID_A), ['portal_messages_thread', UUID_A])
    assert.notDeepEqual(portalThreadQueryKey(UUID_A), portalThreadQueryKey(UUID_B))
    assert.deepEqual(portalThreadQueryKey(undefined), ['portal_messages_thread', null])
  })
})

test('dormant client: request serialization', async (t) => {
  await t.test('the newest page sends no cursor', () => {
    const { query } = serializePortalThreadQuery({ conversationId: UUID_A })
    assert.deepEqual(query, { conversation_id: UUID_A, limit: '50' })
  })

  await t.test('an older page sends BOTH cursor fields', () => {
    const { query } = serializePortalThreadQuery({
      conversationId: UUID_A,
      cursor: { cursor_ts: TS, cursor_id: UUID_B },
    })
    assert.equal(query.cursor_ts, TS)
    assert.equal(query.cursor_id, UUID_B)
  })

  await t.test('a partial or malformed cursor is never sent', () => {
    for (const bad of [{ cursor_ts: TS }, { cursor_id: UUID_B }, { cursor_ts: 'x', cursor_id: UUID_B },
      { cursor_ts: TS, cursor_id: 'x' }, null, undefined]) {
      const { query } = serializePortalThreadQuery({ conversationId: UUID_A, cursor: bad })
      assert.equal(query.cursor_ts, undefined, `partial cursor leaked: ${JSON.stringify(bad)}`)
      assert.equal(query.cursor_id, undefined)
    }
  })

  await t.test('the cursor field names round-trip the RPC response exactly', () => {
    // next_cursor from the RPC feeds straight back in with no renaming.
    const page = { has_more: true, next_cursor: { cursor_ts: TS, cursor_id: UUID_B } }
    const { query } = serializePortalThreadQuery({ conversationId: UUID_A, cursor: nextThreadCursor(page) })
    assert.equal(query.cursor_ts, TS)
    assert.equal(query.cursor_id, UUID_B)
  })
})

test('dormant client: cursor derivation', async (t) => {
  await t.test('has_more is authoritative, never inferred from page length', () => {
    // The oldest page can be exactly `limit` long. Inferring from length would
    // falsely offer another page.
    assert.equal(nextThreadCursor({ has_more: false, next_cursor: { cursor_ts: TS, cursor_id: UUID_B } }), null)
    assert.equal(nextThreadCursor({ has_more: true, next_cursor: { cursor_ts: TS, cursor_id: UUID_B } }).cursor_id, UUID_B)
  })

  await t.test('no cursor when no older page exists', () => {
    assert.equal(nextThreadCursor({ has_more: false, next_cursor: null }), null)
    assert.equal(nextThreadCursor({}), null)
    assert.equal(nextThreadCursor(null), null)
  })

  await t.test('a malformed cursor from the server is rejected', () => {
    assert.equal(nextThreadCursor({ has_more: true, next_cursor: { cursor_ts: TS } }), null)
    assert.equal(nextThreadCursor({ has_more: true, next_cursor: { cursor_ts: 'x', cursor_id: UUID_B } }), null)
  })
})

test('dormant client: duplicate-safe merging', async (t) => {
  const older = [{ id: 'a', created_at: '2026-07-16T09:00:00Z' }, { id: 'b', created_at: '2026-07-16T09:30:00Z' }]
  const held = [{ id: 'c', created_at: '2026-07-16T10:00:00Z' }, { id: 'd', created_at: '2026-07-16T10:30:00Z' }]

  await t.test('an older page is PREPENDED, preserving chronology', () => {
    const merged = prependOlderPage(held, older)
    assert.deepEqual(merged.map((r) => r.id), ['a', 'b', 'c', 'd'])
  })

  await t.test('no duplicates across pages, and held rows win', () => {
    const overlapping = [{ id: 'b', created_at: 'x' }, { id: 'c', created_at: 'y' }]
    const merged = prependOlderPage(held, overlapping)
    assert.deepEqual(merged.map((r) => r.id), ['b', 'c', 'd'], 'c is not duplicated')
    assert.equal(merged.find((r) => r.id === 'c').created_at, '2026-07-16T10:00:00Z', 'held row preserved')
  })

  await t.test('no rows are skipped when pages abut', () => {
    const merged = prependOlderPage(held, older)
    assert.equal(merged.length, 4)
    for (const id of ['a', 'b', 'c', 'd']) {
      assert.ok(merged.some((r) => r.id === id), `row ${id} was skipped`)
    }
  })

  await t.test('rows sharing a timestamp both survive (id tie-breaker)', () => {
    const tie = [{ id: 'x', created_at: TS }, { id: 'y', created_at: TS }]
    const merged = prependOlderPage([], tie)
    assert.deepEqual(merged.map((r) => r.id), ['x', 'y'], 'equal timestamps are distinct rows')
  })

  await t.test('a refresh of the newest page appends only what is new', () => {
    const merged = appendNewerPage(held, [{ id: 'd' }, { id: 'e' }])
    assert.deepEqual(merged.map((r) => r.id), ['c', 'd', 'e'])
  })

  await t.test('merging tolerates empty and malformed input', () => {
    assert.deepEqual(prependOlderPage([], []), [])
    assert.deepEqual(prependOlderPage(null, older).map((r) => r.id), ['a', 'b'])
    assert.deepEqual(prependOlderPage(held, null).map((r) => r.id), ['c', 'd'])
    assert.deepEqual(prependOlderPage([], [{ id: null }, { id: 'z' }]).map((r) => r.id), ['z'])
  })
})

test('dormant client: stale-response protection', async (t) => {
  await t.test('a page is only current for its own conversation', () => {
    assert.equal(threadPageIsCurrent({ conversation: { id: UUID_A } }, UUID_A), true)
    assert.equal(threadPageIsCurrent({ conversation: { id: UUID_A } }, UUID_B), false,
      'a late response from another conversation must not merge')
  })

  await t.test('an unprovable page is not current', () => {
    assert.equal(threadPageIsCurrent({ conversation: {} }, UUID_A), false)
    assert.equal(threadPageIsCurrent({}, UUID_A), false)
    assert.equal(threadPageIsCurrent(null, UUID_A), false)
    assert.equal(threadPageIsCurrent({ conversation: { id: UUID_A } }, null), false)
  })

  await t.test('the Phase 5B rule is documented', () => {
    assert.match(client, /STALE-RESPONSE PROTECTION/)
    assert.match(client, /AbortSignal/)
    assert.match(client, /portalThreadQueryKey\(conversationId\)/)
  })
})

test('scope: the portal foundation stays out of the staff app', async (t) => {
  await t.test('the client foundation is imported only by the portal activation point', () => {
    assert.match(read('../src/portal/PortalApp.jsx'), /portalMessagesPolling/)
    // The staff app never imports the portal foundation.
    assert.doesNotMatch(read('../src/pages/Connect.jsx'), /portalThreadState|portalMessages/)
    assert.doesNotMatch(read('../src/App.jsx'), /portalThreadState|portalMessages/)
  })

  await t.test('PortalApp is the only activation point, and URLs grant nothing', () => {
    // Phase 5B-ii activated Messages through PortalApp alone; ASPIRE-COMPASS
    // made the section URL-driven (/portal/messages[/:threadId]) inside the
    // same guarded /portal/* route. PortalApp remains the only mount point.
    assert.match(read('../src/portal/PortalApp.jsx'), /<PortalMessagesWorkspace\s[\s\S]*?active=\{studentView === 'messages'\}/)
    for (const f of ['../src/portal/PortalShell.jsx', '../src/portal/StudentPortal.jsx']) {
      const s = read(f)
      assert.doesNotMatch(s, /MessagesWorkspace|MessagesInbox|NewMessageDialog|ReplyComposer|messagesApiClient/)
    }
    // Only PortalApp mints the messages path; shell and home never hardcode it.
    for (const f of ['../src/portal/PortalShell.jsx', '../src/portal/StudentPortal.jsx']) {
      assert.doesNotMatch(read(f), /\/portal\/messages/)
    }
  })

  await t.test('no portal Messages component was created', () => {
    assert.doesNotMatch(client, /import React|from 'react'|jsx|useState|useQuery/)
  })

  await t.test('the staff workspace remains activated and unchanged', () => {
    const connect = read('../src/pages/Connect.jsx')
    assert.match(connect, /const canUseMessages = \['owner', 'admin'\]\.includes\(userProfile\?\.role\)/)
    assert.match(connect, /<MessagesWorkspace refreshKey=\{refreshKey\} onOpenStudent=\{onNavigateToStudent\} \/>/)
    // The other Connect tabs are untouched.
    assert.match(connect, /<ContactsView refreshKey=\{refreshKey\} \/>/)
    assert.match(connect, /<OutreachView cohortId=\{cohortId\}/)
    assert.match(connect, /<AutomationView active=\{activeSubTab === 'broadcasts'\}/)
  })
})

test('Phase 5A hygiene', async (t) => {
  await t.test('no em dash in the changed files', () => {
    assert.doesNotMatch(endpoint, /\u2014/)
    assert.doesNotMatch(client, /\u2014/)
  })

  await t.test('uses ASPIRE, never the deprecated long form', () => {
    assert.doesNotMatch(endpoint, /ASPIRE Program/)
    assert.doesNotMatch(client, /ASPIRE Program/)
  })

  await t.test('all seven Messages migrations are present', () => {
    const names = ['20260716000000_messages_phase1_schema_foundation',
      '20260716000001_messages_phase2_notification_delivery_foundation',
      '20260716000002_messages_phase3_api_foundation',
      '20260716000003_messages_phase3_delivery_invariant_fix',
      '20260716000004_messages_phase4_staff_inbox_filter_modes',
      '20260716000005_messages_phase4_staff_thread_reverse_pagination',
      '20260716000006_messages_phase5_portal_thread_reverse_pagination']
    for (const n of names) {
      assert.ok(read(`../supabase/migrations/${n}.sql`).length > 0, `missing migration ${n}`)
    }
  })
})
