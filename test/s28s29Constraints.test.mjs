// test/s28s29Constraints.test.mjs
//
// S-28 and S-29 (S28-1 / S29-1, 2026-09-26), plus the activity_logs follow-up from S-23.
// The migration runs on real Postgres (PGlite): a second active token on an assignment
// is refused while revoked or used tokens may accumulate; a second session on a slot is
// refused while sessions without a slot may accumulate; activity_logs refuses UPDATE,
// DELETE and TRUNCATE and still accepts INSERT; the guard names violating ids and applies
// nothing; the file runs twice. The cancel-path fix (S28-2) and the docs are pinned.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(root, p), 'utf8')
const MIGRATION = 'supabase/migrations/20261008000000_s28_s29_constraints_and_activity_logs.sql'
const AUDIT = 'db/audit/s28_s29_constraints_and_activity_logs_checks.sql'
const migration = read(MIGRATION)
const audit = read(AUDIT)

const A1 = '11111111-1111-4111-8111-111111111111'
const A2 = '22222222-2222-4222-8222-222222222222'
const SLOT1 = '33333333-3333-4333-8333-333333333333'
const SLOT2 = '44444444-4444-4444-8444-444444444444'
const STU1 = '55555555-5555-4555-8555-555555555555'
const STU2 = '66666666-6666-4666-8666-666666666666'

const PRELUDE = `
  DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  DO $$ BEGIN CREATE ROLE service_role; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  CREATE OR REPLACE FUNCTION public.append_only_refuse() RETURNS trigger LANGUAGE plpgsql AS $$
  BEGIN RAISE EXCEPTION '% is append-only: % refused', TG_TABLE_NAME, TG_OP USING ERRCODE = '42501'; END $$;
  CREATE TABLE public.evaluation_assignment_tokens (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), assignment_id uuid NOT NULL,
    token_hash text NOT NULL UNIQUE, token_hash_prefix text, expires_at timestamptz NOT NULL,
    revoked_at timestamptz, used_at timestamptz);
  CREATE TABLE public.interview_slots (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), booked_by_student_id uuid);
  CREATE UNIQUE INDEX uq_interview_slots_one_booking_per_student ON public.interview_slots (booked_by_student_id) WHERE booked_by_student_id IS NOT NULL;
  CREATE TABLE public.interview_sessions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), student_id uuid, session_number int DEFAULT 1,
    slot_id uuid REFERENCES public.interview_slots(id) ON DELETE SET NULL);
  CREATE TABLE public.activity_logs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), action_type text, created_at timestamptz DEFAULT now());
  GRANT ALL ON public.activity_logs TO service_role;
  INSERT INTO public.interview_slots (id, booked_by_student_id) VALUES ('${SLOT1}', '${STU1}'), ('${SLOT2}', NULL);
`

async function fresh(seed = '') {
  const db = new PGlite()
  await db.exec(PRELUDE + seed)
  return db
}
const tok = (a, extra = '') => `INSERT INTO public.evaluation_assignment_tokens (assignment_id, token_hash, expires_at ${extra ? ', ' + extra.split('=')[0] : ''}) VALUES ('${a}', md5(random()::text || clock_timestamp()::text), now() + interval '1 day' ${extra ? ', ' + extra.split('=')[1] : ''})`

test('S-29: one active token per assignment; revoked and used tokens may accumulate', async () => {
  const db = await fresh(`${tok(A1)};`)
  await db.exec(migration)
  await assert.rejects(db.exec(tok(A1)), /uq_eval_tokens_one_active/)
  await db.exec(tok(A1, 'revoked_at=now()'))
  await db.exec(tok(A1, 'used_at=now()'))
  await db.exec(tok(A2))
  const { rows: [{ n }] } = await db.query(`SELECT count(*)::int AS n FROM public.evaluation_assignment_tokens`)
  assert.equal(n, 4)
  // revoking the active one lets a new one in (the reissue path)
  await db.exec(`UPDATE public.evaluation_assignment_tokens SET revoked_at = now() WHERE assignment_id = '${A1}' AND revoked_at IS NULL AND used_at IS NULL`)
  await db.exec(tok(A1))
})

test('S-28: one session per slot; sessions without a slot may accumulate; a move works', async () => {
  const db = await fresh(`INSERT INTO public.interview_sessions (student_id, slot_id) VALUES ('${STU1}', '${SLOT1}');`)
  await db.exec(migration)
  await assert.rejects(db.exec(`INSERT INTO public.interview_sessions (student_id, slot_id) VALUES ('${STU2}', '${SLOT1}')`), /uq_interview_sessions_one_per_slot/)
  await db.exec(`INSERT INTO public.interview_sessions (student_id, slot_id) VALUES ('${STU2}', NULL)`)
  await db.exec(`INSERT INTO public.interview_sessions (student_id, slot_id, session_number) VALUES ('${STU1}', NULL, 2)`)
  await db.exec(`UPDATE public.interview_sessions SET slot_id = '${SLOT2}' WHERE slot_id = '${SLOT1}'`)   // move_booking
  await db.exec(`INSERT INTO public.interview_sessions (student_id, slot_id) VALUES ('${STU2}', '${SLOT1}')`)   // the freed slot can be booked again
})

test('activity_logs: INSERT works, UPDATE, DELETE and TRUNCATE are refused, grants trimmed', async () => {
  const db = await fresh()
  await db.exec(migration)
  await db.exec(`INSERT INTO public.activity_logs (action_type) VALUES ('x')`)
  await assert.rejects(db.exec(`UPDATE public.activity_logs SET action_type = 'y'`), /append-only/)
  await assert.rejects(db.exec(`DELETE FROM public.activity_logs`), /append-only/)
  await assert.rejects(db.exec(`TRUNCATE public.activity_logs`), /append-only/)
  for (const priv of ['UPDATE', 'DELETE', 'TRUNCATE']) {
    const { rows: [{ ok }] } = await db.query(`SELECT has_table_privilege('service_role', 'public.activity_logs', $1) AS ok`, [priv])
    assert.equal(ok, false, `service_role must not hold ${priv}`)
  }
  const { rows: [{ ins }] } = await db.query(`SELECT has_table_privilege('service_role', 'public.activity_logs', 'INSERT') AS ins`)
  assert.equal(ins, true)
})

test('the guard names violating ids and applies nothing; the file runs twice', async () => {
  const dupTokens = await fresh(`${tok(A1)}; ${tok(A1)};`)
  await assert.rejects(dupTokens.exec(migration), new RegExp(`S-29: more than one active token on assignment\\(s\\) ${A1} \\(2 active\\)`))
  await dupTokens.exec('ROLLBACK')
  const { rows: [{ idx }] } = await dupTokens.query(`SELECT to_regclass('public.uq_eval_tokens_one_active') IS NOT NULL AS idx`)
  assert.equal(idx, false)
  const { rows: [{ trg }] } = await dupTokens.query(`SELECT count(*)::int AS trg FROM pg_trigger WHERE tgrelid = 'public.activity_logs'::regclass AND NOT tgisinternal`)
  assert.equal(trg, 0, 'nothing from the file survives the refusal')

  const dupSlots = await fresh(`INSERT INTO public.interview_sessions (student_id, slot_id) VALUES ('${STU1}', '${SLOT1}'), ('${STU2}', '${SLOT1}');`)
  await assert.rejects(dupSlots.exec(migration), new RegExp(`S-28: more than one session on slot\\(s\\) ${SLOT1} \\(2 sessions\\)`))

  const noFn = new PGlite()
  await noFn.exec(PRELUDE.replace(/CREATE OR REPLACE FUNCTION public\.append_only_refuse\(\)[\s\S]*?END \$\$;/, ''))
  await assert.rejects(noFn.exec(migration), /append_only_refuse\(\) must exist/)

  const twice = await fresh()
  await twice.exec(migration)
  await twice.exec(migration)
  const { rows } = await twice.query(`SELECT indexname FROM pg_indexes WHERE indexname IN ('uq_eval_tokens_one_active', 'uq_interview_sessions_one_per_slot') ORDER BY 1`)
  assert.deepEqual(rows.map(r => r.indexname), ['uq_eval_tokens_one_active', 'uq_interview_sessions_one_per_slot'])
})

test('S28-2: cancel_booking clears slot_id on a session it keeps', () => {
  const src = read('api/availability.js')
  const start = src.indexOf("action === 'cancel_booking'")
  const cancel = src.slice(start, src.indexOf("from('students')", start))
  assert.match(cancel, /if \(!hasRubric\) \{\s*await db\.from\('interview_sessions'\)\.delete\(\)\.eq\('id', sess\.id\);\s*\} else \{[\s\S]*?\.update\(\{ slot_id: null \}\)\.eq\('id', sess\.id\)/)
})

test('the migration is one transaction with a guard before each index, and the audit is read-only apart from one rolled-back block', () => {
  assert.match(migration, /^BEGIN;/m)
  assert.match(migration, /^COMMIT;/m)
  const code = migration.replace(/^\s*--.*$/gm, '')
  assert.ok(code.indexOf('RAISE EXCEPTION \'S-29') < code.indexOf('CREATE UNIQUE INDEX IF NOT EXISTS uq_eval_tokens_one_active'))
  assert.ok(code.indexOf('RAISE EXCEPTION \'S-28') < code.indexOf('CREATE UNIQUE INDEX IF NOT EXISTS uq_interview_sessions_one_per_slot'))
  assert.equal(audit.match(/^-- ── (PRE|POST) \d+:/gm).length, 10)
  const blocks = [...audit.matchAll(/DO \$(post\d)\$([\s\S]*?)\$\1\$;/g)]
  assert.equal(blocks.length, 1)
  assert.match(blocks[0][2], /RAISE EXCEPTION 'S-28\/S-29 POST 5 % \(rolled back on purpose\)/)
  const outside = audit.replace(/DO \$(post\d)\$[\s\S]*?\$\1\$;/g, '').replace(/^\s*--.*$/gm, '')
  assert.doesNotMatch(outside, /^\s*(INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|TRUNCATE|GRANT|REVOKE)\b/im)
})

test('the register and the SQL gate were updated, and no changed file carries an em dash', () => {
  const register = read('docs/security/FINDINGS_REGISTER.md')
  const s28 = register.slice(register.indexOf('## S-28.'), register.indexOf('## S-29.'))
  const s29 = register.slice(register.indexOf('## S-29.'), register.indexOf('## S-30.'))
  assert.match(s28, /Closed \(code\); SQL unconfirmed/)
  assert.match(s29, /Closed \(code\); SQL unconfirmed/)
  assert.match(s28, /Apply only after S28-2 is\s+live/)
  const gate = read('docs/security/OWNER_SQL_GATE.md')
  assert.match(gate, /^\| 20261008000000_s28_s29_constraints_and_activity_logs\.sql \|.*UNKNOWN/m)
  const dash = new RegExp(String.fromCharCode(8212))
  for (const p of [MIGRATION, AUDIT, 'api/availability.js']) {
    assert.doesNotMatch(read(p), dash, `${p}: no em dash`)
    assert.doesNotMatch(read(p), new RegExp('ASPIRE ' + 'Program'))
  }
  assert.doesNotMatch(s28 + s29, dash)
})
