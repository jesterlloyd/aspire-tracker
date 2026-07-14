// PHASE0B-WAVE-F1: static guard for the SECURITY DEFINER function EXECUTE
// hardening migration (live-state reconciled). Verifies the corrected privilege
// posture, the five internal authorization gates, the nine fixed search_paths,
// and that no table policy/grant/data/portal SQL crept in.
//
// Run: node --test test/waveF1FunctionHardening.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const file = readFileSync(
  join(here, '../supabase/migrations/20260712000006_phase0b_wave_f1_function_execute_hardening.sql'),
  'utf8'
)

// Split the ACTIVE migration from the inert (commented) rollback so gate checks
// assert the applied definitions, not the rollback's ungated restore bodies.
const rollbackIdx = file.indexOf('-- ── Rollback')
const active = rollbackIdx > 0 ? file.slice(0, rollbackIdx) : file
const rollback = rollbackIdx > 0 ? file.slice(rollbackIdx) : ''

test('Wave F-1 function EXECUTE hardening', async (t) => {
  await t.test('explicit BEGIN and COMMIT remain', () => {
    assert.match(active, /^BEGIN;/m)
    assert.match(active, /^COMMIT;/m)
  })

  await t.test('PUBLIC revoke no longer excludes the school-form functions', () => {
    // No exclusion filter of any kind in the revoke step.
    assert.doesNotMatch(active, /proname\s+NOT\s+IN/i, 'revoke step must not exclude any function')
    // The revoke iterates every SECURITY DEFINER function and revokes PUBLIC + anon.
    assert.match(active, /REVOKE EXECUTE ON FUNCTION public\.%I\(%s\) FROM PUBLIC;/)
    assert.match(active, /REVOKE EXECUTE ON FUNCTION public\.%I\(%s\) FROM anon;/)
  })

  await t.test('anon is re-granted only the two school-form functions', () => {
    // The single anon GRANT targets exactly these two names.
    const anonGrantBlock = active.match(
      /IN \('verify_school_form_password', 'school_form_requires_password'\)[\s\S]*?TO anon, authenticated/
    )
    assert.ok(anonGrantBlock, 'anon+authenticated grant must target only the two school-form functions')
    // No other anon grant anywhere in the active migration.
    const anonGrants = active.match(/TO anon\b/g) || []
    assert.equal(anonGrants.length, 1, 'exactly one anon grant statement')
  })

  await t.test('no PUBLIC EXECUTE is restored in the active migration', () => {
    assert.doesNotMatch(active, /GRANT EXECUTE[^;]*TO PUBLIC/i, 'active migration must not grant PUBLIC')
  })

  await t.test('authenticated allowlist includes the six newly identified staff RPCs', () => {
    for (const fn of ['get_all_user_profiles', 'get_active_interviewers', 'add_interviewer',
      'update_interviewer_color', 'update_interviewer_email', 'is_current_user_owner']) {
      assert.match(active, new RegExp(`'${fn}'`), `authenticated allowlist must include ${fn}`)
    }
    // Spot-check the pre-existing allowlist members remain.
    for (const fn of ['get_my_profile', 'update_my_avatar', 'is_owner_or_admin', 'is_staff', 'get_my_portal_access']) {
      assert.match(active, new RegExp(`'${fn}'`), `authenticated allowlist must retain ${fn}`)
    }
  })

  await t.test('service_role is granted EXECUTE on every SECURITY DEFINER function', () => {
    assert.match(active, /GRANT EXECUTE ON FUNCTION public\.%I\(%s\) TO service_role;/)
  })

  await t.test('all nine functions receive a fixed search_path = public, pg_catalog', () => {
    // Four via ALTER FUNCTION (exact signatures).
    const alters = [
      /ALTER FUNCTION public\.clear_student_disposition\(uuid, text\)\s*SET search_path = public, pg_catalog;/,
      /ALTER FUNCTION public\.record_student_disposition\([\s\S]*?\)\s*SET search_path = public, pg_catalog;/,
      /ALTER FUNCTION public\.school_form_requires_password\(uuid\)\s*SET search_path = public, pg_catalog;/,
      /ALTER FUNCTION public\.verify_school_form_password\(uuid, text\)\s*SET search_path = public, pg_catalog;/,
    ]
    for (const re of alters) assert.match(active, re)
    // Five via CREATE OR REPLACE definitions (at least 5 inline search_path settings).
    const inline = active.match(/SET search_path = public, pg_catalog\nAS \$function\$/g) || []
    assert.ok(inline.length >= 5, `expected >=5 rewritten functions with fixed search_path, saw ${inline.length}`)
  })

  await t.test('the five sensitive functions carry the correct internal gate', () => {
    const defn = (name) => {
      const m = active.match(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\b[\\s\\S]*?\\$function\\$;`))
      assert.ok(m, `active definition of ${name} not found`)
      return m[0]
    }
    for (const name of ['get_all_user_profiles', 'add_interviewer', 'update_interviewer_color', 'update_interviewer_email']) {
      assert.match(defn(name), /IF NOT public\.is_owner_or_admin\(\) THEN\s*RAISE EXCEPTION 'Insufficient permissions';/,
        `${name} must gate on is_owner_or_admin()`)
    }
    assert.match(defn('get_active_interviewers'), /IF NOT public\.is_staff\(\) THEN\s*RAISE EXCEPTION 'Insufficient permissions';/,
      'get_active_interviewers must gate on is_staff()')
  })

  await t.test('signatures and return declarations match the Owner-provided live definitions', () => {
    assert.match(active, /FUNCTION public\.get_all_user_profiles\(\)\s*\n\s*RETURNS SETOF user_profiles/)
    assert.match(active, /FUNCTION public\.get_active_interviewers\(\)\s*\n\s*RETURNS TABLE\(\s*\n\s*id uuid,/)
    assert.match(active, /FUNCTION public\.add_interviewer\(p_name text, p_email text\)\s*\n\s*RETURNS TABLE\(id uuid, name text, email text, color text\)/)
    assert.match(active, /FUNCTION public\.update_interviewer_color\(p_id uuid, p_color text\)\s*\n\s*RETURNS void/)
    assert.match(active, /FUNCTION public\.update_interviewer_email\(p_id uuid, p_email text\)\s*\n\s*RETURNS void/)
  })

  await t.test('school-form functions are NOT given a staff gate', () => {
    assert.doesNotMatch(active, /verify_school_form_password[\s\S]{0,400}is_staff\(\)/)
    assert.doesNotMatch(active, /school_form_requires_password[\s\S]{0,400}is_owner_or_admin\(\)/)
  })

  await t.test('is_current_user_owner body is not rewritten', () => {
    assert.doesNotMatch(active, /CREATE OR REPLACE FUNCTION public\.is_current_user_owner/,
      'is_current_user_owner must not be redefined (self-check preserved)')
  })

  await t.test('verification queries use COALESCE(proacl, acldefault(...))', () => {
    assert.match(file, /COALESCE\(p\.proacl, acldefault\('f', p\.proowner\)\)/)
    assert.match(file, /a\.grantee = 0/, 'PUBLIC shown via grantee = 0')
  })

  await t.test('no table policy, table grant, data DML, portal, or reload SQL', () => {
    assert.doesNotMatch(active, /CREATE POLICY|DROP POLICY|ALTER TABLE/i, 'no table policy/schema changes')
    assert.doesNotMatch(active, /GRANT[^;]*ON TABLE/i, 'no table grants')
    assert.doesNotMatch(active, /NOTIFY\s+pgrst/i, 'no pgrst reload')
    assert.doesNotMatch(active, /phase2|portal_role|invite-portal/i, 'no portal migration content')
    // The only INSERT/UPDATE are inside the add_interviewer/update_interviewer bodies.
    for (const m of active.match(/^\s*(INSERT INTO|UPDATE)\s+(\w+)/gm) || []) {
      assert.match(m, /interviewers/, `unexpected DML outside interviewer function bodies: ${m.trim()}`)
    }
  })

  await t.test('rollback section restores the ungated bodies and reopens PUBLIC', () => {
    assert.match(rollback, /CREATE OR REPLACE FUNCTION public\.get_all_user_profiles/)
    assert.doesNotMatch(
      rollback.match(/CREATE OR REPLACE FUNCTION public\.get_all_user_profiles[\s\S]*?\$function\$;/)[0],
      /is_owner_or_admin/, 'rollback get_all_user_profiles must be ungated')
    assert.match(rollback, /GRANT EXECUTE ON FUNCTION public\.%I\(%s\) TO PUBLIC;/)
  })
})
