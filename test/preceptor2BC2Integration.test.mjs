// PHASE 2B + 2C INTEGRATION: static proofs of the cross-migration relationship the two
// migrations depend on. These complement the per-migration guards in
// preceptorAuthorizationMigration.test.mjs and preceptorMirrorRepairMigration.test.mjs. No live
// DB is applied by this gated pass, so these assert the authored SQL's structure: the apply
// order, the guard-before-definer trigger relationship, the explicit role denials, the
// transactional in-app + email row, and that no RLS is widened / no anon grant is added.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const read = (p) => readFileSync(join(root, p), 'utf8')

const MIG_2B = 'supabase/migrations/20260722000000_preceptor_mirror_repair_and_sync.sql'
const MIG_2C = 'supabase/migrations/20260723000000_preceptor_assignment_authorization.sql'
const sql2b = read(MIG_2B)
const sql2c = read(MIG_2C)
const live2c = sql2c.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*--.*$/gm, '')
const helper = live2c.slice(live2c.indexOf('_preceptor_assert_actor_for_student'),
                            live2c.indexOf('_emit_staff_notifications'))

// ── Apply order: 2B precedes 2C ───────────────────────────────────────────────
test('Phase 2B is ordered before Phase 2C by migration timestamp', () => {
  const ts = (p) => p.match(/(\d{14})/)[1]
  assert.ok(ts(MIG_2B) < ts(MIG_2C), '2B timestamp must be earlier than 2C')
  // Both exist in the migrations dir and 2B sorts first.
  const migs = readdirSync(join(root, 'supabase/migrations')).filter(f => f.endsWith('.sql')).sort()
  assert.ok(migs.indexOf('20260722000000_preceptor_mirror_repair_and_sync.sql')
          < migs.indexOf('20260723000000_preceptor_assignment_authorization.sql'))
})

test('2C documents and depends on the 2B sync trigger (apply 2B first)', () => {
  assert.match(sql2c, /Depends on Phase 2B/i)
  assert.match(sql2c, /apply 2B FIRST/i)
})

// ── The 2C guard protects the 2B SECURITY DEFINER trigger ────────────────────
test('guard is BEFORE UPDATE and 2B sync is AFTER UPDATE on the same column (guard runs first)', () => {
  // 2C: BEFORE UPDATE OF preceptor_id authorizes the write.
  assert.match(live2c, /CREATE TRIGGER trg_guard_students_preceptor_id\s*\n\s*BEFORE UPDATE OF preceptor_id ON public\.students/)
  // 2B: AFTER INSERT OR UPDATE OF preceptor_id mirrors the committed value.
  assert.match(sql2b, /CREATE TRIGGER trg_sync_primary_preceptor_mirror\s*\n\s*AFTER INSERT OR UPDATE OF preceptor_id ON public\.students/)
  // 2B's mirror function is SECURITY DEFINER (the object the guard protects).
  assert.match(sql2b, /FUNCTION public\.sync_primary_preceptor_mirror\(\)[\s\S]{0,120}SECURITY DEFINER/)
})

test('an unauthorized client UPDATE is rejected before the definer trigger can mirror it', () => {
  // The guard raises MS403 for a non-owner/admin client with no per-row marker, so a client can
  // never reach the point where the 2B AFTER trigger would propagate an unauthorized change.
  const guard = live2c.slice(live2c.indexOf('FUNCTION public.guard_students_preceptor_id_change'),
                             live2c.indexOf('DROP TRIGGER'))
  assert.match(guard, /RAISE EXCEPTION[\s\S]{0,140}USING ERRCODE = 'MS403'/)
  assert.match(guard, /v_marker = NEW\.id::text AND v_privileged/)
  assert.match(guard, /is_active_owner_or_admin\(\)/)
})

// ── Role authority: only owner/admin or in-scope UL; everyone else denied ─────
test('interviewer, viewer, and co_lead have no grant branch (fall through to MS404 denial)', () => {
  // The helper grants only owner/admin (role or is_owner) or an active unit_leader grant+scope;
  // there is no branch for any other role, so interviewer/viewer/co_lead reach the else->MS404.
  assert.match(helper, /p\.role IN \('owner', 'admin'\) OR p\.is_owner IS TRUE/)
  assert.match(helper, /g\.role = 'unit_leader'/)
  assert.ok(!/'interviewer'|'viewer'|'co_lead'/.test(helper), 'no other-role authorization branch exists')
  // Final else is the non-enumerating MS404.
  assert.match(helper, /ELSE\s*\n\s*RAISE EXCEPTION 'not found' USING ERRCODE = 'MS404'/)
})

test('an out-of-scope student change is denied (UL scope is asserted before any write)', () => {
  // The UL branch requires an active user_unit_scopes row for the student's unit; otherwise the
  // else->MS404 fires. Scope is checked inside the shared assert helper, which every write RPC
  // calls FIRST (before touching students / assignments).
  assert.match(helper, /user_unit_scopes s[\s\S]{0,200}s\.unit_key = v_unit_key/)
  for (const fn of ['assign_primary_preceptor', 'set_secondary_coverage_preceptor']) {
    const body = live2c.slice(live2c.indexOf('FUNCTION public.' + fn))
    const assertPos = body.indexOf('_preceptor_assert_actor_for_student')
    const writePos = Math.min(...['UPDATE public.students', 'INSERT INTO public.student_preceptor_assignments']
      .map(s => { const i = body.indexOf(s); return i < 0 ? Infinity : i }))
    assert.ok(assertPos > -1 && assertPos < writePos, `${fn} authorizes before it writes`)
  }
})

test('owner/admin normal (within-window) primary change succeeds with was_override=false', () => {
  // The helper returns was_override=false on the normal path (active or within 90 days); the RPC
  // proceeds to update + audit + notify. No force/confirm is required for the normal path. This is
  // the final RETURN of the helper (the override branch returns earlier with was_override=true).
  assert.match(helper, /RETURN jsonb_build_object\('role', v_role, 'was_override', false/)
})

// ── In-app + email are one transactional row; dedup by event+recipient ───────
test('the in-app card and the email queue are the SAME row, written in the RPC transaction', () => {
  // One table carries both channels; the emit runs inside the RPC (PERFORM, no COMMIT between the
  // students write, the audit insert, and the fan-out), so all rows commit atomically.
  assert.match(live2c, /CREATE TABLE IF NOT EXISTS public\.staff_notifications[\s\S]{0,2000}in_app_read_at[\s\S]{0,400}queue_status/)
  const primary = live2c.slice(live2c.indexOf('FUNCTION public.assign_primary_preceptor'),
                               live2c.indexOf('FUNCTION public.set_secondary_coverage_preceptor'))
  assert.ok(!/COMMIT;/.test(primary), 'the RPC body contains no intermediate COMMIT')
  assert.ok(primary.indexOf('UPDATE public.students') < primary.indexOf('preceptor_assignment_events'), 'write then audit')
  assert.ok(primary.indexOf('preceptor_assignment_events') < primary.indexOf('_emit_staff_notifications'), 'audit then notify')
})

test('event-recipient deduplication is enforced by a UNIQUE constraint and an idempotent fan-out', () => {
  assert.match(live2c, /CONSTRAINT uq_staff_notifications_event_recipient UNIQUE \(correlation_id, recipient_profile_id\)/)
  assert.match(live2c, /ON CONFLICT \(correlation_id, recipient_profile_id\) DO NOTHING/)
})

// ── Unit Leaders have no direct table write; no RLS widening / no anon grant ──
test('Unit Leaders act only through service-role RPCs (no client table-write path)', () => {
  const ul = read('api/portal/unit-preceptor-manage.js')
  assert.match(ul, /verifyPortalUnitLeaderCaller\(req\)/)
  assert.ok(!/\.from\(['"]students['"]\)|\.from\(['"]student_preceptor_assignments['"]\)|\.from\(['"]preceptors['"]\)/.test(ul),
    'the UL endpoint never writes a domain table directly')
  // The write RPCs are service_role-only (called with the service client), so a UL JWT cannot run them.
  for (const fn of ['assign_primary_preceptor', 'set_secondary_coverage_preceptor', 'create_unit_preceptor']) {
    assert.ok(live2c.includes(`REVOKE ALL ON FUNCTION public.${fn}`) &&
              new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}[\\s\\S]{0,220}TO service_role`).test(live2c),
      `${fn} is service_role-only`)
  }
})

test('neither migration widens RLS or grants writes to anon/authenticated on domain tables', () => {
  for (const [label, sql] of [['2B', sql2b], ['2C', live2c]]) {
    assert.ok(!/CREATE POLICY[\s\S]{0,200}FOR (INSERT|UPDATE|DELETE|ALL)/.test(sql), `${label}: no client write policy`)
    assert.ok(!/GRANT (INSERT|UPDATE|DELETE|ALL)[^;]*(anon|authenticated)/i.test(sql), `${label}: no table write grant to clients`)
  }
  // 2C's only client-executable grant is the read-state mark RPC (authenticated), which touches
  // in_app_read_at on the caller's own rows only.
  assert.match(live2c, /GRANT EXECUTE ON FUNCTION public\.mark_staff_notifications_read\(uuid\[\]\) TO authenticated/)
  assert.ok(!/GRANT EXECUTE[^;]*\b(anon)\b/.test(live2c), '2C grants nothing to anon')
})
