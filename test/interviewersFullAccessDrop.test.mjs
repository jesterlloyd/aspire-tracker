// test/interviewersFullAccessDrop.test.mjs
//
// POST 1 of the Wave E split verification surfaced "Full access on interviewers", a FOR ALL TO
// public USING (true) policy that this repository has never contained. It was created out-of-band
// in the Supabase dashboard. Because permissive policies OR together, it makes every other policy
// on interviewers irrelevant, including the four the split installs, and grants full read and
// write to every authenticated principal, portal users included.
//
// The migration drops exactly that one policy. These tests pin its shape and the conventions it
// must follow. Pure SQL, no live database; nothing here performs network I/O or sends email.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { execSync } from 'node:child_process'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = p => readFileSync(join(root, p), 'utf8')

const MIGRATION = 'supabase/migrations/20260822030000_drop_interviewers_full_access_policy.sql'
const AUDIT = 'db/audit/interviewers_full_access_preflight_and_verification.sql'
const migration = read(MIGRATION)
const audit = read(AUDIT)
const live = migration.replace(/\/\*[\s\S]*?\*\//g, '')
// Comment-free view of the live body. The header legitimately cites Wave B's REVOKE and names
// other tables while explaining the finding, so "touches nothing else" is asserted on code alone.
const code = live.split('\n').filter(l => !l.trim().startsWith('--')).join('\n')

// ── The policy really is out-of-band ─────────────────────────────────────────────────────────────

test('full-access drop: the policy name appears in no other SQL in the repository', () => {
  // The whole premise. If a migration ever starts creating it, this test must be revisited.
  const hits = execSync(
    `grep -rl "Full access on interviewers" --include="*.sql" . 2>/dev/null | grep -v node_modules || true`,
    { cwd: root, encoding: 'utf8' },
  ).trim().split('\n').filter(Boolean)
  assert.deepEqual(hits.sort(), [`./${AUDIT}`, `./${MIGRATION}`].sort(),
    'only the drop migration and its audit file may mention the policy')
})

// ── The migration does exactly one thing ─────────────────────────────────────────────────────────

test('full-access drop: drops exactly one policy, by its exact name', () => {
  assert.match(live, /DROP POLICY IF EXISTS "Full access on interviewers" ON public\.interviewers;/)
  assert.equal((live.match(/DROP POLICY/g) || []).length, 1, 'exactly one DROP POLICY')
  assert.doesNotMatch(live, /CREATE POLICY/, 'the live body creates nothing')
  // Named, never discovered: no catalog loop could drop an unrelated policy.
  assert.doesNotMatch(live, /pg_policies/)
  assert.doesNotMatch(live, /DO \$/)
})

test('full-access drop: touches no grant, no data, and no other object', () => {
  assert.doesNotMatch(code, /\b(GRANT|REVOKE)\b/)
  assert.doesNotMatch(code, /\b(DELETE FROM|TRUNCATE|UPDATE public\.|INSERT INTO)\b/i)
  assert.doesNotMatch(code, /\b(CREATE|DROP|ALTER) (TABLE|FUNCTION|INDEX|TRIGGER)\b/i)
  assert.doesNotMatch(code, /ON public\.(?!interviewers\b)/, 'no table other than interviewers is named')
  // The entire executable body is BEGIN, one DROP POLICY, COMMIT.
  const stmts = code.split('\n').map(l => l.trim()).filter(Boolean)
  assert.deepEqual(stmts, ['BEGIN;', 'DROP POLICY IF EXISTS "Full access on interviewers" ON public.interviewers;', 'COMMIT;'])
})

test('full-access drop: single transaction with an inert rollback that restores the policy', () => {
  assert.equal((live.match(/^BEGIN;/gm) || []).length, 1)
  assert.equal((live.match(/^COMMIT;/gm) || []).length, 1)
  assert.match(migration, /^-- ROLLBACK \(INERT\)/m)
  const rollback = migration.slice(migration.indexOf('/*\nBEGIN;'))
  assert.match(rollback, /CREATE POLICY "Full access on interviewers" ON public\.interviewers\s*\n\s*AS PERMISSIVE FOR ALL TO public\s*\n\s*USING \(true\) WITH CHECK \(true\);/)
  // The rollback defers to the live-generated restore_sql if the reported definition differs.
  assert.match(migration, /use the PRE 1 restore_sql column instead/)
})

// ── The header states the impact precisely ───────────────────────────────────────────────────────

test('full-access drop: the header is precise about anon versus authenticated', () => {
  // Wave B revoked anon's table privileges, so the policy cannot grant anon anything; the live
  // exposure is to every authenticated principal. The header must not overstate the anon side.
  assert.match(migration, /anon\s+holds NO table privilege on interviewers/)
  assert.match(migration, /REVOKE ALL ON public\.interviewers FROM anon/)
  assert.match(migration, /portal students, unit leaders, and academic partners/)
  // And Wave B really did revoke it.
  const waveB = read('supabase/migrations/20260712000001_phase0b_wave_b_drop_orphan_anon_policies.sql')
  assert.match(waveB, /REVOKE ALL ON public\.interviewers\s+FROM anon;/)
})

test('full-access drop: ordering relative to the Wave E split is documented as safe either way', () => {
  assert.match(migration, /Independent of 20260822020000/)
  assert.match(migration, /Either order is safe; apply both/)
})

// ── Verification queries ─────────────────────────────────────────────────────────────────────────

test('full-access drop: the audit file has both sections and the run-separately rule', () => {
  assert.ok(existsSync(join(root, AUDIT)))
  assert.match(audit, /PRE-APPLY \(run BEFORE the migration\)/)
  assert.match(audit, /POST-APPLY \(run AFTER the migration\)/)
  assert.match(audit, /RUN EACH NUMBERED SECTION SEPARATELY/)
  assert.match(migration, /as ONE COMPLETE\n-- BLOCK/)
})

test('full-access drop: PRE 1 captures a live restore statement and PRE 4 hunts for siblings', () => {
  assert.match(audit, /AS restore_sql/)
  assert.match(audit, /PRE 4: SIBLING HUNT/)
  // The sibling hunt must cover both signatures of an out-of-band catch-all.
  assert.match(audit, /'public' = ANY \(roles::text\[\]\)/)
  assert.match(audit, /qual = 'true'/)
})

test('full-access drop: POST 2 proves no catch-all remains, so the split policies take effect', () => {
  const post2 = audit.slice(audit.indexOf('POST 2:'), audit.indexOf('POST 3:'))
  assert.match(post2, /PASS: 0 rows/)
  assert.match(post2, /'public' = ANY \(roles::text\[\]\)/)
  assert.match(post2, /qual = 'true'/)
  assert.match(post2, /with_check = 'true'/)
})

test('full-access drop: no em dash in either SQL file', () => {
  // \u2014 is the em dash, written as an escape so this file contains none either.
  assert.doesNotMatch(migration, /\u2014/)
  assert.doesNotMatch(audit, /\u2014/)
})
