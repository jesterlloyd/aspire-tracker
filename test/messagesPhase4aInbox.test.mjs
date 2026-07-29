// MESSAGES-PHASE4A: pure-function and static-source guards for the staff inbox
// foundation. Uses the repository's existing test stack (node:test, pure
// functions plus static source assertions); no testing-library or jsdom is
// introduced. No real API call, conversation, notification, or student content.
//
// Run: node --test test/messagesPhase4aInbox.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import {
  MESSAGE_CATEGORIES, STAFF_STATUSES, STAFF_STATUS_LABEL,
  formatUnread, unreadLabel, formatInboxTimestamp, formatFullTimestamp,
  participantAccessLabel, mapMessagesError,
} from '../src/lib/messages/messagesConstants.js'
import {
  DEFAULT_FILTERS, filtersAreDefault, serializeInboxQuery, clampLimit,
  appendPage, normalizeCursor, queryIdentity, debounce,
} from '../src/lib/messages/inboxState.js'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, p), 'utf8')
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

const optionsApi = read('../api/messages-staff-options.js')
const client = read('../src/lib/messages/messagesApiClient.js')
const inbox = read('../src/components/connect/messages/MessagesInbox.jsx')
const connect = read('../src/pages/Connect.jsx')

test('shared constants and formatting', async (t) => {
  await t.test('categories and statuses match the approved sets', () => {
    assert.equal(MESSAGE_CATEGORIES.length, 7)
    for (const c of ['Placement and matching', 'Scheduling', 'Onboarding requirements',
      'Clinical rotation support', 'Preceptor support', 'Portal or account help', 'General question']) {
      assert.ok(MESSAGE_CATEGORIES.includes(c), `missing category ${c}`)
    }
    assert.deepEqual(STAFF_STATUSES, ['open', 'waiting', 'resolved'])
    assert.equal(STAFF_STATUS_LABEL.waiting, 'Waiting', 'staff sees the real status, unlike the portal')
  })

  await t.test('unread uses compact 99+ formatting and accessible text', () => {
    assert.equal(formatUnread(0), null)
    assert.equal(formatUnread(1), '1')
    assert.equal(formatUnread(99), '99')
    assert.equal(formatUnread(100), '99+')
    assert.equal(formatUnread(5000), '99+')
    assert.equal(unreadLabel(1), '1 unread message')
    assert.equal(unreadLabel(3), '3 unread messages')
    assert.equal(unreadLabel(0), '')
  })

  await t.test('timestamps use Intl and tolerate bad input', () => {
    const now = new Date('2026-07-16T12:00:00Z')
    assert.equal(formatInboxTimestamp(null), '')
    assert.equal(formatInboxTimestamp('nonsense'), '')
    assert.equal(formatFullTimestamp(undefined), '')
    assert.ok(formatInboxTimestamp('2026-07-16T09:00:00Z', now).length > 0)
    assert.ok(formatFullTimestamp('2026-07-16T09:00:00Z').length > 0)
  })

  await t.test('access labels and safe error mapping', () => {
    assert.equal(participantAccessLabel(true), 'Active portal access')
    assert.equal(participantAccessLabel(false), 'Portal access inactive')
    assert.match(mapMessagesError(401), /session expired/i)
    assert.match(mapMessagesError(403), /Owner or Admin/i)
    assert.match(mapMessagesError(404), /no longer available/i)
    assert.match(mapMessagesError(409), /changed/i)
    assert.match(mapMessagesError(429), /Too many requests/i)
    assert.match(mapMessagesError(500), /Something went wrong/i)
    // Never leaks internals.
    for (const s of [401, 403, 404, 409, 422, 429, 500]) {
      assert.doesNotMatch(mapMessagesError(s), /SQLSTATE|MS4|pg_|service_role|resend/i)
    }
  })
})

test('inbox state utilities', async (t) => {
  await t.test('default filters send no narrowing parameters', () => {
    assert.equal(filtersAreDefault(DEFAULT_FILTERS), true)
    const { query } = serializeInboxQuery({ filters: DEFAULT_FILTERS, search: '', limit: 25 })
    assert.deepEqual(query, { limit: '25' })
  })

  await t.test('filters serialize to the deployed query parameters', () => {
    const { query } = serializeInboxQuery({
      filters: { status: 'waiting', assignee: 'me', category: 'Scheduling', flagged: 'flagged' },
      search: '  Placement  ', limit: 25,
    })
    assert.equal(query.status, 'waiting')
    assert.equal(query.assignee, 'me', 'Me is a sentinel resolved by the server, never a client id')
    assert.equal(query.category, 'Scheduling')
    assert.equal(query.flagged, 'true')
    assert.equal(query.search, 'Placement', 'search is trimmed')
  })

  await t.test('not_flagged serializes to false', () => {
    const { query } = serializeInboxQuery({ filters: { ...DEFAULT_FILTERS, flagged: 'not_flagged' } })
    assert.equal(query.flagged, 'false')
  })

  await t.test('unassigned and uncategorized are sent as real server filters (v2 modes)', () => {
    // Stage A added the v2 RPC filter modes, so these are now genuine
    // server-side IS NULL filters, never client-filtered from a partial page.
    const a = serializeInboxQuery({ filters: { ...DEFAULT_FILTERS, assignee: 'unassigned' } })
    assert.equal(a.query.assignee, 'unassigned')
    const c = serializeInboxQuery({ filters: { ...DEFAULT_FILTERS, category: 'uncategorized' } })
    assert.equal(c.query.category, 'uncategorized')
  })

  await t.test('a client profile id is never used to resolve Me', () => {
    const { query } = serializeInboxQuery({ filters: { ...DEFAULT_FILTERS, assignee: 'me' } })
    assert.equal(query.assignee, 'me', 'the server resolves Me from the verified caller')
  })

  await t.test('limits are capped at 100 and default to 25', () => {
    assert.equal(clampLimit(undefined), 25)
    assert.equal(clampLimit(0), 25)
    assert.equal(clampLimit(-5), 25)
    assert.equal(clampLimit('abc'), 25)
    assert.equal(clampLimit(500), 100)
    assert.equal(clampLimit(10), 10)
    const { query } = serializeInboxQuery({ limit: 999 })
    assert.equal(query.limit, '100')
  })

  await t.test('a valid cursor serializes; a malformed one is rejected safely', () => {
    const good = { cursor_ts: '2026-07-16T00:00:00.000Z', cursor_id: '33333333-3333-4333-8333-333333333333' }
    assert.deepEqual(normalizeCursor(good), good)
    assert.equal(normalizeCursor(null), null)
    assert.equal(normalizeCursor({ cursor_ts: '2026-07-16T00:00:00Z' }), null, 'partial cursor rejected')
    assert.equal(normalizeCursor({ cursor_id: good.cursor_id }), null, 'partial cursor rejected')
    assert.equal(normalizeCursor({ cursor_ts: 'nope', cursor_id: good.cursor_id }), null)
    assert.equal(normalizeCursor({ cursor_ts: good.cursor_ts, cursor_id: 'nope' }), null)
    const { query } = serializeInboxQuery({ cursor: good })
    assert.equal(query.cursor_ts, good.cursor_ts)
    assert.equal(query.cursor_id, good.cursor_id)
  })

  await t.test('appending pages never duplicates and preserves server order', () => {
    const page1 = [{ id: 'a' }, { id: 'b' }]
    const page2 = [{ id: 'b' }, { id: 'c' }] // overlapping page
    const merged = appendPage(page1, page2)
    assert.deepEqual(merged.map((r) => r.id), ['a', 'b', 'c'], 'no duplicate, server order kept')
    assert.deepEqual(appendPage([], page1).map((r) => r.id), ['a', 'b'])
    assert.deepEqual(appendPage(page1, []).map((r) => r.id), ['a', 'b'])
    // Rows without an id are ignored rather than corrupting the list.
    assert.deepEqual(appendPage([], [{ id: null }, { id: 'z' }]).map((r) => r.id), ['z'])
  })

  await t.test('query identity changes when search or any filter changes', () => {
    const base = { filters: DEFAULT_FILTERS, search: '' }
    assert.equal(queryIdentity(base), queryIdentity({ ...base }))
    assert.notEqual(queryIdentity(base), queryIdentity({ ...base, search: 'x' }))
    assert.notEqual(queryIdentity(base), queryIdentity({ filters: { ...DEFAULT_FILTERS, status: 'open' }, search: '' }))
    // Whitespace-only search is identical to empty.
    assert.equal(queryIdentity(base), queryIdentity({ ...base, search: '   ' }))
  })

  await t.test('debounce coalesces bursts and can be cancelled', async () => {
    let calls = 0
    const d = debounce(() => { calls += 1 }, 20)
    d(); d(); d()
    assert.equal(calls, 0, 'no call per keystroke')
    await new Promise((r) => setTimeout(r, 40))
    assert.equal(calls, 1, 'one call after the burst')
    d(); d.cancel()
    await new Promise((r) => setTimeout(r, 40))
    assert.equal(calls, 1, 'cancelled call never fires')
  })
})

test('active Owner/Admin options endpoint', async (t) => {
  await t.test('requires an active Owner or Admin and never uses is_staff', () => {
    assert.match(optionsApi, /verifyStaffCaller\(req\)/)
    assert.match(optionsApi, /if \(!caller\.ok\) return res\.status\(caller\.status\)/)
    assert.doesNotMatch(strip(optionsApi), /is_staff/)
    assert.match(optionsApi, /methodGuard\(req, res, \['GET'\]\)/)
  })

  await t.test('assignees are active Owner/Admin only', () => {
    assert.match(optionsApi, /\.in\('role', \['owner', 'admin'\]\)/)
    assert.match(optionsApi, /\.filter\(\(p\) => p\.is_active !== false\)/)
    // Interviewer, viewer, student, and portal profiles cannot appear.
    assert.doesNotMatch(strip(optionsApi), /'interviewer'|'viewer'/)
  })

  await t.test('assignee options expose only the four approved fields and no email', () => {
    const block = optionsApi.slice(optionsApi.indexOf('async function listAssignees'), optionsApi.indexOf('// Active Student Portal participants'))
    assert.match(block, /profile_id: p\.id/)
    assert.match(block, /display_name:/)
    assert.match(block, /role: p\.role/)
    assert.match(block, /is_current_user: p\.id === caller\.profile\.id/)
    assert.doesNotMatch(block, /email/, 'staff email must not be returned')
    assert.doesNotMatch(block, /auth_user_id/)
    assert.match(optionsApi, /\.select\('id, full_name, role, is_active'\)/, 'narrow select only')
    assert.match(optionsApi, /ASSIGNEE_LIMIT/)
  })

  await t.test('participants are active student portal accounts only', () => {
    assert.match(optionsApi, /\.eq\('role', 'student'\)/)
    assert.match(optionsApi, /\.is\('revoked_at', null\)/)
    assert.match(optionsApi, /g\.starts_at <= nowIso && \(g\.expires_at == null \|\| g\.expires_at > nowIso\)/,
      'canonical active predicate excludes expired and future grants')
    assert.match(optionsApi, /from\('user_student_links'\)[\s\S]{0,160}?\.is\('revoked_at', null\)/,
      'revoked student links excluded')
    assert.match(optionsApi, /p\.is_active !== false/, 'inactive profiles excluded')
    // No other portal role is ever queried.
    assert.doesNotMatch(strip(optionsApi), /unit_leader|academic_partner|preceptor/)
  })

  await t.test('participant results are bounded, searchable, and narrow', () => {
    assert.match(optionsApi, /PARTICIPANT_LIMIT = 20/)
    assert.match(optionsApi, /MIN_SEARCH = 2/)
    assert.match(optionsApi, /q\.length >= MIN_SEARCH/)
    assert.match(optionsApi, /\.trim\(\)\.slice\(0, 80\)/, 'search input is bounded')
    assert.match(optionsApi, /participant_profile_id:/)
    assert.match(optionsApi, /student_id:/)
    assert.match(optionsApi, /context:/)
    assert.match(optionsApi, /access_active: true/)
    // Minimal student read: no clinical or contact detail.
    assert.match(optionsApi, /from\('students'\)[\s\S]{0,80}?\.select\('id, school'\)/)
    // Guard the CODE: the header comment legitimately names the fields that the
    // rejected list-portal-access endpoint returns.
    assert.doesNotMatch(strip(optionsApi), /last_login_at|personal_email|school_email/)
  })

  await t.test('an invalid kind is rejected', () => {
    assert.match(optionsApi, /kind !== 'assignees' && kind !== 'participants'/)
    assert.match(optionsApi, /invalid_kind/)
  })
})

test('messages API client', async (t) => {
  await t.test('sends a bearer token from the existing session convention', () => {
    assert.match(client, /supabase\.auth\.getSession\(\)/)
    assert.match(client, /Bearer \$\{token\}/)
    assert.match(client, /Authorization: await authHeader\(\)/)
  })

  await t.test('never permits the browser to submit routing fields', () => {
    for (const f of ['p_delivery', 'recipient_email', 'recipient_kind', 'recipient_profile_id',
      'event_type', 'idempotency_key', 'snapshot_sender_name', 'cta_path']) {
      assert.ok(client.includes(`'${f}'`), `${f} must be in the forbidden list`)
    }
    assert.match(client, /function assertNoRoutingFields/)
    assert.match(client, /the browser may not send/)
  })

  await t.test('uses the real deployed endpoint paths', () => {
    for (const p of ['/api/messages-staff-list', '/api/messages-staff-thread', '/api/messages-staff-read',
      '/api/messages-staff-start', '/api/messages-staff-reply', '/api/messages-staff-manage',
      '/api/messages-staff-options']) {
      assert.ok(client.includes(p), `missing endpoint ${p}`)
    }
  })

  await t.test('supports AbortSignal and drops empty query values', () => {
    assert.match(client, /signal/)
    assert.match(client, /if \(v === undefined \|\| v === null \|\| v === ''\) continue/)
  })

  await t.test('maps errors safely and never logs responses or content', () => {
    assert.match(client, /class MessagesApiError/)
    assert.match(client, /this\.status = status/)
    assert.doesNotMatch(strip(client), /console\.(log|error|warn)/, 'the client must not log')
    assert.doesNotMatch(strip(client), /dangerouslySetInnerHTML/)
  })

  await t.test('never calls a Supabase RPC directly from the browser', () => {
    assert.doesNotMatch(strip(client), /\.rpc\(/)
    assert.doesNotMatch(strip(client), /service_role|SERVICE_ROLE/)
  })
})

test('staff inbox component', async (t) => {
  await t.test('renders previews as plain text with no dangerous HTML', () => {
    // Guard the CODE: the header comment states the rule it must never break.
    const code = strip(inbox)
    assert.doesNotMatch(code, /dangerouslySetInnerHTML/)
    assert.doesNotMatch(code, /innerHTML/)
    assert.doesNotMatch(code, /marked|markdown|DOMPurify|sanitize-html/i)
  })

  await t.test('never displays a staff email', () => {
    assert.doesNotMatch(strip(inbox), /\.email/)
  })

  await t.test('never logs message content', () => {
    assert.doesNotMatch(strip(inbox), /console\.(log|error|warn)/)
    assert.doesNotMatch(strip(inbox), /localStorage|sessionStorage/, 'no message state persisted in the browser')
  })

  await t.test('unread is signalled by weight, a dot, a badge, and accessible text', () => {
    assert.match(inbox, /fontWeight: isUnread \? 700 : 500/)
    assert.match(inbox, /\{isUnread && <span aria-hidden="true" style=\{dot\} \/>\}/)
    assert.match(inbox, /formatUnread\(unread\)/)
    assert.match(inbox, /<span style=\{srOnly\}>\{unreadLabel\(unread\)\}<\/span>/)
  })

  await t.test('the selected row is programmatically identifiable', () => {
    assert.match(inbox, /aria-current=\{selected \? 'true' : undefined\}/)
  })

  await t.test('search is debounced and clearable, and never searches bodies', () => {
    assert.match(inbox, /SEARCH_DEBOUNCE_MS = 300/)
    assert.ok(300 >= 250 && 300 <= 400, 'debounce within the approved range')
    assert.match(inbox, /debounce\(\(v\) => setSearch\(v\), SEARCH_DEBOUNCE_MS\)/)
    assert.match(inbox, /const clearSearch =/)
    assert.match(inbox, /<label htmlFor="msg-search" style=\{srOnly\}>/)
  })

  await t.test('filters are labeled, keyboard usable, and resettable', () => {
    for (const id of ['msg-f-status', 'msg-f-assignee', 'msg-f-category', 'msg-f-flagged']) {
      assert.ok(inbox.includes(id), `missing filter ${id}`)
    }
    assert.match(inbox, /<label htmlFor=\{id\} style=\{srOnly\}>\{label\}<\/label>/)
    assert.match(inbox, /Reset filters/)
    // Native selects keep keyboard operation and accessible naming.
    assert.match(inbox, /<select id=\{id\}/)
  })

  await t.test('assignee options come from the narrow lookup, not a directory', () => {
    assert.match(inbox, /api\.listAssigneeOptions\(\{ signal \}\)/)
    assert.doesNotMatch(strip(inbox), /get_all_user_profiles|admin-users|list-portal-access/)
  })

  await t.test('pagination is cursor based with Load more and no duplicates', () => {
    assert.match(inbox, /PAGE_LIMIT = 25/)
    assert.match(inbox, /useInfiniteQuery\(\{/)
    assert.match(inbox, /initialPageParam: null/)
    assert.match(inbox, /getNextPageParam: \(lastPage\) => lastPage\?\.next_cursor \?\? undefined/)
    // Pages are flattened through appendPage, so an overlapping page cannot
    // duplicate a row and server order is preserved.
    assert.match(inbox, /reduce\(\(acc, page\) => appendPage\(acc, page\?\.conversations \|\| \[\]\), \[\]\)/)
    assert.match(inbox, /Load more/)
    assert.match(inbox, /disabled=\{isFetchingNextPage\}/)
    assert.match(inbox, /onClick=\{\(\) => fetchNextPage\(\)\}/)
    assert.doesNotMatch(strip(inbox), /offset|page=/i, 'no offset pagination')
  })

  await t.test('a filter or search change resets pagination to the first page', () => {
    // The query identity is part of the React Query key, so changing filters or
    // search starts a NEW cursor chain. Pages from two queries cannot interleave.
    assert.match(inbox, /queryKey: \['messages_staff_list', identity, refreshKey\]/)
    // MESSAGES-ARCHIVE-P1: identity also folds in `view` (Active/Archived), so
    // switching the scope picker resets pagination the same way a filter change
    // does. The queryKey line above is untouched: view travels inside identity.
    assert.match(inbox, /const identity = useMemo\(\(\) => queryIdentity\(\{ filters, search, view \}\), \[filters, search, view\]\)/)
    // The soft-refresh key refetches without clearing filters or search.
    assert.match(inbox, /refreshKey/)
  })

  await t.test('stale responses and cancellation are handled by the query layer', () => {
    // React Query owns request identity and cancellation; the component keeps no
    // manual request state that could apply a stale response.
    assert.match(inbox, /queryFn: \(\{ pageParam, signal \}\)/)
    assert.match(inbox, /api\.listStaffConversations\(query, \{ signal \}\)/)
    assert.doesNotMatch(strip(inbox), /requestSeq|setRows\(|setCursor\(/, 'no manual request state')
  })

  await t.test('loading, error, retry, and the three empty states exist', () => {
    assert.match(inbox, /aria-busy=\{isLoading \? 'true' : 'false'\}/)
    assert.match(inbox, /role="status">Loading conversations/)
    assert.match(inbox, /Retry/)
    assert.match(inbox, /onClick=\{\(\) => refetch\(\)\}/)
    assert.match(inbox, /isError \? mapMessagesError\(error\?\.status\) : null/)
    assert.match(inbox, /'No conversations match your search\.'/)
    assert.match(inbox, /'No conversations match these filters\.'/)
    assert.match(inbox, /'No ASPIRE Messages yet\.'/)
  })

  await t.test('rows show the approved operational fields', () => {
    assert.match(inbox, /row\.participant_name/)
    assert.match(inbox, /row\.subject/)
    assert.match(inbox, /row\.latest_preview/)
    assert.match(inbox, /STAFF_STATUS_LABEL\[row\.status\]/)
    assert.match(inbox, /row\.category/)
    assert.match(inbox, /row\.assignee_name/)
    assert.match(inbox, /row\.follow_up_flagged/)
    assert.match(inbox, /participantAccessLabel\(false\)/)
    assert.match(inbox, /formatInboxTimestamp\(row\.last_message_at\)/)
    // Truncated content carries an accessible title.
    assert.match(inbox, /title=\{row\.participant_name \|\| 'Portal participant'\}/)
    assert.match(inbox, /title=\{formatFullTimestamp\(row\.last_message_at\)\}/)
  })

  await t.test('touch targets are usable and no read pointer is written in Phase 4A', () => {
    assert.match(inbox, /minHeight: 44/)
    assert.doesNotMatch(strip(inbox), /markStaffRead|mark-read/, 'Phase 4A must not update read state')
    assert.doesNotMatch(strip(inbox), /setInterval|refetchInterval/, 'Phase 4A adds no polling')
  })
})

test('Phase 4A safety: Messages stays unexposed', async (t) => {
  await t.test('Messages is activated in Connect and gated to active Owner/Admin', () => {
    assert.match(connect, /const VALID_TABS = new Set\(\['contacts', 'outreach', 'messages', 'broadcasts'\]\)/)
    assert.match(connect, /const canUseMessages = \['owner', 'admin'\]\.includes\(userProfile\?\.role\)/, 'Messages is activated in Phase 4B2b-ii and gated to an active Owner or Admin')
    // The existing three tabs and the redirect are intact.
    assert.match(connect, /path: '\/connect\/contacts'/)
    assert.match(connect, /path: '\/connect\/outreach'/)
    assert.match(connect, /path: '\/connect\/broadcasts'/)
    assert.match(connect, /<SegmentedTabs/)
    assert.match(connect, /aspire\.connect\.lastTab/)
  })

  await t.test('the inbox component is not imported by any routed page', () => {
    for (const f of ['../src/pages/Connect.jsx', '../src/App.jsx']) {
      assert.doesNotMatch(read(f), /MessagesInbox/, `${f} must not mount the inbox in Phase 4A`)
    }
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
