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
    assert.doesNotMatch(src, /getServiceDb\(\)/, name)
  }
})

test('mark-read passes the caller actor kind, never a hardcoded student', () => {
  assert.match(markRead, /p_actor_kind: caller\.actorKind/)
  assert.doesNotMatch(markRead, /p_actor_kind: 'student'/)
})

test('the WRITE paths are deliberately NOT generalized yet', () => {
  // reply and start still hardcode the student actor. A unit leader reaching them
  // would be denied by verifyPortalStudentCaller, which is the safe state until the
  // direct-thread routing and delivery event types are implemented.
  assert.match(reply, /verifyPortalStudentCaller/)
  assert.match(start, /verifyPortalStudentCaller/)
})

test('no em dash in the generalized Messages files', () => {
  for (const [name, src] of Object.entries({ ...GENERALIZED, 'messagesAuth.js': auth })) {
    assert.doesNotMatch(src, /—/, name)
  }
})
