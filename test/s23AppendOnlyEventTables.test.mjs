// test/s23AppendOnlyEventTables.test.mjs
//
// S-23 (S23-1, 2026-09-25): tables documented as append-only event, audit or history
// ledgers are append-only at the database. Three proofs:
//   1. The migration, on real Postgres (PGlite): every covered table accepts an INSERT and
//      refuses UPDATE, DELETE and TRUNCATE whatever role issues them; a parent that cascades
//      into a covered table can no longer be deleted (the template's behaviour); it runs
//      twice without error; it refuses to run at all when a covered table is missing.
//   2. A sweep: every table created in supabase/migrations whose name ends in _events or
//      _audit, plus the documented ledgers listed below, is covered by both triggers, or is
//      excused here with the reason. A new event table without them fails this test.
//   3. The audit file is read-only apart from its two rolled-back DO blocks, and the register
//      and the SQL gate were updated in the same commit.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(root, p), 'utf8')
const MIGRATION = 'supabase/migrations/20261006000000_s23_append_only_event_tables.sql'
const AUDIT = 'db/audit/s23_append_only_event_tables_checks.sql'
const migration = read(MIGRATION)
const audit = read(AUDIT)

// The fourteen tables the migration loops over, read from the migration itself so the test
// cannot drift from it.
const LOOPED = [...migration.matchAll(/^\s{4}'([a-z_]+)'[,\s]*$/gm)].map(m => m[1])
  .filter((t, i, a) => a.indexOf(t) === i)
const COVERED = [...LOOPED, 'form_answer_corrections']

// Documented append-only ledgers whose names do not end in _events or _audit.
const DOCUMENTED_LEDGERS = ['shift_log_reviews', 'student_shift_log_edits', 'keith_requests', 'keith_skill_invocations', 'form_answer_corrections']

// Excused from the sweep, each with the reason recorded in FINDINGS_REGISTER S-23.
const EXCUSED = {
  student_activity_completions: 'cascades from students, which the staff app deletes; grant-enforced since 20260822000000',
}

const PRELUDE = `
  DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  DO $$ BEGIN CREATE ROLE service_role; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  CREATE TABLE public.unit_placement_requests (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE OR REPLACE FUNCTION public.form_answer_corrections_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
  BEGIN RAISE EXCEPTION 'form_answer_corrections is append-only: record a new correction instead' USING ERRCODE = '42501'; END $$;
`

function stubs() {
  return COVERED.map(t => t === 'unit_placement_request_events'
    ? `CREATE TABLE public.${t} (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), request_id uuid NOT NULL REFERENCES public.unit_placement_requests(id) ON DELETE CASCADE, note text, created_at timestamptz NOT NULL DEFAULT now());
       GRANT ALL ON public.${t} TO service_role, authenticated;`
    : `CREATE TABLE public.${t} (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), note text, created_at timestamptz NOT NULL DEFAULT now());
       GRANT ALL ON public.${t} TO service_role, authenticated;`).join('\n') +
    `\nCREATE TRIGGER trg_form_answer_corrections_append_only BEFORE UPDATE OR DELETE ON public.form_answer_corrections FOR EACH ROW EXECUTE FUNCTION public.form_answer_corrections_append_only();`
}

async function fresh() {
  const db = new PGlite()
  await db.exec(PRELUDE)
  await db.exec(stubs())
  await db.exec(migration)
  return db
}

test('fourteen looped tables plus form_answer_corrections, fifteen in all', () => {
  assert.equal(LOOPED.length, 14, LOOPED.join(','))
  assert.ok(LOOPED.includes('preceptor_assignment_events'))
  assert.ok(LOOPED.includes('unit_placement_request_events'))
  assert.ok(LOOPED.includes('cohort_unit_response_target_events'))
  assert.ok(!LOOPED.includes('student_activity_completions'), 'a trigger there would break student deletion')
  assert.match(migration, /^BEGIN;/m)
  assert.match(migration, /^COMMIT;/m)
})

test('every covered table accepts INSERT and refuses UPDATE, DELETE and TRUNCATE', async () => {
  const db = await fresh()
  await db.query(`INSERT INTO public.unit_placement_requests DEFAULT VALUES`)
  const { rows: [{ id: reqId }] } = await db.query(`SELECT id FROM public.unit_placement_requests`)
  for (const t of COVERED) {
    const insert = t === 'unit_placement_request_events'
      ? db.query(`INSERT INTO public.${t} (request_id, note) VALUES ($1, 'x') RETURNING id`, [reqId])
      : db.query(`INSERT INTO public.${t} (note) VALUES ('x') RETURNING id`)
    const { rows } = await insert
    assert.equal(rows.length, 1, `${t}: insert succeeds`)
    await assert.rejects(db.query(`UPDATE public.${t} SET note = 'y'`), /append-only/, `${t}: update refused`)
    await assert.rejects(db.query(`DELETE FROM public.${t}`), /append-only/, `${t}: delete refused`)
    await assert.rejects(db.exec(`TRUNCATE public.${t}`), /append-only/, `${t}: truncate refused`)
    const { rows: [{ n }] } = await db.query(`SELECT count(*)::int AS n FROM public.${t}`)
    assert.equal(n, 1, `${t}: the row is still there`)
    for (const role of ['service_role', 'authenticated', 'anon']) {
      for (const priv of ['UPDATE', 'DELETE', 'TRUNCATE']) {
        const { rows: [{ ok }] } = await db.query(`SELECT has_table_privilege($1, $2, $3) AS ok`, [role, `public.${t}`, priv])
        assert.equal(ok, false, `${t}: ${role} must not hold ${priv}`)
      }
    }
    const { rows: [{ ins }] } = await db.query(`SELECT has_table_privilege('service_role', $1, 'INSERT') AS ins`, [`public.${t}`])
    assert.equal(ins, true, `${t}: service_role keeps INSERT`)
  }
  const { rows: [{ code }] } = await db.query(`SELECT 1 AS code`)
  assert.equal(code, 1)
  // The refusal is insufficient_privilege (42501), so PostgREST reports a permission error.
  try { await db.query(`UPDATE public.ngrp_audit_events SET note = 'z'`); assert.fail('must throw') }
  catch (e) { assert.equal(e.code ?? e.fields?.code, '42501') }
})

test('a parent that cascades into a covered table can no longer be deleted (template behaviour)', async () => {
  const db = await fresh()
  await db.query(`INSERT INTO public.unit_placement_requests DEFAULT VALUES`)
  const { rows: [{ id }] } = await db.query(`SELECT id FROM public.unit_placement_requests`)
  await db.query(`INSERT INTO public.unit_placement_request_events (request_id, note) VALUES ($1, 'created')`, [id])
  await assert.rejects(db.query(`DELETE FROM public.unit_placement_requests WHERE id = $1`, [id]), /append-only/)
  const { rows: [{ n }] } = await db.query(`SELECT count(*)::int AS n FROM public.unit_placement_requests`)
  assert.equal(n, 1)
})

test('the migration runs twice, and refuses to run when a covered table is missing', async () => {
  const db = await fresh()
  await db.exec(migration)
  const { rows } = await db.query(`
    SELECT count(*)::int AS n FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
    WHERE NOT t.tgisinternal AND c.relname = ANY($1)`, [COVERED])
  assert.equal(rows[0].n, 30, 'two triggers per table, corrections keeps its own append-only one')

  const bare = new PGlite()
  await bare.exec(PRELUDE)
  await bare.exec(stubs().split('\n').filter(l => !l.includes('keith_requests')).join('\n'))
  await assert.rejects(bare.exec(migration), /public\.keith_requests does not exist; nothing was applied/)
  await bare.exec('ROLLBACK')
  const { rows: [{ fn }] } = await bare.query(`SELECT to_regproc('public.append_only_refuse') IS NOT NULL AS fn`)
  assert.equal(fn, false, 'nothing from the file survives the refusal')
})

test('sweep: every event or audit table in the migrations is covered, or excused with a reason', () => {
  const dir = join(root, 'supabase/migrations')
  const files = readdirSync(dir).filter(f => f.endsWith('.sql') && !/ \d\.sql$/.test(f))
  const created = new Set()
  const triggered = { updateDelete: new Set(), truncate: new Set() }
  for (const f of files) {
    const sql = readFileSync(join(dir, f), 'utf8').replace(/^\s*--.*$/gm, '')
    for (const m of sql.matchAll(/CREATE TABLE (?:IF NOT EXISTS )?(?:public\.)?([a-z_]+)/gi)) created.add(m[1].toLowerCase())
    for (const m of sql.matchAll(/CREATE TRIGGER \S+\s+BEFORE UPDATE OR DELETE ON (?:public\.)?([a-z_]+)/gi)) triggered.updateDelete.add(m[1])
    for (const m of sql.matchAll(/CREATE TRIGGER \S+\s+BEFORE TRUNCATE ON (?:public\.)?([a-z_]+)/gi)) triggered.truncate.add(m[1])
  }
  for (const t of LOOPED) { triggered.updateDelete.add(t); triggered.truncate.add(t) }
  const eventTables = [...created].filter(t => /_events$|_audit$/.test(t)).concat(DOCUMENTED_LEDGERS)
  assert.ok(eventTables.length >= 17, `found ${eventTables.length}: ${eventTables.join(', ')}`)
  const missing = []
  for (const t of new Set(eventTables)) {
    if (EXCUSED[t]) continue
    if (!triggered.updateDelete.has(t) || !triggered.truncate.has(t)) missing.push(t)
  }
  assert.deepEqual(missing, [], 'event tables without both triggers (add them to the S-23 migration or excuse them with a reason)')
  for (const t of Object.keys(EXCUSED)) assert.ok(created.has(t), `${t} is excused but not created`)
})

test('the audit file is read-only apart from two DO blocks that end by rolling themselves back', () => {
  const sections = audit.match(/^-- ── (PRE|POST) \d+:/gm)
  assert.equal(sections.length, 9)
  const blocks = [...audit.matchAll(/DO \$(post\d)\$([\s\S]*?)\$\1\$;/g)]
  assert.equal(blocks.length, 2)
  for (const [, name, body] of blocks) {
    assert.match(body, /RAISE EXCEPTION 'S-23 POST \d % \(rolled back on purpose\)/, `${name} ends by raising`)
  }
  const outside = audit.replace(/DO \$(post\d)\$[\s\S]*?\$\1\$;/g, '').replace(/^\s*--.*$/gm, '')
  assert.doesNotMatch(outside, /^\s*(INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|TRUNCATE|GRANT|REVOKE)\b/im)
  assert.match(audit, /then the migration as ONE block, then POST 1 to 5/)
})

test('the register and the SQL gate were updated, and no changed file carries an em dash', () => {
  const register = read('docs/security/FINDINGS_REGISTER.md')
  const s23 = register.slice(register.indexOf('## S-23.'), register.indexOf('## S-24.'))
  assert.match(s23, /Closed \(code\); SQL unconfirmed/)
  assert.match(s23, /20261006000000_s23_append_only_event_tables\.sql/)
  assert.match(s23, /student_activity_completions/)
  const gate = read('docs/security/OWNER_SQL_GATE.md')
  assert.match(gate, /^\| 20261006000000_s23_append_only_event_tables\.sql \|.*UNKNOWN/m)
  const dash = new RegExp(String.fromCharCode(8212))
  for (const p of [MIGRATION, AUDIT]) {
    assert.doesNotMatch(read(p), dash, `${p}: no em dash`)
    assert.doesNotMatch(read(p), new RegExp('ASPIRE ' + 'Program'))
  }
  assert.doesNotMatch(s23, dash)
})
