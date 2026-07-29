// MESSAGES-CORRECTNESS-PHASE0-1: regression guards for the two Phase 0 fixes.
//
// FIX 1 - portal reply authorship: the migration widens messages_post_reply to the
// academic_partner actor kind, persists the VERIFIED caller kind as author_role for
// every portal kind, and allowlists delivery events per kind. The API passes the
// verified actorKind and carries a one-shot pre-migration fallback to the legacy
// student kind so behavior is unchanged until the Owner applies the migration.
//
// FIX 2 - portal row unread: a NEW messages_portal_list_conversations_v2 counts
// unread with author_profile_id <> caller (the global-badge rule); the endpoint
// prefers v2 and falls back to v1 while v2 does not exist.
//
// Run: node --test test/messagesCorrectnessPhase0.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')

const migration = read('supabase/migrations/20260730000001_messages_phase0_correctness.sql')
const service = read('lib/server/messages/conversationService.js')
const replyEndpoint = read('api/portal/messages-reply.js')
const listEndpoint = read('api/portal/messages-list.js')
const verificationDoc = read('docs/security/MESSAGES_PHASE0_VERIFICATION.md')

// ── Migration: messages_post_reply actor kinds and author role ───────────────

test('migration: messages_post_reply accepts all four verified actor kinds', () => {
  assert.match(migration, /p_actor_kind NOT IN \('student', 'staff', 'unit_leader', 'academic_partner'\)/)
})

test('migration: portal author_role is the verified kind, never hardcoded', () => {
  assert.match(migration, /v_author_role := p_actor_kind;/)
  // The old per-branch hardcodes are gone from the new definition.
  assert.doesNotMatch(migration, /v_author_role := 'student'/)
  assert.doesNotMatch(migration, /v_author_role := 'unit_leader'/)
  // Staff branch keeps its explicit role.
  assert.match(migration, /v_author_role\s+:= 'staff'/)
})

test('migration: delivery events are allowlisted per actor kind (all three portal roles)', () => {
  // student may declare the student-to-unit-leader direct event.
  assert.match(migration, /p_actor_kind = 'student' AND p_delivery->>'event_type' = 'student_to_unit_leader_message'/)
  // unit_leader may declare the direct-thread event AND falls back to portal_reply
  // for team threads (the pre-Phase0 function forced unit_leader_message always).
  assert.match(migration, /p_actor_kind = 'unit_leader' AND p_delivery->>'event_type' = 'unit_leader_message'/)
  // Everyone else (including academic_partner) resolves to portal_reply.
  assert.match(migration, /ELSE 'portal_reply'/)
  // academic_partner is never granted a special event: no allowlist arm names it.
  assert.doesNotMatch(migration, /p_actor_kind = 'academic_partner' AND p_delivery/)
})

test('migration: portal authorization stays message_participant_can_send for all portal kinds', () => {
  assert.match(migration, /p_actor_kind IN \('student', 'unit_leader', 'academic_partner'\)/)
  assert.match(migration, /message_participant_can_send\(p_conversation_id, p_actor_profile_id\)/)
  // Staff intervention branch preserved verbatim.
  assert.match(migration, /message_participant_can_read\(p_conversation_id, v_participant\)/)
  assert.match(migration, /staff reply must notify the active conversation participant/)
})

test('migration: append-only is untouched - no UPDATE or DELETE on messages/events, no broadened grants', () => {
  assert.doesNotMatch(migration, /UPDATE public\.messages\b/)
  assert.doesNotMatch(migration, /DELETE FROM public\.messages\b/)
  assert.doesNotMatch(migration, /UPDATE public\.conversation_events\b/)
  assert.doesNotMatch(migration, /DELETE FROM public\.conversation_events\b/)
  assert.doesNotMatch(migration, /GRANT (INSERT|UPDATE|DELETE|ALL)[^)]*ON (TABLE )?public\.(messages|conversation_events)/)
  // Function grants follow the established pattern: reply RPC service-role only,
  // list RPC caller-scoped.
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.messages_post_reply\(uuid, text, uuid, text, jsonb\) FROM PUBLIC, anon, authenticated;/)
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.messages_post_reply\(uuid, text, uuid, text, jsonb\) TO service_role;/)
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.messages_portal_list_conversations_v2\(integer, timestamptz, uuid\) TO authenticated, service_role;/)
})

// ── Migration: v2 list function and unread consistency ───────────────────────

test('migration: v2 row unread rule matches the global badge rule', () => {
  const v2 = migration.slice(migration.indexOf('messages_portal_list_conversations_v2'))
  assert.match(v2, /m\.author_profile_id <> v_me/)
  assert.doesNotMatch(v2, /m\.author_role = 'staff'/)
  // The read pointer stays participant_conversation_reads for the caller.
  assert.match(v2, /participant_conversation_reads r2[\s\S]{0,120}r2\.participant_profile_id = v_me/)
})

test('migration: v1 list function and the global unread count are NOT redefined (rollback + consistency)', () => {
  // Only the v2 name appears; the v1 function is untouched by this migration, and
  // messages_portal_unread_count (already author_profile_id <> me since 20260720000000)
  // is not redefined here - so the global badge rule cannot drift.
  assert.doesNotMatch(migration, /FUNCTION public\.messages_portal_list_conversations\(/)
  assert.doesNotMatch(migration, /CREATE OR REPLACE FUNCTION public\.messages_portal_unread_count/)
  const globalDef = read('supabase/migrations/20260720000000_unit_leader_portal_foundation.sql')
  const globalFn = globalDef.slice(globalDef.indexOf('messages_portal_unread_count'), globalDef.indexOf('messages_portal_unread_count') + 2000)
  assert.match(globalFn, /author_profile_id <> /)
})

// ── API: verified actor kind pass-through with pre-migration bridge ─────────

test('reply endpoint passes the VERIFIED caller actor kind to replyForPortal', () => {
  assert.match(replyEndpoint, /actorKind: caller\.actorKind, conversationId, conversation: ctx/)
  // Direct path already passed it; both paths are now server-derived.
  const directIdx = replyEndpoint.indexOf('replyForPortalDirect(')
  assert.ok(directIdx > -1)
  assert.match(replyEndpoint.slice(directIdx, directIdx + 400), /actorKind: caller\.actorKind/)
  // Never read from the request body.
  assert.doesNotMatch(replyEndpoint, /parsed\.body\.(actor_kind|actorKind|role)/)
})

test('replyForPortal sends the true kind with a one-shot MS400 fallback to student', () => {
  const fn = service.slice(service.indexOf('export async function replyForPortal('), service.indexOf('export async function startConversationForStaff'))
  assert.match(fn, /actorKind = 'student'/)                       // default preserves callers that predate the fix
  assert.match(fn, /p_actor_kind: kind,/)                          // kind is parameterized, not hardcoded
  assert.match(fn, /actorKind !== 'student' && String\(error\.code\) === 'MS400'/)
  assert.match(fn, /callRpc\('student'\)/)                         // exactly one legacy retry
  assert.doesNotMatch(fn, /p_actor_kind: 'student'/)               // the hardcode is gone
  // The start path (student-only endpoint) legitimately keeps its student kind.
  const startPortal = service.slice(service.indexOf('startConversationForPortal'), service.indexOf('// ── Portal: reply'))
  assert.match(startPortal, /p_actor_kind: 'student'/)
})

test('direct thread behavior is preserved: replyForPortalDirect is untouched by the fix', () => {
  const fn = service.slice(service.indexOf('export async function replyForPortalDirect('))
  assert.match(fn, /actorKind === 'unit_leader'\s*\?\s*'unit_leader_message'\s*:\s*'student_to_unit_leader_message'/)
})

// ── API: list endpoint switches to v2 only when it exists ────────────────────

test('list endpoint prefers v2 and falls back to v1 while the migration is unapplied', () => {
  assert.match(listEndpoint, /messages_portal_list_conversations_v2/)
  assert.match(listEndpoint, /PGRST202|42883/)
  const v2Idx = listEndpoint.indexOf('messages_portal_list_conversations_v2')
  const v1Idx = listEndpoint.indexOf("rpc('messages_portal_list_conversations'", v2Idx)
  assert.ok(v1Idx > v2Idx, 'v1 fallback follows the v2 attempt')
})

// ── Historical audit: read-only, deterministic, correction not performed ─────

test('verification doc: audit is read-only and covers both suspected roles', () => {
  assert.match(verificationDoc, /READ-ONLY/)
  assert.match(verificationDoc, /participant_role IN \('unit_leader', 'academic_partner'\)/)
  assert.match(verificationDoc, /count\(DISTINCT cp\.participant_role\) > 1/)  // ambiguity cross-check
  assert.match(verificationDoc, /DO NOT perform the correction/)
  // The audit queries never mutate.
  assert.doesNotMatch(verificationDoc, /\bUPDATE public\.messages\b(?![\s\S]{0,200}would)/)
  const sqlBlocks = [...verificationDoc.matchAll(/```sql([\s\S]*?)```/g)].map(m => m[1]).join('\n')
  // Statement-position check: the 4c grant-inspection query legitimately NAMES
  // privilege strings; no block may BEGIN a mutating statement.
  assert.doesNotMatch(sqlBlocks, /^\s*(UPDATE|DELETE|INSERT|ALTER|DROP|TRUNCATE)\b/im)
})

// ── Regression: all three portal roles are representable end to end ──────────

test('all three portal roles flow from verifier to author_role without translation', () => {
  const auth = read('api/lib/messagesAuth.js')
  for (const kind of ["'student'", "'unit_leader'", "'academic_partner'"]) {
    assert.ok(auth.includes(`actorKind: ${kind}`), `verifier emits ${kind}`)
  }
  // The migration accepts each verifier kind verbatim (no mapping layer).
  assert.match(migration, /'student', 'staff', 'unit_leader', 'academic_partner'/)
})

// ── Refinement: atomicity, gate registration, hardened verification ──────────

test('migration is a single transaction: BEGIN before the first DDL, COMMIT last', () => {
  const beginIdx = migration.indexOf('\nBEGIN;')
  const firstDdl = migration.indexOf('CREATE OR REPLACE FUNCTION')
  const commitIdx = migration.lastIndexOf('COMMIT;')
  assert.ok(beginIdx > -1 && firstDdl > -1 && commitIdx > -1)
  assert.ok(beginIdx < firstDdl, 'BEGIN precedes all DDL')
  assert.ok(commitIdx > migration.lastIndexOf('GRANT EXECUTE'), 'COMMIT follows the last privilege statement')
  assert.equal((migration.match(/^BEGIN;$/gm) || []).length, 1)
  assert.equal((migration.match(/^COMMIT;$/gm) || []).length, 1)
})

test('the migration is registered in the Owner SQL gate with its application order', () => {
  const gate = read('docs/security/OWNER_SQL_GATE.md')
  assert.match(gate, /20260730000001_messages_phase0_correctness\.sql/)
  assert.match(gate, /explicitly transactional \(BEGIN\/COMMIT\)/)
  // The four ordered steps, in order.
  const pre = gate.indexOf('**Prechecks**')
  const mig = gate.indexOf('**Migration**')
  const audit = gate.indexOf('**Historical audit**')
  const post = gate.indexOf('**Postchecks**')
  assert.ok(pre > -1 && pre < mig && mig < audit && audit < post)
  assert.match(gate, /MESSAGES_PHASE0_VERIFICATION\.md/)
})

test('verification targets exact function signatures, never proname alone', () => {
  const sqlBlocks = [...verificationDoc.matchAll(/```sql([\s\S]*?)```/g)].map(m => m[1]).join('\n')
  assert.match(sqlBlocks, /'public\.messages_post_reply\(uuid, text, uuid, text, jsonb\)'::regprocedure/)
  assert.match(sqlBlocks, /'public\.messages_portal_list_conversations_v2\(integer, timestamptz, uuid\)'::regprocedure/)
  assert.match(sqlBlocks, /to_regprocedure\(/)
  // No bare-proname lookups remain in the SQL.
  assert.doesNotMatch(sqlBlocks, /WHERE\s+proname\s*=/)
})

test('verification proves the four-role EXECUTE matrix including PUBLIC exclusion', () => {
  const sqlBlocks = [...verificationDoc.matchAll(/```sql([\s\S]*?)```/g)].map(m => m[1]).join('\n')
  assert.match(sqlBlocks, /has_function_privilege\('authenticated',/)
  assert.match(sqlBlocks, /has_function_privilege\('service_role',/)
  assert.match(sqlBlocks, /has_function_privilege\('anon',/)
  // PUBLIC is checked by enumerating explicit grantees (grantee 0 = PUBLIC).
  assert.match(sqlBlocks, /aclexplode/)
  assert.match(sqlBlocks, /a\.grantee = 0 THEN 'PUBLIC'/)
  assert.match(verificationDoc, /'PUBLIC' row must NOT appear/)
})

test('table-grant checks are filtered to schema public and stay read-only', () => {
  const sqlBlocks = [...verificationDoc.matchAll(/```sql([\s\S]*?)```/g)].map(m => m[1]).join('\n')
  assert.match(sqlBlocks, /table_schema = 'public'[\s\S]{0,120}table_name IN \('messages', 'conversation_events'\)/)
  assert.doesNotMatch(sqlBlocks, /^\s*(UPDATE|DELETE|INSERT|ALTER|DROP|TRUNCATE)\b/im)
})

test('4c targets application roles only and documents expected owner privileges', () => {
  const sqlBlocks = [...verificationDoc.matchAll(/```sql([\s\S]*?)```/g)].map(m => m[1]).join('\n')
  assert.match(sqlBlocks, /grantee IN \('PUBLIC', 'anon', 'authenticated', 'service_role'\)/)
  assert.match(verificationDoc, /owner privileges are EXPECTED/)
})

test('the production application record and corrected deployment requirement are documented', () => {
  assert.match(verificationDoc, /Production application record \(2026-07-29\)/)
  assert.match(verificationDoc, /ZERO mislabeled messages/)
  assert.match(verificationDoc, /authenticated,\s+postgres \(owner, expected\), service_role/)
  // The wrong no-deploy claim is corrected in BOTH documents.
  assert.match(verificationDoc, /that claim was wrong and is\ncorrected here/)
  assert.doesNotMatch(verificationDoc, /no redeploy is needed/)
  const gate = read('docs/security/OWNER_SQL_GATE.md')
  assert.match(gate, /APPLIED IN PRODUCTION 2026-07-29/)
  assert.match(gate, /the migration\nalone is inert to the running app/)
  assert.doesNotMatch(gate, /No code deploy is required around the application/)
})
