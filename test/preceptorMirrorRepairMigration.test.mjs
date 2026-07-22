// PHASE 2B: static guards for the preceptor mirror repair + sync migration.
//
// The migration is GATED and NOT applied by this pass. These guards prove it is
// data-driven, history-preserving, permission-safe, idempotent, and that the prevention
// trigger is a safe SECURITY DEFINER with a fixed search_path. Read the SQL as text.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')

const mig = read('supabase/migrations/20260722000000_preceptor_mirror_repair_and_sync.sql')
const ver = read('db/audit/preceptor_mirror_repair_preflight_and_verification.sql')

// Live SQL with block comments removed, so an assertion never matches commented-out text.
const live = mig.replace(/\/\*[\s\S]*?\*\//g, '')
const liveSql = live.replace(/^\s*--.*$/gm, '')

// The one-time repair region is everything before the prevention function.
const repair = liveSql.slice(0, liveSql.indexOf('CREATE OR REPLACE FUNCTION'))
// The prevention function/trigger region.
const prevention = liveSql.slice(liveSql.indexOf('CREATE OR REPLACE FUNCTION'))

test('gated and transactional', () => {
  assert.match(mig, /APPLY MANUALLY/)
  assert.match(mig, /preceptor_mirror_repair_preflight_and_verification\.sql/)
  assert.match(liveSql, /BEGIN;/)
  assert.match(liveSql, /COMMIT;/)
})

test('the repair is data-driven: no hardcoded student or preceptor UUIDs', () => {
  const uuidLiteral = /'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'/i
  assert.ok(!uuidLiteral.test(mig), 'no UUID literal anywhere in the migration')
})

test('the repair aligns exactly the two mirror classes from canonical', () => {
  // students display fields from preceptors
  assert.match(repair, /UPDATE public\.students s\s*\n\s*SET matched_preceptor = p\.full_name,\s*\n\s*preceptor_email\s*= p\.email/)
  assert.match(repair, /FROM public\.preceptors p/)
  // current-cohort match FK from students
  assert.match(repair, /UPDATE public\.matches m\s*\n\s*SET preceptor_id = s\.preceptor_id/)
  assert.match(repair, /m\.cohort_id\s*= s\.cohort_id/)
})

test('the repair does NOT touch matches.preceptor_assigned (not a maintained mirror)', () => {
  assert.ok(!/SET[^;]*preceptor_assigned/i.test(liveSql), 'preceptor_assigned is never written')
})

test('the repair writes NO student_preceptor_assignments rows (SPA already correct)', () => {
  assert.ok(!/INTO public\.student_preceptor_assignments/.test(repair), 'no SPA insert in the repair')
  assert.ok(!/UPDATE public\.student_preceptor_assignments/.test(repair), 'no SPA update in the repair')
})

test('rollback audit table with a fixed batch sentinel, RLS enabled, no policy', () => {
  assert.match(liveSql, /CREATE TABLE IF NOT EXISTS public\.preceptor_mirror_repair_audit/)
  assert.match(liveSql, /ALTER TABLE public\.preceptor_mirror_repair_audit ENABLE ROW LEVEL SECURITY/)
  assert.match(liveSql, /'phase2b-preceptor-mirror'/)
  // Snapshot happens before the repair UPDATEs.
  assert.ok(liveSql.indexOf('INSERT INTO public.preceptor_mirror_repair_audit')
          < liveSql.indexOf('UPDATE public.students s'), 'snapshot precedes repair')
})

// ── Prevention trigger ──────────────────────────────────────────────────────
test('the sync function is SECURITY DEFINER with a fixed search_path', () => {
  assert.match(prevention, /CREATE OR REPLACE FUNCTION public\.sync_primary_preceptor_mirror\(\)/)
  assert.match(prevention, /SECURITY DEFINER/)
  assert.match(prevention, /SET search_path = public, pg_temp/)
})

test('the trigger fires ONLY on students.preceptor_id, never cohort_id', () => {
  assert.match(prevention, /AFTER INSERT OR UPDATE OF preceptor_id ON public\.students/)
  assert.ok(!/UPDATE OF preceptor_id, cohort_id/.test(prevention), 'cohort_id is not a trigger event')
  assert.match(prevention, /FOR EACH ROW EXECUTE FUNCTION public\.sync_primary_preceptor_mirror\(\)/)
  // Early-return when preceptor_id did not change (idempotent no-op).
  assert.match(prevention, /IF TG_OP = 'UPDATE' AND NEW\.preceptor_id IS NOT DISTINCT FROM OLD\.preceptor_id THEN\s*\n\s*RETURN NULL/)
})

test('the trigger is idempotent and history-preserving', () => {
  // Soft-end, never delete.
  assert.ok(!/DELETE FROM public\.student_preceptor_assignments/.test(prevention), 'never deletes assignments')
  assert.match(prevention, /SET status = 'ended'/)
  // One active primary, inserted only when missing.
  assert.match(prevention, /INSERT INTO public\.student_preceptor_assignments[\s\S]{0,400}WHERE NOT EXISTS/)
  // Same-preceptor conflict is the only secondary/coverage touch.
  assert.match(prevention, /role IN \('secondary', 'coverage'\)\s*\n\s*AND status = 'active'/)
})

test('the cleared-primary branch ends the primary and clears the mirrors', () => {
  // The ELSE (preceptor cleared) branch clears the display fields and nulls the match FK;
  // these markers appear only in that branch.
  assert.match(prevention, /SET matched_preceptor = '', preceptor_email = ''/)
  assert.match(prevention, /SET preceptor_id = NULL/)
  // And it ends the active primary for the current cohort (unconditional on preceptor).
  assert.match(prevention, /ELSE[\s\S]{0,400}role\s*= 'primary'\s*\n\s*AND status\s*= 'active'/)
})

test('NO cohort-change logic exists (students are permanently single-cohort)', () => {
  // The locked product model: students are never re-cohorted, so the trigger neither
  // watches for nor acts on a cohort change.
  assert.ok(!/v_cohort_changed/.test(mig), 'no cohort-change flag')
  assert.ok(!/OLD\.cohort_id/.test(mig), 'the function never reads OLD.cohort_id')
  // Every assignment write is still scoped to the student fixed cohort (NEW.cohort_id).
  assert.match(prevention, /cohort_id\s*= NEW\.cohort_id/)
})

test('no permission widening: execute revoked from PUBLIC, no new policy or anon/portal grant', () => {
  assert.match(liveSql, /REVOKE ALL ON FUNCTION public\.sync_primary_preceptor_mirror\(\) FROM PUBLIC/)
  assert.ok(!/CREATE POLICY/i.test(liveSql), 'no new RLS policy')
  assert.ok(!/GRANT[^;]*\b(anon|authenticated|portal)\b/i.test(liveSql), 'no grant to anon/authenticated/portal')
})

test('verification file covers the equivalence gate, no-SPA-change, and trigger checks', () => {
  assert.match(ver, /MUST RETURN ZERO ROWS/)
  assert.match(ver, /prosecdef AS security_definer/)
  assert.match(ver, /public_can_execute/)
  assert.match(ver, /role, status, count\(\*\) AS rows/)   // before/after SPA snapshot
  assert.match(ver, /ROLLBACK/)
  assert.match(ver, /preceptor_mirror_repair_audit/)
})

test('no em dash in the migration or the verification SQL', () => {
  const emDash = String.fromCharCode(0x2014)
  assert.ok(!mig.includes(emDash), 'migration has no em dash')
  assert.ok(!ver.includes(emDash), 'verification has no em dash')
})
