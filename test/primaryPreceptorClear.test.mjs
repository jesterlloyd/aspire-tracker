// PHASE-2D: canonical primary-preceptor clear for match revert.
//
// Product decision (2026-08-03): reverting a student match ends the primary
// preceptor relationship. The ONE supported path is the new
// clear_primary_preceptor RPC (migration 20260803000000, GATED and NOT
// applied), reached through api/preceptor-assignment-manage.js. It follows
// every assign_primary_preceptor convention (Owner/Admin authorization,
// 2C guard marker, request-id idempotency, audit event, staff notification,
// matches-anomaly surfacing) and relies on the applied 2B trigger's clear
// branch for ALL mirror cleanup. Both App.jsx revert paths call it BEFORE any
// mutation and abort on failure.
//
// Run: node --test test/primaryPreceptorClear.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')
const mig     = read('supabase/migrations/20260803000000_phase2d_clear_primary_preceptor.sql')
const mig2c   = read('supabase/migrations/20260723000000_preceptor_assignment_authorization.sql')
const mig2b   = read('supabase/migrations/20260722000000_preceptor_mirror_repair_and_sync.sql')
const api     = read('api/preceptor-assignment-manage.js')
const lib     = read('src/lib/staffPreceptorAssignmentApi.js')
const appjs   = read('src/App.jsx')

// ── RPC contract ─────────────────────────────────────────────────────────────

test('the clear RPC follows the audited-definer conventions exactly', () => {
  assert.match(mig, /CREATE OR REPLACE FUNCTION public\.clear_primary_preceptor\(/)
  assert.match(mig, /SECURITY DEFINER\nSET search_path = public, pg_catalog/)
  assert.match(mig, /REVOKE ALL ON FUNCTION public\.clear_primary_preceptor\(uuid, uuid, text, boolean, boolean, text\) FROM PUBLIC, anon, authenticated;/)
  assert.match(mig, /GRANT EXECUTE ON FUNCTION public\.clear_primary_preceptor\(uuid, uuid, text, boolean, boolean, text\) TO service_role;/)
  // No other grant anywhere in the file.
  assert.doesNotMatch(mig, /GRANT [^\n]*TO (authenticated|anon|PUBLIC)/i)
})

test('authorization: same actor assertion, then a STRICTER owner/admin-only gate', () => {
  assert.match(mig, /_preceptor_assert_actor_for_student\(p_actor_profile_id, p_student_id, p_reason, p_force, p_confirm_override\)/)
  assert.match(mig, /IF v_role <> 'owner_admin' THEN\n\s+RAISE EXCEPTION 'clearing a primary preceptor requires owner or admin authority' USING ERRCODE = 'MS403';/)
})

test('idempotency: request claimed before mutation, finished with the result, and already-clear no-ops', () => {
  assert.match(mig, /v_claim := public\._preceptor_begin_request\(p_request_id, p_actor_profile_id, 'clear_primary_preceptor', v_fp\);/)
  assert.match(mig, /IF NOT \(v_claim->>'claimed'\)::boolean THEN\n\s+RETURN v_claim->'result';/)
  assert.match(mig, /PERFORM public\._preceptor_finish_request\(p_request_id, v_result\);[\s\S]*RETURN v_result;\nEND;/)
  // Already-clear short-circuit: succeeds with no_change BEFORE the marker/update,
  // writing no event and no notification.
  const noChangeIdx = mig.indexOf("'no_change', true")
  const markerIdx   = mig.indexOf("set_config('app.preceptor_change_authorized', p_student_id::text, true)")
  assert.ok(noChangeIdx > -1 && markerIdx > noChangeIdx, 'no-change path returns before the guarded update')
})

test('the one mutation is the guarded NULL update; the 2B trigger owns the mirror cleanup', () => {
  assert.match(mig, /PERFORM set_config\('app\.preceptor_change_authorized', p_student_id::text, true\);\n\s+UPDATE public\.students SET preceptor_id = NULL WHERE id = p_student_id;\n\s+PERFORM set_config\('app\.preceptor_change_authorized', '', true\);/)
  // The migration writes ONLY students.preceptor_id + the audit/notification
  // tables: no direct assignment/matches/display-field mutation and no DELETE.
  assert.doesNotMatch(mig, /UPDATE public\.student_preceptor_assignments/)
  assert.doesNotMatch(mig, /UPDATE public\.matches/)
  assert.doesNotMatch(mig, /SET matched_preceptor/)
  assert.doesNotMatch(mig, /^\s*DELETE FROM/m, 'no DELETE statement anywhere')
})

test('audit event and staff notification occur once, with the matches-anomaly parity check', () => {
  assert.match(mig, /'clear_primary', p_student_id, v_old, v_cohort, v_unit_key,/)
  assert.match(mig, /'preceptor_primary_cleared', p_actor_profile_id, v_role,/)
  assert.match(mig, /v_corr := 'preceptor_clear:' \|\| p_request_id;/)
  assert.match(mig, /'preceptor_match_anomaly', p_actor_profile_id, v_role,/)
  // The action CHECK now admits the new value (and only adds; nothing removed).
  assert.match(mig, /ADD CONSTRAINT preceptor_assignment_events_action_check CHECK \(action IN \(\n\s+'assign_primary', 'clear_primary', 'add_secondary', 'add_coverage',/)
})

test('the 2B trigger clear branch this relies on ends ONLY primary rows, softly', () => {
  const clearBranch = mig2b.slice(mig2b.indexOf('-- Primary CLEARED for the current cohort.'))
  assert.match(clearBranch, /SET status = 'ended', end_date = COALESCE\(end_date, current_date\), updated_at = now\(\)/)
  assert.match(clearBranch, /AND role\s+= 'primary'\n\s+AND status\s+= 'active';/)
  assert.match(clearBranch, /SET matched_preceptor = '', preceptor_email = ''/)
  assert.match(clearBranch, /SET preceptor_id = NULL/)
})

// ── R1 revision: boundary contract + assert-then-replace prechecks ───────────

test('R1: a nonblank request id is rejected at the RPC surface itself', () => {
  assert.match(mig, /IF p_request_id IS NULL OR length\(btrim\(p_request_id\)\) = 0 THEN\n\s+RAISE EXCEPTION 'a request id is required' USING ERRCODE = 'MS400';/)
})

test('R1: the live action list is asserted EXACTLY before the CHECK is replaced', () => {
  assert.match(mig, /PRECHECK 0a FAILED/)
  assert.match(mig, /ARRAY\[\n\s+'add_coverage','add_secondary','assign_primary','create_preceptor',\n\s+'end_coverage','end_secondary','matches_anomaly','replace_coverage','replace_secondary'\]/)
  // The precheck runs before the ALTER in the same transaction.
  const precheckIdx = mig.indexOf('PRECHECK 0a FAILED')
  const alterIdx = mig.indexOf('DROP CONSTRAINT IF EXISTS preceptor_assignment_events_action_check')
  assert.ok(precheckIdx > -1 && alterIdx > precheckIdx, 'assert-then-replace ordering')
})

test('R1: the owner_admin literal and both dependent triggers are asserted live', () => {
  assert.match(mig, /position\('''owner_admin''' IN v_def\) = 0/)
  assert.match(mig, /trg_guard_students_preceptor_id' AND tgenabled = 'O'/)
  assert.match(mig, /trg_sync_primary_preceptor_mirror' AND tgenabled = 'O'/)
})

test('R1: V4 covers match FK, audit event, notification correlation, and replay', () => {
  assert.match(mig, /V4c\. Same-cohort match FK/)
  assert.match(mig, /V4d\. Audit events/)
  assert.match(mig, /V4e\. Notification correlation/)
  assert.match(mig, /V4f\. Idempotency ledger/)
  assert.match(mig, /V4g\. Same-request replay idempotency/)
})

test('R1: the read-only preflight companion mirrors the prechecks', () => {
  const pre = read('db/audit/phase2d_clear_primary_preflight.sql')
  assert.match(pre, /live_actions_sorted/)
  assert.match(pre, /has_owner_admin_literal/)
  assert.match(pre, /enforces_nonblank_request/)
  assert.match(pre, /sync_fn_has_clear_branch/)
  assert.match(pre, /clear_primary_preceptor/)
  // Preflight stays strictly read-only.
  assert.doesNotMatch(pre, /INSERT|UPDATE |DELETE FROM|ALTER |CREATE OR REPLACE/)
})

// ── Endpoint and client helper ───────────────────────────────────────────────

test('the staff endpoint routes clear_primary to the RPC with the server-verified actor', () => {
  assert.match(api, /} else if \(action === 'clear_primary'\) \{[\s\S]{0,300}rpc = 'clear_primary_preceptor'/)
  assert.match(api, /p_actor_profile_id: auth\.profile\.id,\n\s+p_student_id: body\.student_id,\n\s+p_reason: body\.reason \|\| null,/)
  // request_id is required for every action; the caller never supplies the actor.
  assert.match(api, /if \(!requestId\) return res\.status\(400\)\.json\(\{ error: 'request_id_required' \}\)/)
  assert.doesNotMatch(api, /p_actor_profile_id: body\./)
})

test('the client helper carries one request id per intentional clear', () => {
  assert.match(lib, /export async function clearPrimaryPreceptor\(studentId, reason = null\) \{/)
  assert.match(lib, /action: 'clear_primary',\n\s+student_id: studentId,\n\s+reason,\n\s+request_id: crypto\.randomUUID\(\),/)
})

// ── Revert integration ───────────────────────────────────────────────────────

test('single revert clears through the canonical path first and fails safely', () => {
  assert.match(appjs, /const cleared = await clearPrimaryPreceptor\(student\.id, 'match revert'\)\n\s+if \(!cleared\.ok\) \{\n\s+toast\.error\('Unmatch blocked'[\s\S]{0,120}\n\s+return\n\s+\}/)
  // The clear precedes the match deletion and the student update.
  const clearIdx = appjs.indexOf("clearPrimaryPreceptor(student.id, 'match revert')")
  const deleteIdx = appjs.indexOf("'delete match on unmatch'")
  assert.ok(clearIdx > -1 && deleteIdx > clearIdx, 'clear runs before any revert mutation')
})

test('bulk revert clears every matched student first; one failure aborts the unit delete', () => {
  assert.match(appjs, /for \(const sid of matchedIds\) \{\n\s+const cleared = await clearPrimaryPreceptor\(sid, 'unit delete match revert'\)\n\s+if \(!cleared\.ok\) \{\n\s+toast\.error\('Unit not deleted'[\s\S]{0,120}\n\s+return\n\s+\}\n\s+\}/)
  const clearIdx = appjs.indexOf("'unit delete match revert'")
  const updateIdx = appjs.indexOf("'clear matched students on unit delete'")
  assert.ok(clearIdx > -1 && updateIdx > clearIdx, 'all clears run before the bulk revert mutation')
})

test('no independent display blanking remains; local state echoes the trigger result', () => {
  // The revert DB updates no longer write matched_preceptor at all.
  assert.doesNotMatch(appjs, /update\(\{[^}]*matched_preceptor/)
  // Local merges mirror exactly what the server-side clear produced.
  assert.match(appjs, /preceptor_id: null, matched_preceptor: '', preceptor_email: ''/)
})

// ── Preservation ─────────────────────────────────────────────────────────────

test('Add/Replace, secondary/coverage, and Unit Leader surfaces are untouched', () => {
  // assign still hard-rejects a null target: clear did NOT loosen its contract.
  assert.match(mig2c, /IF p_actor_profile_id IS NULL OR p_student_id IS NULL OR p_preceptor_id IS NULL THEN\n\s+RAISE EXCEPTION 'missing required argument' USING ERRCODE = 'MS400';/)
  // The 2D migration replaces no other function and no trigger (prose mentions
  // are fine; definitions are not).
  assert.doesNotMatch(mig, /CREATE OR REPLACE FUNCTION public\.(assign_primary_preceptor|set_secondary_coverage_preceptor|create_unit_preceptor|sync_primary_preceptor_mirror)/)
  assert.doesNotMatch(mig, /CREATE TRIGGER/)
  // The Unit Leader endpoint gains no clear action (UL may not clear primaries).
  assert.doesNotMatch(read('api/portal/unit-preceptor-manage.js'), /clear_primary/)
  // Secondary/coverage client surface unchanged.
  assert.match(read('src/components/AdditionalPreceptors.jsx'), /\/api\/preceptor-assignments/)
})
