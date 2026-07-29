// Cohort unit response targets: hardened schema, authorized access, management workflow.
//
// Source guards over the Owner-gated migration, the staff-authorized API, and the management modal,
// plus a functional parity check that the API and shared canonical-key rules agree. No SQL runs.
//
// Run: node --test test/cohortResponseTargets.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { canonicalUnitKey as apiCanon } from '../api/cohort-unit-response-targets.js'
import { canonicalUnitKey as libCanon } from '../src/lib/canonicalUnit.js'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')
const migration = read('supabase/migrations/20260731030000_add_cohort_unit_response_targets.sql')
const api = read('api/cohort-unit-response-targets.js')
const modal = read('src/components/CohortResponseTargetsModal.jsx')
const upsert = read('api/lib/unitResponseUpsert.js')

// ─── Canonical key parity (client / server / DB) ────────────────────────────────

test('canonical key rule is identical across the shared lib, the API, and the DB migration', () => {
  for (const s of ['6 NE', '6ne', '6-N-E', ' 6  ne ', 'Labor & Delivery']) {
    assert.equal(apiCanon(s), libCanon(s), `api vs lib mismatch for "${s}"`)
  }
  assert.equal(libCanon('6 NE'), '6NE')
  // The DB generated column uses the same rule.
  assert.match(migration, /regexp_replace\(upper\(coalesce\(unit_key, ''\)\), '\[\^A-Z0-9\]', '', 'g'\)\) STORED/)
})

// ─── Hardened schema (15, 16 + FKs, checks, RLS, sentinel) ──────────────────────

test('schema has required fields, FKs, nonblank + active/removal checks, and audit columns', () => {
  assert.match(migration, /cohort_id\s+uuid NOT NULL REFERENCES public\.cohorts\(id\) ON DELETE CASCADE/)
  assert.match(migration, /unit_id\s+uuid REFERENCES public\.units\(id\) ON DELETE SET NULL/)
  assert.match(migration, /requested_by_profile_id\s+uuid REFERENCES public\.user_profiles\(id\)/)
  assert.match(migration, /removed_at\s+timestamptz/)
  assert.match(migration, /removed_by_profile_id\s+uuid REFERENCES public\.user_profiles/)
  assert.match(migration, /unit_name\s+text NOT NULL/)
  assert.match(migration, /CHECK \(btrim\(unit_key\)\s*<> ''\)/)
  assert.match(migration, /CHECK \(btrim\(unit_name\)\s*<> ''\)/)
  assert.match(migration, /chk_curt_active_removal/)
})

test('exactly one durable target row per cohort + canonical unit (full uniqueness, no partial index)', () => {
  assert.match(migration, /CONSTRAINT uq_curt_cohort_unit UNIQUE \(cohort_id, unit_key_canon\)/)
  // The old partial active-only unique index is gone (it permitted inactive duplicates).
  assert.doesNotMatch(migration, /UNIQUE INDEX[\s\S]*?WHERE is_active/)
})

test('access is restrictive: RLS on, anon/authenticated revoked, service-role only, updated_at trigger', () => {
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/)
  assert.match(migration, /REVOKE ALL ON public\.cohort_unit_response_targets FROM anon/)
  assert.match(migration, /REVOKE ALL ON public\.cohort_unit_response_targets FROM authenticated/)
  // No browser-wide read policy exists (the previous FOR SELECT TO authenticated USING (true) is gone).
  assert.doesNotMatch(migration, /CREATE POLICY[\s\S]*FOR SELECT TO authenticated USING \(true\)/)
  assert.match(migration, /EXECUTE FUNCTION public\.update_updated_at_column\(\)/)
})

test('readiness sentinel is created last and service_role-only (fail-closed pre-migration)', () => {
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.cohort_unit_response_targets_ready\(\)/)
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.cohort_unit_response_targets_ready\(\) TO service_role/)
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.cohort_unit_response_targets_ready\(\) FROM authenticated/)
  const createFn = migration.indexOf('CREATE OR REPLACE FUNCTION public.cohort_unit_response_targets_ready')
  assert.ok(createFn > migration.indexOf('CREATE TABLE'))
})

test('migration does not guess Fall 2026 targets: no executable INSERT in the transaction', () => {
  const txn = migration.slice(migration.indexOf('BEGIN;'), migration.indexOf('COMMIT;'))
  assert.doesNotMatch(txn, /INSERT\s+INTO/i)
  for (const line of migration.split('\n')) {
    if (line.includes('eedd91ec-ad6f-4df8-aa20-5c06b2889011')) assert.match(line.trimStart(), /^--/)
  }
})

// ─── Authorization (10, 11, 12, 13) ─────────────────────────────────────────────

test('API authorizes active owner/admin only; Students / Unit Leaders / Academic Partners are rejected', () => {
  assert.match(api, /verifyOwnerAdminCaller\(req\)/)
  assert.match(api, /if \(!auth\.ok\)/)
  assert.match(api, /code: 'STAFF_ONLY'/)
  // Reads/writes use the service-role client (RLS denies the browser), not a caller-scoped client.
  assert.match(api, /getServiceDb\(\)/)
  // No portal-scope authorization is derived from targets.
  assert.doesNotMatch(api, /user_unit_scopes|user_school_scopes/)
})

test('API fails closed until the migration is applied (readiness sentinel gate)', () => {
  assert.match(api, /cohort_unit_response_targets_ready/)
  assert.match(api, /ready: false/)
  assert.match(api, /targets_not_enabled|TARGETS_NOT_ENABLED/)
})

// ─── Management workflow (14, 16, 18) ───────────────────────────────────────────

test('API supports add / deactivate / reactivate with audit stamps and duplicate prevention', () => {
  assert.match(api, /action === 'create'/)
  assert.match(api, /action === 'deactivate'/)
  assert.match(api, /action === 'reactivate'/)
  // Audit fields written from the VERIFIED caller, never the body.
  assert.match(api, /requested_by_profile_id: actorId/)
  assert.match(api, /removed_by_profile_id: actorId/)
  assert.match(api, /removed_at: new Date\(\)\.toISOString\(\)/)
  // Duplicate prevention: skip already-active, and refuse a reactivation that would duplicate.
  assert.match(api, /already an active target/)
  assert.match(api, /DUPLICATE_ACTIVE_TARGET/)
})

test('targeting a unit never writes units or unit_cohort_responses (no capacity, no response)', () => {
  assert.doesNotMatch(api, /from\('units'\)/)
  assert.doesNotMatch(api, /from\('unit_cohort_responses'\)/)
})

test('every target write/read is scoped to the requested cohort id', () => {
  assert.match(api, /\.eq\('cohort_id', cohortId\)/)
  assert.match(api, /row\.cohort_id !== cohortId/)   // deactivate/reactivate verify ownership
})

// ─── Modal accessibility (17) + submission untouched (20) ───────────────────────

test('management modal is an accessible labelled dialog reusing existing patterns', () => {
  assert.match(modal, /role="dialog"/)
  assert.match(modal, /aria-modal="true"/)
  assert.match(modal, /aria-label="Configure response targets"/)
  assert.match(modal, /getCanonicalUnitNames\(\)/)   // choices come from the canonical catalog, not invented
})

test('the existing capacity-response submission path is unchanged (still upserts units + responses)', () => {
  assert.match(upsert, /\.from\('units'\)/)
  assert.match(upsert, /\.from\('unit_cohort_responses'\)/)
  assert.match(upsert, /onConflict: 'cohort_id,unit_id'/)
})
