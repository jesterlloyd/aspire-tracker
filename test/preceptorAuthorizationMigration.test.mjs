// PHASE 2C: static guards for the scoped preceptor-assignment authorization + backend.
//
// The migration and app changes are GATED and NOT applied/deployed by this pass. These guards
// prove the guard fails closed and cannot be bypassed, the RPCs follow the established
// service-role/definer convention, the completed-rotation override and cross-unit rules, the
// per-recipient in-app + email fan-out, the durable queue + worker, no RLS widening, and the
// staff-path routing. Behavioral proof against a live DB is in the handoff's verification plan;
// the email worker's runtime behavior is tested in test/staffNotificationWorker.test.mjs.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')

const mig     = read('supabase/migrations/20260723000000_preceptor_assignment_authorization.sql')
const ver     = read('db/audit/preceptor_assignment_authorization_preflight_and_verification.sql')
const ulEp    = read('api/portal/unit-preceptor-manage.js')
const staffEp = read('api/preceptor-primary-assign.js')
const modal   = read('src/components/PreceptorAssignmentModal.jsx')
const worker  = read('lib/server/staffNotifications/deliveryService.js')
const emailC  = read('lib/server/staffNotifications/emailContent.js')
const cron    = read('api/cron/staff-notification-worker.js')
const vercel  = read('vercel.json')

const live = mig.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*--.*$/gm, '')

// ── Guard: fail-closed, invoker, hardened per-student marker, no general bypass ──
test('the guard is BEFORE UPDATE OF preceptor_id, SECURITY INVOKER, fixed search_path, fail-closed', () => {
  assert.match(live, /CREATE TRIGGER trg_guard_students_preceptor_id\s*\n\s*BEFORE UPDATE OF preceptor_id ON public\.students/)
  const fn = live.slice(live.indexOf('FUNCTION public.guard_students_preceptor_id_change'), live.indexOf('DROP TRIGGER'))
  assert.match(fn, /SECURITY INVOKER/)
  assert.match(fn, /SET search_path = public, pg_catalog/)
  assert.match(fn, /RAISE EXCEPTION[\s\S]{0,140}USING ERRCODE = 'MS403'/)
  assert.match(fn, /IF public\.is_active_owner_or_admin\(\) THEN\s*\n\s*RETURN NEW/)
})

test('the marker is per-student and ANDed with a privileged role (no sole-GUC, no general bypass)', () => {
  const fn = live.slice(live.indexOf('FUNCTION public.guard_students_preceptor_id_change'), live.indexOf('DROP TRIGGER'))
  assert.match(fn, /v_marker IS NOT NULL AND v_marker = NEW\.id::text AND v_privileged/)
  assert.match(fn, /v_privileged boolean := current_user NOT IN \('authenticated', 'anon'\)/)
  // The primary RPC sets the marker to the SPECIFIC student id and clears it after the update.
  assert.match(live, /set_config\('app\.preceptor_change_authorized', p_student_id::text, true\)/)
  assert.match(live, /set_config\('app\.preceptor_change_authorized', '', true\)/)
})

// ── RPCs: established service-role/definer convention ───────────────────────
test('the write + claim RPCs are SECURITY DEFINER, fixed search_path, service_role-only', () => {
  for (const fn of ['assign_primary_preceptor', 'set_secondary_coverage_preceptor', 'create_unit_preceptor', 'claim_due_staff_notifications']) {
    const body = live.slice(live.indexOf('FUNCTION public.' + fn))
    assert.match(body, /SECURITY DEFINER/, `${fn} definer`)
    assert.match(body, /SET search_path = public, pg_catalog/, `${fn} search_path`)
    assert.ok(live.includes(`REVOKE ALL ON FUNCTION public.${fn}`) && live.includes('FROM PUBLIC, anon, authenticated'), `${fn} revoked`)
    assert.ok(live.includes(`GRANT EXECUTE ON FUNCTION public.${fn}`) && live.includes('TO service_role'), `${fn} to service_role`)
  }
  // The in-app mark-read RPC is granted to authenticated (called with the user's JWT).
  assert.match(live, /GRANT EXECUTE ON FUNCTION public\.mark_staff_notifications_read\(uuid\[\]\) TO authenticated/)
})

test('authorization is from the actor profile id (never auth.uid), non-enumerating', () => {
  const helper = live.slice(live.indexOf('_preceptor_assert_actor_for_student'), live.indexOf('_emit_staff_notifications'))
  assert.ok(!/auth\.uid\(\)/.test(helper), 'the write authz helper does not use auth.uid()')
  assert.match(helper, /p\.role IN \('owner', 'admin'\) OR p\.is_owner IS TRUE/)
  assert.match(helper, /g\.role = 'unit_leader'[\s\S]{0,200}g\.revoked_at IS NULL/)
  assert.match(helper, /FROM public\.units u WHERE u\.id = v_stu\.matched_unit_id/)  // canonical student->unit
  assert.match(helper, /USING ERRCODE = 'MS404'/)
})

// ── Completed-rotation override ─────────────────────────────────────────────
test('override: UL denied beyond 90d even with force; owner/admin needs force+confirm+reason', () => {
  const helper = live.slice(live.indexOf('_preceptor_assert_actor_for_student'), live.indexOf('_emit_staff_notifications'))
  assert.match(helper, /v_end >= v_now - INTERVAL '90 days'/)
  // Unit Leader beyond window: hard deny (no force path).
  assert.match(helper, /IF v_role = 'unit_leader' THEN\s*\n\s*RAISE EXCEPTION 'completed rotation is outside the 90-day window' USING ERRCODE = 'MS403'/)
  // Owner/admin beyond window: force AND confirm required, plus a reason.
  assert.match(helper, /p_force IS NOT TRUE OR p_confirm_override IS NOT TRUE/)
  assert.match(helper, /a reason is required for a historical override[\s\S]{0,40}MS400/)
  // The override flag is recorded and returned.
  assert.match(helper, /'was_override', true/)
})

// ── Cross-unit allowed ──────────────────────────────────────────────────────
test('cross-unit is allowed: the RPC blocks only inactivity, not the preceptor unit', () => {
  const fn = live.slice(live.indexOf('FUNCTION public.assign_primary_preceptor'), live.indexOf('FUNCTION public.set_secondary_coverage_preceptor'))
  assert.match(fn, /preceptors p WHERE p\.id = p_preceptor_id AND p\.is_active IS TRUE/)
  // No comparison of the preceptor's unit to the student's unit anywhere in the assignment RPCs.
  const both = fn + live.slice(live.indexOf('FUNCTION public.set_secondary_coverage_preceptor'), live.indexOf('FUNCTION public.create_unit_preceptor'))
  assert.ok(!/p\.unit_id\s*=|p\.unit_name\s*=\s*v_unit_key/.test(both), 'no preceptor-unit restriction on assignment')
})

test('a UL-created preceptor must be under a unit in the UL scope', () => {
  const fn = live.slice(live.indexOf('FUNCTION public.create_unit_preceptor'))
  assert.match(fn, /user_unit_scopes s[\s\S]{0,140}s\.unit_key = p_unit_key/)
})

// ── Secondary/Coverage never touch primary; ppm3 dedup ──────────────────────
test('secondary/coverage writes canonical assignments, never primary, dedup to MS409', () => {
  const fn = live.slice(live.indexOf('FUNCTION public.set_secondary_coverage_preceptor'), live.indexOf('FUNCTION public.create_unit_preceptor'))
  assert.match(fn, /a\.role IN \('secondary', 'coverage'\)/)
  assert.match(fn, /INSERT INTO public\.student_preceptor_assignments/)
  assert.match(fn, /EXCEPTION WHEN unique_violation THEN\s*\n\s*RAISE EXCEPTION[\s\S]{0,160}MS409/)
})

// ── Notification: unified in-app + email, fan-out excludes actor, idempotent ─
test('staff_notifications is one durable in-app + email row per recipient, deduped', () => {
  assert.match(live, /CREATE TABLE IF NOT EXISTS public\.staff_notifications/)
  assert.match(live, /in_app_read_at\s+timestamptz/)         // in-app read state
  assert.match(live, /queue_status\s+text/)                  // email queue state
  assert.match(live, /CONSTRAINT uq_staff_notifications_event_recipient UNIQUE \(correlation_id, recipient_profile_id\)/)
  const emit = live.slice(live.indexOf('FUNCTION public._emit_staff_notifications'), live.indexOf('FUNCTION public.assign_primary_preceptor'))
  // Fan-out to every active owner/admin EXCEPT the actor; idempotent.
  assert.match(emit, /up\.role IN \('owner', 'admin'\) OR up\.is_owner IS TRUE/)
  assert.match(emit, /up\.id <> p_actor_profile_id/)
  assert.match(emit, /ON CONFLICT \(correlation_id, recipient_profile_id\) DO NOTHING/)
})

test('every action audits and emits; the primary RPC also flags the matches anomaly', () => {
  for (const fn of ['assign_primary_preceptor', 'set_secondary_coverage_preceptor', 'create_unit_preceptor']) {
    const body = live.slice(live.indexOf('FUNCTION public.' + fn), live.indexOf('REVOKE ALL ON FUNCTION public.' + fn))
    assert.match(body, /INSERT INTO public\.preceptor_assignment_events/, `${fn} audits`)
    assert.match(body, /_emit_staff_notifications/, `${fn} notifies`)
  }
  const primary = live.slice(live.indexOf('FUNCTION public.assign_primary_preceptor'), live.indexOf('FUNCTION public.set_secondary_coverage_preceptor'))
  assert.match(primary, /same_cohort_match_rows/)
  assert.match(primary, /'matches_anomaly'/)
})

// ── In-app read state is only changed through the scoped RPC ─────────────────
test('read state changes only via the scoped mark-read RPC (no client write policy on the table)', () => {
  assert.match(live, /FUNCTION public\.mark_staff_notifications_read\(p_ids uuid\[\]\)/)
  const rd = live.slice(live.indexOf('FUNCTION public.mark_staff_notifications_read'))
  assert.match(rd, /v_me\s+uuid := public\.portal_profile_id\(\)/)
  assert.match(rd, /SET in_app_read_at = now\(\)/)
  assert.match(rd, /recipient_profile_id = v_me/)
  // No FOR UPDATE / INSERT / DELETE client policy on staff_notifications (only SELECT own-or-admin).
  assert.ok(!/staff_notifications FOR (UPDATE|INSERT|DELETE|ALL)/.test(live), 'no client write policy on staff_notifications')
})

// ── No RLS widening ─────────────────────────────────────────────────────────
test('no RLS widening: SELECT-only policies, no client write policy, no anon/authenticated write grant', () => {
  // Two owner/admin-scoped SELECT policies (audit; staff_notifications own-or-admin).
  assert.ok(live.includes('preceptor_assignment_events FOR SELECT') && live.includes('staff_notifications FOR SELECT'))
  assert.ok(!/CREATE POLICY[\s\S]{0,160}FOR (INSERT|UPDATE|DELETE|ALL)/.test(live), 'no write policy')
  assert.ok(!/GRANT (INSERT|UPDATE|DELETE)[^;]*(anon|authenticated)/i.test(live), 'no table write grant to clients')
  assert.match(live, /ENABLE ROW LEVEL SECURITY/)
})

// ── Endpoints + modal ───────────────────────────────────────────────────────
test('endpoints verify the caller, call RPCs with the actor id, and forward force/confirm', () => {
  assert.match(ulEp, /verifyPortalUnitLeaderCaller\(req\)/)
  assert.match(ulEp, /p_actor_profile_id: profile\.id/)
  assert.match(ulEp, /p_force: body\.force === true/)
  assert.ok(!/\.from\('students'\)|\.insert/.test(ulEp), 'UL endpoint never writes a table directly')
  assert.match(staffEp, /is_owner === true \|\| \['owner', 'admin'\]\.includes\(role\)/)
  assert.match(staffEp, /rpc\('assign_primary_preceptor'/)
  assert.match(staffEp, /p_confirm_override: body\.confirmOverride === true/)
})

test('the staff modal routes the primary write through the audited endpoint', () => {
  assert.match(modal, /fetch\('\/api\/preceptor-primary-assign'/)
  assert.ok(!/from\('students'\)\.update\(\{[\s\S]{0,80}preceptor_id:/.test(modal), 'no direct students preceptor_id write')
})

// ── Email worker + cron are runnable and registered ─────────────────────────
test('the email worker claims via the RPC, sends, and is idempotent per recipient', () => {
  assert.match(worker, /rpc\('claim_due_staff_notifications'/)
  assert.match(worker, /idempotencyKey = `\$\{row\.correlation_id\}:\$\{row\.recipient_profile_id\}`/)
  assert.match(worker, /nextDeliveryState/)  // reuses the messages retry logic
  assert.match(worker, /export async function runStaffNotificationWorker/)
})

test('the cron endpoint is CRON_SECRET-gated and registered in vercel.json', () => {
  assert.match(cron, /req\.headers\['authorization'\] !== `Bearer \$\{process\.env\.CRON_SECRET\}`/)
  assert.match(cron, /runStaffNotificationWorker/)
  assert.match(vercel, /\/api\/cron\/staff-notification-worker/)
})

test('the email builder uses the canonical appUrl helper, not a hardcoded /app.html# base', () => {
  assert.match(emailC, /import \{ appUrl \} from '\.\.\/appUrl\.js'/)
  assert.match(emailC, /appUrl\(destUrl \|\| ''\)/)
  assert.ok(!emailC.includes('app.html#'), 'no hardcoded /app.html# hash base')
  // The link host, when present as a literal, is the canonical domain (the helper enforces it).
  assert.ok(!/https?:\/\/(?!aspireintelligence\.app)/.test(emailC), 'no non-canonical hardcoded host')
})

test('no em dash in the migration, verification, endpoints, worker, email builder, or cron', () => {
  const emDash = String.fromCharCode(0x2014)
  for (const src of [mig, ver, ulEp, staffEp, worker, emailC, cron]) assert.ok(!src.includes(emDash), 'no em dash')
})
