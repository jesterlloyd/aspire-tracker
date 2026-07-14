// PHASE2-AUTHZ: static guard for the Phase 2 authorization foundation migration.
// Verifies the explicit transaction, the four authz tables + RLS + eight
// policies, the six SECURITY DEFINER portal functions with fixed search_path and
// authenticated-only EXECUTE, least-privilege table grants, and that the
// migration inserts no authorization data.
//
// Run: node --test test/phase2AuthzFoundation.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const sql = readFileSync(
  join(here, '../supabase/migrations/20260712000007_phase2_authz_foundation.sql'),
  'utf8'
)

const TABLES = ['user_role_grants', 'user_student_links', 'user_unit_scopes', 'user_school_scopes']
const FUNCTIONS = ['portal_profile_id', 'has_active_role_grant', 'my_linked_student_ids',
  'my_unit_scope_keys', 'my_school_scope_keys', 'get_my_portal_access']

test('Phase 2 authorization foundation', async (t) => {
  await t.test('explicit BEGIN and COMMIT are present', () => {
    assert.match(sql, /^BEGIN;/m)
    assert.match(sql, /^COMMIT;/m)
    // BEGIN precedes the first CREATE TABLE; COMMIT follows the last GRANT EXECUTE.
    assert.ok(sql.indexOf('\nBEGIN;') < sql.indexOf('CREATE TABLE'), 'BEGIN before first DDL')
    assert.ok(sql.indexOf('\nCOMMIT;') > sql.lastIndexOf('GRANT EXECUTE ON FUNCTION'), 'COMMIT after last grant')
    // Verification queries remain outside the transaction.
    assert.ok(sql.indexOf('-- Verification') > sql.indexOf('\nCOMMIT;'), 'verification block after COMMIT')
  })

  await t.test('creates the four authorization tables', () => {
    for (const tbl of TABLES) {
      assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${tbl}\\b`), `missing table ${tbl}`)
    }
  })

  await t.test('enables RLS on all four tables', () => {
    for (const tbl of TABLES) {
      assert.match(sql, new RegExp(`ALTER TABLE public\\.${tbl}\\s+ENABLE ROW LEVEL SECURITY`), `RLS not enabled on ${tbl}`)
    }
  })

  await t.test('creates exactly eight policies (self + owner/admin per table)', () => {
    const policies = sql.match(/CREATE POLICY\s+"[^"]+"/g) || []
    assert.equal(policies.length, 8, `expected 8 policies, found ${policies.length}`)
    for (const tbl of TABLES) {
      assert.match(sql, new RegExp(`CREATE POLICY "self_select_[a-z_]+" ON public\\.${tbl}`), `missing self policy on ${tbl}`)
      assert.match(sql, new RegExp(`CREATE POLICY "owner_admin_select_[a-z_]+" ON public\\.${tbl}`), `missing owner/admin policy on ${tbl}`)
    }
  })

  await t.test('creates the six portal authorization functions', () => {
    for (const fn of FUNCTIONS) {
      assert.match(sql, new RegExp(`CREATE OR REPLACE FUNCTION public\\.${fn}\\b`), `missing function ${fn}`)
    }
  })

  await t.test('all six functions are SECURITY DEFINER with fixed search_path', () => {
    const secdef = sql.match(/SECURITY DEFINER/g) || []
    assert.ok(secdef.length >= 6, `expected >=6 SECURITY DEFINER, found ${secdef.length}`)
    const sp = sql.match(/SET search_path = public, pg_catalog/g) || []
    assert.ok(sp.length >= 6, `expected >=6 fixed search_path, found ${sp.length}`)
  })

  await t.test('PUBLIC and anon EXECUTE revoked, authenticated granted, for each function', () => {
    for (const fn of FUNCTIONS) {
      const sig = fn === 'has_active_role_grant' ? `${fn}\\(text\\)` : `${fn}\\(\\)`
      assert.match(sql, new RegExp(`REVOKE ALL ON FUNCTION public\\.${sig}\\s+FROM PUBLIC, anon;`), `missing REVOKE for ${fn}`)
      assert.match(sql, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${sig}\\s+TO authenticated;`), `missing authenticated grant for ${fn}`)
    }
  })

  await t.test('authenticated receives SELECT only on the four tables (no write)', () => {
    // [^;]* keeps each match within a single GRANT statement (no crossing ';').
    assert.match(sql, /GRANT SELECT ON public\.user_role_grants,[^;]*TO authenticated;/, 'authenticated SELECT grant missing')
    // No ALL/INSERT/UPDATE/DELETE table grant to authenticated, within one statement.
    assert.doesNotMatch(sql, /GRANT ALL PRIVILEGES ON[^;]*TO authenticated/, 'authenticated must not get ALL')
    assert.doesNotMatch(sql, /GRANT (INSERT|UPDATE|DELETE)[^;]*TO authenticated/i, 'authenticated must not get write grants')
  })

  await t.test('service_role receives table write access', () => {
    assert.match(sql, /GRANT ALL PRIVILEGES ON public\.user_role_grants,[^;]*TO service_role;/, 'service_role ALL grant missing')
  })

  await t.test('inserts no authorization data', () => {
    for (const tbl of TABLES) {
      assert.doesNotMatch(sql, new RegExp(`INSERT INTO public\\.${tbl}\\b`), `unexpected data insert into ${tbl}`)
    }
    assert.doesNotMatch(sql, /\bINSERT INTO\b/, 'migration must not INSERT any data')
  })
})
