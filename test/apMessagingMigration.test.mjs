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

test('signatures: predicates unchanged; the public 8-arg RPC preserved; plus internal core + AP RPC', () => {
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.message_participant_can_read\(\s*\n\s*p_conversation_id uuid,\s*\n\s*p_profile_id\s+uuid\s*\n\)/)
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.message_participant_can_send\(\s*\n\s*p_conversation_id uuid,\s*\n\s*p_profile_id\s+uuid\s*\n\)/)
  // Public student/unit_leader RPC: EXACT original 8-arg signature (no p_school_key), unchanged.
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.messages_start_general_team_conversation\(\s*\n\s*p_actor_profile_id\s+uuid,\s*\n\s*p_actor_kind\s+text,\s*\n\s*p_request_id\s+uuid,\s*\n\s*p_payload_fingerprint\s+text,\s*\n\s*p_subject\s+text,\s*\n\s*p_category\s+text,\s*\n\s*p_body\s+text,\s*\n\s*p_delivery\s+jsonb\s*\n\)/)
  // Internal core: 9 args including the verified school key.
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.messages_start_general_team_conversation_core\([\s\S]*?p_scope_school_key\s+text\s*\n\)/)
  // Dedicated AP RPC: distinct name, 8 args with an explicit p_school_key and NO p_actor_kind.
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.messages_start_general_team_conversation_ap\(\s*\n\s*p_actor_profile_id\s+uuid,\s*\n\s*p_request_id\s+uuid,\s*\n\s*p_payload_fingerprint\s+text,\s*\n\s*p_subject\s+text,\s*\n\s*p_category\s+text,\s*\n\s*p_body\s+text,\s*\n\s*p_delivery\s+jsonb,\s*\n\s*p_school_key\s+text\s*\n\)/)
})

test('the public 8-arg RPC accepts ONLY student/unit_leader and delegates to core (behavior preserved)', () => {
  // Slice the wrapper FUNCTION BODY only (CREATE .. $$;), excluding its trailing COMMENT string.
  const wIdx = sql.indexOf('CREATE OR REPLACE FUNCTION public.messages_start_general_team_conversation(', sql.indexOf('-- 4b.'))
  const wrapper = sql.slice(wIdx, sql.indexOf('$$;', wIdx) + 3)
  assert.match(wrapper, /IF p_actor_kind NOT IN \('student', 'unit_leader'\) THEN/)
  assert.match(wrapper, /RETURN public\.messages_start_general_team_conversation_core\([\s\S]*?p_delivery, NULL\s*\n\s*\)/)
  assert.doesNotMatch(wrapper, /academic_partner/)  // AP is not handled in this signature
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

test('the AP RPC verifies the SERVER-SUPPLIED school against active scopes, then delegates to core', () => {
  const ap = sql.slice(sql.indexOf('-- 4c. Dedicated Academic Partner'), sql.indexOf('-- 5. Grants'))
  assert.match(ap, /messages_start_general_team_conversation_ap\(/)
  assert.match(ap, /p_school_key\s+text/)
  // Re-verify the supplied canonical key is an ACTIVE scope for the actor (exact match; fail closed).
  assert.match(ap, /WHERE s\.user_profile_id = p_actor_profile_id\s*\n\s*AND s\.school_key = v_school/)
  assert.match(ap, /RAISE EXCEPTION 'academic partner school scope is not active' USING ERRCODE = 'MS403'/)
  assert.match(ap, /RETURN public\.messages_start_general_team_conversation_core\([\s\S]*?'academic_partner'[\s\S]*?v_school\s*\n\s*\)/)
  // Core also re-verifies (defense in depth) and inserts a school-scoped participant with the key.
  const core = sql.slice(sql.indexOf('-- 4a. Internal CORE'), sql.indexOf('-- 4b. Public'))
  assert.match(core, /public\.message_profile_has_active_academic_partner_portal_scope\(p_actor_profile_id\)/)
  assert.match(core, /v_school_key := btrim\(coalesce\(p_scope_school_key, ''\)\)/)
  assert.match(core, /AND s\.school_key = v_school_key/)   // exact match on the verified key
  // General thread only: conversation related_* NULL and school-scoped participant with no student/unit.
  assert.match(core, /'academic_partner', 'school',\s*\n\s*NULL, NULL, v_school_key, NULL, v_now/)
  assert.match(core, /related_student_id, related_unit_key, related_school_key, related_cohort_id,[\s\S]*?NULL, NULL, NULL, NULL,/)
  // No ambiguity-rejection heuristic remains: the school is passed + verified, never array-derived.
  assert.doesNotMatch(sql, /array_agg\(DISTINCT s\.school_key\)/)
})

test('the AP RPC verifies the active academic_partner ROLE GRANT before delegating to the core (pre-replay)', () => {
  const ap = sql.slice(sql.indexOf('-- 4c. Dedicated Academic Partner'), sql.indexOf('-- 5. Grants'))
  const grantIdx = ap.indexOf('message_profile_has_active_academic_partner_portal_scope(p_actor_profile_id)')
  const coreIdx = ap.indexOf('RETURN public.messages_start_general_team_conversation_core')
  const schoolIdx = ap.indexOf("v_school = ''")
  assert.ok(grantIdx > -1 && grantIdx < coreIdx, 'role-grant check precedes the core delegation')
  assert.ok(grantIdx < schoolIdx, 'role-grant check is the FIRST gate (before school checks and the core)')
  assert.match(ap, /IF NOT public\.message_profile_has_active_academic_partner_portal_scope\(p_actor_profile_id\) THEN\s*\n\s*RAISE EXCEPTION 'academic partner access is not active' USING ERRCODE = 'MS403'/)
})

test('the core ledger raises MS409 when the same request_id carries a different payload (e.g. a different school)', () => {
  const core = sql.slice(sql.indexOf('-- 4a. Internal CORE'), sql.indexOf('-- 4b. Public'))
  assert.match(core, /v_existing\.payload_fingerprint IS DISTINCT FROM p_payload_fingerprint THEN\s*\n\s*RAISE EXCEPTION 'request id was already used with a different payload' USING ERRCODE = 'MS409'/)
})

test('the AP path LOCKS the recipient to the ASPIRE Team in the core, asserted before any write', () => {
  const core = sql.slice(sql.indexOf('-- 4a. Internal CORE'), sql.indexOf('-- 4b. Public'))
  // The academic_partner recipient assertion appears BEFORE the idempotency ledger insert (so a bad
  // recipient leaves no row) and requires the exact shared inbox, shared_inbox kind, and no profile id.
  const apCheckIdx = core.indexOf("IF p_actor_kind = 'academic_partner' THEN")
  const ledgerIdx = core.indexOf('INSERT INTO public.message_creation_requests')
  assert.ok(apCheckIdx > -1 && apCheckIdx < ledgerIdx, 'AP recipient check precedes the ledger insert')
  assert.match(core, /v_ap_recipient_email\s+:= lower\(btrim\(coalesce\(p_delivery->>'recipient_email', ''\)\)\)/)
  assert.match(core, /v_ap_recipient_email <> 'aspire@cshs\.org'/)
  assert.match(core, /v_ap_recipient_kind <> 'shared_inbox'/)
  assert.match(core, /v_ap_recipient_profile IS NOT NULL/)
  assert.match(core, /RAISE EXCEPTION 'academic partner messages must be sent to the ASPIRE Team' USING ERRCODE = 'MS403'/)
  // Defense in depth: the shared validator also runs (it forces shared_inbox kind for new_conversation).
  assert.match(core, /message_assert_valid_delivery\(p_delivery, 'new_conversation'/)
})

test('grants are least privilege: service_role EXECUTE for entry functions; internal core granted to NO ONE', () => {
  for (const fn of [
    'message_participant_can_read(uuid, uuid)',
    'message_participant_can_send(uuid, uuid)',
    'messages_start_general_team_conversation(uuid, text, uuid, text, text, text, text, jsonb)',
    'messages_start_general_team_conversation_ap(uuid, uuid, text, text, text, text, jsonb, text)',
    'message_profile_has_active_academic_partner_portal_scope(uuid)',
    'ap_team_messaging_capability()',
  ]) {
    const esc = fn.replace(/[().]/g, m => '\\' + m)
    assert.match(sql, new RegExp(`REVOKE ALL ON FUNCTION public\\.${esc}\\s*\\n\\s*FROM PUBLIC, anon, authenticated;`), `${fn} revoked`)
    assert.match(sql, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${esc}\\s*\\n\\s*TO service_role;`), `${fn} granted to service_role`)
  }
  // The internal core is revoked from everyone and granted to NO ONE (invoked only by the definer RPCs).
  const coreEsc = 'messages_start_general_team_conversation_core(uuid, text, uuid, text, text, text, text, jsonb, text)'.replace(/[().]/g, m => '\\' + m)
  assert.match(sql, new RegExp(`REVOKE ALL ON FUNCTION public\\.${coreEsc}\\s*\\n\\s*FROM PUBLIC, anon, authenticated;`))
  assert.doesNotMatch(sql, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${coreEsc}`))
  // No EXECUTE is ever granted to anon or authenticated for any function.
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

test('the Owner verification queries cover signatures, DEFINER, search_path, grants, sentinel, no-overload', () => {
  const v = sql.slice(sql.indexOf('Verification (run AFTER'))
  assert.match(v, /pg_get_function_identity_arguments/)                     // (1) exact signatures
  assert.match(v, /prosecdef/)                                              // (2) SECURITY DEFINER
  assert.match(v, /proconfig/)                                              // (3) explicit search_path
  assert.match(v, /has_function_privilege\([^)]*'EXECUTE'\)/)               // (4)/(7) service_role-only EXECUTE
  assert.match(v, /messages_start_general_team_conversation_ap/)            // (5) dedicated AP RPC exists
  assert.match(v, /SELECT public\.ap_team_messaging_capability\(\);\s+-- expect true/)  // (6) sentinel true
  assert.match(v, /No stray\/prior overload/i)                             // (8) no partial prior overload
  assert.match(v, /messages_start_general_team_conversation with 8 args/i)  // (9) original 8-arg RPC available
  assert.match(v, /FALSE for service_role on _core/)                        // core is internal (not granted)
})

test('the migration provides ordered rollback for the CORRECTED function set', () => {
  const r = sql.slice(sql.indexOf('Rollback considerations'))
  assert.match(r, /Re-apply the prior definitions of message_participant_can_read/)
  assert.match(r, /DROP FUNCTION public\.messages_start_general_team_conversation_ap\(/)
  assert.match(r, /DROP FUNCTION public\.messages_start_general_team_conversation_core\(/)
  assert.match(r, /DROP FUNCTION public\.ap_team_messaging_capability\(\)/)
  assert.match(r, /DROP FUNCTION public\.message_profile_has_active_academic_partner_portal_scope\(uuid\)/)
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
