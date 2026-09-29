// test/messagesSimplifyMigration.test.mjs
//
// MESSAGES-SIMPLIFY-1: runs supabase/migrations/20261014000000_messages_simplify.sql
// against a real Postgres (PGlite, in process) and proves the Needs reply rule the
// spec's acceptance checklist names:
//   - a participant message puts a thread in Needs reply,
//   - a staff reply or a staff reaction on that message takes it out,
//     and removing the reaction puts it back,
//   - a participant reaction never changes it,
//   - Follow up holds a thread in Needs reply until it is turned off,
//   - Done (resolved) and a personal archive hide the thread; the counts agree,
//   - handled_by is the last staff member to reply or react,
//   - the badge count equals the Needs reply view,
//   - thread v5 carries reactor identities and the triage state.
// The migration defines read functions only; the tables below are minimal stubs
// of the applied schema with the columns those functions read.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const migration = readFileSync(join(root, 'supabase/migrations/20261014000000_messages_simplify.sql'), 'utf8')

const JESTER = '00000000-0000-0000-0000-00000000000a'
const KRYSTAL = '00000000-0000-0000-0000-00000000000b'
const JOEL = '00000000-0000-0000-0000-00000000000c'
const CHLOE = '00000000-0000-0000-0000-00000000000d'
const C1 = '10000000-0000-0000-0000-000000000001'
const C2 = '10000000-0000-0000-0000-000000000002'

const PRELUDE = `
  DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  DO $$ BEGIN CREATE ROLE service_role; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  CREATE TABLE user_profiles (id uuid PRIMARY KEY, full_name text);
  CREATE TABLE conversations (
    id uuid PRIMARY KEY, subject text, status text NOT NULL DEFAULT 'open',
    follow_up_flagged boolean NOT NULL DEFAULT false, related_student_id uuid,
    last_message_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE conversation_participants (
    conversation_id uuid, participant_profile_id uuid, removed_at timestamptz
  );
  CREATE TABLE messages (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), conversation_id uuid,
    author_profile_id uuid, author_role text, body text, created_at timestamptz
  );
  CREATE TABLE message_reactions (
    message_id uuid, profile_id uuid, reaction_key text,
    created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (message_id, profile_id)
  );
  CREATE TABLE message_conversation_visibility (
    profile_id uuid, conversation_id uuid, archived_at timestamptz,
    PRIMARY KEY (profile_id, conversation_id)
  );
  CREATE TABLE staff_conversation_reads (staff_profile_id uuid, conversation_id uuid, last_read_at timestamptz);
  CREATE OR REPLACE FUNCTION public.portal_profile_id() RETURNS uuid LANGUAGE sql STABLE
    AS $$ SELECT current_setting('test.me')::uuid $$;
  CREATE OR REPLACE FUNCTION public.is_active_owner_or_admin() RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
  CREATE OR REPLACE FUNCTION public.message_recipient_has_active_access(uuid, uuid) RETURNS boolean
    LANGUAGE sql AS $$ SELECT true $$;
  CREATE OR REPLACE FUNCTION public.messages_staff_get_thread_v4(uuid, integer, timestamptz, uuid)
  RETURNS jsonb LANGUAGE sql STABLE AS $$
    SELECT jsonb_build_object(
      'conversation', jsonb_build_object('id', $1, 'status', (SELECT status FROM conversations WHERE id = $1)),
      'messages', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', m.id, 'author_role', m.author_role) ORDER BY m.created_at)
        FROM messages m WHERE m.conversation_id = $1), '[]'::jsonb),
      'reaction_set_version', 2)
  $$;
`

async function setup() {
  const db = new PGlite()
  await db.exec(PRELUDE)
  await db.exec(migration)
  await db.exec(`SET test.me = '${JESTER}'`)
  await db.exec(`
    INSERT INTO user_profiles VALUES
      ('${JESTER}', 'Jester Lloyd Bautista'), ('${KRYSTAL}', 'Krystal Rodriguez'),
      ('${JOEL}', 'Joel Brown'), ('${CHLOE}', 'Chloe Tergalstanian');
    INSERT INTO conversations (id, subject, last_message_at) VALUES
      ('${C1}', 'Preceptor phone number', '2026-09-20T10:00Z'),
      ('${C2}', 'clocking in', '2026-09-21T10:00Z');
    INSERT INTO conversation_participants VALUES ('${C1}', '${JOEL}', NULL), ('${C2}', '${CHLOE}', NULL);
  `)
  return db
}

let clock = Date.parse('2026-09-20T10:00:00Z')
async function post(db, conv, author, role, body = 'hi') {
  clock += 60000
  const at = new Date(clock).toISOString()
  const { rows } = await db.query(
    'INSERT INTO messages (conversation_id, author_profile_id, author_role, body, created_at) VALUES ($1,$2,$3,$4,$5) RETURNING id',
    [conv, author, role, body, at],
  )
  await db.query('UPDATE conversations SET last_message_at = $2 WHERE id = $1', [conv, at])
  return rows[0].id
}
async function react(db, messageId, who, key = 'acknowledge') {
  clock += 60000
  await db.query(
    `INSERT INTO message_reactions VALUES ($1,$2,$3,$4)
     ON CONFLICT (message_id, profile_id) DO UPDATE SET reaction_key = EXCLUDED.reaction_key, created_at = EXCLUDED.created_at`,
    [messageId, who, key, new Date(clock).toISOString()],
  )
}
async function triage(db, conv) {
  const { rows } = await db.query('SELECT * FROM messages_staff_triage($1, $2)', [conv, JESTER])
  return rows[0]
}
async function list(db, view) {
  const { rows } = await db.query('SELECT messages_staff_list_conversations_v5(25, NULL, NULL, NULL, $1) AS r', [view])
  return rows[0].r
}

test('a participant message needs a reply; a staff reply clears it and names the replier', async () => {
  const db = await setup()
  await post(db, C1, JOEL, 'student')
  assert.equal((await triage(db, C1)).needs_reply, true)
  await post(db, C1, KRYSTAL, 'staff')
  const t = await triage(db, C1)
  assert.equal(t.needs_reply, false)
  assert.equal(t.handled_by_name, 'Krystal Rodriguez')
})

test('a staff reaction on the last participant message clears it; removing it puts the thread back', async () => {
  const db = await setup()
  const m = await post(db, C1, JOEL, 'student')
  await react(db, m, JESTER)
  let t = await triage(db, C1)
  assert.equal(t.needs_reply, false)
  assert.equal(t.handled_by_name, 'Jester Lloyd Bautista')
  await db.query('DELETE FROM message_reactions WHERE message_id = $1 AND profile_id = $2', [m, JESTER])
  t = await triage(db, C1)
  assert.equal(t.needs_reply, true)
})

test('a staff reaction on an EARLIER message does not answer a newer one', async () => {
  const db = await setup()
  const first = await post(db, C1, JOEL, 'student')
  await react(db, first, JESTER)
  await post(db, C1, JOEL, 'student')
  assert.equal((await triage(db, C1)).needs_reply, true)
})

test('a participant reaction never puts a thread back into Needs reply', async () => {
  const db = await setup()
  await post(db, C1, JOEL, 'student')
  const reply = await post(db, C1, JESTER, 'staff')
  await react(db, reply, JOEL, 'thanks')
  const t = await triage(db, C1)
  assert.equal(t.needs_reply, false)
  assert.equal(t.handled_by_name, 'Jester Lloyd Bautista', 'a participant reaction is not handling')
})

test('Follow up holds a thread in Needs reply until it is turned off', async () => {
  const db = await setup()
  await post(db, C1, JOEL, 'student')
  await post(db, C1, JESTER, 'staff')
  await db.query('UPDATE conversations SET follow_up_flagged = true WHERE id = $1', [C1])
  assert.equal((await triage(db, C1)).needs_reply, true)
  await db.query('UPDATE conversations SET follow_up_flagged = false WHERE id = $1', [C1])
  assert.equal((await triage(db, C1)).needs_reply, false)
})

test('Done hides a thread from Needs reply and All; a personal archive counts as done', async () => {
  const db = await setup()
  await post(db, C1, JOEL, 'student')
  await post(db, C2, CHLOE, 'student')
  let r = await list(db, 'needs_reply')
  assert.deepEqual(r.counts, { needs_reply: 2, all: 2, done: 0 })

  await db.query(`UPDATE conversations SET status = 'resolved' WHERE id = $1`, [C1])
  await db.query(`INSERT INTO message_conversation_visibility VALUES ($1, $2, now() + interval '1 day')`, [JESTER, C2])
  r = await list(db, 'done')
  assert.deepEqual(r.counts, { needs_reply: 0, all: 0, done: 2 })
  assert.equal(r.conversations.length, 2)
  assert.equal((await list(db, 'all')).conversations.length, 0)

  // Krystal never archived C2, so for her it is still open.
  await db.exec(`SET test.me = '${KRYSTAL}'`)
  r = await list(db, 'needs_reply')
  assert.deepEqual(r.counts, { needs_reply: 1, all: 1, done: 1 })
})

test('the badge count equals the Needs reply view', async () => {
  const db = await setup()
  const m = await post(db, C1, JOEL, 'student')
  await post(db, C2, CHLOE, 'student')
  await react(db, m, KRYSTAL)
  const { rows } = await db.query('SELECT messages_staff_needs_reply_count_v2() AS n')
  const r = await list(db, 'needs_reply')
  assert.equal(rows[0].n, 1)
  assert.equal(rows[0].n, r.counts.needs_reply)
  assert.equal(r.conversations[0].id, C2)
})

test('list rows carry what the row needs: preview author, handler, flags', async () => {
  const db = await setup()
  await post(db, C1, JOEL, 'student', 'Thank you')
  await post(db, C1, KRYSTAL, 'staff', 'Glad to help')
  const r = await list(db, 'all')
  const row = r.conversations.find((c) => c.id === C1)
  assert.equal(row.latest_author_role, 'staff')
  assert.equal(row.latest_author_profile_id, KRYSTAL)
  assert.equal(row.latest_author_name, 'Krystal Rodriguez')
  assert.equal(row.latest_preview, 'Glad to help')
  assert.equal(row.handled_by_name, 'Krystal Rodriguez')
  assert.equal(row.needs_reply, false)
  assert.equal(row.participant_name, 'Joel Brown')
})

test('search narrows the page but never the counts', async () => {
  const db = await setup()
  await post(db, C1, JOEL, 'student')
  await post(db, C2, CHLOE, 'student')
  const { rows } = await db.query(`SELECT messages_staff_list_conversations_v5(25, NULL, NULL, 'chloe', 'needs_reply') AS r`)
  assert.equal(rows[0].r.conversations.length, 1)
  assert.equal(rows[0].r.counts.needs_reply, 2)
})

test('an unknown view is refused', async () => {
  const db = await setup()
  await assert.rejects(db.query(`SELECT messages_staff_list_conversations_v5(25, NULL, NULL, NULL, 'archived')`), /invalid view/)
})

test('thread v5 adds reactor identities, author ids and the triage state', async () => {
  const db = await setup()
  const m = await post(db, C1, JOEL, 'student')
  const reply = await post(db, C1, JESTER, 'staff')
  await react(db, m, JESTER, 'acknowledge')
  await react(db, reply, JOEL, 'thanks')
  const { rows } = await db.query('SELECT messages_staff_get_thread_v5($1, 50, NULL, NULL) AS t', [C1])
  const t = rows[0].t
  assert.equal(t.triage_version, 2)
  assert.equal(t.conversation.needs_reply, false)
  assert.equal(t.conversation.handled_by_name, 'Jester Lloyd Bautista')
  assert.equal(t.reaction_set_version, 2, 'the v4 payload is preserved')
  const [first, second] = t.messages
  assert.equal(first.author_profile_id, JOEL)
  assert.deepEqual(first.reactors, [{ key: 'acknowledge', profile_id: JESTER, name: 'Jester Lloyd Bautista', is_staff: true }])
  assert.deepEqual(second.reactors, [{ key: 'thanks', profile_id: JOEL, name: 'Joel Brown', is_staff: false }])
})

test('the migration adds no tables and changes no rows', () => {
  assert.doesNotMatch(migration, /\b(CREATE|ALTER|DROP)\s+TABLE\b/i)
  assert.doesNotMatch(migration, /\b(INSERT\s+INTO|UPDATE\s+public\.|DELETE\s+FROM)\b/i)
})
