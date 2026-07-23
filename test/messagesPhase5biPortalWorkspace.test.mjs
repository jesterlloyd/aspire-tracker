// MESSAGES-PHASE5B-I: guards for the dormant Student Portal Messages workspace.
// Pure-function tests plus static-source assertions, matching the repository
// stack (node:test; no testing-library or jsdom is introduced). No real API call,
// conversation, notification, or student content.
//
// Run: node --test test/messagesPhase5biPortalWorkspace.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import {
  PORTAL_RECIPIENT_LABEL, PORTAL_SUBTITLE, PORTAL_NO_SELECTION, PORTAL_EMPTY_BODY,
  PORTAL_SEND_CONFIRMATION, PORTAL_SAFETY_NOTICE, PORTAL_CATEGORY_OPTIONS,
  portalStatusLabel, portalStatusIsClosed, mapPortalMessagesError,
  mapPortalConflict, portalConflictIsAccessLost,
} from '../src/lib/messages/portalMessagesConstants.js'
import {
  MESSAGE_CATEGORIES, MESSAGE_MAX_BODY_CHARS, SUBJECT_MIN_CHARS, SUBJECT_MAX_CHARS,
  validateSubjectValue, validateBodyValue,
} from '../src/lib/messages/messagesConstants.js'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, p), 'utf8')
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
const jsx = (n) => read(`../src/portal/messages/${n}`)

const client = read('../src/lib/messages/portalMessagesApiClient.js')
const clientCode = strip(client)
const polling = read('../src/lib/messages/portalMessagesPolling.js')
const constants = read('../src/lib/messages/portalMessagesConstants.js')
const workspace = jsx('PortalMessagesWorkspace.jsx')
const inbox = jsx('PortalMessagesInbox.jsx')
const thread = jsx('PortalMessagesThread.jsx')
const newMsg = jsx('PortalNewMessageDrawer.jsx')
const reply = jsx('PortalReplyComposer.jsx')
const css = read('../src/portal/portal.css')
const all = [workspace, inbox, thread, newMsg, reply]
const allCode = all.map(strip)

test('API client', async (t) => {
  await t.test('all active portal endpoints plus the dormant general-team helper are used, and only those', () => {
    for (const p of ['/api/portal/messages-list', '/api/portal/messages-thread',
      '/api/portal/messages-start', '/api/portal/messages-reply',
      '/api/portal/messages-mark-read', '/api/portal/messages-unread-count',
      '/api/portal/team-messages-start']) {
      assert.ok(clientCode.includes(p), `missing endpoint ${p}`)
    }
    // No parallel or invented endpoint.
    const paths = [...clientCode.matchAll(/'(\/api\/[^']+)'/g)].map((m) => m[1]).sort()
    assert.deepEqual([...new Set(paths)], [
      '/api/portal/messages-list', '/api/portal/messages-mark-read',
      '/api/portal/messages-reply', '/api/portal/messages-start',
      '/api/portal/messages-thread', '/api/portal/messages-unread-count',
      '/api/portal/team-messages-start',
    ])
  })

  await t.test('it reuses the shared request core rather than duplicating transport', () => {
    assert.match(client, /import \{ request, MessagesApiError \} from '\.\/messagesApiClient\.js'/)
    assert.match(read('../src/lib/messages/messagesApiClient.js'), /export async function request\(/)
    // No transport of its own.
    assert.doesNotMatch(clientCode, /fetch\(|getSession\(|Authorization/)
  })

  await t.test('no direct RPC call and no service-role credential', () => {
    for (const s of [clientCode, polling, ...allCode]) {
      assert.doesNotMatch(s, /\.rpc\(/)
      assert.doesNotMatch(s, /service_role|SERVICE_ROLE|serviceRole|SUPABASE_SERVICE/)
    }
  })

  await t.test('no notification-routing field is ever sent', () => {
    for (const f of ['p_delivery', 'recipient_email', 'recipient_kind', 'recipient_profile_id',
      'event_type', 'idempotency_key', 'cta_path', 'snapshot_subject']) {
      assert.doesNotMatch(clientCode, new RegExp(f), `client must not send ${f}`)
    }
  })

  await t.test('start sends only subject, category, and body', () => {
    const fn = clientCode.slice(clientCode.indexOf('export function startPortalConversation'),
      clientCode.indexOf('export function replyToPortalConversation'))
    assert.match(fn, /body: \{ subject, category: category \?\? null, body \}/)
    // No participant or student id: the endpoint has no such field.
    assert.doesNotMatch(fn, /participant_profile_id|student_id/)
  })

  await t.test('mark read sends only conversation_id', () => {
    const fn = clientCode.slice(clientCode.indexOf('export function markPortalConversationRead'),
      clientCode.indexOf('export function getPortalUnreadCount'))
    assert.match(fn, /body: \{ conversation_id: conversationId \}/)
    // Never a client timestamp or a client profile id.
    assert.doesNotMatch(fn, /last_read_at|profile_id|Date\.now|toISOString/)
  })

  await t.test('AbortSignal is supported on every call', () => {
    for (const fn of ['listPortalConversations', 'getPortalThreadPage', 'startPortalConversation',
      'replyToPortalConversation', 'markPortalConversationRead', 'getPortalUnreadCount']) {
      const i = clientCode.indexOf(`export function ${fn}`)
      assert.ok(i > -1, `missing ${fn}`)
      assert.ok(clientCode.slice(i, i + 500).includes('signal'), `${fn} must pass a signal`)
    }
  })

  await t.test('safe error mapping exposes nothing internal', () => {
    assert.match(mapPortalMessagesError(401), /session expired/i)
    assert.match(mapPortalMessagesError(403), /Student Portal access/i)
    assert.match(mapPortalMessagesError(404), /no longer available/i)
    assert.match(mapPortalMessagesError(409), /changed/i)
    assert.match(mapPortalMessagesError(422), /check the highlighted fields/i)
    assert.match(mapPortalMessagesError(429), /Wait a moment/i)
    assert.match(mapPortalMessagesError(500), /Something went wrong/i)
    for (const s of [401, 403, 404, 409, 422, 429, 500]) {
      assert.doesNotMatch(mapPortalMessagesError(s), /SQLSTATE|MS4|pg_|messages_portal|resend|service_role/i)
    }
  })

  await t.test('the error carries the 409 reason, not just the error code', () => {
    // Visual inspection caught this: every 409 returns error: 'conflict', so
    // without `reason` an access-lost conflict is indistinguishable from any
    // other and the composer would stay enabled after access was revoked.
    const core = read('../src/lib/messages/messagesApiClient.js')
    assert.match(core, /constructor\(status, code, reason\)/)
    assert.match(core, /this\.reason = reason \|\| null;/)
    assert.match(core, /if \(typeof parsed\?\.reason === 'string'\) reason = parsed\.reason;/)
    assert.match(core, /throw new MessagesApiError\(res\.status, code, reason\);/)
    // Both write endpoints supply it.
    assert.match(read('../api/portal/messages-reply.js'), /res\.status\(409\)\.json\(\{ error: 'conflict', reason: out\.reason \}\)/)
    assert.match(read('../api/portal/messages-start.js'), /res\.status\(409\)\.json\(\{ error: 'conflict', reason: out\.reason \}\)/)
  })

  await t.test('no logging and no email exposure anywhere', () => {
    for (const s of [clientCode, polling, ...allCode]) {
      assert.doesNotMatch(s, /console\.(log|info|warn|error|debug)/)
      assert.doesNotMatch(s, /email/i)
    }
  })
})

test('inbox', async (t) => {
  await t.test('uses the real list endpoint through the client', () => {
    assert.match(inbox, /listPortalConversations/)
    assert.doesNotMatch(strip(inbox), /\/api\//, 'the component must not hardcode a path')
  })

  await t.test('cursor pagination is preserved and duplicate-safe', () => {
    assert.match(inbox, /getNextPageParam: \(lastPage\) => normalizeCursor\(lastPage\?\.next_cursor\) \?\? undefined/)
    assert.match(inbox, /appendPage\(acc, page\?\.conversations \|\| \[\]\)/)
    assert.doesNotMatch(strip(inbox), /offset|page_number/i)
  })

  await t.test('newest activity ordering comes from the server', () => {
    // The component never re-sorts: the RPC orders by last_message_at DESC.
    assert.doesNotMatch(strip(inbox), /\.sort\(/)
  })

  await t.test('unread state is not conveyed by color alone', () => {
    assert.match(inbox, /formatUnread\(unread\)/)
    assert.match(inbox, /unreadLabel\(unread\)/)
    assert.match(css, /\.ptl-msg-row-unread \.ptl-msg-row-subject \{ font-weight: 700; \}/)
  })

  await t.test('portal status is displayed, never re-derived from workflow state', () => {
    assert.match(inbox, /portalStatusLabel\(c\.status\)/)
    // 'waiting' and 'resolved' never appear: the browser never receives them.
    assert.doesNotMatch(strip(inbox), /'waiting'|'resolved'|Waiting/)
  })

  await t.test('no staff-only field is displayed', () => {
    for (const f of ['assigned', 'assignee', 'follow_up', 'flagged', 'events', 'internal']) {
      assert.doesNotMatch(strip(inbox), new RegExp(f, 'i'), `${f} must not be displayed`)
    }
  })

  await t.test('the preview is the server projection, not a client-derived one', () => {
    assert.match(inbox, /c\.latest_preview/)
    assert.doesNotMatch(strip(inbox), /\.slice\(0, 160\)|substring/)
  })

  await t.test('empty, loading, and error with retry all exist', () => {
    assert.match(inbox, /Loading your messages/)
    assert.match(inbox, /PORTAL_EMPTY_TITLE|PORTAL_EMPTY_BODY/)
    assert.match(inbox, /onClick=\{\(\) => refetch\(\)\}/)
    assert.match(inbox, /Try again/)
    // The empty state offers the action, and promises no escalation path.
    assert.match(inbox, /New message/)
    assert.doesNotMatch(PORTAL_EMPTY_BODY, /urgent|required|support ticket/i)
  })
})

test('thread', async (t) => {
  await t.test('uses the portal v2 endpoint and never v1', () => {
    assert.match(thread, /getPortalThreadPage/)
    assert.match(read('../api/portal/messages-thread.js'), /messages_portal_get_thread_v2/)
    assert.doesNotMatch(strip(thread), /messages_portal_get_thread\b/)
  })

  await t.test('newest page opens first and older pages prepend', () => {
    assert.match(thread, /initialPageParam: null/)
    assert.match(thread, /prependOlderPage\(acc, p\?\.messages \|\| \[\]\)/)
    assert.match(thread, /Load earlier messages/)
  })

  await t.test('has_more is authoritative through nextThreadCursor', () => {
    assert.match(thread, /getNextPageParam: \(lastPage\) => nextThreadCursor\(lastPage\) \?\? undefined/)
    assert.doesNotMatch(strip(thread), /length === limit|length >= limit/)
  })

  await t.test('no offset and no unbounded retrieval', () => {
    assert.doesNotMatch(strip(thread), /offset|page_number/i)
    assert.match(thread, /limit: PORTAL_THREAD_LIMIT_DEFAULT/)
  })

  await t.test('stale responses cannot replace a newer selection', () => {
    assert.match(thread, /queryKey: portalThreadQueryKey\(conversationId\)/)
    assert.match(thread, /threadPageIsCurrent\(newestPage, conversationId\)/)
    assert.match(thread, /queryFn: \(\{ pageParam, signal \}\)/)
    assert.match(thread, /signal/)
  })

  await t.test('loading an older page does not replace the newest page', () => {
    // Pages accumulate in the infinite query; page 0 stays the newest.
    assert.match(thread, /const newestPage = pages\[0\] \|\| null/)
  })

  await t.test('bodies are plain text: wrapped, line breaks kept, no HTML or Markdown', () => {
    const bubble = read('../src/components/shared/MessageBubble.jsx')
    const globalCss = read('../src/index.css')
    assert.match(thread, /MessageBubble/)
    assert.match(thread, /perspective="portal"/)
    assert.match(bubble, /<div className=\{`msg-bubble-body ptl-msg-body \$\{bodyClassName\}`\}>\{message\?\.body\}<\/div>/)
    assert.doesNotMatch(strip(thread + bubble), /dangerouslySetInnerHTML|innerHTML|\bmarkdown\b|\bmarked\b|\bremark\b/i)
    assert.match(globalCss, /\.msg-bubble-body \{[\s\S]*white-space: pre-wrap;[\s\S]*overflow-wrap: anywhere/)
  })
})

test('author display', async (t) => {
  await t.test('the server label is shown for both sides', () => {
    // author_label is 'You' or 'ASPIRE Team', projected by the RPC.
    assert.match(read('../src/components/shared/MessageBubble.jsx'), /message\?\.author_label/)
    const rpc = read('../supabase/migrations/20260716000006_messages_phase5_portal_thread_reverse_pagination.sql')
    assert.match(rpc, /'author_label', CASE WHEN p\.author_role = 'staff' THEN 'ASPIRE Team' ELSE 'You' END/)
  })

  await t.test('a staff name is secondary context only', () => {
    const bubble = read('../src/components/shared/MessageBubble.jsx')
    const globalCss = read('../src/index.css')
    assert.match(bubble, /fromStaff && message\?\.author_name/)
    assert.match(globalCss, /\.msg-bubble-author \{[\s\S]*font-size: 12\.5px;[\s\S]*font-weight: 700/)
    assert.match(globalCss, /\.msg-bubble-author-detail \{[\s\S]*font-size: 12px;[\s\S]*font-weight: 400/)
  })

  await t.test('no staff email is shown', () => {
    assert.doesNotMatch(strip(thread), /email/i)
  })

  await t.test('timestamps carry readable accessible labels', () => {
    const bubble = read('../src/components/shared/MessageBubble.jsx')
    assert.match(bubble, /formatFullTimestamp\(message\?\.created_at\)/)
    assert.match(bubble, /message from \$\{displayName\}, sent \$\{fullTime\}/)
    assert.match(bubble, /dateTime=\{message\?\.created_at \|\| undefined\}/)
    assert.match(bubble, /title=\{fullTime\}/)
  })
})

test('mark read', async (t) => {
  await t.test('fires only after the newest page renders for the current conversation', () => {
    assert.match(thread, /if \(!threadPageIsCurrent\(newestPage, conversationId\)\) return/)
    assert.match(thread, /const token = `\$\{conversationId\}:\$\{newestAt \|\| 'empty'\}`/)
    assert.match(thread, /if \(markedRef\.current === token\) return/)
  })

  await t.test('an older-page load never marks read', () => {
    // newestAt derives from page 0 only, so fetching older pages cannot change
    // the token and cannot re-trigger.
    assert.match(thread, /const newestAt = newestPage\?\.messages\?\.length/)
  })

  await t.test('no client timestamp and no client profile id', () => {
    assert.doesNotMatch(strip(workspace), /last_read_at|Date\.now|toISOString|profile_id/)
  })

  await t.test('unread clears and the total refreshes only after authoritative success', () => {
    const fn = workspace.slice(workspace.indexOf('const handleMarkRead'), workspace.indexOf('const selectConversation'))
    assert.match(fn, /await api\.markPortalConversationRead\(\{ conversationId: id \}\)/)
    assert.ok(fn.indexOf('await api.markPortalConversationRead') < fn.indexOf('refreshInbox()'),
      'the refresh must follow the awaited success')
    assert.match(workspace, /queryKey: \['portal_messages_unread'\]/)
  })

  await t.test('failure keeps unread recoverable and never falsely clears', () => {
    const fn = workspace.slice(workspace.indexOf('const handleMarkRead'), workspace.indexOf('const selectConversation'))
    assert.match(fn, /\} catch \{/)
    // No optimistic local clearing anywhere.
    assert.doesNotMatch(fn, /setUnread|unread_count = 0|setQueryData/)
  })

  await t.test('read state is per participant, by contract', () => {
    // The endpoint advances only this participant's pointer; the browser cannot
    // name another profile.
    assert.match(read('../api/portal/messages-mark-read.js'), /p_actor_profile_id: caller\.profile\.id/)
    // UL-PORTAL: the actor kind is now the VERIFIED caller's kind rather than a
    // hardcoded 'student', because a unit leader may also mark a thread read. The
    // security property is unchanged and is what this asserts: the kind comes from
    // the server-verified caller, never from the request body.
    assert.match(read('../api/portal/messages-mark-read.js'), /p_actor_kind: caller\.actorKind/);
    assert.doesNotMatch(read('../api/portal/messages-mark-read.js'), /p_actor_kind: (req|parsed|body)/);
  })
})

test('New message', async (t) => {
  await t.test('the recipient is fixed and there is no participant picker', () => {
    assert.equal(PORTAL_RECIPIENT_LABEL, 'ASPIRE Team')
    assert.match(newMsg, /<span className="ptl-field-label">To<\/span>/)
    assert.match(newMsg, /\{PORTAL_RECIPIENT_LABEL\}/)
    assert.doesNotMatch(strip(newMsg), /participant_profile_id|recipient_profile_id|recipient_email|recipient_kind/i)
    assert.doesNotMatch(strip(newMsg), /messages-staff-options|searchParticipants|<input[^>]*search/i)
  })

  await t.test('subject validation is trimmed, required, and 3 to 120', () => {
    assert.match(newMsg, /validateSubjectValue\(subject\)/)
    assert.match(newMsg, /subject: subject\.trim\(\)/)
    assert.match(newMsg, /maxLength=\{SUBJECT_MAX_CHARS\}/)
    // The shared validator is the authority; these pin the limits it enforces.
    assert.equal(SUBJECT_MIN_CHARS, 3)
    assert.equal(SUBJECT_MAX_CHARS, 120)
    assert.equal(validateSubjectValue('  ').ok, false, 'whitespace only is rejected')
    assert.equal(validateSubjectValue('ab').ok, false, 'under 3 is rejected')
    assert.equal(validateSubjectValue('abc').ok, true)
    assert.equal(validateSubjectValue('x'.repeat(121)).ok, false, 'over 120 is rejected')
    assert.equal(validateBodyValue('   ').ok, false, 'whitespace-only body is rejected')
    assert.equal(validateBodyValue('hi').ok, true)
    assert.equal(validateBodyValue('x'.repeat(5001)).ok, false, 'over 5000 is rejected')
    assert.equal(MESSAGE_MAX_BODY_CHARS, 5000)
  })

  await t.test('body validation is trimmed, required, and capped at 5000', () => {
    assert.match(newMsg, /validateBodyValue\(body\)/)
    assert.match(newMsg, /maxLength=\{MESSAGE_MAX_BODY_CHARS\}/)
    assert.match(newMsg, /body: normalized/)
    assert.match(newMsg, /normalizeBody\(body\)/)
  })

  await t.test('character counts are shown for subject and body', () => {
    assert.match(newMsg, /of \$\{SUBJECT_MAX_CHARS\} characters/)
    assert.match(newMsg, /of \$\{MESSAGE_MAX_BODY_CHARS\} characters/)
  })

  await t.test('the approved category set is offered, with null for Uncategorized', () => {
    assert.equal(PORTAL_CATEGORY_OPTIONS.length, 8)
    assert.deepEqual(PORTAL_CATEGORY_OPTIONS[0], { value: null, label: 'Uncategorized' })
    for (const c of MESSAGE_CATEGORIES) {
      assert.ok(PORTAL_CATEGORY_OPTIONS.some((o) => o.value === c), `missing category ${c}`)
    }
    assert.match(newMsg, /const toCategory = \(v\) => \(v === '' \? null : v\)/)
    assert.match(newMsg, /category: toCategory\(category\)/)
  })

  await t.test('duplicate submit is blocked by a SYNCHRONOUS ref, not React state', () => {
    // Visual inspection caught this: three clicks in one tick produced three
    // start requests, because setPending does not apply until the next render,
    // so every same-tick handler read pending === false. A ref flips
    // immediately, so one activation is one request.
    assert.match(newMsg, /const submittingRef = useRef\(false\)/)
    assert.match(newMsg, /if \(submittingRef\.current \|\| pending\) return/)
    assert.match(newMsg, /submittingRef\.current = true/)
    assert.match(newMsg, /\} finally \{\s*\n\s*submittingRef\.current = false/)
    assert.match(newMsg, /disabled=\{disabled\}/)
    assert.match(newMsg, /const disabled = pending \|\| !subjectCheck\.ok \|\| !bodyCheck\.ok/)
  })

  await t.test('success clears, closes, selects the authoritative conversation, refreshes', () => {
    assert.match(newMsg, /setSubject\(''\); setCategory\(''\); setBody\(''\)/)
    assert.match(newMsg, /onSent\?\.\(out\)/)
    assert.match(newMsg, /onClose\?\.\(\)/)
    assert.match(workspace, /if \(out\?\.conversation_id\) \{/)
    // ASPIRE-COMPASS: selection is a navigation to /portal/messages/:id.
    assert.match(workspace, /onSelectThread\?\.\(out\.conversation_id\)/)
    assert.match(workspace, /refreshInbox\(\)/)
  })

  await t.test('the announcement is the server confirmation, never a delivery claim', () => {
    assert.match(newMsg, /announce\?\.\(out\?\.confirmation \|\| PORTAL_SEND_CONFIRMATION\)/)
    assert.equal(PORTAL_SEND_CONFIRMATION, 'Your message was sent to the ASPIRE Team.')
    // The endpoint returns this exact string.
    assert.match(read('../api/portal/messages-start.js'), /confirmation: 'Your message was sent to the ASPIRE Team\.'/)
    assert.doesNotMatch(PORTAL_SEND_CONFIRMATION, /email|notified|delivered|inbox/i)
  })

  await t.test('failure preserves the form and maps errors safely', () => {
    const c = newMsg.slice(newMsg.indexOf('} catch (e2)'), newMsg.indexOf('} finally'))
    assert.doesNotMatch(c, /setSubject|setBody|setCategory/, 'the form must be preserved')
    assert.match(c, /mapPortalMessagesError\(e2\?\.status\)/)
    // Must key on `reason`, not `code`: every 409 carries error: 'conflict'.
    assert.match(c, /mapPortalConflict\(e2\?\.reason\)/)
  })
})

test('reply', async (t) => {
  await t.test('the safety notice is verbatim', () => {
    assert.equal(PORTAL_SAFETY_NOTICE,
      'ASPIRE Messages is not monitored continuously. Do not include patient names, '
      + 'medical record numbers, or other identifying information. For urgent '
      + 'patient-care or safety concerns, follow your unit\'s established escalation process.')
    assert.match(read('../src/portal/messages/PortalMessagesWorkspace.jsx'), /\{PORTAL_SAFETY_NOTICE\}/)
    assert.doesNotMatch(reply, /PORTAL_SAFETY_NOTICE/)
    assert.match(newMsg, /\{PORTAL_SAFETY_NOTICE\}/)
  })

  await t.test('uses the real reply contract', () => {
    assert.match(reply, /replyToPortalConversation\(\{/)
    assert.match(reply, /conversationId,/)
    assert.match(reply, /body: normalized,/)
    assert.match(clientCode, /body: \{ conversation_id: conversationId, body \}/)
  })

  await t.test('sending is disabled for every unsafe condition', () => {
    assert.match(reply, /const disabled = !conversationId \|\| pending \|\| !check\.ok \|\| accessLost/)
  })

  await t.test('duplicate send is blocked by a synchronous ref, and nothing is optimistic', () => {
    assert.match(reply, /const sendingRef = useRef\(false\)/)
    assert.match(reply, /if \(sendingRef\.current \|\| pending\) return/)
    assert.match(reply, /sendingRef\.current = true/)
    assert.match(reply, /\} finally \{\s*\n\s*sendingRef\.current = false/)
    assert.doesNotMatch(strip(reply), /setMessages|optimistic|tempId|setQueryData/)
  })

  await t.test('success clears the draft and announces the server confirmation', () => {
    assert.match(reply, /setBody\(''\)/)
    assert.match(reply, /announce\?\.\(out\?\.confirmation \|\| PORTAL_SEND_CONFIRMATION\)/)
    assert.match(read('../api/portal/messages-reply.js'), /confirmation: 'Your message was sent to the ASPIRE Team\.'/)
  })

  await t.test('failure preserves the draft, including on 409', () => {
    const c = reply.slice(reply.indexOf('} catch (e2)'), reply.indexOf('} finally'))
    assert.doesNotMatch(c, /setBody\(''\)/, 'the draft must survive every failure')
    assert.match(c, /if \(e2\?\.status === 409\)/)
    assert.match(c, /if \(portalConflictIsAccessLost\(e2\?\.reason\)\) setAccessLost\(true\)/)
    assert.match(c, /refreshOnly: true/)
  })

  await t.test('a conflict reason is never shown verbatim', () => {
    assert.equal(portalConflictIsAccessLost('no_active_participant'), true)
    assert.equal(portalConflictIsAccessLost('something_else'), false)
    assert.match(mapPortalConflict('no_active_participant'), /no longer active/i)
    assert.match(mapPortalConflict('other'), /changed/i)
    for (const r of ['no_active_participant', 'other']) {
      assert.doesNotMatch(mapPortalConflict(r), /no_active_participant|MS4|SQLSTATE/)
    }
  })

  await t.test('reopening is reflected, never performed in the browser', () => {
    // The server reports `reopened`; the browser only refetches.
    assert.match(read('../api/portal/messages-reply.js'), /reopened: out\.result\.reopened === true/)
    assert.doesNotMatch(strip(reply), /setStatus|reopen\(/)
    assert.match(workspace, /refreshThread\(selectedId\)/)
  })

  await t.test('a Closed conversation stays readable and explains reopening', () => {
    assert.match(reply, /closed && !accessLost/)
    assert.match(reply, /PORTAL_CLOSED_NOTICE/)
    assert.match(constants, /Sending a reply will reopen it if it still needs attention/)
  })

  await t.test('the draft lives only in React state', () => {
    for (const s of allCode) {
      assert.doesNotMatch(s, /localStorage|sessionStorage|indexedDB|IndexedDB/)
    }
    // Polling cannot clear it: the draft is not derived from a query result.
    assert.match(reply, /const \[body, setBody\] = useState\(''\)/)
  })
})

test('status mapping', async (t) => {
  await t.test('the backend already maps status, and the browser preserves it', () => {
    // message_portal_status_label(): resolved -> Closed, everything else -> Open.
    // So waiting reaches the browser as Open and can never render as Waiting.
    const p3 = read('../supabase/migrations/20260716000002_messages_phase3_api_foundation.sql')
    assert.match(p3, /SELECT CASE WHEN p_status = 'resolved' THEN 'Closed' ELSE 'Open' END/)
    assert.match(p3, /public\.message_portal_status_label\(c\.status\) AS status/)
    assert.match(read('../supabase/migrations/20260716000006_messages_phase5_portal_thread_reverse_pagination.sql'),
      /public\.message_portal_status_label\(c\.status\)/)
  })

  await t.test('open and waiting are Open; resolved is Closed', () => {
    assert.equal(portalStatusLabel('Open'), 'Open')
    assert.equal(portalStatusLabel('Closed'), 'Closed')
    assert.equal(portalStatusIsClosed('Closed'), true)
    assert.equal(portalStatusIsClosed('Open'), false)
    // Anything unexpected fails safe to Open rather than inventing a state.
    assert.equal(portalStatusLabel('waiting'), 'Open')
    assert.equal(portalStatusLabel(undefined), 'Open')
  })

  await t.test('the staff-only Waiting label never appears in portal code', () => {
    // Executable code only: the constants file's comment legitimately explains
    // why the staff Waiting label cannot reach a student.
    for (const s of [strip(constants), ...allCode]) {
      assert.doesNotMatch(s, /Waiting/)
    }
  })
})

test('polling', async (t) => {
  await t.test('30s active, 60s idle unread', () => {
    assert.match(polling, /export const PORTAL_ACTIVE_POLL_MS = 30 \* 1000/)
    assert.match(polling, /export const PORTAL_IDLE_UNREAD_POLL_MS = 60 \* 1000/)
    assert.match(workspace, /intervalMs: PORTAL_ACTIVE_POLL_MS/)
    assert.match(workspace, /refreshMs=\{active \? PORTAL_ACTIVE_POLL_MS : false\}/)
  })

  await t.test('polling pauses while hidden and refreshes on focus', () => {
    assert.match(polling, /typeof document === 'undefined' \? true : !document\.hidden/)
    assert.match(polling, /document\.addEventListener\('visibilitychange', sync\)/)
    assert.match(polling, /window\.addEventListener\('focus', sync\)/)
    assert.match(polling, /refetchInterval: enabled && visible \? intervalMs : false/)
    assert.match(polling, /refetchOnWindowFocus: enabled/)
  })

  await t.test('listeners are cleaned up and no setInterval is used', () => {
    assert.match(polling, /document\.removeEventListener\('visibilitychange', sync\)/)
    assert.match(polling, /window\.removeEventListener\('focus', sync\)/)
    assert.match(polling, /window\.removeEventListener\('resize', onResize\)/)
    assert.doesNotMatch(strip(polling), /setInterval/)
    for (const s of allCode) assert.doesNotMatch(s, /setInterval/)
  })

  await t.test('no Supabase Realtime', () => {
    // Executable code only: the polling file's header comment says it uses no
    // Realtime, which is the very claim under test.
    for (const s of [strip(polling), clientCode, ...allCode]) {
      assert.doesNotMatch(s, /realtime|\.channel\(|\.subscribe\(/i)
    }
  })

  await t.test('background refresh preserves state and shows no full loading state', () => {
    // Selection is URL state (ASPIRE-COMPASS); pagination and drafts remain
    // component state. None of them derive from query results, so a
    // background refetch can never clear them.
    assert.match(workspace, /const selectedId = threadId/)
    // isLoading is the first-load flag only; a background refetch does not set it.
    assert.match(inbox, /if \(isLoading\)/)
    assert.match(thread, /if \(isLoading\)/)
    assert.doesNotMatch(strip(inbox), /isFetching \?/)
    assert.doesNotMatch(strip(thread), /isFetching \?/)
  })
})

test('responsive foundation', async (t) => {
  await t.test('desktop is a readable list beside a flexible thread', () => {
    // Corrected: 320px read as a cramped inbox against an oversized thread.
    assert.match(css, /\.ptl-msg-split \{ display: grid; grid-template-columns: 360px 1fr/)
    // Convergence: Unit Leader full Messages now uses the available portal width.
    assert.match(css, /\.ptl-msg-workspace \{ width: 100%; max-width: none; margin-left: 0; margin-right: 0; \}/)
  })

  await t.test('tablet keeps a usable split', () => {
    assert.match(css, /@media \(max-width: 1000px\) \{\s*\n\s*\.ptl-msg-split \{ grid-template-columns: 300px 1fr/)
  })

  await t.test('phone is list-first and never a compressed two-column split', () => {
    assert.match(css, /@media \(max-width: 760px\) \{[\s\S]*?\.ptl-msg-split, \.ptl-msg-split-narrow \{ grid-template-columns: 1fr;/)
    // The JS breakpoint must equal the CSS one, or widths between them render a
    // two-column grid with only one pane filled.
    assert.match(polling, /export const PORTAL_MOBILE_MAX_WIDTH = 760;/)
    assert.match(css, /@media \(max-width: 760px\)/)
    assert.match(workspace, /const showList = !narrow \|\| mobileView === 'list'/)
    assert.match(workspace, /const showThread = !narrow \|\| mobileView === 'thread'/)
    // ASPIRE-COMPASS: the phone view derives from the URL; a thread id means
    // the thread view.
    assert.match(workspace, /const mobileView = threadId \? 'thread' : 'list'/)
  })

  await t.test('Back to messages exists and returns to the list', () => {
    assert.match(thread, /Back to messages/)
    assert.match(workspace, /onBack=\{\(\) => onBackToList\?\.\(\)\}/)
    assert.match(workspace, /showBack=\{narrow\}/)
  })

  await t.test('returning to the list preserves pagination and drafts', () => {
    // Back navigates to /portal/messages; the workspace stays mounted, so the
    // thread cache, its pages, and any draft survive. Nothing here clears
    // conversation state on back beyond the selection itself.
    const back = workspace.slice(workspace.indexOf('onBack='), workspace.indexOf('onBack=') + 60)
    assert.doesNotMatch(back, /setBody|setConversation\(null\)/)
  })

  await t.test('New message and the composer stay reachable on a phone', () => {
    // justify-content was inert on the old display:block button; the primary now
    // flexes to fill the row beside the unread chip.
    assert.match(css, /\.ptl-msg-new \{ flex: 1; \}/)
    assert.match(css, /\.ptl-msg-scroll \{ max-height: none; \}/)
  })

  await t.test('an unmeasured viewport width is not treated as a phone', () => {
    // Visual inspection caught this: innerWidth can read 0 before layout, which
    // collapsed a desktop into the mobile list-first view.
    assert.match(polling, /const isNarrowWidth = \(width, maxWidth\) => width > 0 && width <= maxWidth;/)
    assert.match(polling, /isNarrowWidth\(window\.innerWidth, maxWidth\)/)
    assert.match(polling, /\/\/ Sync once on mount/)
  })

  await t.test('long content wraps instead of overflowing horizontally', () => {
    assert.match(css, /\.ptl-msg-pane \{ min-width: 0; \}/)
    assert.match(css, /\.ptl-msg-row-subject \{[^}]*overflow-wrap: anywhere/)
    assert.match(css, /\.ptl-msg-thread-subject \{[^}]*overflow-wrap: anywhere/)
    assert.match(css, /\.ptl-msg-body \{[^}]*overflow-wrap: anywhere/)
  })
})

test('accessibility foundation', async (t) => {
  await t.test('conversation rows are real buttons with selected semantics', () => {
    assert.match(inbox, /<button\s*\n\s*key=\{c\.id\}\s*\n\s*type="button"/)
    assert.match(inbox, /aria-current=\{selected \? 'true' : undefined\}/)
    assert.match(inbox, /role="list"/)
    assert.match(inbox, /role="listitem"/)
  })

  await t.test('focus is visible and touch targets are adequate', () => {
    assert.match(css, /\.ptl-msg-row:focus-visible \{ outline: 2px solid #1D2567; outline-offset: 2px; \}/)
    assert.match(css, /\.ptl-msg-row \{[\s\S]*?min-height: 44px;/)
    assert.match(css, /\.ptl-msg-back \{[\s\S]{0,200}?min-height: 44px/)
    assert.match(css, /\.ptl-msg-loadmore, \.ptl-msg-loadearlier \{ align-self: center; min-height: 44px; \}/)
  })

  await t.test('the drawer is a labeled modal that Escape closes with focus return', () => {
    assert.match(newMsg, /role="dialog"/)
    assert.match(newMsg, /aria-modal="true"/)
    assert.match(newMsg, /aria-labelledby="ptl-newmsg-title"/)
    assert.match(newMsg, /id="ptl-newmsg-title"/)
    assert.match(newMsg, /if \(e\.key === 'Escape' && !pending\) \{ onClose\?\.\(\); return \}/)
    assert.match(newMsg, /if \(prev\?\.focus\) prev\.focus\(\)/)
    assert.match(workspace, /returnFocusRef=\{newBtnRef\}/)
    // Focus is trapped while open.
    assert.match(newMsg, /if \(e\.shiftKey && document\.activeElement === first\)/)
  })

  await t.test('every form control is labeled', () => {
    for (const id of ['ptl-newmsg-subject', 'ptl-newmsg-category', 'ptl-newmsg-body']) {
      assert.ok(newMsg.includes(`htmlFor="${id}"`), `missing label for ${id}`)
      assert.ok(newMsg.includes(`id="${id}"`), `missing id ${id}`)
    }
    assert.match(reply, /htmlFor="ptl-reply-body"/)
    assert.match(reply, /id="ptl-reply-body"/)
  })

  await t.test('validation is accessible', () => {
    assert.match(newMsg, /aria-invalid=\{touched && !subjectCheck\.ok \? 'true' : undefined\}/)
    assert.match(newMsg, /aria-invalid=\{touched && !bodyCheck\.ok \? 'true' : undefined\}/)
    assert.match(newMsg, /aria-describedby="ptl-newmsg-subject-help"/)
    assert.match(newMsg, /aria-describedby="ptl-newmsg-body-help"/)
  })

  await t.test('send and error feedback is announced', () => {
    assert.match(workspace, /role="status" aria-live="polite"/)
    assert.match(newMsg, /role="alert"/)
    assert.match(reply, /role="alert"/)
  })

  await t.test('icon buttons have accessible names', () => {
    assert.match(newMsg, /aria-label="Close new message"/)
    assert.match(newMsg, /<X size=\{16\} aria-hidden="true" \/>/)
    // Decorative icons are hidden from assistive technology.
    for (const s of all) {
      const icons = [...s.matchAll(/<(MessageSquarePlus|RefreshCw|ChevronLeft|Send|X) size=\{\d+\}([^/]*)\/>/g)]
      for (const m of icons) {
        assert.match(m[2], /aria-hidden="true"/, `icon ${m[1]} must be aria-hidden or labeled`)
      }
    }
  })

  await t.test('unread and Closed are not color-only', () => {
    assert.match(inbox, /<span style=\{srOnly\}>\{unread > 0 \? unreadLabel\(unread\) : ''\}<\/span>/)
    assert.match(inbox, /\{portalStatusLabel\(c\.status\)\}/)
    assert.match(thread, /\{portalStatusLabel\(conversation\?\.status\)\}/)
  })

  await t.test('copy is exact and restrained', () => {
    assert.equal(PORTAL_SUBTITLE, 'Contact the ASPIRE Team about your ASPIRE experience.')
    assert.equal(PORTAL_NO_SELECTION, 'Select a conversation to review your messages with the ASPIRE Team.')
    // UL-POLISH: the copy is selected by variant; the student strings above
    // stay byte-identical and remain the default branch.
    assert.match(thread, /variant === 'unit_leader' \? UL_PORTAL_NO_SELECTION : PORTAL_NO_SELECTION/)
    assert.match(workspace, /variant === 'unit_leader' \? UL_PORTAL_SUBTITLE : PORTAL_SUBTITLE/)
    // No response-time promise and no continuous-monitoring implication.
    for (const s of [PORTAL_SUBTITLE, PORTAL_NO_SELECTION, PORTAL_EMPTY_BODY]) {
      assert.doesNotMatch(s, /respond within|response time|24\/7|monitored|immediately/i)
    }
  })
})

test('privacy', async (t) => {
  await t.test('nothing is logged, persisted, or tracked', () => {
    for (const s of [clientCode, polling, ...allCode]) {
      assert.doesNotMatch(s, /console\./)
      assert.doesNotMatch(s, /localStorage|sessionStorage|indexedDB/i)
      assert.doesNotMatch(s, /analytics|telemetry|gtag|posthog|segment|track\(/i)
    }
  })

  await t.test('no dangerous HTML and no Markdown rendering', () => {
    for (const s of allCode) {
      assert.doesNotMatch(s, /dangerouslySetInnerHTML|innerHTML/)
      assert.doesNotMatch(s, /\bmarkdown\b|\bremark\b|\bmarked\b|\brehype\b/i)
    }
  })

  await t.test('no email is displayed anywhere', () => {
    for (const s of allCode) assert.doesNotMatch(s, /email/i)
  })
})

test('dormancy and regression', async (t) => {
  await t.test('only the two activated portals mount the workspace', () => {
    // Phase 5B-ii activated Messages for the Student Portal through PortalApp.
    // UL-PORTAL activated it for the Unit Leader Portal, which mounts the SAME
    // workspace component so the approved Messages design is shared rather than
    // reimplemented. The staff shell, the Academic Partner Portal, and the staff
    // app still must not reach it.
    assert.match(read('../src/portal/PortalApp.jsx'), /import PortalMessagesWorkspace from '\.\/messages\/PortalMessagesWorkspace'/)
    assert.match(read('../src/portal/UnitLeaderPortal.jsx'), /import PortalMessagesWorkspace from '\.\/messages\/PortalMessagesWorkspace'/)
    for (const f of ['../src/portal/PortalShell.jsx', '../src/portal/StudentPortal.jsx',
      '../src/portal/AcademicPartnerPortal.jsx', '../src/App.jsx']) {
      assert.doesNotMatch(read(f), /PortalMessagesWorkspace/, `${f} must not mount the workspace`)
    }
  })

  await t.test('Student Portal navigation exposes Messages through guarded URLs only', () => {
    const papp = read('../src/portal/PortalApp.jsx')
    assert.match(papp, /<PortalNav\s[\s\S]*?view=\{studentView\}/)
    // ASPIRE-COMPASS (owner-approved): /portal/messages and
    // /portal/messages/:threadId are real URLs handled INSIDE the guarded
    // /portal/* route. They grant nothing: every messages request still
    // verifies the caller's JWT server-side. No other file mints the path.
    assert.match(papp, /navigate\(`\/portal\/messages\/\$\{id\}`\)/)
    assert.doesNotMatch(strip(read('../src/portal/PortalShell.jsx')), /\/portal\/messages/)
  })

  await t.test('the portal unread badge is mounted in the student nav only', () => {
    assert.match(polling, /export function usePortalUnreadCount/)
    assert.match(read('../src/portal/PortalApp.jsx'), /const unread = usePortalUnreadCount\(\{/)
    // Never in the staff sidebar, and never for another portal role.
    assert.doesNotMatch(read('../src/components/UnifiedNav.jsx'), /usePortalUnreadCount/)
    assert.doesNotMatch(read('../src/portal/UnitLeaderPortal.jsx'), /usePortalUnreadCount/)
  })

  await t.test('the workspace is reachable only through dormant Messages modules', () => {
    // Its only importers are itself, its own children, and tests.
    assert.match(workspace, /import PortalMessagesInbox from '\.\/PortalMessagesInbox'/)
    assert.match(workspace, /import PortalMessagesThread from '\.\/PortalMessagesThread'/)
  })

  await t.test('no debug route and no feature flag', () => {
    for (const s of allCode) {
      assert.doesNotMatch(s, /debug|__DEV|featureFlag|VITE_ENABLE|localhost/i)
    }
  })

  await t.test('all seven migrations are present and the applied ones intact', () => {
    const names = ['20260716000000_messages_phase1_schema_foundation',
      '20260716000001_messages_phase2_notification_delivery_foundation',
      '20260716000002_messages_phase3_api_foundation',
      '20260716000003_messages_phase3_delivery_invariant_fix',
      '20260716000004_messages_phase4_staff_inbox_filter_modes',
      '20260716000005_messages_phase4_staff_thread_reverse_pagination',
      '20260716000006_messages_phase5_portal_thread_reverse_pagination']
    for (const n of names) assert.ok(read(`../supabase/migrations/${n}.sql`).length > 0, `missing ${n}`)
  })

  await t.test('staff Messages and the other Connect tabs are untouched', () => {
    const connect = read('../src/pages/Connect.jsx')
    assert.match(connect, /const canUseMessages = \['owner', 'admin'\]\.includes\(userProfile\?\.role\)/)
    assert.match(connect, /<MessagesWorkspace refreshKey=\{refreshKey\} onOpenStudent=\{onNavigateToStudent\} \/>/)
    assert.match(connect, /<ContactsView refreshKey=\{refreshKey\} \/>/)
    assert.match(connect, /<OutreachView cohortId=\{cohortId\}/)
    assert.match(connect, /<AutomationView active=\{activeSubTab === 'broadcasts'\}/)
    assert.match(read('../api/messages-staff-list.js'), /messages_staff_list_conversations_v2/)
    assert.match(read('../api/messages-staff-thread.js'), /messages_staff_get_thread_v2/)
  })

  await t.test('Phase 5A pagination is preserved', () => {
    assert.match(read('../api/portal/messages-thread.js'), /messages_portal_get_thread_v2/)
    assert.match(read('../src/lib/messages/portalThreadState.js'), /export function prependOlderPage/)
  })

  await t.test('portal components live outside the staff Connect tree', () => {
    for (const f of ['PortalMessagesWorkspace.jsx', 'PortalMessagesInbox.jsx',
      'PortalMessagesThread.jsx', 'PortalNewMessageDrawer.jsx', 'PortalReplyComposer.jsx']) {
      assert.ok(readFileSync(join(here, `../src/portal/messages/${f}`), 'utf8').length > 0)
    }
  })
})

test('hygiene', async (t) => {
  await t.test('no em dash anywhere in Phase 5B-i', () => {
    for (const s of [client, polling, constants, css, ...all]) {
      assert.doesNotMatch(s, /\u2014/)
    }
  })

  await t.test('uses ASPIRE, never the deprecated long form', () => {
    for (const s of [client, polling, constants, ...all]) {
      assert.doesNotMatch(s, /ASPIRE Program/)
    }
  })
})
