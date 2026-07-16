// MESSAGES-PHASE1: static guard for the ASPIRE Messages Phase 1 schema and
// authorization foundation migration. Verifies the six tables, RLS, the two
// SECURITY DEFINER helpers, the exact constraints, the student-only participant
// authorization, the append-only privilege posture, and the version-one
// boundary (no future-role authorization, no is_staff, no related-context
// authorization, no portal base-table read policy).
//
// Run: node --test test/messagesPhase1SchemaFoundation.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const MIGRATION = join(here, '../supabase/migrations/20260716000000_messages_phase1_schema_foundation.sql')
const VERIFICATION = join(here, '../db/audit/messages_phase1_verification.sql')
const sql = readFileSync(MIGRATION, 'utf8')
const verify = readFileSync(VERIFICATION, 'utf8')

// Executable SQL with line and inline comments removed, so guards against
// forbidden tokens (is_staff, etc.) test the code, not the documentation that
// deliberately names what it avoids.
const executableSql = sql.replace(/--[^\n]*/g, '')

const TABLES = [
  'conversations', 'conversation_participants', 'messages',
  'staff_conversation_reads', 'participant_conversation_reads', 'conversation_events',
]
const HELPERS = ['is_active_owner_or_admin', 'my_message_conversation_ids']

// The policy section is everything from the first CREATE POLICY to COMMIT.
const policySection = sql.slice(sql.indexOf('CREATE POLICY'), sql.indexOf('\nCOMMIT;'))
// The participant helper body is from its CREATE to the REVOKE that follows it.
const helperStart = sql.indexOf('CREATE OR REPLACE FUNCTION public.my_message_conversation_ids')
const participantHelper = sql.slice(helperStart, sql.indexOf('REVOKE ALL ON FUNCTION public.my_message_conversation_ids'))
const postCommit = sql.slice(sql.indexOf('\nCOMMIT;'))

test('ASPIRE Messages Phase 1 migration', async (t) => {
  await t.test('is atomic: explicit BEGIN and COMMIT around the DDL', () => {
    assert.match(sql, /^BEGIN;/m)
    assert.match(sql, /^COMMIT;/m)
    assert.ok(sql.indexOf('\nBEGIN;') < sql.indexOf('CREATE TABLE'), 'BEGIN before first DDL')
    assert.ok(sql.indexOf('\nCOMMIT;') > sql.lastIndexOf('CREATE POLICY'), 'COMMIT after last policy')
  })

  await t.test('creates the six Messages tables', () => {
    for (const tbl of TABLES) {
      assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${tbl}\\b`), `missing table ${tbl}`)
    }
  })

  await t.test('enables RLS on all six tables', () => {
    for (const tbl of TABLES) {
      assert.match(sql, new RegExp(`ALTER TABLE public\\.${tbl}\\s+ENABLE ROW LEVEL SECURITY`), `RLS not enabled on ${tbl}`)
    }
  })

  await t.test('creates both helpers as SECURITY DEFINER with fixed search_path', () => {
    for (const fn of HELPERS) {
      assert.match(sql, new RegExp(`CREATE OR REPLACE FUNCTION public\\.${fn}\\b`), `missing helper ${fn}`)
    }
    const secdef = sql.match(/SECURITY DEFINER/g) || []
    assert.ok(secdef.length >= 2, `expected >=2 SECURITY DEFINER, found ${secdef.length}`)
    const sp = sql.match(/SET search_path = public, pg_catalog/g) || []
    assert.ok(sp.length >= 2, `expected >=2 fixed search_path, found ${sp.length}`)
  })

  await t.test('helpers revoke PUBLIC/anon and grant EXECUTE to authenticated + service_role', () => {
    for (const fn of HELPERS) {
      assert.match(sql, new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}\\(\\)\\s+FROM PUBLIC, anon;`), `missing REVOKE for ${fn}`)
      assert.match(sql, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}\\(\\)\\s+TO authenticated, service_role;`), `missing EXECUTE grant for ${fn}`)
    }
  })

  await t.test('staff access uses is_active_owner_or_admin(), never is_staff()', () => {
    assert.doesNotMatch(executableSql, /is_staff/, 'Messages SQL must not reference is_staff')
    // The four staff-readable surfaces each have an is_active_owner_or_admin SELECT policy.
    for (const tbl of ['conversations', 'conversation_participants', 'messages', 'conversation_events']) {
      assert.match(
        sql,
        new RegExp(`CREATE POLICY "[^"]+" ON public\\.${tbl}\\s+FOR SELECT TO authenticated\\s+USING \\(public\\.is_active_owner_or_admin\\(\\)\\)`),
        `missing active-owner/admin SELECT policy on ${tbl}`,
      )
    }
    // The existing is_owner_or_admin() helper is not redefined here.
    assert.doesNotMatch(sql, /CREATE OR REPLACE FUNCTION public\.is_owner_or_admin\b/, 'must not redefine is_owner_or_admin')
  })

  await t.test('the new helper requires an ACTIVE owner/admin (is_active check)', () => {
    assert.match(sql, /role IN \('owner', 'admin'\)\s*\n\s*AND COALESCE\(is_active, true\) = true/, 'is_active_owner_or_admin must require active profile')
  })

  await t.test('uses the three-identity subquery convention, never profile_id = auth.uid()', () => {
    assert.match(sql, /\(SELECT id FROM public\.user_profiles WHERE auth_user_id = auth\.uid\(\)\)/, 'missing auth_user_id subquery convention')
    assert.doesNotMatch(sql, /profile_id\s*=\s*auth\.uid\(\)/, 'must never compare a profile_id directly to auth.uid()')
  })

  await t.test('no policy authorizes through related student/unit/school/cohort context', () => {
    assert.doesNotMatch(policySection, /related_student_id/, 'policy must not reference related_student_id')
    assert.doesNotMatch(policySection, /related_unit_key/, 'policy must not reference related_unit_key')
    assert.doesNotMatch(policySection, /related_school_key/, 'policy must not reference related_school_key')
    assert.doesNotMatch(policySection, /related_cohort_id/, 'policy must not reference related_cohort_id')
  })

  await t.test('participant helper authorizes STUDENT scope only, with the canonical active predicate', () => {
    assert.match(participantHelper, /participant_role = 'student'/, 'helper must require student participant role')
    assert.match(participantHelper, /scope_kind = 'student'/, 'helper must require student scope kind')
    // No future-role branch in the helper body.
    assert.doesNotMatch(participantHelper, /unit_leader|academic_partner|preceptor/, 'helper must not authorize future roles')
    // Canonical active predicate on the student role grant.
    assert.match(participantHelper, /revoked_at IS NULL/, 'missing revoked_at predicate')
    assert.match(participantHelper, /starts_at <= now\(\)/, 'missing starts_at predicate')
    assert.match(participantHelper, /expires_at IS NULL OR g\.expires_at > now\(\)/, 'missing expires_at predicate')
    // Active student link matched to the participant scope.
    assert.match(participantHelper, /user_student_links/, 'helper must check an active student link')
    assert.match(participantHelper, /l\.student_id = p\.scope_student_id/, 'helper must match the link to scope_student_id')
    // No related-context authorization inside the helper.
    assert.doesNotMatch(participantHelper, /related_/, 'helper must not reference related_* context')
  })

  await t.test('subject is trimmed and 3 to 120 characters', () => {
    assert.match(sql, /CHECK \(subject = btrim\(subject\)\)/, 'missing subject trim constraint')
    assert.match(sql, /CHECK \(char_length\(btrim\(subject\)\) BETWEEN 3 AND 120\)/, 'missing subject length constraint')
  })

  await t.test('body is non-blank and at most 5000 characters', () => {
    assert.match(sql, /CHECK \(char_length\(btrim\(body\)\) >= 1\)/, 'missing body non-blank constraint')
    assert.match(sql, /CHECK \(char_length\(body\) <= 5000\)/, 'missing body max-length constraint')
  })

  await t.test('status set is exactly open, waiting, resolved', () => {
    assert.match(sql, /status IN \('open', 'waiting', 'resolved'\)/, 'wrong status set')
  })

  await t.test('created_by_role and author_role reserve the five-role shape', () => {
    assert.match(sql, /created_by_role IN \('student', 'unit_leader', 'academic_partner', 'preceptor', 'staff'\)/, 'wrong created_by_role set')
    assert.match(sql, /author_role IN \('student', 'unit_leader', 'academic_partner', 'preceptor', 'staff'\)/, 'wrong author_role set')
  })

  await t.test('participant_role reserves the four portal roles (no staff author here)', () => {
    assert.match(sql, /participant_role IN \('student', 'unit_leader', 'academic_partner', 'preceptor'\)/, 'wrong participant_role set')
  })

  await t.test('category value set is exactly the seven approved categories', () => {
    for (const cat of [
      'Placement and matching', 'Scheduling', 'Onboarding requirements',
      'Clinical rotation support', 'Preceptor support', 'Portal or account help',
      'General question',
    ]) {
      assert.ok(sql.includes(`'${cat}'`), `missing category ${cat}`)
    }
  })

  await t.test('scope_kind set and role-to-scope shape checks are present', () => {
    assert.match(sql, /scope_kind IN \('student', 'unit', 'school'\)/, 'wrong scope_kind set')
    assert.match(sql, /chk_participant_role_scope/, 'missing role-to-scope constraint')
    // Each reserved role appears in the role-to-scope check.
    for (const role of ['student', 'preceptor', 'unit_leader', 'academic_partner']) {
      assert.ok(sql.includes(`participant_role = '${role}'`), `role-to-scope missing ${role}`)
    }
  })

  await t.test('event_type set is exactly the seven lifecycle events', () => {
    for (const ev of [
      'created', 'status_change', 'assignment_change', 'resolved',
      'reopened', 'flagged', 'participant_access_changed',
    ]) {
      assert.ok(sql.includes(`'${ev}'`), `missing event_type ${ev}`)
    }
  })

  await t.test('messages has no edit, delete, or system column', () => {
    assert.doesNotMatch(sql, /\bedited_at\b/, 'messages must not define edited_at')
    assert.doesNotMatch(sql, /\bdeleted_at\b/, 'messages must not define deleted_at')
    assert.doesNotMatch(sql, /\bis_system\b/, 'messages must not define is_system')
  })

  await t.test('deny-by-default revocation is present for all six tables', () => {
    assert.match(sql, /REVOKE ALL ON public\.conversations,[\s\S]*?FROM PUBLIC, anon, authenticated, service_role;/, 'missing deny-by-default REVOKE')
  })

  await t.test('authenticated receives SELECT only, never a mutation grant', () => {
    assert.match(sql, /GRANT SELECT ON public\.conversations\s+TO authenticated;/, 'authenticated SELECT grant missing')
    assert.doesNotMatch(sql, /GRANT[^;]*\b(INSERT|UPDATE|DELETE|TRUNCATE)\b[^;]*TO authenticated/i, 'authenticated must not get a write grant')
  })

  await t.test('messages and conversation_events are append-only for service_role (SELECT, INSERT only)', () => {
    assert.match(sql, /GRANT SELECT, INSERT\s+ON public\.messages\s+TO service_role;/, 'messages service_role grant must be SELECT, INSERT only')
    assert.match(sql, /GRANT SELECT, INSERT\s+ON public\.conversation_events\s+TO service_role;/, 'conversation_events service_role grant must be SELECT, INSERT only')
  })

  await t.test('no role ever receives DELETE or TRUNCATE', () => {
    assert.doesNotMatch(sql, /GRANT[^;]*\b(DELETE|TRUNCATE)\b[^;]*TO (anon|authenticated|service_role)/i, 'no DELETE/TRUNCATE grant permitted')
  })

  await t.test('no portal base-table read policy in Phase 1', () => {
    // The participant helper exists but is never used to expose a base table.
    assert.doesNotMatch(policySection, /my_message_conversation_ids/, 'no policy may use the participant helper in Phase 1')
    // participant_conversation_reads has no policy at all.
    assert.doesNotMatch(sql, /CREATE POLICY "[^"]+" ON public\.participant_conversation_reads/, 'participant_conversation_reads must have no policy in Phase 1')
  })

  await t.test('creates no data and embeds no catalog verification queries', () => {
    assert.doesNotMatch(sql, /\bINSERT INTO\b/, 'migration must not INSERT any data')
    assert.doesNotMatch(sql, /information_schema|pg_policies|pg_get_constraintdef|pg_get_functiondef/, 'verification queries belong in db/audit, not the migration')
    // Nothing executable after COMMIT (comment only).
    assert.doesNotMatch(postCommit, /\b(SELECT|CREATE|ALTER|GRANT|REVOKE|INSERT)\b\s/, 'no statements may follow COMMIT')
  })
})

test('ASPIRE Messages Phase 1 verification file', async (t) => {
  await t.test('is clearly labeled read-only and run-after-apply', () => {
    assert.match(verify, /READ-ONLY VERIFICATION QUERIES\.\s*\n--\s*RUN ONLY AFTER THE MIGRATION HAS BEEN APPLIED\./, 'missing read-only label')
  })

  await t.test('checks every table, RLS, helper security, and privilege posture', () => {
    for (const tbl of TABLES) assert.ok(verify.includes(tbl), `verification missing table ${tbl}`)
    for (const fn of HELPERS) assert.ok(verify.includes(fn), `verification missing helper ${fn}`)
    assert.match(verify, /prosecdef/, 'verification must check SECURITY DEFINER')
    assert.match(verify, /role_table_grants/, 'verification must check table grants')
    assert.match(verify, /is_staff/, 'verification must guard against is_staff')
    assert.match(verify, /related_student_id|related_cohort_id/, 'verification must guard related-context authorization')
  })
})
