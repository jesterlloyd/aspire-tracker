// AP Placement Requests provenance/password follow-up, Commit 3: the authenticated submission POST
// independently verifies the cohort password server-side (the client-side gate is NOT trusted), and
// re-authorizes the school + cohort from server scope. Pure tests over the scope matcher plus source
// guards over the endpoint's verification chain and its password hygiene.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { matchSchoolCohortScope } from '../api/lib/schoolScope.js'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')
const stripJs = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const endpoint = read('api/portal/school-placement-requests.js')
const endpointCode = stripJs(endpoint)

// ── Server-side school + cohort authorization (matchSchoolCohortScope) ─────────────────────────────

test('a submission is authorized only for a school+cohort within the caller active scopes', () => {
  const scopes = [{ school_key: 'West Coast University Anaheim', cohort_id: null }]
  assert.equal(matchSchoolCohortScope(scopes, 'West Coast University Anaheim', 'c1'), true)
  // A different school the caller is not scoped to is rejected.
  assert.equal(matchSchoolCohortScope(scopes, 'Mount Saint Mary', 'c1'), false)
})

test('WCU campuses stay isolated: an Anaheim scope cannot submit for North Hollywood or the parent', () => {
  const scopes = [{ school_key: 'West Coast University Anaheim', cohort_id: null }]
  assert.equal(matchSchoolCohortScope(scopes, 'West Coast University North Hollywood', 'c1'), false)
  assert.equal(matchSchoolCohortScope(scopes, 'West Coast University', 'c1'), false)
})

test('a cohort-scoped grant authorizes only that cohort; a null-cohort grant authorizes any', () => {
  const cohortScoped = [{ school_key: 'West Coast University', cohort_id: 'c1' }]
  assert.equal(matchSchoolCohortScope(cohortScoped, 'West Coast University', 'c1'), true)
  assert.equal(matchSchoolCohortScope(cohortScoped, 'West Coast University', 'c2'), false)
  const anyCohort = [{ school_key: 'West Coast University', cohort_id: null }]
  assert.equal(matchSchoolCohortScope(anyCohort, 'West Coast University', 'c2'), true)
})

// ── Endpoint: independent server-side password verification on the final POST ──────────────────────

test('the final POST re-derives the cohort and independently verifies the password server-side', () => {
  // The submission runs its own auth+scope+cohort+password chain; it does not trust a client flag.
  assert.match(endpoint, /async function submitPlacementRequest\(req, res, auth\)/)
  assert.match(endpoint, /matchSchoolCohortScope\(scopes, school, cohortId\)/)
  assert.match(endpoint, /\.from\('cohorts'\)\.select\('id, name, accepting_submissions'\)/)
  assert.match(endpoint, /accepting_submissions/)
  // Password requirement + verification through the canonical RPCs, via a caller-scoped client.
  assert.match(endpoint, /getCallerScopedDb\(req\)/)
  assert.match(endpoint, /rpc\('school_form_requires_password', \{ p_cohort_id: cohortId \}\)/)
  assert.match(endpoint, /rpc\('verify_school_form_password', \{[\s\S]*?p_entered_password: entered/)
})

test('missing or invalid password fails before any write; a password-free cohort proceeds', () => {
  // Required-but-missing -> rejected; wrong -> rejected; both BEFORE the readiness gate / write.
  assert.match(endpointCode, /if \(requiresPassword\) \{[\s\S]*?if \(!entered\) return res\.status\(403\)\.json\(\{ error: 'password_required' \}\)/)
  assert.match(endpointCode, /if \(!ok\) return res\.status\(403\)\.json\(\{ error: 'password_invalid' \}\)/)
  // Verification only happens when the cohort requires it (password-free cohort skips the check).
  assert.match(endpointCode, /requiresPassword = data === true/)
  // The password check sits BEFORE the submission gate/write in the function body.
  assert.match(endpointCode, /verify_school_form_password[\s\S]*?submission_not_enabled/)
})

test('the password is never logged, echoed, persisted, or copied into a write payload', () => {
  // No console logging of the password, and no storage APIs.
  assert.doesNotMatch(endpointCode, /console\.\w+\([^)]*password/i)
  assert.doesNotMatch(endpointCode, /localStorage|sessionStorage/)
  // The password VALUE is never echoed in a response body (the 'password_required'/'password_invalid'
  // error CODES are generic and fine; the entered value must not appear).
  assert.doesNotMatch(endpointCode, /\.json\(\{[^}]*\b(entered|body\.password)\b/)
  // It is read only transiently from the body into a local, then passed to the RPC and dropped.
  assert.match(endpointCode, /const entered = typeof body\.password === 'string' \? body\.password\.trim\(\) : ''/)
  // The endpoint still performs no student write in this commit (readiness gate + write come next).
  assert.doesNotMatch(endpointCode, /\.insert\(|\.update\(|\.upsert\(/)
})

test('the password RPCs run as the caller (authenticated), not the service role', () => {
  // getCallerScopedDb builds an anon+Bearer client (role authenticated); the RPCs are called on it.
  const portalAuth = read('api/lib/portalAuth.js')
  assert.match(portalAuth, /export function getCallerScopedDb\(req\)/)
  assert.match(portalAuth, /Authorization: `Bearer \$\{token\}`/)
  assert.match(endpoint, /const caller = getCallerScopedDb\(req\)/)
  assert.match(endpoint, /caller\.rpc\('verify_school_form_password'/)
})
