// UL-PORTAL: guards for migration 20260720000002 and the Unit Leader start endpoint.
//
// Two approved decisions are encoded here:
//   1. chk_ulnp_alert_type gains three values and PRESERVES the existing five
//   2. Report a Concern opens a thread with the ASPIRE Team, never a direct student
//      thread, and the student is context only rather than a participant

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')

const mig = read('supabase/migrations/20260720000002_unit_leader_notifications_and_concerns.sql')
const ver = read('db/audit/unit_leader_notifications_preflight_and_verification.sql')
const svc = read('lib/server/messages/conversationService.js')
const ep  = read('api/portal/unit-messages-start.js')

const live = mig.replace(/\/\*[\s\S]*?\*\//g, '')
const liveSql = live.replace(/^\s*--.*$/gm, '')
const rollback = (mig.match(/\/\*[\s\S]*?\*\//g) || []).join('\n')

const PRESERVED = ['placement_request', 'response_deadline', 'onboarding_issue',
  'schedule_change', 'new_message']
const ADDED = ['capacity_review_outcome', 'preceptor_assignment_update', 'concern_follow_up']

// ── 1. Notification alert types ─────────────────────────────────────────────
test('the CHECK preserves all five existing alert types', () => {
  const chk = liveSql.slice(liveSql.indexOf('ADD CONSTRAINT chk_ulnp_alert_type'))
  for (const v of PRESERVED) {
    assert.ok(chk.includes(`'${v}'`), `must preserve ${v}`)
  }
})

test('the CHECK adds exactly the three approved alert types', () => {
  const chk = liveSql.slice(liveSql.indexOf('ADD CONSTRAINT chk_ulnp_alert_type'))
  for (const v of ADDED) {
    assert.ok(chk.includes(`'${v}'`), `must add ${v}`)
  }
})

test('the alert-type change is ADDITIVE, so no existing preference is invalidated', () => {
  // Only a DROP and re-ADD of the one CHECK. No data statement touches the table.
  assert.match(liveSql, /ALTER TABLE public\.unit_leader_notification_prefs\s*\n\s*DROP CONSTRAINT IF EXISTS chk_ulnp_alert_type/)
  assert.doesNotMatch(liveSql, /DELETE FROM public\.unit_leader_notification_prefs/i)
  assert.doesNotMatch(liveSql, /UPDATE public\.unit_leader_notification_prefs/i)
})

test('the rollback restores exactly the five original values', () => {
  const rbChk = rollback.slice(rollback.indexOf('ADD CONSTRAINT chk_ulnp_alert_type'))
  for (const v of PRESERVED) assert.ok(rbChk.includes(`'${v}'`), `rollback keeps ${v}`)
  for (const v of ADDED) assert.ok(!rbChk.includes(`'${v}'`), `rollback drops ${v}`)
  // And it warns that the rollback fails if a row already uses an added value.
  assert.match(mig, /FAILS if any preference row already uses one of the/)
})

// ── 2. Report a Concern ─────────────────────────────────────────────────────
test('the new actor kind is admitted without changing the signature', () => {
  assert.match(liveSql, /p_actor_kind NOT IN \('student', 'staff', 'unit_leader', 'unit_leader_to_staff'\)/)
  // A VALUE was added to an existing parameter, not a parameter, so the ACL survives.
  assert.doesNotMatch(liveSql, /DROP FUNCTION IF EXISTS public\.messages_start_conversation/)
  assert.doesNotMatch(liveSql, /GRANT[^;]*messages_start_conversation/)
  assert.match(mig, /NO SIGNATURE CHANGE/)
})

test('a concern thread creates ONE participant, the Unit Leader, never the student', () => {
  const fn = liveSql.slice(liveSql.indexOf('CREATE OR REPLACE FUNCTION public.messages_start_conversation'))
  assert.match(fn, /IF p_actor_kind = 'unit_leader_to_staff' THEN[\s\S]{0,400}'unit_leader', 'unit',/)
  // The student appears as scope context on the unit leader's own row.
  assert.match(fn, /v_conversation_id, p_actor_profile_id, 'unit_leader', 'unit',\s*\n\s*p_student_id, v_unit_key, v_now/)
})

test('THE PRIVACY PROPERTY: the student-link precondition is skipped for a concern', () => {
  // Without this, a concern report would require the student to be a participant of
  // the thread reporting on them, which they could then read.
  assert.match(liveSql, /IF p_actor_kind <> 'unit_leader_to_staff'\s*\n\s*AND NOT public\.message_profile_has_active_student_link/)
  assert.match(mig, /what keeps a concern report invisible to the student it concerns/)
})

test('a concern thread routes to the shared inbox, not to the student', () => {
  const fn = liveSql.slice(liveSql.indexOf("IF p_actor_kind = 'unit_leader_to_staff'"))
  assert.match(fn.slice(0, 2600), /v_expected_event := 'new_conversation'/)
  assert.match(svc, /eventType: 'new_conversation'/)
  const concern = svc.slice(svc.indexOf('export async function startConcernThreadForUnitLeader'))
  assert.match(concern, /sharedInboxEmail: SHARED_INBOX_EMAIL/)
  // Never a direct-thread event type.
  assert.doesNotMatch(concern, /unit_leader_message|student_to_unit_leader_message/)
})

test('a concern requires an ACTIVE grant, an ACTIVE scope, and a real placement', () => {
  const fn = liveSql.slice(liveSql.indexOf("IF p_actor_kind = 'unit_leader_to_staff'"))
  const branch = fn.slice(0, fn.indexOf("ELSIF p_actor_kind = 'unit_leader' THEN"))
  assert.match(branch, /g\.role = 'unit_leader'/)
  assert.match(branch, /FROM public\.user_unit_scopes s/)
  assert.match(branch, /JOIN public\.units u ON u\.id = st\.matched_unit_id/)
  assert.match(branch, /a unit leader may only start their own conversation/)
})

// ── The endpoint ────────────────────────────────────────────────────────────
test('the start endpoint authorizes the student through the source of truth', () => {
  assert.match(ep, /verifyPortalUnitLeaderCaller\(req\)/)
  assert.match(ep, /resolveUnitScopedStudents\(db, scopes\)/)
  assert.match(ep, /if \(!student\) return res\.status\(404\)\.json\(\{ error: 'not_found' \}\)/)
  assert.match(ep, /if \(scopes\.length === 0\) return res\.status\(403\)/)
})

test('the unit is derived from the student placement, never from the request', () => {
  assert.match(ep, /unitKey: student\.unit_key/)
  const allowed = ep.slice(ep.indexOf('const allowed = new Set('), ep.indexOf('for (const k of'))
  assert.doesNotMatch(allowed, /unit_key/)
})

test('the endpoint enforces a strict body allowlist and validates every field', () => {
  assert.match(ep, /return res\.status\(400\)\.json\(\{ error: 'unexpected_field', field: k \}\)/)
  assert.match(ep, /validateSubject\(/)
  assert.match(ep, /validateCategory\(/)
  assert.match(ep, /validateBody\(/)
  assert.match(ep, /isUuid\(studentId\)/)
})

test('the endpoint applies the existing rate limits', () => {
  assert.match(ep, /consumeNewConversation\(db, profile\.id\)/)
  assert.match(ep, /consumeMessage\(db, profile\.id\)/)
  assert.match(ep, /rateLimitResponse\(res, /)
})

test('a direct thread resolves the counterpart from the student active link', () => {
  assert.match(ep, /async function resolveStudentPortalAccount/)
  assert.match(ep, /from\('user_student_links'\)/)
  assert.match(ep, /\.is\('revoked_at', null\)/)
  // An inactive or email-less account is not a valid counterpart.
  assert.match(ep, /p\.is_active === false \|\| !p\.email/)
  assert.match(ep, /student_has_no_portal_account/)
})

test('the concern path passes NO counterpart, so it cannot notify the student', () => {
  const concernCall = ep.slice(ep.indexOf('startConcernThreadForUnitLeader(deps, {'),
                               ep.indexOf('} else {'))
  assert.doesNotMatch(concernCall, /counterpart/)
})

// ── Verification file ───────────────────────────────────────────────────────
test('verification proves preservation, privacy, and an unchanged ACL', () => {
  assert.match(ver, /VERIFY 1: the CHECK now allows all EIGHT values/)
  for (const v of [...PRESERVED, ...ADDED]) assert.ok(ver.includes(v), `verify covers ${v}`)
  assert.match(ver, /VERIFY 5: no student is a participant of a concern thread/)
  assert.match(ver, /VERIFY 4: signature and ACL are UNCHANGED/)
  assert.match(ver, /STOP if more than one row appears, or if any privilege differs/)
  assert.match(ver, /skips_student_link_for_new_kind/)
  assert.match(ver, /creates_lone_ul_participant/)
})

test('preflight is read only and states its stop conditions', () => {
  assert.doesNotMatch(ver, /^\s*(UPDATE|INSERT|DELETE|ALTER|DROP|CREATE|TRUNCATE|GRANT|REVOKE)\b/im)
  assert.match(ver, /STOP CONDITIONS/)
  for (let i = 1; i <= 6; i++) assert.match(ver, new RegExp(`PREFLIGHT ${i}:`))
})

test('the migration is transactional and touches neither Wave F-2 nor prior migrations', () => {
  assert.match(mig, /BEGIN;[\s\S]*COMMIT;/)
  assert.doesNotMatch(liveSql, /storage\.buckets|storage\.objects|student-files/)
  assert.doesNotMatch(liveSql, /message_participant_can_(read|send)/)
  assert.doesNotMatch(liveSql, /unit_placement_respond|unit_capacity_submit/)
})

test('no em dash in the new migration, verification, or endpoint', () => {
  for (const [n, s] of Object.entries({ mig, ver, ep })) assert.doesNotMatch(s, /—/, n)
})
