// Commit 3: the verification, rollback, and follow-on artifacts exist and carry the
// safety-critical checks, and the SQL-gate branch changed no application behavior (the
// Evaluations tab is still a placeholder; no endpoint; migration not wired to any code).

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const read = (p) => readFileSync(join(root, p), 'utf8')

const verify = read('db/audit/unit_leader_evaluation_release_gate_verification.sql')
const rollback = read('db/audit/unit_leader_evaluation_release_gate_rollback.sql')
const followon = read('docs/UNIT_LEADER_EVALUATIONS_FOLLOWON.md')

test('the verification script checks objects, security, grants, and immutability', () => {
  assert.match(verify, /relrowsecurity/)
  assert.match(verify, /prosecdef, proconfig/)
  // Lifecycle functions must not be executable by anon (least privilege).
  assert.match(verify, /has_function_privilege\('anon', 'public\.ul_eval_release_response\(uuid\)',\s+'EXECUTE'\)/)
  // Read functions: authenticated yes, anon no.
  assert.match(verify, /has_function_privilege\('anon',\s+'public\.ul_eval_response_list\(text,text,text\)', 'EXECUTE'\)/)
  // Backfill outcome + non-approved invariant.
  assert.match(verify, /GROUP BY 1, 2/)
  assert.match(verify, /non_approved_rows/)
  // It is a review script: it must not itself release or grant anything.
  assert.ok(!/SELECT public\.ul_eval_release_response\([^']*'[0-9a-f]/.test(verify),
    'verification must not release a real response')
})

test('the expanded verification proves the second-review corrections', () => {
  // Surface + confirm the authoritative Owner/Admin helper definition.
  assert.match(verify, /pg_get_functiondef\('public\.is_active_owner_or_admin\(\)'::regprocedure\)/)
  assert.match(verify, /checks_active/)
  // (1) Table privilege restrictions + TRUNCATE denial.
  assert.match(verify, /ev_truncate/)
  assert.match(verify, /rel_delete/)
  assert.match(verify, /no_truncate/)
  // (5) No stable response identifier exposed.
  assert.match(verify, /public_token_columns/)
  assert.match(verify, /read_fns_with_identifier/)
  // (6/4b) The pure helper is NOT security definer.
  assert.match(verify, /_ul_eval_safe_quantitative\(text,jsonb\)'::regprocedure/)
  // (3) Row locking in every lifecycle function.
  assert.match(verify, /for_update/)
  // (2) Missing-preceptor ineligibility.
  assert.match(verify, /release_checks_preceptor/)
  // (4) Exact allowlist table seeded + joined; no unsafe rows.
  assert.match(verify, /seeded_allowlist_paths/)
  assert.match(verify, /helper_uses_allowlist/)
  assert.match(verify, /unsafe_allowlist_rows/)
  // Corrected immutability failure is a hard, un-swallowed assert_failure.
  assert.match(verify, /IMMUTABILITY GUARD FAILED/)
  assert.match(verify, /ERRCODE = 'assert_failure'/)
  // Append-only + release delete/truncate blocking negative tests.
  assert.match(verify, /append_only_enforced/)
  assert.match(verify, /release_delete_truncate_blocked/)
  // (I) FK is RESTRICT, never CASCADE.
  assert.match(verify, /confdeltype[\s\S]*?RESTRICT[\s\S]*?NEVER 'c'/)
})

test('the rollback preserves data and never deletes responses', () => {
  // Option A (preferred): revoke read EXECUTE, non-destructive.
  assert.match(rollback, /REVOKE EXECUTE ON FUNCTION public\.ul_eval_response_list/)
  // Option B (full teardown) drops all three new tables but never evaluation_responses.
  assert.match(rollback, /DROP TABLE IF EXISTS public\.evaluation_response_unit_release_events/)
  assert.match(rollback, /DROP TABLE IF EXISTS public\.evaluation_unit_quantitative_keys/)
  assert.match(rollback, /DROP TABLE IF EXISTS public\.evaluation_response_unit_release;/)
  assert.ok(!/DELETE FROM public\.evaluation_responses|DROP TABLE[^\n]*evaluation_responses\b/.test(rollback),
    'rollback must never delete evaluation_responses content')
  assert.match(rollback, /safe ONLY before/i)
})

test('the follow-on contract names the next branch and defers all API/UI', () => {
  assert.match(followon, /unit-leader-evaluations-backend-ui/)
  assert.match(followon, /verifyPortalUnitLeaderCaller/)
  assert.match(followon, /never claim anonymity is guaranteed|never claim anonymity/i)
  assert.match(followon, /out of scope/i)
})

test('every app reference to the lifecycle/read RPCs goes through the caller-JWT client', () => {
  // The follow-on backend-ui branch activates the surface. Any code that calls the
  // SECURITY DEFINER RPCs must do so with the caller's JWT client (getUserScopedDb), which
  // preserves auth.uid(); it must NEVER use the service-role client, and must never pass a
  // spoofable actor id. We check every app file that names an RPC.
  const grepDirs = ['src', 'api']
  const rpcRe = /ul_eval_(dashboard_summary|response_list|release_response|rerelease_response|revoke_response|moderate_response)/
  const offenders = []
  const walk = (dir) => {
    for (const e of readdirSync(join(root, dir), { withFileTypes: true })) {
      if (e.name === 'node_modules') continue
      const rel = join(dir, e.name)
      if (e.isDirectory()) walk(rel)
      else if (/\.(js|jsx|mjs|ts|tsx)$/.test(e.name)) {
        const t = readFileSync(join(root, rel), 'utf8')
        if (rpcRe.test(t)) {
          // A file that invokes an RPC (db.rpc / .rpc()) must import getUserScopedDb and
          // must not call the RPC through a service-role client.
          if (/\.rpc\(/.test(t)) {
            if (!/getUserScopedDb/.test(t) || /getServiceDb[\s\S]*\.rpc\(/.test(t)) offenders.push(rel)
          }
        }
      }
    }
  }
  grepDirs.forEach(walk)
  assert.deepEqual(offenders, [], `RPC calls must use the caller-JWT client, offenders: ${offenders.join(', ')}`)
})

test('the activated Evaluations tab mounts the read-only workspace, not the placeholder', () => {
  // Activation era: the placeholder is superseded by the released workspace. The gate that
  // matters now is not "no UI exists" but "the UI is the read-only, quantitative-only
  // workspace" — the placeholder file is retained on disk only as a rollback target.
  const portal = read('src/portal/UnitLeaderPortal.jsx')
  assert.match(portal, /view === 'evaluations'[\s\S]*?<UnitEvaluationsWorkspace unitKeys=\{unitKeys\} \/>/)
  assert.ok(!portal.includes('UnitEvaluationsPlaceholder'))
  assert.ok(existsSync(join(root, 'src/portal/unit/UnitEvaluationsWorkspace.jsx')))
})

test('the migration file exists and is not referenced by the build', () => {
  assert.ok(existsSync(join(root, 'supabase/migrations/20260725000000_unit_leader_evaluation_release_gate.sql')))
})
