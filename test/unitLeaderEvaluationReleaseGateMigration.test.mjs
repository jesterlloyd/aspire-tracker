// Commit 2 static guards for the Unit Leader evaluation release-gate migration.
//
// The migration is NOT applied on this branch (Jester runs it through the SQL gate), so
// these are source-level assertions on the migration text, matching this repo's
// established migration-test style. They lock the safety-critical properties of the
// schema, the immutable snapshot, the release lifecycle, and the authorization functions.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')

const sql = read('supabase/migrations/20260725000000_unit_leader_evaluation_release_gate.sql')
// Executable SQL only (line comments stripped), so excluded-slug checks ignore the header.
const code = sql.replace(/^\s*--.*$/gm, '')

// Bodies of the individual read/write functions, for scoped assertions.
function fnBody(name) {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}`)
  assert.ok(start > -1, `function ${name} must exist`)
  const end = sql.indexOf('$$;', start)
  assert.ok(end > start, `function ${name} must be dollar-quoted`)
  return sql.slice(start, end)
}

const READ_FNS = ['ul_eval_dashboard_summary', 'ul_eval_response_list', 'ul_eval_response_detail']
const WRITE_FNS = ['ul_eval_moderate_response', 'ul_eval_release_response', 'ul_eval_revoke_response']

test('the migration is transactional and reloads the PostgREST schema', () => {
  assert.match(sql, /^BEGIN;/m)
  assert.match(sql, /^COMMIT;/m)
  assert.match(sql, /NOTIFY pgrst, 'reload schema'/)
})

test('the release table exists with the immutable-snapshot + lifecycle columns', () => {
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.evaluation_response_unit_release/)
  for (const col of [
    'response_id', 'instrument_slug', 'hist_unit_id', 'hist_unit_key', 'hist_preceptor_id',
    'hist_cohort_id', 'hist_rotation_end', 'unit_leader_eligible_at', 'snapshot_source',
    'release_state', 'moderation_state', 'quantitative_visible', 'free_text_visible',
  ]) {
    assert.ok(sql.includes(col), `table must define ${col}`)
  }
  // response_id is 1:1 with a response and cascades.
  assert.match(sql, /response_id\s+uuid NOT NULL UNIQUE\s*\n?\s*REFERENCES public\.evaluation_responses\(id\) ON DELETE CASCADE/)
})

test('only the two approved instruments are ever eligible', () => {
  // CHECK constraint, capture trigger, backfill, and every function guard on slug.
  assert.match(sql, /CHECK \(instrument_slug IN \('student_preceptor_eval', 'preceptor_progress'\)\)/)
  // Excluded instruments must not appear in executable SQL (comments may name them).
  assert.ok(!code.includes('casey_fink_readiness_2024'), 'Casey-Fink slug must not appear in code')
  assert.ok(!code.includes('post_rotation_evaluation'), 'post-rotation slug must not appear in code')
  const occurrences = (sql.match(/'student_preceptor_eval', 'preceptor_progress'/g) || []).length
  assert.ok(occurrences >= 5, `approved-slug guard should be repeated across guards, saw ${occurrences}`)
})

test('release timing is rotation end plus a 7-day delay', () => {
  assert.match(sql, /COALESCE\(s\.rotation_completed_at, s\.rotation_end_date::timestamptz\)/)
  assert.match(sql, /v_rotation_end \+ interval '7 days'/)
})

test('free text is hidden: hard CHECK, and reads return numeric values only', () => {
  assert.match(sql, /CONSTRAINT chk_ul_eval_free_text_hidden_first_release\s*\n?\s*CHECK \(free_text_visible = false\)/)
  for (const fn of READ_FNS) {
    const body = fnBody(fn)
    assert.match(body, /jsonb_typeof\((?:e\.value|sc\.responses|value)?[^)]*\) = 'number'/,
      `${fn} must filter to numeric values (dropping all free text)`)
  }
})

test('reads never return identity, timestamps, or preceptor grouping', () => {
  for (const fn of READ_FNS) {
    const body = fnBody(fn)
    // released_at is used only for stable ORDER BY (never returned), so it is excluded
    // here. "preceptor" alone is a substring of the approved slug names, so the guard
    // uses hist_preceptor (the actual preceptor snapshot columns) instead.
    for (const forbidden of [
      'first_name', 'last_name', 'preferred_first_name', 'email', 'headshot',
      'student_id', 'submitted_at', 'hist_preceptor',
    ]) {
      assert.ok(!body.includes(forbidden), `${fn} must not expose ${forbidden}`)
    }
  }
})

test('reads derive scope from the JWT and can only narrow (never widen)', () => {
  for (const fn of READ_FNS) {
    const body = fnBody(fn)
    assert.match(body, /public\.has_active_role_grant\('unit_leader'\)/,
      `${fn} must require an active unit_leader grant`)
    assert.match(body, /FROM public\.my_unit_scope_keys\(\) s/,
      `${fn} must intersect with the caller's server-derived scopes`)
    assert.match(body, /s\.unit_key = rel\.hist_unit_key/,
      `${fn} must scope on the immutable historical unit snapshot`)
    assert.match(body, /s\.cohort_id IS NULL OR s\.cohort_id = rel\.hist_cohort_id/,
      `${fn} must respect cohort-limited scopes`)
  }
  // The optional unit parameter only narrows.
  assert.ok((sql.match(/p_unit_key IS NULL OR rel\.hist_unit_key = p_unit_key/g) || []).length >= 2)
})

test('reads only surface released, un-revoked, eligible responses', () => {
  for (const fn of READ_FNS) {
    const body = fnBody(fn)
    assert.match(body, /rel\.release_state = 'released'/, `${fn} requires released`)
    assert.match(body, /rel\.revoked_at IS NULL/, `${fn} excludes revoked`)
    assert.match(body, /now\(\) >= rel\.unit_leader_eligible_at/, `${fn} enforces the delay`)
  }
})

test('there is no minimum-count suppression', () => {
  // The summary returns the raw released count with no threshold gate.
  assert.match(sql, /'released_response_count', \(SELECT count\(\*\) FROM scoped\)/)
  assert.ok(!/min_unit_aggregate_n|>= *5|HAVING count/.test(sql), 'no hidden 5-response threshold')
})

test('the snapshot is immutable via a BEFORE UPDATE guard trigger', () => {
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\._ul_eval_guard_snapshot_immutable/)
  assert.match(sql, /BEFORE UPDATE ON public\.evaluation_response_unit_release/)
  assert.match(sql, /snapshot columns are immutable/)
  // Guards each snapshot column.
  for (const col of ['hist_unit_key', 'hist_preceptor_id', 'unit_leader_eligible_at', 'snapshot_source']) {
    assert.match(sql, new RegExp(`NEW\\.${col}\\s+IS DISTINCT FROM OLD\\.${col}`))
  }
})

test('snapshots are captured at submission for approved instruments only', () => {
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\._ul_eval_capture_snapshot/)
  assert.match(sql, /AFTER INSERT ON public\.evaluation_responses/)
  const body = fnBody('_ul_eval_capture_snapshot')
  assert.match(body, /v_slug NOT IN \('student_preceptor_eval', 'preceptor_progress'\) THEN\s*\n?\s*RETURN NEW/)
  assert.match(body, /'submission_trigger', 'pending'/)
})

test('legacy rows are quarantined ineligible and never releasable', () => {
  assert.match(sql, /'backfill_unverified', 'ineligible'/)
  // eligibility is intentionally withheld for legacy rows.
  assert.match(sql, /NULL,\s*--[^\n]*quarantined[\s\S]*?'backfill_unverified', 'ineligible'/)
  const release = fnBody('ul_eval_release_response')
  assert.match(release, /snapshot_source = 'backfill_unverified' THEN\s*\n?\s*RETURN jsonb_build_object\('status', 'snapshot_unverified'\)/)
})

test('release enforces every gate before making a response visible', () => {
  const body = fnBody('ul_eval_release_response')
  assert.match(body, /_ul_eval_is_active_owner_admin\(p_actor_profile_id\)/)
  assert.match(body, /unit_leader_eligible_at IS NULL[\s\S]*?snapshot_incomplete/)
  assert.match(body, /now\(\) < v_row\.unit_leader_eligible_at[\s\S]*?not_yet_eligible/)
  assert.match(body, /moderation_state <> 'cleared'[\s\S]*?not_moderated/)
  assert.match(body, /release_state\s*=\s*'released'/)
})

test('revoke immediately removes visibility; owner/admin only', () => {
  const body = fnBody('ul_eval_revoke_response')
  assert.match(body, /_ul_eval_is_active_owner_admin\(p_actor_profile_id\)/)
  assert.match(body, /release_state\s*=\s*'revoked'/)
  assert.match(body, /quantitative_visible\s*=\s*false/)
})

test('lifecycle functions are Owner/Admin, service_role EXECUTE only (Unit Leaders denied)', () => {
  for (const fn of WRITE_FNS) {
    const body = fnBody(fn)
    assert.match(body, /_ul_eval_is_active_owner_admin\(p_actor_profile_id\)/, `${fn} validates the actor`)
  }
  for (const sig of [
    'ul_eval_moderate_response(uuid, uuid, text)',
    'ul_eval_release_response(uuid, uuid)',
    'ul_eval_revoke_response(uuid, uuid)',
  ]) {
    assert.match(sql, new RegExp(`REVOKE ALL ON FUNCTION public\\.${sig.replace(/[()]/g, '\\$&')}\\s+FROM PUBLIC, anon, authenticated`))
    assert.match(sql, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${sig.replace(/[()]/g, '\\$&')}\\s+TO service_role`))
  }
})

test('read functions are authenticated EXECUTE, never anon/public', () => {
  for (const sig of [
    'ul_eval_dashboard_summary(text, text, text)',
    'ul_eval_response_list(text, text, text)',
    'ul_eval_response_detail(uuid)',
  ]) {
    assert.match(sql, new RegExp(`REVOKE ALL ON FUNCTION public\\.${sig.replace(/[()]/g, '\\$&')}\\s+FROM PUBLIC, anon`))
    assert.match(sql, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${sig.replace(/[()]/g, '\\$&')}\\s+TO authenticated`))
  }
})

test('every function is SECURITY DEFINER with a fixed search_path', () => {
  const defs = sql.match(/CREATE OR REPLACE FUNCTION/g) || []
  const secdef = sql.match(/SECURITY DEFINER/g) || []
  const paths = sql.match(/SET search_path = public, pg_catalog/g) || []
  assert.equal(defs.length, 9)
  assert.ok(secdef.length >= 9)
  assert.equal(paths.length, 9)
})

test('the base evaluation tables and staff/student contracts are untouched', () => {
  // No column changes to evaluation_responses / assignments; no submit-RPC edits.
  assert.ok(!/ALTER TABLE public\.evaluation_responses/.test(sql))
  assert.ok(!/ALTER TABLE public\.evaluation_assignments/.test(sql))
  assert.ok(!/submit_evaluation_response|submit_preceptor_evaluation_response|submit_student_preceptor_evaluation_response|is_owner_or_admin\(\)\s+RETURNS/.test(sql))
  // The only touch to evaluation_responses is an additive AFTER INSERT trigger.
  assert.match(sql, /AFTER INSERT ON public\.evaluation_responses/)
})

test('the table is RLS-protected: Unit Leaders read only through the functions', () => {
  assert.match(sql, /ALTER TABLE public\.evaluation_response_unit_release ENABLE ROW LEVEL SECURITY/)
  assert.match(sql, /REVOKE ALL ON TABLE public\.evaluation_response_unit_release FROM PUBLIC, anon, authenticated/)
  assert.match(sql, /USING \(public\.is_active_owner_or_admin\(\)\)/)
})
