// PROGRAM_EVENTS RLS LOCKDOWN: source guards for the Owner-applied migration.
//
// The migration is unapplied and cannot be executed here, so these pin the
// SHAPE of the SQL and the claims the header makes about the codebase. That is
// worth doing because the dangerous failures in this file are all textual: a
// predicate swapped for a laxer one, a grant that quietly stays broad, a
// rollback that replays without revoking first.
//
// Run: node --test test/programEventsLockdown.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')

const MIGRATION = 'supabase/migrations/20260805000002_program_events_rls_lockdown.sql'
const AUDIT = 'db/audit/program_events_rls_verification.sql'
const sql = read(MIGRATION)
const audit = read(AUDIT)

// The executable half only: the header and the commented rollback both quote SQL
// that must not be mistaken for statements that actually run on apply.
const applyBody = sql.slice(sql.indexOf('\nBEGIN;'), sql.indexOf('\nCOMMIT;'))
const rollback = sql.slice(sql.indexOf('/*\nBEGIN;'))

// ── The read/write split ─────────────────────────────────────────────────────

test('Viewers may SELECT: the read policy uses is_staff(), which includes viewer', () => {
  assert.match(applyBody, /CREATE POLICY "staff_select_program_events"[\s\S]*?FOR SELECT TO authenticated[\s\S]*?public\.is_staff\(\)/)
  // is_staff() is the shipped helper and does list viewer - that is what makes
  // the read side inclusive without a second predicate.
  const helper = read('supabase/migrations/20260712000000_phase0b_wave_a_is_staff_helper.sql')
  assert.match(helper, /role IN \('owner', 'admin', 'co_lead', 'co-lead', 'interviewer', 'viewer'\)/)
})

test('Viewers may NOT INSERT: the write policy uses the viewer-excluding predicate', () => {
  const insertPolicy = applyBody.slice(
    applyBody.indexOf('CREATE POLICY "staff_insert_program_events"'),
    applyBody.indexOf('-- 8e.'))
  assert.match(insertPolicy, /public\.is_staff_event_writer\(\)/)
  assert.doesNotMatch(insertPolicy, /public\.is_staff\(\)/,
    'the write policy must NOT fall back to is_staff(), which admits viewer')
  assert.match(insertPolicy, /event_type IS DISTINCT FROM 'keith_tool_call'/)
})

test('is_staff_event_writer admits owner/admin/co-lead/interviewer and never viewer', () => {
  const fn = applyBody.slice(applyBody.indexOf('CREATE OR REPLACE FUNCTION public.is_staff_event_writer'),
    applyBody.indexOf('GRANT EXECUTE ON FUNCTION public.is_staff_event_writer'))
  for (const role of ["'owner'", "'admin'", "'co_lead'", "'co-lead'", "'interviewer'"]) {
    assert.ok(fn.includes(role), `${role} must be able to write events`)
  }
  // Match the QUOTED literal: 'interviewer' contains the substring "viewer", so a
  // bare substring check would fail on a correct function.
  assert.ok(!fn.includes("'viewer'"), 'viewer must never appear as a writer role')
  // Must be SECURITY DEFINER, or it is subject to user_profiles' own RLS and
  // would deny everyone while looking correct.
  assert.match(fn, /SECURITY DEFINER/)
  assert.match(fn, /STABLE/)
  // pg_catalog FIRST: a SECURITY DEFINER function must not be shadowable by a
  // same-named object planted in public.
  assert.match(fn, /SET search_path = pg_catalog, public/)
  assert.doesNotMatch(fn, /SET search_path = public, pg_catalog/)
  // Deactivated accounts lose write access with everything else.
  assert.match(fn, /COALESCE\(is_active, true\) = true/)
})

test('the writer predicate is executable by authenticated only', () => {
  assert.match(applyBody, /REVOKE ALL ON FUNCTION public\.is_staff_event_writer\(\) FROM PUBLIC;/)
  assert.match(applyBody, /REVOKE ALL ON FUNCTION public\.is_staff_event_writer\(\) FROM anon;/)
  assert.match(applyBody, /GRANT EXECUTE ON FUNCTION public\.is_staff_event_writer\(\) TO authenticated;/)
})

// ── Grants ───────────────────────────────────────────────────────────────────

test('service_role is narrowed to SELECT, INSERT', () => {
  assert.match(applyBody, /GRANT SELECT, INSERT ON public\.program_events TO service_role;/)
  assert.doesNotMatch(applyBody, /GRANT ALL\s+ON public\.program_events TO service_role;/)
  // And the policy set mirrors the grant rather than claiming FOR ALL.
  assert.doesNotMatch(applyBody, /service_role_all_program_events/)
  assert.match(applyBody, /CREATE POLICY "service_role_select_program_events"/)
  assert.match(applyBody, /CREATE POLICY "service_role_insert_program_events"/)
})

test('every client-facing grant is revoked before the narrow re-grant', () => {
  for (const role of ['PUBLIC', 'anon', 'authenticated', 'service_role']) {
    assert.ok(applyBody.includes(`REVOKE ALL ON public.program_events FROM ${role};`),
      `${role} must be revoked before re-granting`)
  }
  assert.match(applyBody, /GRANT SELECT, INSERT ON public\.program_events TO authenticated;/)
  // No UPDATE or DELETE reaches any role ON THE EVENTS TABLE. The trailing
  // " TO " matters: "program_events" is a prefix of
  // "program_events_rls_lockdown_runs", whose own grant legitimately includes
  // UPDATE, and a prefix match would flag it.
  assert.doesNotMatch(applyBody, /GRANT[^;]*\bUPDATE\b[^;]*ON public\.program_events TO/)
  assert.doesNotMatch(applyBody, /GRANT[^;]*\bDELETE\b[^;]*ON public\.program_events TO/)
})

test('no UPDATE or DELETE policy exists for any role', () => {
  assert.doesNotMatch(applyBody, /FOR UPDATE TO/)
  assert.doesNotMatch(applyBody, /FOR DELETE TO/)
})

// ── Rollback exactness ───────────────────────────────────────────────────────

test('rollback revokes the lockdown grants BEFORE replaying captured ones', () => {
  const revokeAt = rollback.indexOf('REVOKE ALL ON public.program_events FROM service_role;')
  const replayAt = rollback.indexOf('EXECUTE g.restore_sql;')
  assert.ok(revokeAt > 0, 'the rollback must revoke lockdown grants')
  assert.ok(replayAt > 0, 'the rollback must replay captured grants')
  assert.ok(revokeAt < replayAt,
    'GRANT is additive, so a privilege this migration added would survive a replay that did not revoke first')
})

test('rollback restores grant options rather than silently downgrading them', () => {
  // Captured...
  assert.match(applyBody, /CASE WHEN g\.is_grantable THEN ' WITH GRANT OPTION' ELSE '' END/)
  // ...and the audit script checks the captured SQL actually carries it.
  assert.match(audit, /WITH GRANT OPTION/)
})

test('rollback restores the PRIOR RLS state instead of assuming it was enabled', () => {
  assert.match(applyBody, /prior_rowsecurity\s+boolean\s+NOT NULL/)
  assert.match(applyBody, /prior_forcerowsecurity boolean\s+NOT NULL/)
  assert.match(applyBody, /SELECT c\.relrowsecurity, c\.relforcerowsecurity/)
  // Both branches must exist: a table that was NOT under RLS before must not be
  // left under RLS by a rollback.
  assert.match(rollback, /IF v_rls THEN\s*\n\s*ALTER TABLE public\.program_events ENABLE ROW LEVEL SECURITY;\s*\n\s*ELSE\s*\n\s*ALTER TABLE public\.program_events DISABLE ROW LEVEL SECURITY;/)
  assert.match(rollback, /ALTER TABLE public\.program_events NO FORCE ROW LEVEL SECURITY;/)
})

test('rollback drops everything the migration created, including the helper', () => {
  for (const name of ['service_role_select_program_events', 'service_role_insert_program_events',
    'staff_select_program_events', 'staff_insert_program_events']) {
    assert.ok(rollback.includes(`DROP POLICY IF EXISTS "${name}"`), `${name} must be dropped`)
  }
  assert.match(rollback, /DROP FUNCTION IF EXISTS public\.is_staff_event_writer\(\);/)
})

// ── Stale backup reuse ───────────────────────────────────────────────────────

test('each apply captures a complete fresh snapshot under its own run_id', () => {
  assert.match(applyBody, /CREATE TABLE IF NOT EXISTS public\.program_events_rls_lockdown_runs/)
  assert.match(applyBody, /run_id\s+uuid\s+NOT NULL REFERENCES public\.program_events_rls_lockdown_runs\(run_id\) ON DELETE CASCADE/)
  // The previous draft deduped with NOT EXISTS, which is what made a second run
  // silently keep the first run's snapshot.
  const capture = applyBody.slice(applyBody.indexOf('DO $capture$'), applyBody.indexOf('$capture$;'))
  assert.doesNotMatch(capture, /NOT EXISTS/,
    'capture must be unconditional per run, not deduped against earlier runs')
  assert.match(capture, /RETURNING run_id INTO v_run/)
})

test('the first-run precheck never statically references the run registry', () => {
  const gate = applyBody.slice(0, applyBody.indexOf('-- \u2500\u2500 2.'))
  // plpgsql evaluates `IF a AND b` as ONE SQL expression, so a static
  // FROM public.program_events_rls_lockdown_runs would be name-resolved even
  // when the to_regclass guard is false - failing on the very first application,
  // the one case this guard exists to handle. The lookup must be dynamic.
  // Reduce to EXECUTABLE text before asserting. Two kinds of legitimate mention
  // must not count: the comment above the guard, which explains the hazard by
  // naming it, and the EXECUTE'd literal, which contains the table name as data.
  // Only an unquoted reference in live SQL is a parse-time hazard.
  const gateStatic = gate
    .split('\n').filter(l => !l.trim().startsWith('--')).join('\n')
    .replace(/EXECUTE '[^']*'/g, "EXECUTE '<dynamic>'")
  assert.doesNotMatch(gateStatic, /FROM public\.program_events_rls_lockdown_runs/,
    'a static reference here breaks the first application')
  assert.match(gate, /IF to_regclass\('public\.program_events_rls_lockdown_runs'\) IS NOT NULL THEN/)
  assert.match(gate, /EXECUTE 'SELECT count\(\*\) FROM public\.program_events_rls_lockdown_runs WHERE rolled_back_at IS NULL'/)
  assert.match(gate, /previous run\(s\) still open/)
})

test('the legacy-schema guard validates BOTH backup tables and the run registry', () => {
  const gate = applyBody.slice(0, applyBody.indexOf('-- \u2500\u2500 2.'))
  for (const table of ['program_events_rls_policy_backup', 'program_events_rls_grant_backup',
    'program_events_rls_lockdown_runs']) {
    assert.ok(gate.includes(`to_regclass('public.${table}') IS NOT NULL`),
      `${table} must be validated when present`)
  }
  // The registry needs more than run_id to be usable by the rollback.
  for (const col of ['run_id', 'prior_rowsecurity', 'prior_forcerowsecurity', 'rolled_back_at']) {
    assert.ok(gate.includes(`('${col}')`), `the registry check must require ${col}`)
  }
  // These probes read information_schema, which is safe whether or not the
  // tables exist, so they do not need dynamic SQL.
  assert.match(gate, /FROM information_schema\.columns/)
  assert.match(gate, /incomplete shape/)
})

test('rollback restores exactly one run and then closes it', () => {
  assert.match(rollback, /WHERE rolled_back_at IS NULL\s*\n\s*ORDER BY captured_at DESC\s*\n\s*LIMIT 1/)
  assert.match(rollback, /WHERE run_id = v_run/)
  assert.match(rollback, /SET rolled_back_at = now\(\)/)
  // A second rollback must not silently re-grant.
  assert.match(rollback, /no open lockdown run found/)
})

// ── The codebase claims the header makes ─────────────────────────────────────

test('the header claim that nothing server-side mutates program_events still holds', () => {
  // If this fails, the service_role narrowing is no longer safe.
  const server = ['api', 'lib'].flatMap(dir => {
    const out = []
    const walk = (d) => {
      for (const e of readdirSync(join(here, '..', d), { withFileTypes: true })) {
        if (e.name === 'node_modules') continue
        const full = join(d, e.name)
        if (e.isDirectory()) walk(full)
        else if (e.name.endsWith('.js')) out.push(full)
      }
    }
    walk(dir)
    return out
  })
  const offenders = server.filter(f => {
    const src = read(f)
    if (!src.includes('program_events')) return false
    return /from\(['"]program_events['"]\)\s*\.\s*(update|delete|upsert)\(/.test(src)
  })
  assert.deepEqual(offenders, [],
    'a server-side update/delete of program_events would break the SELECT+INSERT service_role grant')
})

test('the PRECHECK probe is safe on a first application', () => {
  const probe = audit.slice(audit.indexOf('-- 1.4b'), audit.indexOf('-- 1.5 PREREQUISITE'))
  // Same trap as the migration: on a first run none of these tables exist, and a
  // plain SELECT naming them errors in the SQL editor - alarming output for the
  // expected healthy state.
  assert.doesNotMatch(probe, /^SELECT[\s\S]*FROM public\.program_events_rls_lockdown_runs/m)
  assert.match(probe, /DO \$probe\$/)
  assert.match(probe, /IF to_regclass\('public\.program_events_rls_lockdown_runs'\) IS NULL THEN/)
  assert.match(probe, /this is a first application/)
  assert.match(probe, /EXECUTE 'SELECT count\(\*\) FROM public\.program_events_rls_lockdown_runs/)
  // And it validates all three artifacts, like the migration does.
  for (const table of ['program_events_rls_policy_backup', 'program_events_rls_grant_backup',
    'program_events_rls_lockdown_runs']) {
    assert.ok(probe.includes(table), `${table} must be probed`)
  }
})

test('the verification script matches the policy set the migration creates', () => {
  assert.match(audit, /service_role_select_program_events/)
  assert.match(audit, /service_role_insert_program_events/)
  assert.match(audit, /is_staff_event_writer/)
  // The audit must check the QUOTED literal, since 'interviewer' contains "viewer".
  assert.match(audit, /LIKE '%''viewer''%'/)
  assert.doesNotMatch(audit, /service_role_all_program_events/)
})

// ── Framing and grant verification (post-PRECHECK correction) ────────────────

test('anon full CRUD is described as historical, not as the current state', () => {
  const header = sql.slice(0, sql.indexOf('\nBEGIN;'))
  assert.match(header, /HISTORICAL EXPOSURE/)
  assert.match(header, /NO anon policy and NO anon grant remain/)
  // The old present-tense claim must be gone: the production PRECHECK on
  // 2026-08-06 found no anon policy and no anon grant.
  assert.doesNotMatch(header, /Today that table is protected by nothing/)
  // And the migration must still state what it is for now that anon is closed.
  assert.match(header, /WHAT THIS MIGRATION IS THEREFORE STILL FOR/)
  assert.match(audit, /PASS: ZERO rows\. The 2026-08-06 production PRECHECK/)
})

test('V5 classifies grantees instead of counting rows', () => {
  // aclexplode(relacl) reports the TABLE OWNER's privileges too, so an
  // "exactly two grantees" expectation fails on a correct database.
  const v5 = audit.slice(audit.indexOf('-- 2.5 (V5)'), audit.indexOf('-- 2.5b'))
  assert.doesNotMatch(v5, /PASS: exactly two rows/)
  assert.match(v5, /pg_get_userbyid\(c\.relowner\) AS owner_role/,
    'the owner must be resolved dynamically, not hard-coded to postgres')
  assert.match(v5, /'FAIL - client role must hold NO privileges'/)
  assert.match(v5, /acl\.grantee = 'authenticated' AND acl\.privileges = 'INSERT, SELECT'/)
  assert.match(v5, /acl\.grantee = 'service_role' AND acl\.privileges = 'INSERT, SELECT'/)
  assert.match(v5, /'FAIL - authenticated must be exactly INSERT, SELECT'/)
  assert.match(v5, /'FAIL - service_role must be exactly INSERT, SELECT'/)
  assert.match(v5, /'ok - table owner \(trusted\)'/)
  assert.match(v5, /'UNEXPECTED - STOP and review this grantee'/)
})

test('a separate check catches a client role holding a mutating privilege', () => {
  // Kept out of 2.5 so trusted owner UPDATE/DELETE cannot mask a client role
  // that wrongly has them.
  const v5b = audit.slice(audit.indexOf('-- 2.5b'), audit.indexOf('-- 2.6'))
  assert.match(v5b, /IN \('anon', 'PUBLIC', 'authenticated', 'service_role'\)/)
  assert.match(v5b, /IN \('UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'\)/)
  assert.match(v5b, /PASS: zero rows/)
})

test('the migration V5 comment matches the audit script', () => {
  const v5 = sql.slice(sql.indexOf('-- V5. Table grants'), sql.indexOf('-- V6.'))
  assert.match(v5, /by grantee class/i)
  assert.match(v5, /the table owner \/ platform admin roles : may retain full privileges/)
  assert.doesNotMatch(v5, /EXACTLY two grantees/)
})
