// PHASE2-ACCESS: static guard for the portal access lifecycle migration.
// Verifies the explicit transaction, both SECURITY DEFINER functions with fixed
// search_path and service-role-only EXECUTE, historical (revoke-not-delete)
// semantics, the expired-unrevoked replacement path, active-identical
// idempotency, student-link conflict detection, cross-role isolation on
// revocation, and that the migration touches no tables/policies/read-receipts.
// Also validates the renumbered migration order.
//
// Run: node --test test/phase2PortalAccessLifecycle.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const migDir = join(here, '../supabase/migrations')
const migFile = '20260712000009_phase2_portal_access_lifecycle.sql'
const sql = readFileSync(join(migDir, migFile), 'utf8')

const FUNCS = ['provision_portal_access', 'revoke_portal_access']

test('Phase 2 portal access lifecycle', async (t) => {
  await t.test('explicit BEGIN and COMMIT wrap the functions and grants', () => {
    assert.match(sql, /^BEGIN;/m)
    assert.match(sql, /^COMMIT;/m)
    assert.ok(sql.indexOf('\nBEGIN;') < sql.indexOf('CREATE OR REPLACE FUNCTION'), 'BEGIN before first function')
    assert.ok(sql.indexOf('\nCOMMIT;') > sql.lastIndexOf('GRANT EXECUTE ON FUNCTION'), 'COMMIT after last grant')
  })

  await t.test('creates both lifecycle functions', () => {
    for (const fn of FUNCS) {
      assert.match(sql, new RegExp(`CREATE OR REPLACE FUNCTION public\\.${fn}\\b`), `missing function ${fn}`)
    }
  })

  await t.test('both functions are SECURITY DEFINER with fixed search_path', () => {
    const secdef = sql.match(/SECURITY DEFINER/g) || []
    assert.ok(secdef.length >= 2, `expected >=2 SECURITY DEFINER, found ${secdef.length}`)
    const sp = sql.match(/SET search_path = public, pg_catalog/g) || []
    assert.ok(sp.length >= 2, `expected >=2 fixed search_path, found ${sp.length}`)
  })

  await t.test('EXECUTE is revoked from PUBLIC/anon/authenticated and granted only to service_role', () => {
    for (const fn of FUNCS) {
      assert.match(sql, new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}\\([^)]*\\)\\s*\\n?\\s*FROM PUBLIC, anon, authenticated;`),
        `missing service-role-only REVOKE for ${fn}`)
      assert.match(sql, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}\\([^)]*\\)\\s*\\n?\\s*TO service_role;`),
        `missing service_role EXECUTE grant for ${fn}`)
    }
    // Never grant EXECUTE on these functions to anon or authenticated.
    assert.doesNotMatch(sql, /GRANT EXECUTE ON FUNCTION public\.(provision|revoke)_portal_access[^;]*TO (anon|authenticated)/,
      'lifecycle functions must not be executable by anon/authenticated')
  })

  await t.test('revocation preserves history (revoked_at set, never DELETE)', () => {
    assert.doesNotMatch(sql, /\bDELETE\s+FROM\b/i, 'lifecycle must not delete rows')
    assert.match(sql, /SET revoked_at = now\(\), revoked_by = p_revoked_by/, 'revocation must set revoked_at/revoked_by')
  })

  await t.test('expired-but-unrevoked grants are revoked then re-granted (no uniqueness failure)', () => {
    // The active-slot occupant that is expired gets revoked, then a fresh grant inserts.
    assert.match(sql, /expires_at IS NOT NULL AND v_grant\.expires_at <= now\(\)/, 'expired-grant branch present')
    assert.match(sql, /v_grant_action := 'renewed'/, 'expired grant renews')
  })

  await t.test('active identical grant is idempotently reused', () => {
    assert.match(sql, /v_grant_action := 'reused'/, 'active identical grant path reuses the row')
  })

  await t.test('student-link conflict on a different profile raises PT409', () => {
    assert.match(sql, /user_profile_id <> v_profile_id/, 'conflict check compares against a different profile')
    assert.match(sql, /already linked to another active portal account[\s\S]*ERRCODE = 'PT409'/,
      'cross-profile student link raises PT409')
  })

  await t.test('revocation is scoped to the requested role only (no cross-role revoke)', () => {
    // Each dependent-revoke block is guarded by its own role check.
    assert.match(sql, /IF p_role = 'student' AND \(p_cascade OR p_student_id IS NOT NULL\)/)
    assert.match(sql, /IF p_role = 'unit_leader' AND \(p_cascade OR p_unit_keys IS NOT NULL\)/)
    assert.match(sql, /IF p_role = 'academic_partner' AND \(p_cascade OR p_school_keys IS NOT NULL\)/)
  })

  await t.test('preserves multiple units and schools (per-key loops)', () => {
    assert.match(sql, /FOREACH v_key IN ARRAY p_unit_keys/, 'iterates unit keys')
    assert.match(sql, /FOREACH v_key IN ARRAY p_school_keys/, 'iterates school keys')
  })

  await t.test('creates no tables/policies/triggers and touches no read-receipt tables', () => {
    assert.doesNotMatch(sql, /CREATE TABLE/i, 'must not create tables')
    assert.doesNotMatch(sql, /CREATE POLICY|CREATE TRIGGER/i, 'must not create policies/triggers')
    assert.doesNotMatch(sql, /ALTER TABLE/i, 'must not alter tables')
    assert.doesNotMatch(sql, /student_reads|session_reads|support_request_reads/, 'must not touch read-receipt tables')
  })

  await t.test('migration order: lifecycle is 000009 and later phases are shifted, with no duplicate versions', () => {
    const files = readdirSync(migDir).filter(f => f.startsWith('20260712') && f.endsWith('.sql')).sort()
    const expected = [
      '20260712000009_phase2_portal_access_lifecycle.sql',
      '20260712000010_phase2_portal_role_enablement.sql',
      '20260712000011_phase3_unit_portal.sql',
      '20260712000012_phase4_school_portal.sql',
      '20260712000013_phase5_public_metrics.sql',
      '20260712000014_phase0b_wave_f2_student_files_private.sql',
    ]
    for (const f of expected) {
      assert.ok(files.includes(f), `expected migration ${f} to exist`)
    }
    // No two migrations share a 14-digit version prefix.
    const versions = files.map(f => f.slice(0, 14))
    assert.equal(new Set(versions).size, versions.length, 'duplicate migration version prefixes found')
  })
})
