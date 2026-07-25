// Static guards for the Unit Leader evaluation release-gate migration
// (second Owner-review-corrected revision). The migration is NOT applied on this branch;
// these are source-level assertions on the migration text, matching this repo's
// migration-test style, locking the safety-critical properties after both review rounds.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')

const sql = read('supabase/migrations/20260725000000_unit_leader_evaluation_release_gate.sql')
const code = sql.replace(/^\s*--.*$/gm, '')   // executable SQL only (comments stripped)

function fnBody(name) {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}`)
  assert.ok(start > -1, `function ${name} must exist`)
  const end = sql.indexOf('$$;', start)
  assert.ok(end > start, `function ${name} must be dollar-quoted`)
  return sql.slice(start, end)
}

const READ_FNS = ['ul_eval_dashboard_summary', 'ul_eval_response_list']
const WRITE_FNS = ['ul_eval_moderate_response', 'ul_eval_release_response',
                   'ul_eval_revoke_response', 'ul_eval_rerelease_response']

test('the migration is transactional and reloads the PostgREST schema', () => {
  assert.match(sql, /^BEGIN;/m)
  assert.match(sql, /^COMMIT;/m)
  assert.match(sql, /NOTIFY pgrst, 'reload schema'/)
})

test('three tables: release, append-only events, and the exact-key allowlist', () => {
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.evaluation_response_unit_release\b/)
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.evaluation_response_unit_release_events\b/)
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.evaluation_unit_quantitative_keys\b/)
})

// ── (Blocker 1) table privileges + TRUNCATE denial ──────────────────────────
test('no GRANT ALL; service_role privileges are restricted per table', () => {
  assert.ok(!/GRANT ALL/.test(code), 'GRANT ALL must not appear')
  // Release: SELECT/INSERT/UPDATE to service_role (no DELETE/TRUNCATE).
  assert.match(sql, /GRANT SELECT, INSERT, UPDATE ON TABLE public\.evaluation_response_unit_release TO service_role/)
  // Events: SELECT/INSERT only.
  assert.match(sql, /GRANT SELECT, INSERT ON TABLE public\.evaluation_response_unit_release_events TO service_role/)
  // All three REVOKE ALL from service_role first.
  assert.ok((sql.match(/REVOKE ALL ON TABLE [^\n]*FROM PUBLIC, anon, authenticated, service_role/g) || []).length >= 3)
})

test('DELETE and TRUNCATE are blocked by triggers (row triggers cannot block TRUNCATE)', () => {
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\._ul_eval_block_write/)
  // Release: BEFORE DELETE (row) + BEFORE TRUNCATE (statement).
  assert.match(sql, /BEFORE DELETE ON public\.evaluation_response_unit_release\b[\s\S]*?_ul_eval_block_write/)
  assert.match(sql, /BEFORE TRUNCATE ON public\.evaluation_response_unit_release\b[\s\S]*?FOR EACH STATEMENT/)
  // Events: BEFORE UPDATE OR DELETE (row) + BEFORE TRUNCATE (statement).
  assert.match(sql, /BEFORE UPDATE OR DELETE ON public\.evaluation_response_unit_release_events[\s\S]*?_ul_eval_block_write/)
  assert.match(sql, /BEFORE TRUNCATE ON public\.evaluation_response_unit_release_events[\s\S]*?FOR EACH STATEMENT/)
})

// ── (Blocker 5) no stable response identifier ───────────────────────────────
test('no public_token column, no by-token detail RPC, no identifier in reads', () => {
  assert.ok(!/public_token/.test(code), 'public_token must not exist in executable SQL')
  assert.ok(!sql.includes('ul_eval_response_detail'), 'the by-token detail RPC must be gone')
  for (const fn of READ_FNS) {
    const b = fnBody(fn)
    assert.ok(!/'response_id'|'response_token'|public_token/.test(b), `${fn} exposes no identifier`)
  }
  // The list returns only a positional anon_label (no id/token columns).
  assert.match(fnBody('ul_eval_response_list'), /RETURNS TABLE \(\s*anon_label\s+text,\s*instrument_slug/)
})

// ── (Blocker 4) exact per-instrument path allowlist ─────────────────────────
test('quantitative exposure is an exact allowlist table joined by the extractor', () => {
  // Allowlist table with a section CHECK forbidding free-text/identifying sections.
  assert.match(sql, /CONSTRAINT chk_uqk_safe_section CHECK/)
  assert.match(sql, /json_path\[1\] IN \('preceptor_support', 'learning_environment',\s*'psychological_safety', 'overall_experience'\)/)
  assert.match(sql, /json_path\[1\] IN \('developmental_feedback', 'readiness_endorsement'\)/)
  // Seeded with the fixed numeric paths.
  assert.match(sql, /ARRAY\['overall_experience', 'overall_rating'\]/)
  assert.match(sql, /ARRAY\['developmental_feedback', 'context', 'shifts_observed'\]/)
  // Extractor JOINS the allowlist and returns numbers only (no generic scan).
  const helper = fnBody('_ul_eval_safe_quantitative')
  assert.match(helper, /FROM public\.evaluation_unit_quantitative_keys k/)
  assert.match(helper, /jsonb_typeof\(v\.val\) = 'number'/)
  // No free-text/identifying section is ever named in the extractor.
  for (const s of ['narrative', 'evaluated_target', 'confidential_team_comments', 'attestation']) {
    assert.ok(!helper.includes(s), `extractor must not reference ${s}`)
  }
})

// ── (Blocker 2) exact evaluated-preceptor attribution ───────────────────────
test('evaluated preceptor is resolved exactly; unresolved blocks release', () => {
  const cap = fnBody('_ul_eval_capture_snapshot')
  // preceptor_progress from the assignment respondent.
  assert.match(cap, /a\.respondent_preceptor_id/)
  // student_preceptor_eval from responses.evaluated_target.preceptor_id, uuid-validated.
  assert.match(cap, /NEW\.responses #>> '\{evaluated_target,preceptor_id\}'/)
  assert.match(cap, /\^\[0-9a-f\]\{8\}-\[0-9a-f\]\{4\}/)   // uuid format guard
  assert.ok(!/s\.preceptor_id/.test(cap), 'capture must not use students.preceptor_id')
  // Validated against preceptors before it counts as resolved.
  assert.match(cap, /FROM public\.preceptors p WHERE p\.id = v_cand_preceptor/)
  // Unresolved (hist_preceptor_id NULL) blocks release + re-release, and reads require it.
  assert.match(fnBody('ul_eval_release_response'), /hist_preceptor_id IS NULL[\s\S]*?snapshot_incomplete/)
  assert.match(fnBody('ul_eval_rerelease_response'), /hist_preceptor_id IS NULL[\s\S]*?snapshot_incomplete/)
  for (const fn of READ_FNS) assert.match(fnBody(fn), /hist_preceptor_id IS NOT NULL/)
})

// ── (Blocker 3) FOR UPDATE row locking + expected-state ─────────────────────
test('lifecycle functions lock the row FOR UPDATE and enforce expected state', () => {
  for (const fn of WRITE_FNS) {
    const b = fnBody(fn)
    assert.match(b, /WHERE response_id = p_response_id\s*\n?\s*FOR UPDATE;/, `${fn}: FOR UPDATE lock`)
    assert.match(b, /public\.is_active_owner_or_admin\(\)/, `${fn}: authoritative gate`)
  }
  assert.match(fnBody('ul_eval_release_response'), /release_state NOT IN \('pending', 'moderated'\)[\s\S]*?not_releasable_state/)
  assert.match(fnBody('ul_eval_revoke_response'), /release_state = 'revoked'[\s\S]*?already_revoked/)
  assert.match(fnBody('ul_eval_rerelease_response'), /release_state <> 'revoked'[\s\S]*?not_revoked/)
  // No-op guard prevents spurious audit events on moderation.
  assert.match(fnBody('ul_eval_moderate_response'), /no_change/)
})

// ── (Blocker 6) SECURITY DEFINER expectations ───────────────────────────────
test('public API + trigger functions are SECURITY DEFINER; the pure helper is not', () => {
  for (const fn of [...WRITE_FNS, ...READ_FNS, '_ul_eval_capture_snapshot',
                    '_ul_eval_guard_snapshot_immutable', '_ul_eval_block_write']) {
    assert.match(fnBody(fn), /SECURITY DEFINER/, `${fn} must be SECURITY DEFINER`)
  }
  // The pure allowlist helper is intentionally NOT security definer (invoker; STABLE).
  const helper = fnBody('_ul_eval_safe_quantitative')
  assert.ok(!/SECURITY DEFINER/.test(helper), '_ul_eval_safe_quantitative must not be SECURITY DEFINER')
  assert.match(helper, /\bSTABLE\b/)
  // 10 functions, all with a fixed search_path; exactly 9 are SECURITY DEFINER.
  // Counted on comment-stripped code so prose mentions do not inflate the totals.
  assert.equal((code.match(/CREATE OR REPLACE FUNCTION/g) || []).length, 10)
  assert.equal((code.match(/SET search_path = public, pg_catalog/g) || []).length, 10)
  assert.equal((code.match(/SECURITY DEFINER/g) || []).length, 9)
})

// ── carried-over invariants ─────────────────────────────────────────────────
test('every read carries the full defense-in-depth predicate set', () => {
  for (const fn of READ_FNS) {
    const b = fnBody(fn)
    assert.match(b, /has_active_role_grant\('unit_leader'\)/)
    assert.match(b, /release_state = 'released'/)
    assert.match(b, /release_state <> 'revoked'/)
    assert.match(b, /moderation_state = 'cleared'/)
    assert.match(b, /quantitative_visible = true/)
    assert.match(b, /free_text_visible = false/)
    assert.match(b, /snapshot_source IN \('submission_trigger', 'backfill_verified'\)/)
    assert.match(b, /now\(\) >= rel\.unit_leader_eligible_at/)
    assert.match(b, /FROM public\.my_unit_scope_keys\(\) s/)
    assert.match(b, /p_unit_key IS NULL OR rel\.hist_unit_key = p_unit_key/)
  }
})

test('reads never return identity, timestamps, or preceptor grouping', () => {
  for (const fn of READ_FNS) {
    const b = fnBody(fn)
    for (const forbidden of ['first_name', 'last_name', 'email', 'headshot', 'submitted_at',
                             'hist_preceptor_label']) {
      assert.ok(!b.includes(forbidden), `${fn} must not expose ${forbidden}`)
    }
  }
})

test('no minimum-count suppression', () => {
  assert.match(sql, /'released_response_count', \(SELECT count\(\*\) FROM scoped\)/)
  assert.ok(!/min_unit_aggregate_n|HAVING count/.test(sql))
})

test('response FK is ON DELETE RESTRICT, never CASCADE', () => {
  assert.match(sql, /REFERENCES public\.evaluation_responses\(id\) ON DELETE RESTRICT/)
  assert.ok(!/ON DELETE CASCADE/.test(code))
})

test('immutability guard + append-only audit inserts', () => {
  assert.match(sql, /BEFORE UPDATE ON public\.evaluation_response_unit_release\b[\s\S]*?_ul_eval_guard_snapshot_immutable/)
  for (const fn of WRITE_FNS) {
    assert.match(fnBody(fn), /INSERT INTO public\.evaluation_response_unit_release_events/, `${fn}: audit insert`)
  }
})

test('lifecycle + read functions are authenticated EXECUTE, never anon/public', () => {
  for (const sig of ['ul_eval_moderate_response(uuid, text)', 'ul_eval_release_response(uuid)',
                     'ul_eval_revoke_response(uuid)', 'ul_eval_rerelease_response(uuid)',
                     'ul_eval_dashboard_summary(text, text, text)', 'ul_eval_response_list(text, text, text)']) {
    const e = sig.replace(/[()]/g, '\\$&')
    assert.match(sql, new RegExp(`REVOKE ALL ON FUNCTION public\\.${e}\\s+FROM PUBLIC, anon`))
    assert.match(sql, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${e}\\s+TO authenticated`))
  }
  // The pure helper is not client-executable at all.
  assert.match(sql, /REVOKE ALL ON FUNCTION public\._ul_eval_safe_quantitative\(text, jsonb\) FROM PUBLIC, anon, authenticated/)
})

test('base evaluation tables and staff/student contracts are untouched', () => {
  assert.ok(!/ALTER TABLE public\.evaluation_responses/.test(sql))
  assert.ok(!/ALTER TABLE public\.evaluation_assignments/.test(sql))
  assert.ok(!/submit_evaluation_response|submit_preceptor_evaluation_response|submit_student_preceptor_evaluation_response/.test(code))
  assert.match(sql, /AFTER INSERT ON public\.evaluation_responses/)
})
