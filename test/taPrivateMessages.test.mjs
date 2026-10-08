// test/taPrivateMessages.test.mjs
//
// TA-MESSAGES-1: runs supabase/migrations/20261114000000_ta_private_messages.sql on real Postgres
// (PGlite) over minimal stubs of the applied schema, then walks a private conversation from both
// sides and every staff path. Owner, 2026-10-07: a private conversation is "only between the
// portal user and who they send a message to"; the unit leader to student direct threads become
// private too; a unit leader or an alumnus may start one with Talent Acquisition.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const migration = readFileSync(new URL('../supabase/migrations/20261114000000_ta_private_messages.sql', import.meta.url), 'utf8')

const TA = '00000000-0000-0000-0000-0000000000a1'
const UL = '00000000-0000-0000-0000-0000000000b1'
const ALUM = '00000000-0000-0000-0000-0000000000c1'
const STAFF = '00000000-0000-0000-0000-0000000000d1'
const TA2 = '00000000-0000-0000-0000-0000000000a2'
const OLD_DIRECT = '10000000-0000-0000-0000-000000000001'
const OLD_TEAM = '10000000-0000-0000-0000-000000000002'

const PRELUDE = `
  DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  DO $$ BEGIN CREATE ROLE service_role; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  CREATE TABLE user_profiles (id uuid PRIMARY KEY, full_name text, is_active boolean DEFAULT true, role text);
  CREATE TABLE user_role_grants (user_profile_id uuid, role text, revoked_at timestamptz, starts_at timestamptz DEFAULT now() - interval '1 day', expires_at timestamptz);
  CREATE TABLE user_unit_scopes (user_profile_id uuid, unit_key text, revoked_at timestamptz, starts_at timestamptz, expires_at timestamptz);
  CREATE TABLE user_school_scopes (user_profile_id uuid, school_key text, revoked_at timestamptz, starts_at timestamptz, expires_at timestamptz);
  CREATE TABLE user_student_links (user_profile_id uuid, student_id uuid, revoked_at timestamptz);
  CREATE TABLE conversations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), subject text NOT NULL, category text, status text NOT NULL DEFAULT 'open',
    assigned_staff_profile_id uuid, follow_up_flagged boolean NOT NULL DEFAULT false, follow_up_flagged_by uuid, follow_up_flagged_at timestamptz,
    created_by_profile_id uuid NOT NULL, created_by_role text NOT NULL,
    related_student_id uuid, related_unit_key text, related_school_key text, related_cohort_id uuid,
    last_message_at timestamptz NOT NULL DEFAULT now(), resolved_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
  CREATE TABLE conversation_participants (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), conversation_id uuid, participant_profile_id uuid, participant_role text,
    scope_kind text, scope_student_id uuid, scope_unit_key text, scope_school_key text, scope_cohort_id uuid,
    added_at timestamptz DEFAULT now(), removed_at timestamptz);
  CREATE TABLE messages (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), conversation_id uuid, author_profile_id uuid, author_role text, body text, created_at timestamptz DEFAULT now());
  CREATE TABLE conversation_events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), conversation_id uuid, event_type text, actor_profile_id uuid, from_value text, to_value text, created_at timestamptz);
  CREATE TABLE participant_conversation_reads (participant_profile_id uuid, conversation_id uuid, last_read_at timestamptz, PRIMARY KEY (participant_profile_id, conversation_id));
  CREATE TABLE staff_conversation_reads (staff_profile_id uuid, conversation_id uuid, last_read_at timestamptz, PRIMARY KEY (staff_profile_id, conversation_id));
  CREATE TABLE message_reactions (message_id uuid, profile_id uuid, reaction_key text, created_at timestamptz DEFAULT now(), PRIMARY KEY (message_id, profile_id));
  CREATE TABLE message_conversation_visibility (profile_id uuid, conversation_id uuid, archived_at timestamptz, created_at timestamptz DEFAULT now(), PRIMARY KEY (profile_id, conversation_id));
  CREATE TABLE message_notification_deliveries (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), conversation_id uuid, message_id uuid, triggered_by_profile_id uuid, recipient_profile_id uuid,
    recipient_email text, recipient_kind text, event_type text, idempotency_key text UNIQUE, queue_status text, next_attempt_at timestamptz,
    snapshot_sender_name text, snapshot_subject text, snapshot_category text, cta_path text);
  CREATE TABLE message_creation_requests (id uuid PRIMARY KEY DEFAULT gen_random_uuid());

  CREATE FUNCTION portal_profile_id() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT current_setting('test.me')::uuid $$;
  CREATE FUNCTION is_active_owner_or_admin() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT current_setting('test.me')::uuid = '${STAFF}'::uuid $$;
  CREATE FUNCTION message_profile_is_active_owner_or_admin(uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT $1 = '${STAFF}'::uuid $$;
  CREATE FUNCTION message_profile_is_active(uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT COALESCE((SELECT is_active FROM user_profiles WHERE id = $1), false) $$;
  CREATE FUNCTION message_profile_has_active_student_portal(uuid) RETURNS boolean LANGUAGE sql STABLE
    AS $$ SELECT EXISTS (SELECT 1 FROM user_role_grants g WHERE g.user_profile_id = $1 AND g.role = 'student' AND g.revoked_at IS NULL) $$;
  CREATE FUNCTION message_profile_has_active_unit_leader_portal_scope(uuid) RETURNS boolean LANGUAGE sql STABLE
    AS $$ SELECT EXISTS (SELECT 1 FROM user_role_grants g WHERE g.user_profile_id = $1 AND g.role = 'unit_leader' AND g.revoked_at IS NULL) $$;
  CREATE FUNCTION message_profile_has_active_academic_partner_portal_scope(uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
  CREATE FUNCTION message_profile_has_active_nursing_academic_portal_scope(uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
  CREATE FUNCTION consume_message_rate_limit(uuid, text, integer, integer) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{"allowed": true}'::jsonb $$;
  CREATE FUNCTION message_recipient_has_active_access(uuid, uuid) RETURNS boolean LANGUAGE plpgsql STABLE
    AS $$ BEGIN RETURN public.message_participant_can_read($1, $2); END $$;
  CREATE FUNCTION message_participant_can_send(uuid, uuid) RETURNS boolean LANGUAGE plpgsql STABLE
    AS $$ BEGIN RETURN public.message_participant_can_read($1, $2); END $$;
  CREATE FUNCTION messages_receipt_state(uuid, text, uuid) RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT '{}'::jsonb $$;
  CREATE FUNCTION messages_staff_get_thread(uuid, integer, timestamptz, uuid) RETURNS jsonb LANGUAGE sql AS $$ SELECT NULL::jsonb $$;
  CREATE FUNCTION messages_staff_get_thread_v2(uuid, integer, timestamptz, uuid) RETURNS jsonb LANGUAGE sql AS $$ SELECT NULL::jsonb $$;
  CREATE FUNCTION messages_staff_get_thread_v3(uuid, integer, timestamptz, uuid) RETURNS jsonb LANGUAGE sql AS $$ SELECT NULL::jsonb $$;
  CREATE FUNCTION messages_staff_get_thread_v4(uuid, integer, timestamptz, uuid) RETURNS jsonb LANGUAGE sql AS $$ SELECT NULL::jsonb $$;
  CREATE FUNCTION messages_staff_get_thread_v5(uuid, integer, timestamptz, uuid) RETURNS jsonb LANGUAGE sql
    AS $$ SELECT jsonb_build_object('conversation', jsonb_build_object('id', $1), 'messages', '[]'::jsonb) $$;
  CREATE FUNCTION messages_staff_list_conversations(integer, timestamptz, uuid, text, uuid, text, boolean, text) RETURNS jsonb LANGUAGE sql AS $$ SELECT NULL::jsonb $$;
  CREATE FUNCTION messages_staff_list_conversations_v2(integer, timestamptz, uuid, text, text, uuid, text, text, boolean, text) RETURNS jsonb LANGUAGE sql AS $$ SELECT NULL::jsonb $$;
  CREATE FUNCTION messages_staff_list_conversations_v3(integer, timestamptz, uuid, text, text, uuid, text, text, boolean, text, text) RETURNS jsonb LANGUAGE sql AS $$ SELECT NULL::jsonb $$;
  CREATE FUNCTION messages_staff_list_conversations_v4(integer, timestamptz, uuid, text, text, uuid, text, text, boolean, text, text, text) RETURNS jsonb LANGUAGE sql AS $$ SELECT NULL::jsonb $$;
  CREATE FUNCTION messages_staff_needs_reply_count() RETURNS integer LANGUAGE sql AS $$ SELECT 0 $$;

  INSERT INTO user_profiles (id, full_name) VALUES
    ('${TA}', 'Dana Reyes'), ('${TA2}', 'Second HR'), ('${UL}', 'Alexis Kim'), ('${ALUM}', 'Emi Bayaraa'), ('${STAFF}', 'Jester');
  INSERT INTO user_role_grants (user_profile_id, role) VALUES
    ('${TA}', 'talent_acquisition'), ('${TA2}', 'talent_acquisition'), ('${UL}', 'unit_leader'), ('${ALUM}', 'student');

  -- Before the migration: one unit leader to student direct thread, one student team thread.
  INSERT INTO conversations (id, subject, created_by_profile_id, created_by_role) VALUES
    ('${OLD_DIRECT}', 'Shift on Friday', '${UL}', 'unit_leader'),
    ('${OLD_TEAM}', 'A question', '${ALUM}', 'student');
  INSERT INTO conversation_participants (conversation_id, participant_profile_id, participant_role, scope_kind, scope_unit_key) VALUES
    ('${OLD_DIRECT}', '${UL}', 'unit_leader', 'unit', '5 North');
  INSERT INTO conversation_participants (conversation_id, participant_profile_id, participant_role, scope_kind) VALUES
    ('${OLD_DIRECT}', '${ALUM}', 'student', 'student'),
    ('${OLD_TEAM}', '${ALUM}', 'student', 'student');
  INSERT INTO messages (conversation_id, author_profile_id, author_role, body) VALUES
    ('${OLD_DIRECT}', '${UL}', 'unit_leader', 'See you Friday'), ('${OLD_TEAM}', '${ALUM}', 'student', 'Hi team');
`

async function setup() {
  const db = new PGlite()
  await db.exec(PRELUDE)
  await db.exec(migration)
  return db
}
const as = (db, who) => db.exec(`SET test.me = '${who}'`)
const delivery = (to, event = 'private_message', key = Math.random().toString(36).slice(2)) => JSON.stringify({
  idempotency_key: key, recipient_email: 'x@example.com', recipient_kind: 'portal_user', event_type: event,
  recipient_profile_id: to, snapshot_sender_name: 'Someone', snapshot_subject: 'Subject', cta_path: '/portal',
})
const start = (db, actor, kind, to, toKind) => db.query(
  'SELECT messages_start_private_conversation($1, $2, $3, $4, $5, $6, $7::jsonb) AS r',
  [actor, kind, to, toKind, 'Interview times next week', 'Could you open two more times?', delivery(to)])
const one = async (db, sql, args = []) => (await db.query(sql, args)).rows[0]
const rejects = async (p, code) => {
  try { await p } catch (err) { if (code) assert.equal(err.code, code, err.message); return err }
  assert.fail('expected an error')
}

test('the existing unit leader to student direct thread becomes private; a team thread does not', async () => {
  const db = await setup()
  assert.equal((await one(db, `SELECT visibility FROM conversations WHERE id = '${OLD_DIRECT}'`)).visibility, 'private')
  assert.equal((await one(db, `SELECT visibility FROM conversations WHERE id = '${OLD_TEAM}'`)).visibility, 'team')
})

test('Talent Acquisition starts a private conversation with a unit leader; both can read it', async () => {
  const db = await setup()
  const r = (await start(db, TA, 'talent_acquisition', UL, 'unit_leader')).rows[0].r
  assert.equal(r.thread_kind, 'private')
  const c = await one(db, 'SELECT visibility, created_by_role FROM conversations WHERE id = $1', [r.conversation_id])
  assert.deepEqual(c, { visibility: 'private', created_by_role: 'talent_acquisition' })
  const parts = (await db.query('SELECT participant_role, scope_kind FROM conversation_participants WHERE conversation_id = $1 ORDER BY participant_role', [r.conversation_id])).rows
  assert.deepEqual(parts, [{ participant_role: 'talent_acquisition', scope_kind: 'general' }, { participant_role: 'unit_leader', scope_kind: 'unit' }])
  const d = await one(db, 'SELECT event_type, recipient_kind, recipient_profile_id FROM message_notification_deliveries WHERE conversation_id = $1', [r.conversation_id])
  assert.deepEqual(d, { event_type: 'private_message', recipient_kind: 'portal_user', recipient_profile_id: UL })
  for (const who of [TA, UL]) {
    assert.equal((await one(db, 'SELECT message_participant_can_read($1, $2) AS ok', [r.conversation_id, who])).ok, true, who)
  }
})

test('a unit leader and an alumnus may each start one with Talent Acquisition', async () => {
  const db = await setup()
  assert.ok((await start(db, UL, 'unit_leader', TA, 'talent_acquisition')).rows[0].r.conversation_id)
  assert.ok((await start(db, ALUM, 'student', TA, 'talent_acquisition')).rows[0].r.conversation_id)
})

test('a private conversation always has Talent Acquisition on exactly one side', async () => {
  const db = await setup()
  await rejects(start(db, TA, 'talent_acquisition', TA2, 'talent_acquisition'), 'MS400')
  await rejects(start(db, UL, 'unit_leader', ALUM, 'student'), 'MS400')
})

test('a recipient without active access cannot be messaged; a revoked grant loses the thread', async () => {
  const db = await setup()
  const r = (await start(db, TA, 'talent_acquisition', UL, 'unit_leader')).rows[0].r
  await db.exec(`UPDATE user_role_grants SET revoked_at = now() WHERE user_profile_id = '${UL}'`)
  await rejects(start(db, TA, 'talent_acquisition', UL, 'unit_leader'), 'MS409')
  assert.equal((await one(db, 'SELECT message_participant_can_read($1, $2) AS ok', [r.conversation_id, UL])).ok, false)
  await db.exec(`UPDATE user_role_grants SET revoked_at = now() WHERE user_profile_id = '${TA}'`)
  assert.equal((await one(db, 'SELECT message_participant_can_read($1, $2) AS ok', [r.conversation_id, TA])).ok, false)
})

test('the other side replies with private_message; the reply notifies only the other participant', async () => {
  const db = await setup()
  const r = (await start(db, TA, 'talent_acquisition', UL, 'unit_leader')).rows[0].r
  const reply = await one(db, 'SELECT messages_post_reply($1, $2, $3, $4, $5::jsonb) AS r', [UL, 'unit_leader', r.conversation_id, 'Yes, adding 1:00 and 1:30.', delivery(TA)])
  assert.ok(reply.r.message_id)
  const back = await one(db, 'SELECT messages_post_reply($1, $2, $3, $4, $5::jsonb) AS r', [TA, 'talent_acquisition', r.conversation_id, 'Thank you!', delivery(UL)])
  assert.ok(back.r.message_id)
  // A private thread never routes to the shared inbox.
  await rejects(db.query('SELECT messages_post_reply($1, $2, $3, $4, $5::jsonb)', [UL, 'unit_leader', r.conversation_id, 'x',
    JSON.stringify({ idempotency_key: 'k-team', recipient_email: 'aspire@cshs.org', recipient_kind: 'shared_inbox', event_type: 'private_message', snapshot_sender_name: 'A', snapshot_subject: 'S', cta_path: '/' })]), 'MS400')
})

test('the ASPIRE team sees no trace: triage, unread badge, thread, read policies', async () => {
  const db = await setup()
  const r = (await start(db, TA, 'talent_acquisition', UL, 'unit_leader')).rows[0].r
  await as(db, STAFF)
  assert.equal((await db.query('SELECT * FROM messages_staff_triage($1, $2)', [r.conversation_id, STAFF])).rows.length, 0)
  assert.equal((await db.query('SELECT * FROM messages_staff_triage($1, $2)', [OLD_DIRECT, STAFF])).rows.length, 0)
  assert.equal((await db.query('SELECT * FROM messages_staff_triage($1, $2)', [OLD_TEAM, STAFF])).rows.length, 1)
  assert.equal((await one(db, 'SELECT messages_staff_unread_count() AS n')).n, 1, 'only the team thread counts')
  assert.equal((await one(db, 'SELECT messages_staff_get_thread_v6($1) AS t', [r.conversation_id])).t, null)
  assert.ok((await one(db, 'SELECT messages_staff_get_thread_v6($1) AS t', [OLD_TEAM])).t)
})

test('staff cannot write into a private thread by any path', async () => {
  const db = await setup()
  const r = (await start(db, TA, 'talent_acquisition', UL, 'unit_leader')).rows[0].r
  const staffDelivery = JSON.stringify({ idempotency_key: 'k-staff', recipient_email: 'x@example.com', recipient_kind: 'portal_user', event_type: 'staff_reply', recipient_profile_id: UL, snapshot_sender_name: 'J', snapshot_subject: 'S', cta_path: '/' })
  await rejects(db.query('SELECT messages_post_reply($1, $2, $3, $4, $5::jsonb)', [STAFF, 'staff', r.conversation_id, 'Hello', staffDelivery]), 'MS404')
  await rejects(db.query(`INSERT INTO messages (conversation_id, author_profile_id, author_role, body) VALUES ($1, $2, 'staff', 'x')`, [r.conversation_id, STAFF]), 'MS404')
  await rejects(db.query('SELECT messages_mark_read($1, $2, $3)', [STAFF, 'staff', r.conversation_id]), 'MS404')
  await rejects(db.query(`INSERT INTO staff_conversation_reads VALUES ($1, $2, now())`, [STAFF, r.conversation_id]), 'MS404')
  await rejects(db.query(`UPDATE conversations SET assigned_staff_profile_id = $1 WHERE id = $2`, [STAFF, r.conversation_id]), 'MS404')
  await rejects(db.query(`UPDATE conversations SET status = 'resolved' WHERE id = $1`, [r.conversation_id]), 'MS404')
  await rejects(db.query(`UPDATE conversations SET visibility = 'team' WHERE id = $1`, [r.conversation_id]), 'MS409')
  const msg = (await one(db, 'SELECT id FROM messages WHERE conversation_id = $1', [r.conversation_id])).id
  await rejects(db.query(`INSERT INTO message_reactions (message_id, profile_id, reaction_key) VALUES ($1, $2, 'thanks')`, [msg, STAFF]), 'MS404')
  await db.query(`INSERT INTO message_reactions (message_id, profile_id, reaction_key) VALUES ($1, $2, 'thanks')`, [msg, UL])
  await rejects(db.query(`INSERT INTO message_conversation_visibility (profile_id, conversation_id, archived_at) VALUES ($1, $2, now())`, [STAFF, r.conversation_id]), 'MS404')
})

test('a portal participant can mark a private thread read (mark-read now admits every portal kind)', async () => {
  const db = await setup()
  const r = (await start(db, TA, 'talent_acquisition', UL, 'unit_leader')).rows[0].r
  const out = await one(db, 'SELECT messages_mark_read($1, $2, $3) AS r', [UL, 'unit_leader', r.conversation_id])
  assert.equal(out.r.conversation_id, r.conversation_id)
  await rejects(db.query('SELECT messages_mark_read($1, $2, $3)', [ALUM, 'student', r.conversation_id]), 'MS404')
})

test('Talent Acquisition can start an ASPIRE Team thread (the shared inbox), visible to staff', async () => {
  const src = migration
  assert.match(src, /CREATE OR REPLACE FUNCTION public\.messages_start_general_team_conversation_ta\(/)
  assert.match(src, /IF p_actor_kind IN \('academic_partner', 'nursing_academic', 'talent_acquisition'\) THEN/)
})

test('older staff versions are revoked from every client', async () => {
  for (const f of ['messages_staff_get_thread_v5', 'messages_staff_list_conversations_v4', 'messages_staff_needs_reply_count()']) {
    assert.match(migration, new RegExp(`REVOKE ALL ON FUNCTION public\\.${f.replace(/[()]/g, '\\$&')}`))
  }
})
