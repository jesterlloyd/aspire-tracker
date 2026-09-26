// test/s24CohortSchoolRotationsReadScope.test.mjs
//
// S-24 (S24-1, 2026-09-25): cohort_school_rotations is readable by staff only. The
// migration runs on real Postgres (PGlite) with the table as 20260522000000 left it (two
// USING (true) SELECT policies, anon and authenticated grants) and four callers are tried:
// anon is refused, an authenticated session with no JWT reads nothing, an Academic Partner
// portal user reads nothing, a staff profile reads every row. Then a sweep: no migration in
// the repository may create a USING (true) policy on this table, and the register and the
// SQL gate were updated in the same commit.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(root, p), 'utf8')
const MIGRATION = 'supabase/migrations/20261007000000_s24_cohort_school_rotations_read_scope.sql'
const AUDIT = 'db/audit/s24_cohort_school_rotations_read_scope_checks.sql'
const migration = read(MIGRATION)
const audit = read(AUDIT)

const STAFF_UID = '11111111-1111-4111-8111-111111111111'
const PORTAL_UID = '22222222-2222-4222-8222-222222222222'

// Supabase's auth.uid() reads the JWT sub from a request setting; the stub does the same.
const PRELUDE = `
  DO $$ BEGIN CREATE ROLE anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  DO $$ BEGIN CREATE ROLE service_role NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  CREATE SCHEMA IF NOT EXISTS auth;
  CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
    SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  CREATE TABLE public.user_profiles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), auth_user_id uuid, role text, is_active boolean DEFAULT true);
  CREATE TABLE public.cohorts (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
  -- is_staff() as 20260712000000 defines it.
  CREATE OR REPLACE FUNCTION public.is_staff() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public, pg_catalog AS $$
    SELECT EXISTS (SELECT 1 FROM public.user_profiles WHERE auth_user_id = auth.uid()
      AND role IN ('owner', 'admin', 'co_lead', 'co-lead', 'interviewer', 'viewer') AND COALESCE(is_active, true) = true) $$;
  GRANT EXECUTE ON FUNCTION public.is_staff() TO authenticated;
  GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
  -- The table as 20260522000000 left it.
  CREATE TABLE public.cohort_school_rotations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    cohort_id uuid NOT NULL REFERENCES public.cohorts(id) ON DELETE CASCADE,
    school_name text NOT NULL,
    rotation_start_date date NOT NULL DEFAULT '1900-01-01',
    rotation_end_date date NOT NULL DEFAULT '1900-01-01',
    coordinator_name text, coordinator_email text);
  ALTER TABLE public.cohort_school_rotations ENABLE ROW LEVEL SECURITY;
  CREATE POLICY "cohort_school_rotations_authenticated_select" ON public.cohort_school_rotations FOR SELECT TO authenticated USING (true);
  CREATE POLICY "cohort_school_rotations_anon_select" ON public.cohort_school_rotations FOR SELECT TO anon USING (true);
  GRANT SELECT ON public.cohort_school_rotations TO anon, authenticated, service_role;
  INSERT INTO public.user_profiles (auth_user_id, role) VALUES ('${STAFF_UID}', 'admin'), ('${PORTAL_UID}', 'academic_partner');
  INSERT INTO public.cohorts (id) VALUES ('33333333-3333-4333-8333-333333333333');
  INSERT INTO public.cohort_school_rotations (cohort_id, school_name, coordinator_email) VALUES
    ('33333333-3333-4333-8333-333333333333', 'School A', 'a@example.edu'),
    ('33333333-3333-4333-8333-333333333333', 'School B', 'b@example.edu'),
    ('33333333-3333-4333-8333-333333333333', 'School C', NULL);
`

async function fresh() {
  const db = new PGlite()
  await db.exec(PRELUDE)
  return db
}

async function countAs(db, role, sub) {
  await db.exec(`BEGIN`)
  try {
    await db.query(`SELECT set_config('request.jwt.claim.sub', $1, true)`, [sub || ''])
    await db.exec(`SET LOCAL ROLE ${role}`)
    const { rows } = await db.query(`SELECT count(*)::int AS n FROM public.cohort_school_rotations`)
    return rows[0].n
  } finally {
    await db.exec(`ROLLBACK`)
  }
}

test('before the migration the exposure is real: anon and a portal user read every row', async () => {
  const db = await fresh()
  assert.equal(await countAs(db, 'anon', null), 3)
  assert.equal(await countAs(db, 'authenticated', PORTAL_UID), 3)
})

test('after the migration: anon refused, no-JWT and portal user read nothing, staff reads every row', async () => {
  const db = await fresh()
  await db.exec(migration)
  await assert.rejects(countAs(db, 'anon', null), /permission denied/)
  assert.equal(await countAs(db, 'authenticated', null), 0)
  assert.equal(await countAs(db, 'authenticated', PORTAL_UID), 0)
  assert.equal(await countAs(db, 'authenticated', STAFF_UID), 3)
  const { rows: policies } = await db.query(
    `SELECT policyname, cmd, roles::text[] AS roles, qual FROM pg_policies WHERE tablename = 'cohort_school_rotations' ORDER BY policyname`)
  assert.deepEqual(policies, [{ policyname: 'cohort_school_rotations_staff_select', cmd: 'SELECT', roles: ['authenticated'], qual: 'is_staff()' }])
  const { rows: [g] } = await db.query(`SELECT has_table_privilege('anon', 'public.cohort_school_rotations', 'SELECT') AS anon,
    has_table_privilege('authenticated', 'public.cohort_school_rotations', 'SELECT') AS auth,
    has_table_privilege('service_role', 'public.cohort_school_rotations', 'SELECT') AS svc`)
  assert.deepEqual(g, { anon: false, auth: true, svc: true })
})

test('the migration runs twice, and refuses without is_staff()', async () => {
  const db = await fresh()
  await db.exec(migration)
  await db.exec(migration)
  assert.equal(await countAs(db, 'authenticated', STAFF_UID), 3)

  const bare = new PGlite()
  await bare.exec(PRELUDE.replace(/CREATE OR REPLACE FUNCTION public\.is_staff\(\)[\s\S]*?\$\$;\s*GRANT EXECUTE ON FUNCTION public\.is_staff\(\) TO authenticated;/, ''))
  await assert.rejects(bare.exec(migration), /is_staff\(\) must exist/)
  await bare.exec('ROLLBACK')
  assert.equal(await countAs(bare, 'anon', null), 3, 'nothing from the file survives the refusal')
})

test('sweep: no migration creates a USING (true) policy on cohort_school_rotations, and the two old names are dropped', () => {
  const dir = join(root, 'supabase/migrations')
  const offenders = []
  for (const f of readdirSync(dir).filter(f => f.endsWith('.sql') && !/ \d\.sql$/.test(f))) {
    if (f.startsWith('20260522000000')) continue   // the original, superseded by this migration
    const sql = readFileSync(join(dir, f), 'utf8').replace(/^\s*--.*$/gm, '')
    for (const m of sql.matchAll(/CREATE POLICY[^;]*?ON (?:public\.)?cohort_school_rotations\b[^;]*;/gi)) {
      if (/USING\s*\(\s*true\s*\)/i.test(m[0])) offenders.push(`${f}: ${m[0].slice(0, 80)}`)
    }
  }
  assert.deepEqual(offenders, [])
  assert.match(migration, /DROP POLICY IF EXISTS "cohort_school_rotations_anon_select"/)
  assert.match(migration, /DROP POLICY IF EXISTS "cohort_school_rotations_authenticated_select"/)
  assert.match(migration, /USING \(public\.is_staff\(\)\)/)
  assert.doesNotMatch(migration.replace(/^\s*--.*$/gm, ''), /USING \(true\)/)
  assert.match(migration, /^BEGIN;/m)
  assert.match(migration, /^COMMIT;/m)
})

test('the audit file is read-only apart from one DO block that ends by rolling itself back', () => {
  assert.equal(audit.match(/^-- ── (PRE|POST) \d+:/gm).length, 6)
  const blocks = [...audit.matchAll(/DO \$(post\d)\$([\s\S]*?)\$\1\$;/g)]
  assert.equal(blocks.length, 1)
  assert.match(blocks[0][2], /RAISE EXCEPTION 'S-24 POST 3 % \(rolled back on purpose\)/)
  const outside = audit.replace(/DO \$(post\d)\$[\s\S]*?\$\1\$;/g, '').replace(/^\s*--.*$/gm, '')
  assert.doesNotMatch(outside, /^\s*(INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|TRUNCATE|GRANT|REVOKE)\b/im)
  assert.doesNotMatch(audit, /coordinator_email|coordinator_name|full_name|email\b/i, 'no names or emails are selected')
})

test('the register and the SQL gate were updated, and no changed file carries an em dash', () => {
  const register = read('docs/security/FINDINGS_REGISTER.md')
  const s24 = register.slice(register.indexOf('## S-24.'), register.indexOf('## S-25.'))
  // Repinned when the Owner applied 20261007000000 on 2026-09-26 (S24-2): the finding is Closed.
  assert.match(s24, /\*\*Status\*\*: Closed\./)
  assert.doesNotMatch(s24, /SQL unconfirmed/)
  assert.match(s24, /20261007000000_s24_cohort_school_rotations_read_scope\.sql/)
  const gate = read('docs/security/OWNER_SQL_GATE.md')
  assert.match(gate, /^\| 20261007000000_s24_cohort_school_rotations_read_scope\.sql \|.*APPLIED 2026-09-26/m)
  assert.doesNotMatch(gate, /^\| 20261007000000_s24_cohort_school_rotations_read_scope\.sql \|.*UNKNOWN/m)
  const dash = new RegExp(String.fromCharCode(8212))
  for (const p of [MIGRATION, AUDIT]) {
    assert.doesNotMatch(read(p), dash, `${p}: no em dash`)
    assert.doesNotMatch(read(p), new RegExp('ASPIRE ' + 'Program'))
  }
  assert.doesNotMatch(s24, dash)
})
