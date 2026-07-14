// PHASE2-ROLE: static guard for the portal-role-enablement migration and the
// no-escalation posture that makes it safe. Verifies the CHECK widening (adds
// 'portal', preserves the four staff roles and the constraint name, no data
// writes), the renumbered migration order, and, by reading the ALREADY-APPLIED
// Wave A / Wave E migrations read-only, that portal is not a staff role and a
// portal user cannot self-promote through any direct profile-update path.
//
// Run: node --test test/phase2PortalRoleEnablement.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const migDir = join(here, '../supabase/migrations')
const read = (f) => readFileSync(join(migDir, f), 'utf8')

const migFile = '20260712000010_phase2_portal_role_enablement.sql'
const sql = read(migFile)

test('Phase 2 portal role enablement', async (t) => {
  await t.test('explicit BEGIN and COMMIT wrap the constraint change', () => {
    assert.match(sql, /^BEGIN;/m)
    assert.match(sql, /^COMMIT;/m)
    assert.ok(sql.indexOf('\nBEGIN;') < sql.indexOf('DROP CONSTRAINT'), 'BEGIN before the DROP')
    assert.ok(sql.indexOf('\nCOMMIT;') > sql.indexOf('ADD CONSTRAINT'), 'COMMIT after the ADD')
  })

  await t.test('drops and re-adds the exact same constraint name', () => {
    assert.match(sql, /DROP CONSTRAINT user_profiles_role_check;/, 'drops the named constraint')
    assert.match(sql, /ADD CONSTRAINT user_profiles_role_check/, 're-adds the same name')
    // Exactly one DROP and one ADD of this constraint (outside the commented rollback).
    const active = sql.slice(0, sql.indexOf('-- ── Rollback'))
    assert.equal((active.match(/DROP CONSTRAINT user_profiles_role_check/g) || []).length, 1)
    assert.equal((active.match(/ADD CONSTRAINT user_profiles_role_check/g) || []).length, 1)
  })

  await t.test('the new CHECK preserves the four staff roles and adds portal', () => {
    // Isolate the ADD CONSTRAINT ... CHECK ( ... ) block that is applied.
    const addIdx = sql.indexOf('ADD CONSTRAINT user_profiles_role_check')
    const block = sql.slice(addIdx, sql.indexOf('COMMIT;', addIdx))
    for (const role of ['owner', 'admin', 'interviewer', 'viewer', 'portal']) {
      assert.match(block, new RegExp(`'${role}'::text`), `role ${role} must be allowed`)
    }
  })

  await t.test('adds no unrelated role value', () => {
    const addIdx = sql.indexOf('ADD CONSTRAINT user_profiles_role_check')
    const block = sql.slice(addIdx, sql.indexOf('COMMIT;', addIdx))
    const roles = [...block.matchAll(/'([a-z_]+)'::text/g)].map(m => m[1])
    assert.deepEqual(new Set(roles), new Set(['owner', 'admin', 'interviewer', 'viewer', 'portal']),
      `unexpected roles in CHECK: ${roles.join(', ')}`)
    // Explicitly forbid portal SUB-roles or staff co-lead creeping into the CHECK.
    for (const forbidden of ['student', 'unit_leader', 'academic_partner', 'co_lead', 'co-lead']) {
      assert.doesNotMatch(block, new RegExp(`'${forbidden}'`), `CHECK must not list ${forbidden}`)
    }
  })

  await t.test('writes no data and changes only the constraint', () => {
    assert.doesNotMatch(sql, /\bINSERT\b/i, 'must not insert data')
    assert.doesNotMatch(sql, /\bUPDATE\s+public\./i, 'must not update rows (no profile conversion)')
    assert.doesNotMatch(sql, /CREATE TABLE|CREATE POLICY|CREATE TRIGGER|CREATE OR REPLACE FUNCTION/i,
      'must not create tables/policies/triggers/functions')
    // The only ALTER TABLE statements are the two on user_profiles for the constraint.
    const alters = sql.match(/ALTER TABLE public\.\w+/g) || []
    assert.ok(alters.every(a => a === 'ALTER TABLE public.user_profiles'), 'only user_profiles is altered')
  })

  await t.test('migration order: enablement is 000010 and later phases shift, no duplicate prefixes', () => {
    const files = readdirSync(migDir).filter(f => f.startsWith('20260712') && f.endsWith('.sql')).sort()
    const expected = [
      '20260712000009_phase2_portal_access_lifecycle.sql',
      '20260712000010_phase2_portal_role_enablement.sql',
      '20260712000011_phase3_unit_portal.sql',
      '20260712000012_phase4_school_portal.sql',
      '20260712000013_phase5_public_metrics.sql',
      '20260712000014_phase0b_wave_f2_student_files_private.sql',
    ]
    for (const f of expected) assert.ok(files.includes(f), `expected migration ${f}`)
    const versions = files.map(f => f.slice(0, 14))
    assert.equal(new Set(versions).size, versions.length, 'duplicate migration version prefixes found')
  })
})

// ── No-escalation posture, proven against the ALREADY-APPLIED migrations ──────
test('portal role cannot escalate to staff (applied-migration posture)', async (t) => {
  const waveA = read('20260712000000_phase0b_wave_a_is_staff_helper.sql')
  const waveE = read('20260712000004_phase0b_wave_e_staff_rescope.sql')

  await t.test('is_staff() does not list portal as a staff role', () => {
    const body = waveA.slice(waveA.indexOf('CREATE OR REPLACE FUNCTION public.is_staff'))
    const roleLine = body.match(/role IN \(([^)]*)\)/)
    assert.ok(roleLine, 'is_staff role list found')
    assert.doesNotMatch(roleLine[1], /'portal'/, 'is_staff must not include portal')
    for (const r of ['owner', 'admin', 'interviewer', 'viewer']) {
      assert.match(roleLine[1], new RegExp(`'${r}'`), `is_staff must still include ${r}`)
    }
  })

  await t.test('Wave E revoked table-level UPDATE and column-granted only cosmetic fields', () => {
    assert.match(waveE, /REVOKE INSERT, UPDATE, DELETE[^;]*ON public\.user_profiles FROM authenticated;/,
      'table-level UPDATE revoked from authenticated')
    const grantIdx = waveE.indexOf('GRANT UPDATE (')
    assert.ok(grantIdx > 0, 'column-level UPDATE grant present')
    const grantBlock = waveE.slice(grantIdx, waveE.indexOf(') ON public.user_profiles TO authenticated', grantIdx))
    // avatar self-service stays writable...
    assert.match(grantBlock, /avatar_url/, 'avatar_url remains client-writable (self-service)')
    // ...but no privileged column may be in the column grant.
    for (const priv of ['role', 'is_owner', 'is_active', 'can_conduct_interviews', 'login_enabled']) {
      assert.doesNotMatch(grantBlock, new RegExp(`\\b${priv}\\b`), `privileged column ${priv} must not be client-writable`)
    }
  })

  await t.test('self-update policy is scoped to the caller’s own row', () => {
    assert.match(waveE, /CREATE POLICY "user_profiles_update_self" ON public\.user_profiles/, 'self-update policy exists')
    const polIdx = waveE.indexOf('"user_profiles_update_self"')
    const polBlock = waveE.slice(polIdx, polIdx + 240)
    assert.match(polBlock, /USING \(auth_user_id = auth\.uid\(\)\)/, 'USING is self-scoped')
    assert.match(polBlock, /WITH CHECK \(auth_user_id = auth\.uid\(\)\)/, 'WITH CHECK is self-scoped')
  })

  await t.test('provisioning writes role=portal, which the widened CHECK now permits', () => {
    const lifecycle = read('20260712000009_phase2_portal_access_lifecycle.sql')
    assert.match(lifecycle, /role\s*=\s*'portal'|'portal'/, 'lifecycle sets role=portal')
    assert.match(sql, /'portal'::text/, 'enablement CHECK permits portal')
  })

  await t.test('self-service avatar and Connect signature RPCs remain referenced', () => {
    const menu = readFileSync(join(here, '../src/components/UserMenu.jsx'), 'utf8')
    const sig = readFileSync(join(here, '../src/components/settings/SignaturePanel.jsx'), 'utf8')
    assert.match(menu, /update_my_avatar/, 'avatar self-service preserved')
    assert.match(sig, /update_my_connect_signature/, 'Connect signature self-service preserved')
  })

  await t.test('client routing does not treat portal as a staff role', () => {
    const app = readFileSync(join(here, '../src/App.jsx'), 'utf8')
    const listLine = app.match(/const PORTAL_STAFF_ROLES = \[([^\]]*)\]/)
    assert.ok(listLine, 'PORTAL_STAFF_ROLES found')
    assert.doesNotMatch(listLine[1], /'portal'/, 'portal must not be a staff routing role')
  })
})
