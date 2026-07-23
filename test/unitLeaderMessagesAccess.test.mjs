// UL-PORTAL: guards for admitting a Unit Leader to the Messages read path.
//
// The three read endpoints and mark-read now accept EITHER a student or a unit
// leader. The critical property is that Student Portal behavior is unchanged: the
// generalized caller returns the student result untouched, and a student whose
// access is merely broken keeps its own denial rather than being re-evaluated as a
// unit leader.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')

const auth      = read('api/lib/messagesAuth.js')
const list      = read('api/portal/messages-list.js')
const thread    = read('api/portal/messages-thread.js')
const unread    = read('api/portal/messages-unread-count.js')
const markRead  = read('api/portal/messages-mark-read.js')
const reply     = read('api/portal/messages-reply.js')
const start     = read('api/portal/messages-start.js')

const READ_ENDPOINTS = {
  'messages-list.js': list,
  'messages-thread.js': thread,
  'messages-unread-count.js': unread,
}
const GENERALIZED = { ...READ_ENDPOINTS, 'messages-mark-read.js': markRead }

// ── The generalized caller ──────────────────────────────────────────────────
test('verifyPortalMessagesCaller exists and reports the actor kind', () => {
  assert.match(auth, /export async function verifyPortalMessagesCaller/)
  assert.match(auth, /actorKind: 'student'/)
  assert.match(auth, /actorKind: 'unit_leader'/)
})

test('STUDENT BEHAVIOR UNCHANGED: a successful student result is returned untouched', () => {
  const fn = auth.slice(
    auth.indexOf('export async function verifyPortalMessagesCaller'),
    auth.indexOf('export async function verifyPortalStudentCaller'))
  assert.match(fn, /const asStudent = await verifyPortalStudentCaller\(req\)/)
  assert.match(fn, /if \(asStudent\.ok\) \{\s*\n\s*return \{ \.\.\.asStudent, actorKind: 'student'/)
  // Student is tried FIRST.
  assert.ok(
    fn.indexOf('verifyPortalStudentCaller') < fn.indexOf('verifyPortalUnitLeaderCaller'),
    'the student path must be evaluated first')
})

test('a BROKEN student keeps its own denial, never falls through to unit leader', () => {
  const fn = auth.slice(
    auth.indexOf('export async function verifyPortalMessagesCaller'),
    auth.indexOf('export async function verifyPortalStudentCaller'))
  // Only the "no student role at all" case is reconsidered.
  assert.match(fn, /if \(asStudent\.reason !== 'no_active_student_grant'\) return asStudent/)
  // So a revoked student link (no_active_student_link) is NOT re-evaluated.
  assert.doesNotMatch(fn, /no_active_student_link[\s\S]{0,80}verifyPortalUnitLeaderCaller/)
})

test('the unit leader branch fails closed and leaks no extra fields', () => {
  const fn = auth.slice(
    auth.indexOf('export async function verifyPortalMessagesCaller'),
    auth.indexOf('export async function verifyPortalStudentCaller'))
  assert.match(fn, /if \(!asUnitLeader\.ok\) \{[\s\S]{0,160}return \{ ok: false, status: asUnitLeader\.status, reason: asUnitLeader\.reason \}/)
  // A unit leader has no student ids.
  assert.match(fn, /studentIds: \[\]/)
})

test('the caller does NOT re-derive per-conversation authorization', () => {
  // That belongs to the RPCs, which gate both kinds. Duplicating it here would be a
  // second place to get wrong.
  assert.match(auth, /only answers "may this account use Messages at all"/)
})

// ── Endpoint wiring ─────────────────────────────────────────────────────────
test('every generalized endpoint uses the new caller and none uses the old one', () => {
  for (const [name, src] of Object.entries(GENERALIZED)) {
    assert.match(src, /verifyPortalMessagesCaller\(req\)/, name)
    assert.doesNotMatch(src, /verifyPortalStudentCaller/, name)
  }
})

test('the read endpoints still run as the signed-in caller, not service role', () => {
  // This is what makes the RPC resolve auth.uid() to the viewer.
  for (const [name, src] of Object.entries(READ_ENDPOINTS)) {
    assert.match(src, /getUserScopedDb\(req\)/, name)
    if (name === 'messages-list.js' || name === 'messages-thread.js') continue // metadata decoration is covered below
    assert.doesNotMatch(src, /getServiceDb\(\)/, name)
  }
})

test('messages-thread: access stays with the user-scoped RPC; service role only decorates metadata', () => {
  assert.match(thread, /db\.rpc\('messages_portal_get_thread_v2'/)
  assert.match(thread, /const db = getUserScopedDb\(req\)/)
  assert.match(thread, /classifyPortalConversations\(svc, \[conversation\], caller\.profile\.id\)/)
  assert.match(thread, /Classification is response metadata only/)
})

test('messages-list: conversation ACCESS stays with the user-scoped RPC; service role only decorates metadata', () => {
  const src = READ_ENDPOINTS['messages-list.js']
  // The conversation set itself still comes from the caller-scoped RPC.
  assert.match(src, /db\.rpc\('messages_portal_list_conversations'/)
  assert.match(src, /const db = getUserScopedDb\(req\)/)
  // General thread metadata is attached only after the user-scoped RPC returns
  // the authorized page. It never selects the conversation set itself.
  assert.match(src, /classifyPortalConversations\(svc, conversations, caller\.profile\.id\)/)
  assert.match(src, /Classification is response metadata only/)
  const svcUses = (src.match(/getServiceDb\(\)/g) || []).length
  assert.equal(svcUses, 1, 'service client only in response metadata decoration')
  assert.doesNotMatch(src, /svc\s*\.\s*from\('conversations'\)|svc\s*\.\s*from\('messages'\)/)
})

test('mark-read passes the caller actor kind, never a hardcoded student', () => {
  assert.match(markRead, /p_actor_kind: caller\.actorKind/)
  assert.doesNotMatch(markRead, /p_actor_kind: 'student'/)
})

test('REPLY is generalized and routes a direct thread to the other portal party', () => {
  assert.match(reply, /verifyPortalMessagesCaller\(req\)/)
  assert.doesNotMatch(reply, /verifyPortalStudentCaller/)
  // The counterpart comes from the conversation's own participant rows.
  assert.match(reply, /loadDirectCounterpart\(db, conversationId, caller\.profile\.id\)/)
  assert.match(reply, /replyForPortalDirect\(/)
  // A single-participant thread still uses the unchanged student to staff path.
  assert.match(reply, /if \(counterpart\) \{/)
  assert.match(reply, /await replyForPortal\(/)
})

test('the direct reply passes the VERIFIED actor kind, never a client value', () => {
  assert.match(reply, /actorKind: caller\.actorKind/)
  const body = reply.slice(reply.indexOf('replyForPortalDirect('), reply.indexOf('if (direct.rpcError)'))
  assert.doesNotMatch(body, /req\.body|parsed\.body/)
})

test('student-linked thread creation remains on the existing student-only endpoint', () => {
  // startDirectThreadForUnitLeader exists in the service layer but no route calls
  // it yet, so a unit leader cannot create a thread. messages-start.js remains
  // student-only, which is the safe state.
  assert.match(start, /verifyPortalStudentCaller/)
  assert.doesNotMatch(start, /startDirectThreadForUnitLeader/)
})

test('the direct service functions never trust a client-supplied identity', () => {
  const svc = read('lib/server/messages/conversationService.js')
  const direct = svc.slice(svc.indexOf('export async function replyForPortalDirect'))
  // Recipient identity comes from the resolved counterpart only.
  assert.match(direct, /senderProfileId: profile\.id/)
  assert.match(direct, /counterpart,/)
  // The sender is never the recipient.
  assert.match(svc, /counterpart\.profileId === senderProfileId/)
  assert.match(svc, /sender_is_recipient/)
  // And the delivery payload is still built by the shared allowlist.
  assert.match(direct, /buildDeliveryPayload\(\{/)
})

test('direct threads use the two new delivery event types, correctly directed', () => {
  const svc = read('lib/server/messages/conversationService.js')
  assert.match(svc, /actorKind === 'unit_leader'\s*\n\s*\? 'unit_leader_message'\s*\n\s*: 'student_to_unit_leader_message'/)
  // Both route to the other portal participant, never to staff.
  assert.match(svc, /recipientKind: 'portal_user'/)
  const direct = svc.slice(svc.indexOf('function directRecipient'))
  assert.doesNotMatch(direct.slice(0, 600), /SHARED_INBOX_EMAIL|assignedStaff/)
})

test('no em dash in the generalized Messages files', () => {
  for (const [name, src] of Object.entries({ ...GENERALIZED, 'messagesAuth.js': auth })) {
    assert.doesNotMatch(src, /—/, name)
  }
})
