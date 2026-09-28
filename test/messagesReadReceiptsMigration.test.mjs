// test/messagesReadReceiptsMigration.test.mjs
//
// MESSAGES-RECEIPTS-1: runs supabase/migrations/20261015000000_messages_read_receipts.sql
// on real Postgres (PGlite) and walks one message from Sent to Delivered to Read,
// on both sides, and proves a receipt appears only on the viewer side's own
// latest message. The tables are minimal stubs of the applied schema.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const migration = readFileSync(new URL('../supabase/migrations/20261015000000_messages_read_receipts.sql', import.meta.url), 'utf8')

const STAFF = '00000000-0000-0000-0000-00000000000a'
const STAFF2 = '00000000-0000-0000-0000-00000000000b'
const STUDENT = '00000000-0000-0000-0000-00000000000c'
const OTHER = '00000000-0000-0000-0000-00000000000d'
const C = '10000000-0000-0000-0000-000000000001'

const PRELUDE = `
  DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  DO $$ BEGIN CREATE ROLE service_role; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  CREATE TABLE messages (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), conversation_id uuid,
    author_profile_id uuid, author_role text, created_at timestamptz);
  CREATE TABLE conversation_participants (conversation_id uuid, participant_profile_id uuid, removed_at timestamptz);
  CREATE TABLE participant_conversation_reads (participant_profile_id uuid, conversation_id uuid, last_read_at timestamptz);
  CREATE TABLE staff_conversation_reads (staff_profile_id uuid, conversation_id uuid, last_read_at timestamptz);
  CREATE TABLE message_notification_deliveries (message_id uuid, provider_status text);
  CREATE OR REPLACE FUNCTION public.portal_profile_id() RETURNS uuid LANGUAGE sql STABLE
    AS $$ SELECT current_setting('test.me')::uuid $$;
  CREATE OR REPLACE FUNCTION public.messages_staff_get_thread_v5(uuid, integer, timestamptz, uuid)
    RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT jsonb_build_object('conversation', jsonb_build_object('id', $1)) $$;
  CREATE OR REPLACE FUNCTION public.messages_portal_get_thread_v4(uuid, integer, timestamptz, uuid)
    RETURNS jsonb LANGUAGE sql STABLE AS $$
      SELECT CASE WHEN EXISTS (SELECT 1 FROM conversation_participants
        WHERE conversation_id = $1 AND participant_profile_id = current_setting('test.me')::uuid)
      THEN jsonb_build_object('conversation', jsonb_build_object('id', $1)) END $$;
`

async function setup() {
  const db = new PGlite()
  await db.exec(PRELUDE)
  await db.exec(migration)
  await db.exec(`INSERT INTO conversation_participants VALUES ('${C}', '${STUDENT}', NULL)`)
  return db
}
const post = async (db, author, role, at) => (await db.query(
  'INSERT INTO messages (conversation_id, author_profile_id, author_role, created_at) VALUES ($1,$2,$3,$4) RETURNING id',
  [C, author, role, at])).rows[0].id
const receipt = async (db, side, viewer) =>
  (await db.query('SELECT messages_receipt_state($1, $2, $3) AS r', [C, side, viewer])).rows[0].r

test('a staff message goes Sent, then Delivered, then Read', async () => {
  const db = await setup()
  const m = await post(db, STAFF, 'staff', '2026-09-28T10:00:00Z')
  assert.deepEqual(await receipt(db, 'staff', STAFF), { message_id: m, state: 'sent' })
  await db.query(`INSERT INTO message_notification_deliveries VALUES ($1, 'sent')`, [m])
  assert.equal((await receipt(db, 'staff', STAFF)).state, 'sent', 'handed to Resend is not delivered')
  await db.query(`UPDATE message_notification_deliveries SET provider_status = 'delivered'`)
  assert.equal((await receipt(db, 'staff', STAFF)).state, 'delivered')
  await db.query(`INSERT INTO participant_conversation_reads VALUES ($1, $2, '2026-09-28T09:00:00Z')`, [STUDENT, C])
  assert.equal((await receipt(db, 'staff', STAFF)).state, 'delivered', 'a read BEFORE the message does not count')
  await db.query(`UPDATE participant_conversation_reads SET last_read_at = '2026-09-28T10:05:00Z'`)
  assert.equal((await receipt(db, 'staff', STAFF)).state, 'read')
})

test('a staff receipt shows for any staff viewer (the team speaks as one)', async () => {
  const db = await setup()
  await post(db, STAFF, 'staff', '2026-09-28T10:00:00Z')
  assert.equal((await receipt(db, 'staff', STAFF2)).state, 'sent')
})

test('a removed participant reading does not count as read', async () => {
  const db = await setup()
  await db.exec(`INSERT INTO conversation_participants VALUES ('${C}', '${OTHER}', now())`)
  await post(db, STAFF, 'staff', '2026-09-28T10:00:00Z')
  await db.query(`INSERT INTO participant_conversation_reads VALUES ($1, $2, '2026-09-28T11:00:00Z')`, [OTHER, C])
  assert.equal((await receipt(db, 'staff', STAFF)).state, 'sent')
})

test('a participant message is Read once any staff member opens it', async () => {
  const db = await setup()
  await post(db, STUDENT, 'student', '2026-09-28T10:00:00Z')
  assert.equal((await receipt(db, 'portal', STUDENT)).state, 'sent')
  await db.query(`INSERT INTO staff_conversation_reads VALUES ($1, $2, '2026-09-28T10:30:00Z')`, [STAFF2, C])
  assert.equal((await receipt(db, 'portal', STUDENT)).state, 'read')
})

test('no receipt when the latest message is the other side\'s', async () => {
  const db = await setup()
  await post(db, STAFF, 'staff', '2026-09-28T10:00:00Z')
  await post(db, STUDENT, 'student', '2026-09-28T10:10:00Z')
  assert.equal(await receipt(db, 'staff', STAFF), null)
  assert.equal((await receipt(db, 'portal', STUDENT)).state, 'sent')
  assert.equal(await receipt(db, 'portal', OTHER), null, 'another participant never sees it')
})

test('the thread readers carry the receipt; a non-participant gets nothing', async () => {
  const db = await setup()
  await post(db, STUDENT, 'student', '2026-09-28T10:00:00Z')
  await db.exec(`SET test.me = '${STUDENT}'`)
  let r = (await db.query('SELECT messages_portal_get_thread_v5($1, 50, NULL, NULL) AS t', [C])).rows[0].t
  assert.equal(r.receipt.state, 'sent')
  assert.equal(r.conversation.id, C, 'the v4 payload is preserved')
  await db.exec(`SET test.me = '${OTHER}'`)
  r = (await db.query('SELECT messages_portal_get_thread_v5($1, 50, NULL, NULL) AS t', [C])).rows[0].t
  assert.equal(r, null)
  await db.exec(`SET test.me = '${STAFF}'`)
  r = (await db.query('SELECT messages_staff_get_thread_v6($1, 50, NULL, NULL) AS t', [C])).rows[0].t
  assert.equal(r.receipt, null, 'the student wrote last')
})

test('the migration adds no tables and changes no rows', () => {
  assert.doesNotMatch(migration, /\b(CREATE|ALTER|DROP)\s+TABLE\b/i)
  assert.doesNotMatch(migration, /\b(INSERT\s+INTO|UPDATE\s+public\.|DELETE\s+FROM)\b/i)
})
