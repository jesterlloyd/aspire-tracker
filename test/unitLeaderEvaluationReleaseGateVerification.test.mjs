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
  // Lifecycle functions must not be executable by authenticated (least privilege).
  assert.match(verify, /has_function_privilege\('authenticated', 'public\.ul_eval_release_response\(uuid,uuid\)',\s+'EXECUTE'\)/)
  // Read functions: authenticated yes, anon no.
  assert.match(verify, /has_function_privilege\('anon',\s+'public\.ul_eval_response_list\(text,text,text\)', 'EXECUTE'\)/)
  // Backfill outcome + non-approved invariant + immutability negative test.
  assert.match(verify, /GROUP BY 1, 2/)
  assert.match(verify, /non_approved_rows/)
  assert.match(verify, /immutability_enforced/)
  // It is a review script: it must not itself release or grant anything.
  assert.ok(!/SELECT public\.ul_eval_release_response\([^']*'[0-9a-f]/.test(verify),
    'verification must not release a real response')
})

test('the rollback preserves data and never deletes responses', () => {
  // Option A (preferred): revoke read EXECUTE, non-destructive.
  assert.match(rollback, /REVOKE EXECUTE ON FUNCTION public\.ul_eval_response_list/)
  // Option B (full teardown) drops the gate table but never evaluation_responses.
  assert.match(rollback, /DROP TABLE IF EXISTS public\.evaluation_response_unit_release/)
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

test('the SQL-gate branch wired no evaluation endpoint or client read', () => {
  // The migration exists but nothing in the app imports/calls the new DB functions.
  const portalApi = readdirSync(join(root, 'api', 'portal'))
  assert.deepEqual(portalApi.filter(f => /eval/i.test(f)), [],
    'no api/portal evaluation endpoint may exist on this branch')
  // No application code references the new functions yet.
  const grepDirs = ['src', 'api']
  const hits = []
  const walk = (dir) => {
    for (const e of readdirSync(join(root, dir), { withFileTypes: true })) {
      if (e.name === 'node_modules') continue
      const rel = join(dir, e.name)
      if (e.isDirectory()) walk(rel)
      else if (/\.(js|jsx|mjs|ts|tsx)$/.test(e.name)) {
        const t = readFileSync(join(root, rel), 'utf8')
        if (/ul_eval_(dashboard_summary|response_list|response_detail|release_response|revoke_response|moderate_response)/.test(t)) {
          hits.push(rel)
        }
      }
    }
  }
  grepDirs.forEach(walk)
  assert.deepEqual(hits, [], `no app code may call the new DB functions yet, found: ${hits.join(', ')}`)
})

test('the Evaluations tab remains the placeholder (gate intact)', () => {
  const portal = read('src/portal/UnitLeaderPortal.jsx')
  assert.match(portal, /view === 'evaluations' && <UnitEvaluationsPlaceholder \/>/)
  assert.ok(existsSync(join(root, 'src/portal/unit/UnitEvaluationsPlaceholder.jsx')))
})

test('the migration file exists and is not referenced by the build', () => {
  assert.ok(existsSync(join(root, 'supabase/migrations/20260725000000_unit_leader_evaluation_release_gate.sql')))
})
