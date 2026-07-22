// PHASE 2C SAFETY CORRECTION: static guards proving the targeted secondary/coverage semantics,
// request-id idempotency, stable (non-timestamp) correlation ids, real notification routes, and
// old/new preceptor id+name capture. The migration is GATED (not applied), so these assert the
// authored SQL structure that guarantees the behavior; the live behavioral proof is the
// scratch-transaction smoke test and the verification blocks in the companion audit file.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')
const mig = read('supabase/migrations/20260723000000_preceptor_assignment_authorization.sql')
const live = mig.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*--.*$/gm, '')

const sec = live.slice(live.indexOf('FUNCTION public.set_secondary_coverage_preceptor'),
                       live.indexOf('FUNCTION public.create_unit_preceptor'))
const primary = live.slice(live.indexOf('FUNCTION public.assign_primary_preceptor'),
                           live.indexOf('FUNCTION public.set_secondary_coverage_preceptor'))
const create = live.slice(live.indexOf('FUNCTION public.create_unit_preceptor'),
                          live.indexOf('FUNCTION public.claim_due_staff_notifications'))
const ledger = live.slice(live.indexOf('FUNCTION public._preceptor_begin_request'),
                          live.indexOf('FUNCTION public._emit_staff_notifications'))

// ── Targeted replace/end ──────────────────────────────────────────────────────
test('replace and end require p_assignment_id', () => {
  assert.match(sec, /IF p_action IN \('replace', 'end'\) THEN[\s\S]{0,120}IF p_assignment_id IS NULL THEN\s*\n\s*RAISE EXCEPTION 'assignment id is required to replace or end' USING ERRCODE = 'MS400'/)
})

test('replace and end LOCK the selected assignment and validate ownership, role, and active state', () => {
  assert.match(sec, /FROM public\.student_preceptor_assignments a\s*\n\s*WHERE a\.id = p_assignment_id\s*\n\s*FOR UPDATE/)
  assert.match(sec, /v_target\.student_id <> p_student_id THEN\s*\n\s*RAISE EXCEPTION 'assignment does not belong to this student' USING ERRCODE = 'MS404'/)
  assert.match(sec, /v_target\.role <> p_role THEN\s*\n\s*RAISE EXCEPTION 'assignment role does not match' USING ERRCODE = 'MS409'/)
  assert.match(sec, /v_target\.status <> 'active' THEN\s*\n\s*RAISE EXCEPTION 'assignment is not active' USING ERRCODE = 'MS409'/)
})

test('replace/end end ONLY the selected row; there is no role-wide bulk end anymore', () => {
  // Exactly one soft-end, scoped to the specific assignment id.
  const ends = sec.match(/SET status = 'ended'/g) || []
  assert.equal(ends.length, 1, 'exactly one end statement')
  assert.match(sec, /UPDATE public\.student_preceptor_assignments\s*\n\s*SET status = 'ended', end_date = current_date, updated_at = now\(\)\s*\n\s*WHERE id = p_assignment_id;/)
  // The old bulk pattern (end every active row of this role in the cohort) must be gone.
  assert.ok(!/WHERE a\.student_id = p_student_id AND a\.cohort_id = v_cohort AND a\.role = p_role AND a\.status = 'active'/.test(sec),
    'no role-wide bulk end')
  // History is soft-ended, never deleted.
  assert.ok(!/DELETE FROM public\.student_preceptor_assignments/.test(sec), 'no delete of assignment history')
})

test('add and replace insert exactly one new active row; add alters nothing existing', () => {
  assert.match(sec, /IF p_action IN \('add', 'replace'\) THEN[\s\S]{0,400}INSERT INTO public\.student_preceptor_assignments/)
  const inserts = sec.match(/INSERT INTO public\.student_preceptor_assignments/g) || []
  assert.equal(inserts.length, 1, 'one insert path (add/replace)')
  // The end block is guarded to replace/end only, so an add never reaches it.
  assert.match(sec, /IF p_action IN \('replace', 'end'\) THEN/)
})

// ── Old/new preceptor id + name captured everywhere ──────────────────────────
test('secondary/coverage records old/new preceptor id AND name in event, notification, and result', () => {
  // Event metadata carries both ids and both names + the assignment ids.
  assert.match(sec, /jsonb_build_object\('assignment_id', COALESCE\(v_new_id, p_assignment_id\)/)
  assert.match(sec, /'old_preceptor_id', v_old_id, 'old_preceptor_name', v_old_name/)
  assert.match(sec, /'new_preceptor_id', p_preceptor_id, 'new_preceptor_name', v_new_name/)
  // Notification carries the human-readable old/new names (old_value/new_value).
  assert.match(sec, /_emit_staff_notifications\([\s\S]{0,260}v_old_name, v_new_name/)
  // RPC response carries ids + names + which assignment was ended.
  assert.match(sec, /v_result := jsonb_build_object\('ok', true, 'action', v_lbl,[\s\S]{0,200}'ended_assignment_id'[\s\S]{0,200}'old_preceptor_id', v_old_id[\s\S]{0,120}'new_preceptor_id', p_preceptor_id/)
  // The real old preceptor name is resolved from the LOCKED row's preceptor id.
  assert.match(sec, /v_old_id := v_target\.preceptor_id/)
  assert.match(sec, /SELECT full_name INTO v_old_name FROM public\.preceptors WHERE id = v_old_id/)
})

test('primary also records old/new preceptor id and name', () => {
  assert.match(primary, /'old_preceptor_id', v_old, 'old_preceptor_name', v_old_name/)
  assert.match(primary, /'new_preceptor_id', p_preceptor_id, 'new_preceptor_name', v_new_name/)
})

// ── Idempotency on p_request_id ──────────────────────────────────────────────
test('the idempotency ledger claims first, replays on repeat, and conflicts on reuse', () => {
  assert.match(ledger, /INSERT INTO public\.preceptor_assignment_requests \(request_id, actor_profile_id, rpc, fingerprint\)\s*\n\s*VALUES[\s\S]{0,80}ON CONFLICT \(request_id\) DO NOTHING/)
  assert.match(ledger, /v_inserted = 1 THEN\s*\n\s*RETURN jsonb_build_object\('claimed', true\)/)   // first time
  assert.match(ledger, /WHERE request_id = p_request_id FOR UPDATE/)                                 // serialize
  assert.match(ledger, /v_fp IS DISTINCT FROM p_fingerprint THEN\s*\n\s*RAISE EXCEPTION 'this request id was already used with different parameters' USING ERRCODE = 'MS409'/)
  assert.match(ledger, /RETURN jsonb_build_object\('claimed', false, 'result', v_res\)/)             // replay
  assert.match(ledger, /a request id is required' USING ERRCODE = 'MS400'/)
})

test('every write RPC claims/replays via the ledger and finishes with its result', () => {
  for (const [name, fn] of [['assign_primary', primary], ['set_secondary', sec], ['create_unit', create]]) {
    assert.match(fn, /v_fp := md5\(concat_ws\('\|'/, `${name} fingerprints its args`)
    assert.match(fn, /v_claim := public\._preceptor_begin_request\(p_request_id/, `${name} claims`)
    assert.match(fn, /IF NOT \(v_claim->>'claimed'\)::boolean THEN\s*\n\s*RETURN v_claim->'result';/, `${name} replays`)
    assert.match(fn, /PERFORM public\._preceptor_finish_request\(p_request_id, v_result\)/, `${name} finishes`)
  }
})

test('correlation ids are derived from p_request_id and are NEVER timestamp-based', () => {
  assert.match(primary, /v_corr := 'preceptor_primary:' \|\| p_request_id/)
  assert.match(sec, /v_corr := 'preceptor_' \|\| v_lbl \|\| ':' \|\| p_request_id/)
  assert.match(create, /v_corr := 'preceptor_created:' \|\| p_request_id/)
  assert.ok(!/extract\(epoch/.test(live), 'no timestamp-based correlation ids anywhere')
})

// ── Real notification routes ─────────────────────────────────────────────────
test('notification destinations use REAL staff routes, not the invented path forms', () => {
  assert.match(primary, /'\/students\?student=' \|\| p_student_id::text/)
  assert.match(sec, /'\/students\?student=' \|\| p_student_id::text/)
  assert.match(create, /'\/rotation\/preceptors'/)  // directory; no per-preceptor detail route
  assert.ok(!/'\/students\/' \|\|/.test(live), 'no /students/<id> path form (does not route)')
  assert.ok(!/'\/preceptors\/' \|\|/.test(live), 'no /preceptors/<id> form (that is the public page)')
})

// ── Ledger table security ────────────────────────────────────────────────────
test('the ledger table is RLS owner/admin SELECT only, with no client write policy or grant', () => {
  assert.match(live, /CREATE TABLE IF NOT EXISTS public\.preceptor_assignment_requests/)
  assert.match(live, /preceptor_assignment_requests[\s\S]{0,200}ENABLE ROW LEVEL SECURITY/)
  assert.match(live, /"preceptor_assignment_requests_owner_admin_read"\s*\n\s*ON public\.preceptor_assignment_requests FOR SELECT/)
  assert.ok(!/preceptor_assignment_requests FOR (INSERT|UPDATE|DELETE|ALL)/.test(live), 'no client write policy')
  assert.ok(!/GRANT[^;]*preceptor_assignment_requests[^;]*(anon|authenticated)/i.test(live), 'no client grant')
})
