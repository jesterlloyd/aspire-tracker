// test/s22ActiveOwnerOrAdmin.test.mjs
//
// S-22: is_owner_or_admin() ignored is_active, so a deactivated Owner or Admin
// still passed at the database layer even after S-05 closed the same gap at
// every endpoint.
//
// The fix is a REDEFINITION rather than a call-site rewrite, and these tests
// pin that choice as much as the SQL. Fifteen policies and five functions
// reference the predicate in this repository, but the original audit counted
// seven RPCs, so at least two references exist only in the dashboard. Rewriting
// what the repository can see would have left those still trusting a
// deactivated account.
//
// Pure SQL and source assertions. No live database; nothing here executes SQL.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(root, p), 'utf8')

const MIGRATION = 'supabase/migrations/20260829000000_s22_is_owner_or_admin_requires_active.sql'
const AUDIT = 'db/audit/s22_is_owner_or_admin_preflight_and_verification.sql'
const migration = read(MIGRATION)
const audit = read(AUDIT)
// Comment-free view: the header legitimately quotes the OLD role-only body while
// explaining the finding, so "the new body requires active" is asserted on code.
const live = migration.split('/*')[0]
const code = live.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')

// ── The migration does one thing ─────────────────────────────────────────────

test('S-22: the predicate delegates to the active helper, one implementation', () => {
  assert.match(code, /CREATE OR REPLACE FUNCTION public\.is_owner_or_admin\(\)/)
  assert.match(code, /SELECT public\.is_active_owner_or_admin\(\);/)
  // Not a copied predicate: the two names must not be able to drift apart.
  assert.doesNotMatch(code, /role IN \('owner', 'admin'\)/)
  assert.doesNotMatch(code, /FROM public\.user_profiles/)
})

test('S-22: it keeps every hardened function attribute', () => {
  assert.match(code, /LANGUAGE sql/)
  assert.match(code, /SECURITY DEFINER/)
  assert.match(code, /STABLE/)
  assert.match(code, /SET search_path = public, pg_catalog/)
  assert.match(code, /REVOKE ALL ON FUNCTION public\.is_owner_or_admin\(\) FROM PUBLIC, anon;/)
  assert.match(code, /GRANT EXECUTE ON FUNCTION public\.is_owner_or_admin\(\) TO authenticated, service_role;/)
})

test('S-22: it touches no policy, no table, and no row', () => {
  assert.doesNotMatch(code, /CREATE POLICY|DROP POLICY|ALTER POLICY/)
  assert.doesNotMatch(code, /CREATE TABLE|ALTER TABLE|DROP TABLE/)
  assert.doesNotMatch(code, /\b(INSERT INTO|UPDATE public\.|DELETE FROM|TRUNCATE)\b/i)
  // And it does not drop the alias, which is the whole point of keeping it.
  assert.doesNotMatch(code, /DROP FUNCTION/)
})

test('S-22: single transaction with an inert rollback to the role-only body', () => {
  assert.equal((live.match(/^BEGIN;/gm) || []).length, 1)
  assert.equal((live.match(/^COMMIT;/gm) || []).length, 1)
  assert.match(migration, /^-- ROLLBACK \(INERT\)/m)
  const rollback = migration.slice(migration.indexOf('/*\nBEGIN;'))
  assert.match(rollback, /role IN \('owner', 'admin'\)/, 'the rollback restores the original body')
  assert.doesNotMatch(rollback, /is_active/, 'the rollback is the pre-fix behaviour, by design')
  assert.match(migration, /use the PRE 1 restore_sql column instead/)
})

// ── The reasoning is recorded, because it is the load-bearing part ──────────

test('S-22: the header explains why redefinition beats rewriting call sites', () => {
  assert.match(migration, /dashboard-created references that cannot be enumerated/)
  assert.match(migration, /20260822030000 dropped/, 'cites the precedent for invisible objects')
  assert.match(migration, /unit_leaders/)
  assert.match(migration, /fail-safe direction/)
})

test('S-22: the header names BOTH differences between the two helpers', () => {
  // The task asked whether they differ in anything besides the is_active check.
  // They do: the EXECUTE grant. Recording only one of the two would be wrong.
  assert.match(migration, /Only two things/)
  assert.match(migration, /EXECUTE grants/)
  assert.match(migration, /superset and cannot remove access/)
})

test('S-22: the header states the concrete browser exposure, not just the theory', () => {
  assert.match(migration, /activity_logs, evaluation_assignments,\n-- certificates, and support_request_reads/)
  assert.match(migration, /get_all_user_profiles\(\) and complete_disposition_followup\(\)/)
  assert.match(migration, /routes a staff profile to \/aggregate\n-- regardless of is_active/)
})

test('S-22: it states that no legitimate user is affected', () => {
  assert.match(migration, /An ACTIVE Owner or Admin evaluates identically/)
  assert.match(migration, /service_role bypasses RLS/)
})

// ── The audit file ───────────────────────────────────────────────────────────

test('S-22: the audit has both sections and the run-separately rule', () => {
  assert.match(audit, /PRE-APPLY \(run BEFORE the migration\)/)
  assert.match(audit, /POST-APPLY \(run AFTER the migration\)/)
  assert.match(audit, /RUN EACH NUMBERED SECTION SEPARATELY/)
  assert.match(audit, /as ONE complete block/)
  for (const n of [1, 2, 3, 4, 5]) {
    assert.match(audit, new RegExp(`PRE ${n}:`), `PRE ${n} missing`)
    assert.match(audit, new RegExp(`POST ${n}:`), `POST ${n} missing`)
  }
})

test('S-22: PRE 2 and PRE 3 enumerate LIVE dependencies, which the repo cannot', () => {
  // The only complete inventory that will ever exist.
  assert.match(audit, /THE COMPLETE INVENTORY/)
  assert.match(audit, /qual ILIKE '%is_owner_or_admin%' OR with_check ILIKE '%is_owner_or_admin%'/)
  assert.match(audit, /pg_get_functiondef\(p\.oid\) ILIKE '%is_owner_or_admin%'/)
  assert.match(audit, /created out-of-band/)
})

test('S-22: PRE 1 captures a live restore statement before anything changes', () => {
  assert.match(audit, /AS restore_sql/)
  assert.match(audit, /pg_get_functiondef\(p\.oid\)\s+AS restore_sql/)
  // And gives the reader a stop condition.
  assert.match(audit, /stop: someone has\n-- changed it out-of-band/)
})

test('S-22: PRE 5 sizes the impact without selecting any PII', () => {
  // Slice to the POST-APPLY SECTION HEADER, not its first mention: the file
  // header names both sections in prose, well before PRE 5.
  const pre5 = audit.slice(audit.indexOf('PRE 5:'), audit.indexOf('-- POST-APPLY (run AFTER'))
  assert.match(pre5, /count\(\*\) FILTER/)
  // Comment-stripped: the note PROMISING no PII necessarily names the columns it
  // promises not to select, so the promise is asserted against the SQL alone.
  const pre5Sql = pre5.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')
  assert.doesNotMatch(pre5Sql, /\bemail\b|full_name|auth_user_id|\bid\b/)
  assert.match(pre5Sql, /FROM public\.user_profiles/)
  assert.match(pre5, /NO email, name, or id is\n-- selected/)
  // A stop condition, so a misconfigured run cannot lock everyone out.
  assert.match(pre5, /treat 0 as a stop condition/)
})

test('S-22: the audit is read-only', () => {
  const stmts = audit.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')
  assert.doesNotMatch(stmts, /\b(INSERT|UPDATE|DELETE|ALTER|DROP|CREATE|GRANT|REVOKE|TRUNCATE)\b/i)
  assert.match(audit, /READ ONLY\. Nothing here writes/)
})

test('S-22: the drop-versus-keep decision is recorded with its reason', () => {
  assert.match(audit, /FOLLOW-UP, NOT PART OF THIS MIGRATION/)
  assert.match(audit, /Do NOT drop is_owner_or_admin\(\) while any dependency remains/)
  // The reason wraps across comment lines in the file, so match on the halves.
  assert.match(audit, /policy\n-- churn across fourteen-plus tables for no additional security/)
  assert.match(migration, /Kept rather than dropped because references created outside/)
})

// ── The repository inventory the migration's reasoning rests on ─────────────

test('S-22: the repository really does contain the call sites claimed', () => {
  const sql = execSync(
    `grep -rn "is_owner_or_admin()" --include="*.sql" supabase/ migrations/ 2>/dev/null || true`,
    { cwd: root, encoding: 'utf8' },
  ).split('\n').filter(Boolean).filter((l) => !/:\s*--/.test(l))

  const policies = sql.filter((l) => /USING|WITH CHECK/.test(l))
  assert.ok(policies.length >= 15, `expected 15+ policy references, found ${policies.length}`)

  const guards = sql.filter((l) => /IF NOT public\.is_owner_or_admin\(\) THEN/.test(l))
  assert.ok(guards.length >= 4, `expected 4+ function guards, found ${guards.length}`)
})

test('S-22: the canonical helper it delegates to actually requires active', () => {
  const foundation = read('supabase/migrations/20260716000000_messages_phase1_schema_foundation.sql')
  assert.match(foundation, /CREATE OR REPLACE FUNCTION public\.is_active_owner_or_admin\(\)/)
  assert.match(foundation, /AND COALESCE\(is_active, true\) = true/)
  assert.match(foundation, /GRANT EXECUTE ON FUNCTION public\.is_active_owner_or_admin\(\) TO authenticated, service_role;/)
})

test('S-22: house style, no em dash in either file', () => {
  // — is the em dash, written as an escape so this file contains none.
  assert.doesNotMatch(migration, /—/)
  assert.doesNotMatch(audit, /—/)
})
