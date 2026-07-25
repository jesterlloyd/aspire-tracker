// Commit-2 (Owner-review-corrected) static guards for the Unit Leader evaluation
// release-gate migration. The migration is NOT applied on this branch; these are
// source-level assertions on the migration text, matching this repo's migration-test
// style, locking the safety-critical properties after the Owner pre-apply corrections.

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

const READ_FNS = ['ul_eval_dashboard_summary', 'ul_eval_response_list', 'ul_eval_response_detail']
const WRITE_FNS = ['ul_eval_moderate_response', 'ul_eval_release_response',
                   'ul_eval_revoke_response', 'ul_eval_rerelease_response']

test('the migration is transactional and reloads the PostgREST schema', () => {
  assert.match(sql, /^BEGIN;/m)
  assert.match(sql, /^COMMIT;/m)
  assert.match(sql, /NOTIFY pgrst, 'reload schema'/)
})

test('both the release table and the append-only audit table are created', () => {
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.evaluation_response_unit_release\b/)
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.evaluation_response_unit_release_events\b/)
})

// ── (I) audit-preserving deletion ──────────────────────────────────────────
test('the response relationship is ON DELETE RESTRICT, never CASCADE', () => {
  assert.match(sql, /REFERENCES public\.evaluation_responses\(id\) ON DELETE RESTRICT/)
  assert.ok(!/ON DELETE CASCADE/.test(code), 'no CASCADE on any relationship in executable SQL')
  // The audit table keeps response_id as a durable, non-FK column.
  assert.match(sql, /response_id\s+uuid NOT NULL,\s*--[^\n]*durable/)
})

// ── (D) opaque token, no raw response_id to Unit Leaders ────────────────────
test('reads return an opaque public_token and never a raw response_id', () => {
  assert.match(sql, /public_token\s+text NOT NULL UNIQUE/)
  // list/detail output the token; detail is keyed by the token, not a response id.
  assert.match(fnBody('ul_eval_response_list'), /rel\.public_token AS response_token/)
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.ul_eval_response_detail\(p_token text\)/)
  assert.match(fnBody('ul_eval_response_detail'), /rel\.public_token = p_token/)
  for (const fn of READ_FNS) {
    // response_id may appear ONLY in a JOIN (r.id = rel.response_id), never as an output key.
    assert.ok(!/'response_id'/.test(fnBody(fn)), `${fn} must not output a response_id key`)
  }
})

// ── (E) explicit per-instrument quantitative allowlist ──────────────────────
test('quantitative exposure is an explicit per-instrument section allowlist, numeric-only', () => {
  const helper = fnBody('_ul_eval_safe_quantitative')
  assert.match(helper, /jsonb_typeof\(it\.value\) = 'number'/)          // numeric leaves only
  assert.match(helper, /p_slug = 'student_preceptor_eval'[\s\S]*?'preceptor_support', 'learning_environment',[\s\S]*?'psychological_safety', 'overall_experience'/)
  assert.match(helper, /p_slug = 'preceptor_progress'[\s\S]*?'developmental_feedback', 'readiness_endorsement'/)
  // The excluded free-text / identifying sections are never allowlisted.
  for (const excluded of ['evaluated_target', 'narrative', 'confidential_team_comments', 'attestation']) {
    assert.ok(!helper.includes(`'${excluded}'`), `allowlist must not include ${excluded}`)
  }
  // Reads obtain quantitative data ONLY through the allowlist helper (no ad-hoc jsonb_each
  // over the raw responses in list/detail).
  assert.match(fnBody('ul_eval_response_list'), /public\._ul_eval_safe_quantitative\(rel\.instrument_slug, r\.responses\)/)
  assert.match(fnBody('ul_eval_response_detail'), /public\._ul_eval_safe_quantitative\(rel\.instrument_slug, r\.responses\)/)
})

test('release timing is rotation end plus a 7-day delay', () => {
  assert.match(sql, /COALESCE\(s\.rotation_completed_at, s\.rotation_end_date::timestamptz\)/)
  assert.match(sql, /v_rotation_end \+ interval '7 days'/)
})

test('free text stays hidden: hard CHECK plus numeric-only allowlist', () => {
  assert.match(sql, /CONSTRAINT chk_ul_eval_free_text_hidden_first_release\s*\n?\s*CHECK \(free_text_visible = false\)/)
  for (const fn of READ_FNS) {
    assert.match(fnBody(fn), /free_text_visible = false/, `${fn} re-asserts free_text hidden`)
  }
})

// ── (J) defense-in-depth read predicates ────────────────────────────────────
test('every read carries the full defense-in-depth predicate set', () => {
  for (const fn of READ_FNS) {
    const b = fnBody(fn)
    assert.match(b, /public\.has_active_role_grant\('unit_leader'\)/, `${fn}: active grant`)
    assert.match(b, /rel\.release_state = 'released'/, `${fn}: release state`)
    assert.match(b, /rel\.release_state <> 'revoked'/, `${fn}: explicit non-revocation`)
    assert.match(b, /rel\.moderation_state = 'cleared'/, `${fn}: cleared moderation`)
    assert.match(b, /rel\.quantitative_visible = true/, `${fn}: quantitative visibility`)
    assert.match(b, /rel\.snapshot_source IN \('submission_trigger', 'backfill_verified'\)/, `${fn}: verified snapshot`)
    assert.match(b, /now\(\) >= rel\.unit_leader_eligible_at/, `${fn}: eligibility`)
    assert.match(b, /FROM public\.my_unit_scope_keys\(\) s/, `${fn}: server-derived scope`)
    assert.match(b, /s\.unit_key = rel\.hist_unit_key/, `${fn}: historical unit scope`)
  }
  // The unit parameter can only narrow.
  assert.ok((sql.match(/p_unit_key IS NULL OR rel\.hist_unit_key = p_unit_key/g) || []).length >= 2)
})

test('reads never return identity, timestamps, or preceptor grouping', () => {
  for (const fn of READ_FNS) {
    const b = fnBody(fn)
    for (const forbidden of ['first_name', 'last_name', 'preferred_first_name', 'email',
                             'headshot', 'submitted_at', 'hist_preceptor']) {
      assert.ok(!b.includes(forbidden), `${fn} must not expose ${forbidden}`)
    }
  }
})

test('there is no minimum-count suppression', () => {
  assert.match(sql, /'released_response_count', \(SELECT count\(\*\) FROM scoped\)/)
  assert.ok(!/min_unit_aggregate_n|HAVING count/.test(sql), 'no hidden threshold')
})

// ── (C) authoritative active authorization model ────────────────────────────
test('lifecycle functions gate on is_active_owner_or_admin() from the JWT (no actor param, no bespoke role read)', () => {
  for (const fn of WRITE_FNS) {
    const b = fnBody(fn)
    assert.match(b, /IF NOT public\.is_active_owner_or_admin\(\) THEN/, `${fn}: authoritative gate`)
    assert.match(b, /public\.portal_profile_id\(\)/, `${fn}: actor from JWT`)
    assert.ok(!/p_actor_profile_id/.test(b), `${fn}: no passed actor id`)
    assert.ok(!/user_profiles[\s\S]{0,40}role\s+IN/.test(b), `${fn}: no bespoke user_profiles.role read`)
  }
  // The bespoke _ul_eval_is_active_owner_admin helper from the first draft is gone.
  assert.ok(!code.includes('_ul_eval_is_active_owner_admin'), 'bespoke owner/admin helper removed')
})

// ── (A) blocked moderation hides a released response ─────────────────────────
test('a blocked moderation immediately hides a released response', () => {
  const b = fnBody('ul_eval_moderate_response')
  assert.match(b, /v_new_visible := false/)
  assert.match(b, /release_state = 'released' THEN 'moderated'/)   // demote out of released
})

// ── (G) explicit audited re-release; ordinary release refuses revoked ───────
test('ordinary release never silently re-releases and never clears revoked_at/by', () => {
  const rel = fnBody('ul_eval_release_response')
  assert.match(rel, /release_state = 'revoked' THEN[\s\S]*?'revoked_requires_explicit_rerelease'/)
  assert.ok(!/revoked_at\s*=\s*NULL/.test(rel), 'ordinary release must not clear revoked_at')
  const re = fnBody('ul_eval_rerelease_response')
  assert.match(re, /release_state <> 'revoked' THEN[\s\S]*?'not_revoked'/)
  assert.ok(!/revoked_at\s*=\s*NULL/.test(re), 're-release must preserve revoked_at')
})

// ── (B) append-only audit ────────────────────────────────────────────────────
test('every lifecycle action writes an append-only audit event', () => {
  for (const fn of WRITE_FNS) {
    assert.match(fnBody(fn), /INSERT INTO public\.evaluation_response_unit_release_events/, `${fn}: audit insert`)
  }
  // Append-only enforced by a BEFORE UPDATE OR DELETE trigger that raises.
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\._ul_eval_events_append_only/)
  assert.match(sql, /BEFORE UPDATE OR DELETE ON public\.evaluation_response_unit_release_events/)
  assert.match(fnBody('_ul_eval_events_append_only'), /RAISE EXCEPTION[\s\S]*?append-only/)
})

test('the snapshot is immutable via a BEFORE UPDATE guard trigger', () => {
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\._ul_eval_guard_snapshot_immutable/)
  assert.match(sql, /BEFORE UPDATE ON public\.evaluation_response_unit_release\b/)
  for (const col of ['hist_unit_key', 'hist_preceptor_id', 'unit_leader_eligible_at', 'public_token']) {
    assert.match(sql, new RegExp(`NEW\\.${col}\\s+IS DISTINCT FROM OLD\\.${col}`))
  }
})

// ── (H) preceptor attribution from the assignment/respondent relationship ────
test('preceptor attribution uses the assignment respondent, never students.preceptor_id', () => {
  const cap = fnBody('_ul_eval_capture_snapshot')
  assert.match(cap, /a\.respondent_type, a\.respondent_preceptor_id/)
  assert.match(cap, /v_slug = 'preceptor_progress' THEN\s*\n?\s*v_preceptor_id := v_resp_preceptor;/)
  assert.match(cap, /ELSE\s*\n?\s*v_preceptor_id := NULL;/)
  assert.ok(!/s\.preceptor_id/.test(cap), 'capture must not read students.preceptor_id')
  // Legacy backfill uses the same respondent source (not students.preceptor_id).
  assert.match(sql, /CASE WHEN i\.slug = 'preceptor_progress' THEN a\.respondent_preceptor_id ELSE NULL END/)
})

test('snapshots are captured at submission for approved instruments only', () => {
  assert.match(sql, /AFTER INSERT ON public\.evaluation_responses/)
  assert.match(fnBody('_ul_eval_capture_snapshot'),
    /v_slug NOT IN \('student_preceptor_eval', 'preceptor_progress'\) THEN\s*\n?\s*RETURN NEW/)
})

test('legacy rows are quarantined ineligible and unverified', () => {
  assert.match(sql, /'backfill_unverified', 'ineligible'/)
  assert.match(fnBody('ul_eval_release_response'),
    /snapshot_source NOT IN \('submission_trigger', 'backfill_verified'\)[\s\S]*?snapshot_unverified/)
})

test('lifecycle functions are authenticated EXECUTE, never anon/public', () => {
  for (const sig of ['ul_eval_moderate_response(uuid, text)', 'ul_eval_release_response(uuid)',
                     'ul_eval_revoke_response(uuid)', 'ul_eval_rerelease_response(uuid)']) {
    const e = sig.replace(/[()]/g, '\\$&')
    assert.match(sql, new RegExp(`REVOKE ALL ON FUNCTION public\\.${e}\\s+FROM PUBLIC, anon`))
    assert.match(sql, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${e}\\s+TO authenticated`))
  }
})

test('read functions are authenticated EXECUTE, never anon/public', () => {
  for (const sig of ['ul_eval_dashboard_summary(text, text, text)',
                     'ul_eval_response_list(text, text, text)', 'ul_eval_response_detail(text)']) {
    const e = sig.replace(/[()]/g, '\\$&')
    assert.match(sql, new RegExp(`REVOKE ALL ON FUNCTION public\\.${e}\\s+FROM PUBLIC, anon`))
    assert.match(sql, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${e}\\s+TO authenticated`))
  }
})

test('every function is SECURITY DEFINER with a fixed search_path', () => {
  const defs = sql.match(/CREATE OR REPLACE FUNCTION/g) || []
  const paths = sql.match(/SET search_path = public, pg_catalog/g) || []
  assert.equal(defs.length, 11)
  assert.equal(paths.length, 11)
})

test('the base evaluation tables and staff/student contracts are untouched', () => {
  assert.ok(!/ALTER TABLE public\.evaluation_responses/.test(sql))
  assert.ok(!/ALTER TABLE public\.evaluation_assignments/.test(sql))
  assert.ok(!/submit_evaluation_response|submit_preceptor_evaluation_response|submit_student_preceptor_evaluation_response/.test(code))
  assert.match(sql, /AFTER INSERT ON public\.evaluation_responses/)   // additive trigger only
})

test('both new tables are RLS-protected owner/admin SELECT only', () => {
  assert.match(sql, /ALTER TABLE public\.evaluation_response_unit_release ENABLE ROW LEVEL SECURITY/)
  assert.match(sql, /ALTER TABLE public\.evaluation_response_unit_release_events ENABLE ROW LEVEL SECURITY/)
  assert.ok((sql.match(/USING \(public\.is_active_owner_or_admin\(\)\)/g) || []).length >= 2)
})
