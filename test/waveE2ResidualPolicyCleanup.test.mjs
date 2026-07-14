// PHASE0B-WAVE-E2: static guard for the residual-policy cleanup migration.
// Wave E missed 14 dashboard-named broad authenticated policies (name mismatch:
// it dropped "authenticated_all_<t>" but production had "Authenticated full
// access on <t>" / "Authenticated users can insert logs"). This test asserts
// the corrective migration drops every residual name and does NOT drop any of
// the Wave E staff / self-service / owner-admin policies it must preserve.
//
// Run: node --test test/waveE2ResidualPolicyCleanup.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const migration = readFileSync(
  join(here, '../supabase/migrations/20260712000005_phase0b_wave_e2_residual_authenticated_policy_cleanup.sql'),
  'utf8'
)

// Executable SQL only: drop full-line comments and trailing inline comments so
// that forbidden-content checks do not trip on explanatory prose (which names
// anon, service_role, grants deliberately to say what the migration avoids).
const code = migration
  .split('\n')
  .filter(line => !/^\s*--/.test(line))
  .map(line => line.replace(/--.*$/, ''))
  .join('\n')

// The 14 exact residual production policy names discovered during Wave E
// production verification (13 FOR ALL, 1 INSERT on activity_logs).
const RESIDUAL_POLICIES = [
  ['Authenticated full access on students', 'public.students'],
  ['Authenticated full access on cohorts', 'public.cohorts'],
  ['Authenticated full access on communications', 'public.communications'],
  ['Authenticated full access on units', 'public.units'],
  ['Authenticated full access on matches', 'public.matches'],
  ['Authenticated full access on interview_sessions', 'public.interview_sessions'],
  ['Authenticated full access on program_events', 'public.program_events'],
  ['Authenticated full access on interview_availability_blocks', 'public.interview_availability_blocks'],
  ['Authenticated full access on interview_slots', 'public.interview_slots'],
  ['Authenticated full access on student_shift_logs', 'public.student_shift_logs'],
  ['Authenticated full access on ngrp_outcomes', 'public.ngrp_outcomes'],
  ['Authenticated full access on cohort_snapshots', 'public.cohort_snapshots'],
  ['Authenticated full access on interview_rubrics', 'public.interview_rubrics'],
  ['Authenticated users can insert logs', 'public.activity_logs'],
]

// Wave E policies that MUST survive (never appear in a DROP in this migration).
const PRESERVE_POLICIES = [
  'staff_all_students', 'staff_all_cohorts', 'staff_all_communications',
  'staff_all_units', 'staff_all_matches', 'staff_all_interview_sessions',
  'staff_all_program_events', 'staff_all_availability_blocks',
  'staff_all_interview_slots', 'staff_all_student_shift_logs',
  'staff_all_ngrp_outcomes', 'staff_all_cohort_snapshots', 'staff_all_rubrics',
  'staff_all_interviewers', 'staff_all_interviews',
  'contacts_staff_select', 'contacts_staff_insert', 'contacts_staff_update',
  'contacts_staff_delete', 'staff_read_preceptors', 'staff_read_pcp',
  'staff_read_unit_leaders', 'staff_read_unit_responses',
  'owner_admin_select_student_dispositions', 'user_profiles_select_self',
  'user_profiles_select_staff', 'user_profiles_update_self',
  'activity_logs_staff_insert', 'activity_logs_owner_admin_select',
]

test('Wave E-2 residual policy cleanup', async (t) => {
  await t.test('drops every residual policy by its exact case-sensitive name and table', () => {
    for (const [name, table] of RESIDUAL_POLICIES) {
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const re = new RegExp(`DROP POLICY IF EXISTS\\s+"${escaped}"\\s+ON\\s+${table.replace('.', '\\.')}\\s*;`)
      assert.match(migration, re, `missing DROP for "${name}" ON ${table}`)
    }
  })

  await t.test('all 14 residual names are present', () => {
    for (const [name] of RESIDUAL_POLICIES) {
      assert.ok(migration.includes(`"${name}"`), `residual name not found: ${name}`)
    }
    assert.equal(RESIDUAL_POLICIES.length, 14)
  })

  await t.test('does NOT drop any Wave E staff / self / owner-admin policy', () => {
    for (const name of PRESERVE_POLICIES) {
      const re = new RegExp(`DROP POLICY IF EXISTS\\s+"${name}"`)
      assert.doesNotMatch(migration, re, `must not drop preserved policy: ${name}`)
    }
  })

  await t.test('creates no policy (drops only)', () => {
    assert.doesNotMatch(code, /CREATE POLICY/i, 'corrective migration must not CREATE any policy')
  })

  await t.test('touches no grants, anon, or service_role (executable SQL)', () => {
    assert.doesNotMatch(code, /\bGRANT\b/i, 'must not GRANT')
    assert.doesNotMatch(code, /\bREVOKE\b/i, 'must not REVOKE')
    assert.doesNotMatch(code, /\banon\b/i, 'must not touch anon')
    assert.doesNotMatch(code, /service_role/i, 'must not touch service_role')
  })

  await t.test('is wrapped in an explicit transaction (fail-closed, atomic)', () => {
    assert.match(migration, /^BEGIN;/m, 'must open with BEGIN;')
    assert.match(migration, /^COMMIT;/m, 'must close with COMMIT;')
  })

  await t.test('uses DROP POLICY IF EXISTS (rerunnable) for every drop', () => {
    const drops = migration.match(/^\s*DROP POLICY[^\n]*/gm) || []
    assert.ok(drops.length >= 14, 'expected at least 14 DROP statements')
    for (const line of drops) {
      assert.match(line, /DROP POLICY IF EXISTS/, `non-idempotent drop: ${line.trim()}`)
    }
  })
})
