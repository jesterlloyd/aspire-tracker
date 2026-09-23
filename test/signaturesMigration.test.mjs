// test/signaturesMigration.test.mjs
//
// SIGNATURES-PHASE2: runs supabase/migrations/20260927000000_signatures_phase2.sql against a
// real Postgres (PGlite, in process) and proves what the legal requirements lean on:
//   - the flag is created OFF and the disclosure v1.0 is seeded,
//   - every audit event is chained to the one before it by the database, per request,
//     with the hash recomputable from the stored columns,
//   - UPDATE, DELETE and TRUNCATE on sig_events are refused,
//   - excluded statuses and bad settings are refused by constraints,
//   - the migration runs twice without error (it is idempotent).
// The Supabase pieces the migration references (roles, auth.uid(), storage.buckets, the
// referenced tables and the two staff helpers) are stubbed minimally first.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const migration = readFileSync(join(root, 'supabase/migrations/20260927000000_signatures_phase2.sql'), 'utf8')

const PRELUDE = `
  DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  DO $$ BEGIN CREATE ROLE service_role; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  CREATE SCHEMA IF NOT EXISTS auth;
  CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT NULL::uuid $$;
  CREATE SCHEMA IF NOT EXISTS storage;
  CREATE TABLE IF NOT EXISTS storage.buckets (id text PRIMARY KEY, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
  CREATE TABLE IF NOT EXISTS user_profiles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), auth_user_id uuid, role text, is_active boolean DEFAULT true);
  CREATE TABLE IF NOT EXISTS students (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE TABLE IF NOT EXISTS contacts (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE TABLE IF NOT EXISTS catalog_resources (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE OR REPLACE FUNCTION public.is_staff() RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
  CREATE OR REPLACE FUNCTION public.is_active_owner_or_admin() RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
`

async function fresh() {
  const db = new PGlite()
  await db.exec(PRELUDE)
  await db.exec(migration)
  return db
}

async function newRequest(db) {
  const { rows } = await db.query(
    `INSERT INTO sig_requests (envelope_code, title, document_type) VALUES ($1, 'Test', 'attestation') RETURNING id`,
    [`ENV-TEST-${Math.random().toString(36).slice(2, 8)}`])
  return rows[0].id
}

test('the migration applies, twice, and seeds the flag OFF and disclosure v1.0', async () => {
  const db = await fresh()
  await db.exec(migration)   // idempotent
  const flag = await db.query(`SELECT state FROM feature_flags WHERE key = 'catalog.signatures'`)
  assert.equal(flag.rows[0].state, 'off')
  const disc = await db.query(`SELECT version, jsonb_array_length(body->'points') AS n FROM sig_disclosures`)
  assert.deepEqual(disc.rows, [{ version: '1.0', n: 6 }])
  const s = await db.query(`SELECT seal_provider, tsa_url FROM sig_settings`)
  assert.deepEqual(s.rows[0], { seal_provider: 'env_p12', tsa_url: 'http://timestamp.digicert.com' })
  const b = await db.query(`SELECT public FROM storage.buckets WHERE id = 'signature-documents'`)
  assert.equal(b.rows[0].public, false)
})

test('every event is chained to the previous one, per request, and recomputes from its columns', async () => {
  const db = await fresh()
  const r1 = await newRequest(db), r2 = await newRequest(db)
  for (const [r, t] of [[r1, 'created'], [r2, 'created'], [r1, 'sent'], [r1, 'signed'], [r2, 'sent']]) {
    await db.query(`INSERT INTO sig_events (request_id, type, actor, ip, user_agent, details) VALUES ($1, $2, 'Tester', '10.0.0.1', 'UA', '{"k":1}')`, [r, t])
  }
  const { rows } = await db.query(`SELECT id, request_id, signer_id, type, to_char(at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS at_s, actor, ip, user_agent, details::text AS d, prev_hash, hash FROM sig_events ORDER BY id`)
  const chain = (rid) => rows.filter(r => r.request_id === rid)
  for (const rid of [r1, r2]) {
    const evs = chain(rid)
    assert.equal(evs[0].prev_hash, 'GENESIS')
    for (let i = 0; i < evs.length; i++) {
      const e = evs[i]
      if (i > 0) assert.equal(e.prev_hash, evs[i - 1].hash, 'each event names the one before it')
      const expected = createHash('sha256').update([e.prev_hash, e.request_id, e.signer_id || '', e.type, e.at_s, e.actor || '', e.ip || '', e.user_agent || '', e.d].join('|')).digest('hex')
      assert.equal(e.hash, expected, 'the hash recomputes from the stored columns')
    }
  }
  // A caller cannot supply its own hash.
  await db.query(`INSERT INTO sig_events (request_id, type, prev_hash, hash) VALUES ($1, 'forged', 'x', 'y')`, [r1])
  const forged = (await db.query(`SELECT prev_hash, hash FROM sig_events WHERE type = 'forged'`)).rows[0]
  assert.notEqual(forged.hash, 'y')
  assert.equal(forged.prev_hash, chain(r1).at(-1).hash)
})

test('sig_events refuses UPDATE, DELETE and TRUNCATE', async () => {
  const db = await fresh()
  const r = await newRequest(db)
  await db.query(`INSERT INTO sig_events (request_id, type) VALUES ($1, 'created')`, [r])
  await assert.rejects(db.query(`UPDATE sig_events SET type = 'x'`), /append-only/)
  await assert.rejects(db.query(`DELETE FROM sig_events`), /append-only/)
  await assert.rejects(db.exec(`TRUNCATE sig_events`), /append-only/)
  // And a request with events cannot be deleted out from under its trail.
  await assert.rejects(db.query(`DELETE FROM sig_requests WHERE id = $1`, [r]), /violates foreign key|restrict/i)
})

test('constraints refuse bad states and settings', async () => {
  const db = await fresh()
  await assert.rejects(db.query(`INSERT INTO sig_requests (envelope_code, title, document_type, status) VALUES ('E1', 't', 'x', 'lost')`), /chk_sig_requests_status/)
  await assert.rejects(db.query(`UPDATE feature_flags SET state = 'maybe'`), /chk_feature_flags_state/)
  await assert.rejects(db.query(`UPDATE sig_settings SET tsa_url = 'ftp://x'`), /chk_sig_settings_tsa_url/)
  const r = await newRequest(db)
  await assert.rejects(db.query(`INSERT INTO sig_request_signers (request_id, role_key, order_index, name, email, color) VALUES ($1, 'r1', 1, 'A', 'a@x.edu', 'pink')`, [r]), /chk_sig_signers_color/)
})
