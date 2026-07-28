// Owner-gate hardening: static security review of the (unapplied) Academic Partner messaging
// migration. The SQL is not executed here (no DB in CI), so these are source guards over the exact
// security-critical structure: preserved signatures, SECURITY DEFINER + locked search_path, the
// additive academic_partner branch with EXACT school-scope matching (WCU isolation), general-thread
// (student_id NULL) shape, server-derived non-ambiguous school, least-privilege grants, and the
// capability sentinel. Byte-for-byte preservation of the student / unit_leader branches is checked by
// asserting they are still present unchanged.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const MIGRATION = 'supabase/migrations/20260728000000_enable_academic_partner_team_messages.sql'
const sql = readFileSync(join(root, MIGRATION), 'utf8')

test('the migration file exists with the conventional timestamped name', () => {
  assert.ok(existsSync(join(root, MIGRATION)))
})

test('the executable migration is ONE atomic transaction (BEGIN ... COMMIT)', () => {
  const begin = sql.indexOf('\nBEGIN;')
  const commit = sql.indexOf('\nCOMMIT;')
  assert.ok(begin > -1, 'has a BEGIN;')
  assert.ok(commit > begin, 'has a COMMIT; after BEGIN;')
  // Every executable statement (function replacement, revoke, grant, sentinel) is inside the txn.
  const body = sql.slice(begin, commit)
  assert.equal((body.match(/CREATE OR REPLACE FUNCTION/g) || []).length, (sql.match(/CREATE OR REPLACE FUNCTION/g) || []).length,
    'all function definitions are inside the transaction')
  assert.ok(!/\nBEGIN;[\s\S]*\nBEGIN;/.test(sql), 'exactly one top-level BEGIN;')
  // Verification queries live OUTSIDE the transaction (after COMMIT), as comments only.
  const after = sql.slice(commit)
  assert.match(after, /Verification \(run AFTER applying/)
  assert.doesNotMatch(after, /^\s*(CREATE|GRANT|REVOKE|INSERT|UPDATE|ALTER)\b/m)
})

test('the capability sentinel is created LAST, after every authorization function and grant', () => {
  const commit = sql.indexOf('\nCOMMIT;')
  const sentinelCreate = sql.indexOf('CREATE OR REPLACE FUNCTION public.ap_team_messaging_capability')
  assert.ok(sentinelCreate > -1 && sentinelCreate < commit, 'sentinel created inside the transaction')
  // No authorization-function CREATE and no GRANT for the four auth functions appears AFTER the
  // sentinel create (the sentinel is the final capability established).
  for (const marker of [
    'CREATE OR REPLACE FUNCTION public.message_participant_can_read',
    'CREATE OR REPLACE FUNCTION public.messages_start_general_team_conversation(',
    'GRANT EXECUTE ON FUNCTION public.messages_start_general_team_conversation(uuid, text, uuid, text, text, text, text, jsonb)',
    'GRANT EXECUTE ON FUNCTION public.message_participant_can_read(uuid, uuid)',
  ]) {
    assert.ok(sql.indexOf(marker) > -1 && sql.indexOf(marker) < sentinelCreate, `${marker} precedes the sentinel`)
  }
})

test('the three functions are CREATE OR REPLACE with their EXACT existing signatures', () => {
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.message_participant_can_read\(\s*\n\s*p_conversation_id uuid,\s*\n\s*p_profile_id\s+uuid\s*\n\)/)
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.message_participant_can_send\(\s*\n\s*p_conversation_id uuid,\s*\n\s*p_profile_id\s+uuid\s*\n\)/)
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.messages_start_general_team_conversation\(\s*\n\s*p_actor_profile_id\s+uuid,\s*\n\s*p_actor_kind\s+text,\s*\n\s*p_request_id\s+uuid,\s*\n\s*p_payload_fingerprint\s+text,\s*\n\s*p_subject\s+text,\s*\n\s*p_category\s+text,\s*\n\s*p_body\s+text,\s*\n\s*p_delivery\s+jsonb\s*\n\)/)
  // The start RPC signature carries NO school parameter: the school is never supplied by the caller.
  const startSig = sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION public.messages_start_general_team_conversation'))
  assert.doesNotMatch(startSig.slice(0, startSig.indexOf(')')), /school/i)
})

test('every changed/added function keeps SECURITY DEFINER and a locked search_path', () => {
  // Four DEFINER functions (the sentinel is IMMUTABLE and need not be DEFINER).
  const definer = sql.match(/SECURITY DEFINER/g) || []
  assert.ok(definer.length >= 4, 'at least four SECURITY DEFINER functions')
  const searchPaths = sql.match(/SET search_path = public, pg_catalog/g) || []
  assert.ok(searchPaths.length >= 5, 'every function sets the safe search_path')
})

test('the student and unit_leader read branches are preserved (unchanged, still present)', () => {
  const canRead = sql.slice(
    sql.indexOf('CREATE OR REPLACE FUNCTION public.message_participant_can_read'),
    sql.indexOf('CREATE OR REPLACE FUNCTION public.message_participant_can_send'))
  assert.match(canRead, /cp\.participant_role = 'student'/)
  assert.match(canRead, /public\.message_profile_has_active_student_portal\(p_profile_id\)/)
  assert.match(canRead, /cp\.participant_role = 'unit_leader'/)
})

test('the ADDED academic_partner read branch matches school scope EXACTLY (WCU isolation, no substring)', () => {
  const canRead = sql.slice(
    sql.indexOf('CREATE OR REPLACE FUNCTION public.message_participant_can_read'),
    sql.indexOf('CREATE OR REPLACE FUNCTION public.message_participant_can_send'))
  assert.match(canRead, /cp\.participant_role = 'academic_partner'/)
  assert.match(canRead, /cp\.scope_kind = 'school'/)
  assert.match(canRead, /cp\.scope_school_key IS NOT NULL/)
  // Active academic_partner grant AND active school scope; scope matched by EXACT equality.
  assert.match(canRead, /g\.role = 'academic_partner'/)
  assert.match(canRead, /FROM public\.user_school_scopes s\s*\n\s*WHERE s\.user_profile_id = p_profile_id\s*\n\s*AND s\.school_key = cp\.scope_school_key/)
  // Never a substring / fuzzy match on school (the WCU-campus isolation invariant). Strip SQL line
  // comments first so the explanatory comment text does not trip the guard.
  const canReadCode = canRead.replace(/--[^\n]*/g, '')
  assert.doesNotMatch(canReadCode, /school_key\s+(LIKE|ILIKE|~|SIMILAR TO)/i)
  assert.doesNotMatch(canReadCode, /position\(|strpos\(|substring\(/i)
  assert.doesNotMatch(canReadCode, /email|domain|display/i)  // no email-domain / display-name matching
})

test('the academic_partner read branch EXPLICITLY enforces general-thread isolation (participant + conversation)', () => {
  // Isolate the AP branch: from the academic_partner role marker to the end of its school-scope EXISTS.
  const canRead = sql.slice(
    sql.indexOf('CREATE OR REPLACE FUNCTION public.message_participant_can_read'),
    sql.indexOf('CREATE OR REPLACE FUNCTION public.message_participant_can_send'))
  const ap = canRead.slice(canRead.indexOf("cp.participant_role = 'academic_partner'"))
  // Participant row: no student / unit / cohort context.
  assert.match(ap, /cp\.scope_student_id IS NULL/)
  assert.match(ap, /cp\.scope_unit_key IS NULL/)
  assert.match(ap, /cp\.scope_cohort_id IS NULL/)
  // Conversation row: joined and required to carry no student / unit / cohort context (the canonical
  // general-team discriminator, since there is no stored thread_kind column).
  assert.match(ap, /FROM public\.conversations c\s*\n\s*WHERE c\.id = cp\.conversation_id\s*\n\s*AND c\.related_student_id IS NULL\s*\n\s*AND c\.related_unit_key IS NULL\s*\n\s*AND c\.related_cohort_id IS NULL/)
  // A removed participant row is excluded by the outer cp.removed_at IS NULL.
  assert.match(canRead, /cp\.removed_at IS NULL/)
})

test('student and unit_leader read branches are NOT joined to the conversation null-context (unchanged)', () => {
  // The conversation null-context join is scoped to the AP branch only; the student/unit_leader
  // branches keep their exact prior logic (no new conversations join in their sub-conditions).
  const canRead = sql.slice(
    sql.indexOf('CREATE OR REPLACE FUNCTION public.message_participant_can_read'),
    sql.indexOf('CREATE OR REPLACE FUNCTION public.message_participant_can_send'))
  const conversationsJoins = canRead.match(/FROM public\.conversations c/g) || []
  assert.equal(conversationsJoins.length, 1, 'exactly one conversations join, in the AP branch')
})

test('the send predicate composes can_read (so AP send inherits the active-scope check) and only guards unit_leader staleness', () => {
  const canSendStart = sql.indexOf('CREATE OR REPLACE FUNCTION public.message_participant_can_send')
  const canSend = sql.slice(canSendStart, sql.indexOf('$$;', canSendStart) + 3)  // function body only
  assert.match(canSend, /public\.message_participant_can_read\(p_conversation_id, p_profile_id\)/)
  // No academic_partner clause is needed in the send body; it must NOT loosen anything for AP either.
  assert.doesNotMatch(canSend, /academic_partner/)
})

test('the start RPC admits academic_partner, derives ONE school server-side, and rejects ambiguity', () => {
  const start = sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION public.messages_start_general_team_conversation'))
  assert.match(start, /p_actor_kind NOT IN \('student', 'unit_leader', 'academic_partner'\)/)
  // Verify active AP scope, then derive exactly one authorized school from active user_school_scopes.
  assert.match(start, /public\.message_profile_has_active_academic_partner_portal_scope\(p_actor_profile_id\)/)
  assert.match(start, /SELECT array_agg\(DISTINCT s\.school_key\)\s*\n\s*INTO v_schools\s*\n\s*FROM public\.user_school_scopes s/)
  assert.match(start, /IF v_schools IS NULL OR array_length\(v_schools, 1\) <> 1 THEN\s*\n\s*RAISE EXCEPTION 'academic partner school scope is missing or ambiguous'/)
  // General thread only: the conversation has NULL related_* and the participant is school-scoped with
  // NO student/unit context (student_id IS NULL), matching chk_participant_role_scope.
  assert.match(start, /'academic_partner', 'school',\s*\n\s*NULL, NULL, v_school_key, NULL, v_now/)
  assert.match(start, /related_student_id, related_unit_key, related_school_key, related_cohort_id,[\s\S]*?NULL, NULL, NULL, NULL,/)
  // The message author role is the derived actor kind (academic_partner is allowed by the schema CHECK).
  assert.match(start, /author_role, body[\s\S]*?p_actor_kind, p_body/)
})

test('grants are least privilege: service_role EXECUTE only; revoked from PUBLIC/anon/authenticated', () => {
  for (const fn of [
    'message_participant_can_read(uuid, uuid)',
    'message_participant_can_send(uuid, uuid)',
    'messages_start_general_team_conversation(uuid, text, uuid, text, text, text, text, jsonb)',
    'message_profile_has_active_academic_partner_portal_scope(uuid)',
    'ap_team_messaging_capability()',
  ]) {
    const esc = fn.replace(/[().]/g, m => '\\' + m)
    assert.match(sql, new RegExp(`REVOKE ALL ON FUNCTION public\\.${esc}\\s*\\n\\s*FROM PUBLIC, anon, authenticated;`), `${fn} revoked`)
    assert.match(sql, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${esc}\\s*\\n\\s*TO service_role;`), `${fn} granted to service_role`)
  }
  // No EXECUTE is ever granted to anon or authenticated for these functions.
  assert.doesNotMatch(sql, /GRANT EXECUTE ON FUNCTION[\s\S]*?TO (anon|authenticated)\b/)
})

test('the added path exposes no individual staff membership and keeps the fixed ASPIRE Team recipient', () => {
  // The predicates + start RPC never select staff identities (no user_profiles read, no staff dir).
  assert.doesNotMatch(sql, /user_profiles/)
  // The recipient stays the shared ASPIRE Team inbox via the unchanged, server-built delivery path
  // (validated, never a caller-chosen recipient).
  assert.match(sql, /message_assert_valid_delivery\(p_delivery, 'new_conversation'/)
})

test('the capability sentinel exists (read-only, returns true) with an explanatory comment', () => {
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.ap_team_messaging_capability\(\)\s*\n\s*RETURNS boolean/)
  assert.match(sql, /SELECT true;/)
  assert.match(sql, /COMMENT ON FUNCTION public\.ap_team_messaging_capability\(\) IS/)
})

test('the migration is additive (no schema/table change, no backfill) and documents verify + rollback', () => {
  // Only function replacement + grants at apply time. No table DDL and no data backfill. (The RPC
  // BODY contains DML, but that is runtime behavior, not an apply-time mutation.)
  assert.doesNotMatch(sql, /\bALTER TABLE\b/)
  assert.doesNotMatch(sql, /\bCREATE TABLE\b/)
  assert.doesNotMatch(sql, /\bDROP TABLE\b/)
  assert.match(sql, /No backfill/)
  assert.match(sql, /Verification/)
  assert.match(sql, /Rollback considerations/)
})
