// PHASE 2C: static guards for the scoped preceptor-assignment authorization + backend.
//
// The migration and app changes are GATED and NOT applied/deployed by this pass. These guards
// prove the guard trigger fails closed and cannot be bypassed, the RPCs follow the established
// service-role/definer convention, the audit + Owner/Admin notification are transactional, no
// RLS is widened, and the staff path is routed through the audited RPC. Behavioral proof (deny
// interviewer, allow owner/admin, in/out-of-scope UL) requires the live DB and is listed in the
// handoff doc's verification plan; here we assert the SQL/JS that makes those outcomes true.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')

const mig      = read('supabase/migrations/20260723000000_preceptor_assignment_authorization.sql')
const ver      = read('db/audit/preceptor_assignment_authorization_preflight_and_verification.sql')
const ulEp     = read('api/portal/unit-preceptor-manage.js')
const staffEp  = read('api/preceptor-primary-assign.js')
const modal    = read('src/components/PreceptorAssignmentModal.jsx')

const live = mig.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*--.*$/gm, '')

// ── The guard: fail-closed, invoker, no general bypass ──────────────────────
test('the guard is a BEFORE UPDATE OF preceptor_id trigger, SECURITY INVOKER, fixed search_path', () => {
  assert.match(live, /CREATE TRIGGER trg_guard_students_preceptor_id\s*\n\s*BEFORE UPDATE OF preceptor_id ON public\.students/)
  const fn = live.slice(live.indexOf('FUNCTION public.guard_students_preceptor_id_change'))
  assert.match(fn, /SECURITY INVOKER/)
  assert.ok(!/guard_students_preceptor_id_change[\s\S]{0,200}SECURITY DEFINER/.test(fn), 'guard is not DEFINER')
  assert.match(fn, /SET search_path = public, pg_catalog/)
})

test('the guard fails closed and denies non-owner/admin direct writes', () => {
  const fn = live.slice(live.indexOf('guard_students_preceptor_id_change'), live.indexOf('DROP TRIGGER IF EXISTS trg_guard'))
  assert.match(fn, /RAISE EXCEPTION[\s\S]{0,120}USING ERRCODE = 'MS403'/)
  // Owner/admin direct staff path is allowed via the active-owner/admin helper.
  assert.match(fn, /IF public\.is_active_owner_or_admin\(\) THEN\s*\n\s*RETURN NEW/)
})

test('the RPC path requires BOTH a marker AND a privileged role (no sole-GUC, no general definer bypass)', () => {
  const fn = live.slice(live.indexOf('guard_students_preceptor_id_change'), live.indexOf('DROP TRIGGER IF EXISTS trg_guard'))
  // The marker alone is insufficient: it is ANDed with a privileged current_user.
  assert.match(fn, /v_marker IS NOT NULL AND length\(v_marker\) > 0 AND v_privileged/)
  assert.match(fn, /v_privileged\s+boolean := current_user NOT IN \('authenticated', 'anon'\)/)
  assert.match(fn, /current_setting\('app\.preceptor_change_authorized', true\)/)
  // Only the authorized RPCs set the marker; a bare definer function that does not set it is denied.
  assert.equal((live.match(/set_config\('app\.preceptor_change_authorized', p_actor_profile_id::text, true\)/g) || []).length, 1,
    'exactly the primary RPC sets the marker before its update')
})

// ── The RPCs: established service-role/definer convention ───────────────────
test('all three RPCs are SECURITY DEFINER, fixed search_path, service_role-only', () => {
  for (const fn of ['assign_primary_preceptor', 'set_secondary_coverage_preceptor', 'create_unit_preceptor']) {
    const body = live.slice(live.indexOf('FUNCTION public.' + fn))
    assert.match(body, /SECURITY DEFINER/, `${fn} is definer`)
    assert.match(body, /SET search_path = public, pg_catalog/, `${fn} search_path`)
    assert.ok(live.includes(`REVOKE ALL ON FUNCTION public.${fn}`) && live.includes('FROM PUBLIC, anon, authenticated'),
      `${fn} revoked from public/anon/authenticated`)
    assert.ok(live.includes(`GRANT EXECUTE ON FUNCTION public.${fn}`) && live.includes('TO service_role'),
      `${fn} granted to service_role`)
  }
})

test('the RPCs authorize from the actor profile id (never auth.uid), non-enumerating', () => {
  const helper = live.slice(live.indexOf('_preceptor_assert_actor_for_student'), live.indexOf('assign_primary_preceptor'))
  assert.ok(!/auth\.uid\(\)/.test(helper), 'the write authz helper does not use auth.uid()')
  // Active owner/admin (role or is_owner) global; else active unit_leader grant + active unit scope.
  assert.match(helper, /p\.role IN \('owner', 'admin'\) OR p\.is_owner IS TRUE/)
  assert.match(helper, /g\.role = 'unit_leader'[\s\S]{0,200}g\.revoked_at IS NULL/)
  assert.match(helper, /s\.unit_key = v_unit_key[\s\S]{0,160}s\.revoked_at IS NULL/)
  // canonical student->unit: matched_unit_id -> units.unit_name
  assert.match(helper, /FROM public\.units u WHERE u\.id = v_stu\.matched_unit_id/)
  // Out-of-scope == not found (non-enumerating).
  assert.equal((helper.match(/USING ERRCODE = 'MS404'/g) || []).length >= 1, true)
})

test('the completed-rotation reason/window rule mirrors completedStillVisible', () => {
  const helper = live.slice(live.indexOf('_preceptor_assert_actor_for_student'), live.indexOf('assign_primary_preceptor'))
  assert.match(helper, /status = 'Completed'/)
  assert.match(helper, /COALESCE\(v_stu\.rotation_completed_at, v_stu\.rotation_end_date::timestamptz\)/)
  assert.match(helper, /INTERVAL '90 days'/)
  // Deny outside the window (MS403); require a reason within it (MS400).
  assert.match(helper, /outside the 90-day change window[\s\S]{0,60}MS403/)
  assert.match(helper, /a reason is required[\s\S]{0,80}MS400/)
})

// ── Primary: sets preceptor_id and relies on the 2B trigger ─────────────────
test('assign_primary sets students.preceptor_id (2B trigger mirrors) and records the anomaly case', () => {
  const fn = live.slice(live.indexOf('FUNCTION public.assign_primary_preceptor'), live.indexOf('FUNCTION public.set_secondary_coverage_preceptor'))
  assert.match(fn, /UPDATE public\.students SET preceptor_id = p_preceptor_id WHERE id = p_student_id/)
  assert.match(fn, /is_active IS TRUE/)  // inactive preceptor rejected
  // matches anomaly: >1 same-cohort match rows -> structured event, primary change stays correct.
  assert.match(fn, /same_cohort_match_rows/)
  assert.match(fn, /'matches_anomaly'/)
})

// ── Secondary/Coverage: canonical SPA, never primary, ppm3 conflict -> MS409 ─
test('secondary/coverage writes canonical assignments, never primary, dedup to MS409', () => {
  const fn = live.slice(live.indexOf('FUNCTION public.set_secondary_coverage_preceptor'), live.indexOf('FUNCTION public.create_unit_preceptor'))
  assert.match(fn, /p_role NOT IN \('secondary', 'coverage'\)/)
  // End targets only secondary/coverage active rows (never a primary).
  assert.match(fn, /a\.role IN \('secondary', 'coverage'\)/)
  assert.match(fn, /a\.status = 'active'/)
  assert.match(fn, /INSERT INTO public\.student_preceptor_assignments/)
  assert.match(fn, /EXCEPTION WHEN unique_violation THEN\s*\n\s*RAISE EXCEPTION[\s\S]{0,160}MS409/)
  assert.ok(!/'primary'/.test(fn), 'secondary/coverage RPC never writes a primary row')
})

// ── Preceptor creation: dedup, provenance, shift ────────────────────────────
test('create_unit_preceptor dedups by normalized email, records provenance, pins shift', () => {
  const fn = live.slice(live.indexOf('FUNCTION public.create_unit_preceptor'))
  assert.match(fn, /lower\(btrim\(p\.email\)\) = v_email/)  // matches preceptors_email_lower_unique_idx
  assert.match(fn, /created_by, created_by_role/)
  assert.match(fn, /p_shift NOT IN \('Day', 'Night', 'Mid', 'Variable'\)/)
  assert.match(live, /ADD COLUMN IF NOT EXISTS created_by\b/)
  assert.match(live, /ADD COLUMN IF NOT EXISTS created_by_role/)
})

// ── Audit + durable notification in one transaction ─────────────────────────
test('every action writes an audit row and enqueues a durable Owner/Admin notification', () => {
  assert.match(live, /CREATE TABLE IF NOT EXISTS public\.preceptor_assignment_events/)
  assert.match(live, /CREATE TABLE IF NOT EXISTS public\.staff_notification_queue/)
  assert.match(live, /CONSTRAINT uq_snq_idempotency UNIQUE \(idempotency_key\)/)
  // The enqueue is inside the RPC transaction and does NOT swallow a conflict (mirrors messages).
  const enq = live.slice(live.indexOf('FUNCTION public._enqueue_staff_notification'))
  assert.ok(!/ON CONFLICT/.test(enq), 'enqueue does not silently drop a duplicate')
  assert.match(enq, /INSERT INTO public\.staff_notification_queue/)
  assert.match(enq, /'queued', now\(\)\)/)  // enqueue-before-send status
  // Each RPC calls both the audit insert and the enqueue.
  for (const fn of ['assign_primary_preceptor', 'set_secondary_coverage_preceptor', 'create_unit_preceptor']) {
    const body = live.slice(live.indexOf('FUNCTION public.' + fn), live.indexOf('REVOKE ALL ON FUNCTION public.' + fn))
    assert.match(body, /INSERT INTO public\.preceptor_assignment_events/, `${fn} audits`)
    assert.match(body, /_enqueue_staff_notification/, `${fn} notifies`)
  }
})

// ── No RLS widening ─────────────────────────────────────────────────────────
test('no RLS widening: new tables are owner/admin SELECT only, no write policy, no anon grant', () => {
  assert.equal((live.match(/FOR SELECT TO authenticated\s*\n\s*USING \(public\.is_active_owner_or_admin\(\)\)/g) || []).length, 2)
  assert.ok(!/CREATE POLICY[\s\S]{0,120}FOR (INSERT|UPDATE|DELETE|ALL)/.test(live), 'no write policy created')
  assert.ok(!/GRANT (INSERT|UPDATE|DELETE|ALL)[^;]*(anon|authenticated)/i.test(live), 'no table write grant to clients')
  assert.match(live, /ENABLE ROW LEVEL SECURITY/)
})

// ── Endpoints: verify caller, service-role RPC, no direct UL table write ─────
test('the UL endpoint verifies the portal caller and calls the RPC with the actor profile id', () => {
  assert.match(ulEp, /verifyPortalUnitLeaderCaller\(req\)/)
  assert.match(ulEp, /db\.rpc\(rpc, args\)/)
  assert.match(ulEp, /p_actor_profile_id: profile\.id/)
  assert.match(ulEp, /mapRpcStatus\(error\)[\s\S]{0,40}mapRpcError\(error\)/)
  // No direct table write from the UL endpoint.
  assert.ok(!/\.from\('students'\)|\.from\('student_preceptor_assignments'\)|\.from\('preceptors'\)\.insert/.test(ulEp),
    'the UL endpoint never writes a table directly')
})

test('the staff endpoint verifies owner/admin and routes the primary change through the RPC', () => {
  assert.match(staffEp, /is_owner === true \|\| \['owner', 'admin'\]\.includes\(role\)/)
  assert.match(staffEp, /rpc\('assign_primary_preceptor'/)
  assert.match(staffEp, /p_actor_profile_id: caller\.profileId/)
})

test('the staff modal routes the primary write through the audited endpoint, not a bare update', () => {
  assert.match(modal, /fetch\('\/api\/preceptor-primary-assign'/)
  // The old direct students.update({ preceptor_id ... }) and matches.update are gone.
  assert.ok(!/from\('students'\)\.update\(\{[\s\S]{0,80}preceptor_id:/.test(modal), 'no direct students preceptor_id write')
  assert.ok(!/from\('matches'\)\.update\(\{ preceptor_id/.test(modal), 'no direct matches preceptor_id write')
})

test('no em dash in the migration, verification, endpoints, or modal changes', () => {
  const emDash = String.fromCharCode(0x2014)
  for (const src of [mig, ver, ulEp, staffEp]) assert.ok(!src.includes(emDash), 'no em dash')
})
