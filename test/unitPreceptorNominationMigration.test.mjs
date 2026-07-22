// UL-WORKFLOW: guards for the GATED preceptor-nomination migration handoff.
//
// The six-field nomination form (Student optional; Full Name, Email, Unit, Shift
// required; Phone optional) cannot be built without schema. These guards prove the
// provided migration makes the change genuinely, additively, and reversibly, and that it
// reuses the canonical Preceptor Directory shift set rather than inventing a new one.
// The migration is NOT applied by this pass; these are static-source guards on the file.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')

const mig = read('supabase/migrations/20260721000000_unit_preceptor_nomination_fields.sql')
const ver = read('db/audit/unit_preceptor_nomination_fields_preflight_and_verification.sql')
const foundation = read('supabase/migrations/20260720000000_unit_leader_portal_foundation.sql')

// Live SQL is the file with block comments (the rollback) removed, so an assertion about
// what the migration DOES never matches text that only appears in the rollback comment.
const live = mig.replace(/\/\*[\s\S]*?\*\//g, '')
const liveSql = live.replace(/^\s*--.*$/gm, '')
const rollback = (mig.match(/\/\*[\s\S]*?\*\//g) || []).join('\n')

test('Student becomes genuinely optional: student_id and cohort_id drop NOT NULL', () => {
  assert.match(liveSql, /ALTER COLUMN student_id DROP NOT NULL/)
  assert.match(liveSql, /ALTER COLUMN cohort_id\s+DROP NOT NULL/)
  // No sentinel is faked in place of an absent student.
  assert.doesNotMatch(liveSql, /student_id\s*=\s*'0{8}-0{4}/)
})

test('Unit stays required: unit_key NOT NULL is never dropped', () => {
  // The foundation migration made unit_key NOT NULL; this migration must not relax it.
  assert.match(foundation, /unit_key\s+text\s+NOT NULL/)
  assert.doesNotMatch(liveSql, /ALTER COLUMN unit_key DROP NOT NULL/)
})

test('structured columns are added for email, phone, and shift (not overloaded notes)', () => {
  assert.match(liveSql, /ADD COLUMN IF NOT EXISTS proposed_email text/)
  assert.match(liveSql, /ADD COLUMN IF NOT EXISTS proposed_phone text/)
  assert.match(liveSql, /ADD COLUMN IF NOT EXISTS proposed_shift text/)
})

test('shift is pinned to the CANONICAL Preceptor Directory set, so it cannot drift', () => {
  const chk = liveSql.slice(liveSql.indexOf('chk_upn_proposed_shift'))
  for (const v of ['Day', 'Night', 'Mid', 'Variable']) {
    assert.ok(chk.includes(`'${v}'`), `shift check must allow ${v}`)
  }
  // No shift value outside the directory set (guard against 'evening'/'weekend' drift).
  for (const bad of ['evening', 'weekend', 'any']) {
    assert.ok(!chk.includes(`'${bad}'`), `shift check must not allow ${bad}`)
  }
})

test('the change is ADDITIVE and preserves existing rows: no rewrite of data', () => {
  assert.doesNotMatch(liveSql, /UPDATE public\.unit_preceptor_nominations/i)
  assert.doesNotMatch(liveSql, /DELETE FROM public\.unit_preceptor_nominations/i)
  // New columns are nullable (no NOT NULL that would reject grandfathered rows).
  assert.doesNotMatch(liveSql, /proposed_email text NOT NULL/)
  assert.doesNotMatch(liveSql, /proposed_shift text NOT NULL/)
})

test('audit attribution is untouched', () => {
  assert.doesNotMatch(liveSql, /DROP CONSTRAINT[^;]*chk_upn_decision_attribution/)
  assert.doesNotMatch(liveSql, /nominated_by_profile_id/)
})

test('the migration is reversible: a rollback restores NOT NULL and drops the columns', () => {
  assert.match(rollback, /ALTER COLUMN student_id SET NOT NULL/)
  assert.match(rollback, /ALTER COLUMN cohort_id SET NOT NULL/)
  assert.match(rollback, /DROP COLUMN IF EXISTS proposed_email/)
  assert.match(rollback, /DROP COLUMN IF EXISTS proposed_shift/)
  assert.match(rollback, /DROP CONSTRAINT IF EXISTS chk_upn_proposed_shift/)
})

test('it is gated: applied manually only after the preflight is reviewed', () => {
  assert.match(mig, /APPLY MANUALLY/)
  assert.match(mig, /unit_preceptor_nomination_fields_preflight_and_verification\.sql/)
  assert.match(mig, /BEGIN;/)
  assert.match(mig, /COMMIT;/)
})

test('verification checks the columns, the constraint, row preservation, and no write policy', () => {
  assert.match(ver, /proposed_email/)
  assert.match(ver, /chk_upn_proposed_shift/)
  assert.match(ver, /is_nullable/)
  // Confirms server-mediated-only: no permissive INSERT/UPDATE/ALL policy was added.
  assert.match(ver, /pg_policy/)
  assert.match(ver, /polcmd IN \('a', 'w', '\*'\)/)
})
