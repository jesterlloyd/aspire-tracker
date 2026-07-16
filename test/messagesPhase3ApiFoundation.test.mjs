// MESSAGES-PHASE3-A: static guard for the ASPIRE Messages Phase 3 Stage A API
// database foundation migration. Verifies the category_change event type, the
// explicit-profile authorization helpers, the seven transactional write RPCs,
// the six authenticated read RPCs, the grant posture, the three-identity model,
// the student-only version-one boundary, and that Phase 1 and Phase 2 migrations
// are untouched.
//
// Run: node --test test/messagesPhase3ApiFoundation.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, p), 'utf8')

const sql = read('../supabase/migrations/20260716000002_messages_phase3_api_foundation.sql')
const phase1 = read('../supabase/migrations/20260716000000_messages_phase1_schema_foundation.sql')
const phase2 = read('../supabase/migrations/20260716000001_messages_phase2_notification_delivery_foundation.sql')
const verify = read('../db/audit/messages_phase3_verification.sql')

// Executable SQL with line comments removed, so token guards test code not prose.
const executableSql = sql.replace(/--[^\n]*/g, '')

const WRITE_RPCS = [
  'messages_start_conversation', 'messages_post_reply', 'messages_mark_read',
  'messages_set_assignment', 'messages_set_status', 'messages_set_category',
  'messages_set_follow_up',
]
const EXPLICIT_HELPERS = [
  'message_profile_is_active_owner_or_admin', 'message_profile_has_active_student_link',
]
const READ_RPCS = [
  'messages_portal_list_conversations', 'messages_portal_get_thread',
  'messages_portal_unread_count', 'messages_staff_list_conversations',
  'messages_staff_get_thread', 'messages_staff_unread_count',
]

// Slice one function definition, with line comments stripped so token guards
// test the code and not the surrounding section prose.
const fnBody = (name) => {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}`)
  assert.notEqual(start, -1, `function ${name} not found`)
  const end = sql.indexOf('CREATE OR REPLACE FUNCTION', start + 10)
  const slice = sql.slice(start, end === -1 ? sql.indexOf('-- ── 5.') : end)
  return slice.replace(/--[^\n]*/g, '')
}

test('ASPIRE Messages Phase 3 Stage A migration', async (t) => {
  await t.test('does not modify the Phase 1 or Phase 2 migrations', () => {
    assert.match(phase1, /CREATE TABLE IF NOT EXISTS public\.conversations\b/)
    assert.match(phase2, /CREATE TABLE IF NOT EXISTS public\.message_notification_deliveries\b/)
    // Phase 3 objects never leaked backwards into the locked migrations.
    assert.doesNotMatch(phase1, /messages_start_conversation|category_change/)
    assert.doesNotMatch(phase2, /messages_start_conversation|category_change/)
  })

  await t.test('is atomic with BEGIN and COMMIT', () => {
    assert.match(sql, /^BEGIN;/m)
    assert.match(sql, /^COMMIT;/m)
    assert.ok(sql.indexOf('\nCOMMIT;') > sql.lastIndexOf('GRANT EXECUTE ON FUNCTION'), 'COMMIT after last grant')
  })

  await t.test('adds category_change while keeping every original event type', () => {
    const block = sql.slice(sql.indexOf('ADD CONSTRAINT chk_conversation_events_type'), sql.indexOf('-- ── 2.'))
    for (const ev of ['created', 'status_change', 'assignment_change', 'resolved',
      'reopened', 'flagged', 'participant_access_changed', 'category_change']) {
      assert.ok(block.includes(`'${ev}'`), `event_type missing ${ev}`)
    }
    // The constraint is swapped, not the Phase 1 file edited.
    assert.match(sql, /ALTER TABLE public\.conversation_events\s+DROP CONSTRAINT IF EXISTS chk_conversation_events_type/)
  })

  await t.test('creates no new table', () => {
    assert.doesNotMatch(executableSql, /CREATE TABLE/i, 'Phase 3 must not create tables')
  })

  await t.test('creates the explicit-profile helpers, write RPCs, and read RPCs', () => {
    for (const fn of [...EXPLICIT_HELPERS, ...WRITE_RPCS, ...READ_RPCS]) {
      assert.match(sql, new RegExp(`CREATE OR REPLACE FUNCTION public\\.${fn}\\b`), `missing ${fn}`)
    }
  })

  await t.test('every function is SECURITY DEFINER with a fixed search_path', () => {
    const secdef = sql.match(/SECURITY DEFINER/g) || []
    assert.ok(secdef.length >= 15, `expected >=15 SECURITY DEFINER, found ${secdef.length}`)
    const sp = sql.match(/SET search_path = public, pg_catalog/g) || []
    assert.ok(sp.length >= 16, `expected >=16 fixed search_path, found ${sp.length}`)
  })

  await t.test('write RPCs and explicit helpers are service-role only', () => {
    for (const fn of [...EXPLICIT_HELPERS, ...WRITE_RPCS]) {
      assert.match(sql, new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}\\([^)]*\\)\\s*FROM PUBLIC, anon, authenticated;`), `missing REVOKE for ${fn}`)
      assert.match(sql, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}\\([^)]*\\)\\s*TO service_role;`), `missing service_role grant for ${fn}`)
      assert.doesNotMatch(sql, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}\\([^)]*\\)\\s*TO authenticated`), `${fn} must not be granted to authenticated`)
    }
  })

  await t.test('read RPCs are authenticated + service_role, never anon or PUBLIC', () => {
    for (const fn of READ_RPCS) {
      assert.match(sql, new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}\\([^)]*\\)[\\s\\S]{0,40}?FROM PUBLIC, anon;`), `missing REVOKE for ${fn}`)
      assert.match(sql, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}\\([^)]*\\)[\\s\\S]{0,40}?TO authenticated, service_role;`), `missing grant for ${fn}`)
    }
    assert.doesNotMatch(sql, /GRANT EXECUTE[^;]*TO[^;]*\banon\b/, 'no anon execute permitted')
  })

  await t.test('never uses is_staff()', () => {
    assert.doesNotMatch(executableSql, /is_staff/, 'is_staff must never gate Messages')
  })

  await t.test('preserves the three-identity model', () => {
    // No profile id is ever compared to auth.uid().
    assert.doesNotMatch(executableSql, /profile_id\s*=\s*auth\.uid\(\)/)
    // Caller identity is resolved through the established helpers.
    assert.match(sql, /portal_profile_id\(\)/)
    assert.match(sql, /is_active_owner_or_admin\(\)/)
  })

  await t.test('service-role write RPCs use explicit-profile helpers, not caller-scoped ones', () => {
    for (const fn of WRITE_RPCS) {
      const body = fnBody(fn)
      assert.doesNotMatch(body, /portal_profile_id\(\)/, `${fn} must not resolve the caller identity`)
      assert.doesNotMatch(body, /\bis_active_owner_or_admin\(\)/, `${fn} must not use the caller-scoped staff gate`)
    }
    // Start/reply validate the actor from the passed profile id.
    assert.match(fnBody('messages_start_conversation'), /message_profile_has_active_student_link\(p_participant_profile_id, p_student_id\)/)
    assert.match(fnBody('messages_start_conversation'), /message_profile_is_active_owner_or_admin\(p_actor_profile_id\)/)
    assert.match(fnBody('messages_post_reply'), /message_recipient_has_active_access\(p_conversation_id, p_actor_profile_id\)/)
  })

  await t.test('version one authorizes the student portal role only', () => {
    const start = fnBody('messages_start_conversation')
    assert.match(start, /'student'/)
    assert.doesNotMatch(start, /unit_leader|academic_partner|preceptor/, 'future roles must not be activated')
    assert.match(start, /p_actor_kind NOT IN \('student', 'staff'\)/)
  })

  await t.test('no function authorizes through related context or assignment', () => {
    for (const fn of [...WRITE_RPCS, 'messages_portal_list_conversations', 'messages_portal_get_thread']) {
      const body = fnBody(fn)
      assert.doesNotMatch(body, /WHERE[^;]*related_(student_id|unit_key|school_key|cohort_id)\s*=/, `${fn} must not gate on related context`)
      assert.doesNotMatch(body, /IF[^;]*assigned_staff_profile_id[^;]*THEN/, `${fn} must not gate on assignment`)
    }
  })

  await t.test('start conversation is atomic across every required invariant', () => {
    const body = fnBody('messages_start_conversation')
    assert.match(body, /INSERT INTO public\.conversations/)
    assert.match(body, /INSERT INTO public\.conversation_participants/)
    assert.match(body, /INSERT INTO public\.messages/)
    assert.match(body, /INSERT INTO public\.conversation_events[\s\S]*'created'/)
    assert.match(body, /INSERT INTO public\.(participant|staff)_conversation_reads/)
    assert.match(body, /INSERT INTO public\.message_notification_deliveries/)
    assert.match(body, /'queued'/)
    // The durable idempotency guarantee is preserved.
    assert.match(body, /ON CONFLICT \(idempotency_key\) DO NOTHING/)
  })

  await t.test('reply reopens a resolved conversation and advances only the sender pointer', () => {
    const body = fnBody('messages_post_reply')
    assert.match(body, /IF v_status = 'resolved' THEN/)
    assert.match(body, /status = 'open', resolved_at = NULL/)
    assert.match(body, /'reopened'/)
    assert.match(body, /INSERT INTO public\.messages/)
    assert.match(body, /last_message_at = v_now/)
    assert.match(body, /ON CONFLICT \(idempotency_key\) DO NOTHING/)
    // Staff cannot send into a thread whose participant lost access.
    assert.match(body, /MS409/)
  })

  await t.test('mark read uses a server-derived timestamp only', () => {
    const body = fnBody('messages_mark_read')
    assert.match(body, /COALESCE\(max\(m\.created_at\), now\(\)\)/)
    assert.doesNotMatch(body, /p_last_read_at|p_read_at/, 'must not accept a client timestamp')
  })

  await t.test('status and follow-up keep the Phase 1 consistency constraints valid', () => {
    const status = fnBody('messages_set_status')
    assert.match(status, /resolved_at = CASE WHEN p_status = 'resolved' THEN v_now ELSE NULL END/)
    assert.match(status, /p_status NOT IN \('open', 'waiting', 'resolved'\)/)
    const flag = fnBody('messages_set_follow_up')
    assert.match(flag, /follow_up_flagged_by = CASE WHEN p_flagged THEN p_actor_profile_id ELSE NULL END/)
    assert.match(flag, /follow_up_flagged_at = CASE WHEN p_flagged THEN v_now ELSE NULL END/)
  })

  await t.test('assignment only accepts an active owner or admin and never grants access', () => {
    const body = fnBody('messages_set_assignment')
    assert.match(body, /message_profile_is_active_owner_or_admin\(p_assignee_profile_id\)/)
    assert.match(body, /'assignment_change'/)
  })

  await t.test('category change records an auditable category_change event', () => {
    const body = fnBody('messages_set_category')
    assert.match(body, /'category_change'/)
    for (const cat of ['Placement and matching', 'Scheduling', 'Onboarding requirements',
      'Clinical rotation support', 'Preceptor support', 'Portal or account help', 'General question']) {
      assert.ok(body.includes(`'${cat}'`), `category ${cat} missing`)
    }
  })

  await t.test('portal reads are caller-scoped and non-enumerating', () => {
    const list = fnBody('messages_portal_list_conversations')
    assert.match(list, /my_message_conversation_ids\(\)/)
    const thread = fnBody('messages_portal_get_thread')
    assert.match(thread, /NOT IN \(SELECT public\.my_message_conversation_ids\(\)\)/)
    assert.match(thread, /RETURN NULL;/)
    // Staff email is never exposed to the portal.
    assert.doesNotMatch(thread, /up\.email/)
    assert.match(thread, /'ASPIRE Team'/)
  })

  await t.test('unread rules count only the other side and are per-user', () => {
    assert.match(fnBody('messages_portal_unread_count'), /author_role = 'staff'/)
    assert.match(fnBody('messages_portal_unread_count'), /participant_conversation_reads/)
    assert.match(fnBody('messages_staff_unread_count'), /author_role <> 'staff'/)
    assert.match(fnBody('messages_staff_unread_count'), /staff_profile_id = v_me/)
  })

  await t.test('pagination uses stable cursors with an id tie-breaker and capped limits', () => {
    const list = fnBody('messages_portal_list_conversations')
    assert.match(list, /\(c\.last_message_at, c\.id\) < \(p_cursor_ts, p_cursor_id\)/)
    assert.match(list, /LEAST\(GREATEST\(COALESCE\(p_limit, 25\), 1\), 100\)/)
    const thread = fnBody('messages_portal_get_thread')
    assert.match(thread, /\(m\.created_at, m\.id\) > \(p_cursor_ts, p_cursor_id\)/)
  })

  await t.test('custom SQLSTATE codes are exactly five characters', () => {
    const codes = [...sql.matchAll(/ERRCODE = '([^']+)'/g)].map((m) => m[1])
    assert.ok(codes.length > 0, 'expected custom error codes')
    for (const c of new Set(codes)) {
      assert.equal(c.length, 5, `SQLSTATE ${c} must be 5 characters`)
    }
  })
})

test('ASPIRE Messages Phase 3 Stage A verification file', async (t) => {
  await t.test('is labeled read-only and covers the required checks', () => {
    assert.match(verify, /READ-ONLY VERIFICATION QUERIES\.\s*\n--\s*RUN ONLY AFTER THE MIGRATION HAS BEEN APPLIED\./)
    for (const tok of ['chk_conversation_events_type', 'messages_start_conversation',
      'messages_post_reply', 'role_routine_grants', 'prosecdef', 'is_staff', 'pg_policies']) {
      assert.ok(verify.includes(tok), `verification missing ${tok}`)
    }
  })
})
