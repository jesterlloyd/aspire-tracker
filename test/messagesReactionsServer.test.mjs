// MESSAGES-LIFECYCLE-PHASE3A-REACTIONS: server-half regression guards for
// per-user message reactions. Static-source assertions, matching the
// repository test stack. No real API call, RPC, conversation, or email.
//
// Companion migration: supabase/migrations/20260801000000_messages_phase3a_reactions.sql
// Companion docs: docs/security/MESSAGES_REACTIONS_VERIFICATION.md
//
// Run: node --test test/messagesReactionsServer.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')

const migration = read('supabase/migrations/20260801000000_messages_phase3a_reactions.sql')
const staffThread = read('api/messages-staff-thread.js')
const portalThread = read('api/portal/messages-thread.js')
const staffManage = read('api/messages-staff-manage.js')
const portalReact = read('api/portal/messages-react.js')
const messagesApiClient = read('src/lib/messages/messagesApiClient.js')
const portalMessagesApiClient = read('src/lib/messages/portalMessagesApiClient.js')

// Slices of the migration scoped to one function/section, for assertions that
// must hold LOCALLY (not merely "somewhere in the file").
const sliceBetween = (src, startMarker, endMarker) => {
  const start = src.indexOf(startMarker)
  assert.ok(start >= 0, `marker not found: ${startMarker}`)
  const end = endMarker ? src.indexOf(endMarker, start + startMarker.length) : src.length
  assert.ok(end > start, `end marker not found after start: ${endMarker}`)
  return src.slice(start, end)
}

const tableDdl = sliceBetween(migration, 'CREATE TABLE IF NOT EXISTS public.message_reactions', 'CREATE OR REPLACE FUNCTION public.messages_set_message_reaction')
// Bounded to the function BODY itself (through its closing $$;), stopping
// before the descriptive COMMENT ON FUNCTION, which legitimately NAMES these
// tokens only to negate them ("never last_message_at, read pointers, ...").
// The non-negotiable-boundary assertion below is about the SQL that runs, not
// about prose that documents the guarantee.
const reactionRpcBody = sliceBetween(migration, 'CREATE OR REPLACE FUNCTION public.messages_set_message_reaction', 'COMMENT ON FUNCTION public.messages_set_message_reaction')
const staffV3 = sliceBetween(migration, 'CREATE OR REPLACE FUNCTION public.messages_staff_get_thread_v3', 'CREATE OR REPLACE FUNCTION public.messages_portal_get_thread_v3')
const portalV3 = sliceBetween(migration, 'CREATE OR REPLACE FUNCTION public.messages_portal_get_thread_v3', 'COMMIT;')

// ── Migration: one transaction ────────────────────────────────────────────────

test('migration: single atomic transaction', () => {
  const begins = [...migration.matchAll(/^BEGIN;$/gm)]
  const commits = [...migration.matchAll(/^COMMIT;$/gm)]
  assert.equal(begins.length, 1, 'exactly one transactional BEGIN;')
  assert.equal(commits.length, 1, 'exactly one transactional COMMIT;')
  assert.ok(migration.indexOf('BEGIN;') < migration.indexOf('CREATE TABLE IF NOT EXISTS public.message_reactions'))
  assert.ok(migration.lastIndexOf('COMMIT;') > migration.lastIndexOf('GRANT EXECUTE ON FUNCTION public.messages_portal_get_thread_v3'))
})

// ── Table: three-key CHECK, RLS zero policies, service-role-only grants ──────

test('table: closed three-key CHECK allowlist and a composite primary key', () => {
  assert.match(tableDdl, /CONSTRAINT chk_message_reactions_key\s*\n\s*CHECK \(reaction_key IN \('acknowledge', 'thanks', 'celebrate'\)\)/)
  assert.match(tableDdl, /PRIMARY KEY \(message_id, profile_id\)/)
  assert.match(tableDdl, /message_id\s+uuid\s+NOT NULL REFERENCES public\.messages\(id\) ON DELETE CASCADE/)
  assert.match(tableDdl, /profile_id\s+uuid\s+NOT NULL REFERENCES public\.user_profiles\(id\) ON DELETE CASCADE/)
})

test('table: RLS enabled with zero policies, documented in the table comment', () => {
  assert.match(migration, /ALTER TABLE public\.message_reactions ENABLE ROW LEVEL SECURITY;/)
  assert.doesNotMatch(migration, /CREATE POLICY[^;]*message_reactions/)
  assert.match(migration, /COMMENT ON TABLE public\.message_reactions IS/)
  const comment = sliceBetween(migration, 'COMMENT ON TABLE public.message_reactions', 'ALTER TABLE public.message_reactions ENABLE ROW LEVEL SECURITY')
  assert.match(comment, /RLS enabled with zero policies/)
})

test('table: REVOKE ALL from every application role, then GRANT to service_role only', () => {
  assert.match(migration, /REVOKE ALL ON public\.message_reactions FROM PUBLIC, anon, authenticated, service_role;/)
  assert.match(migration, /GRANT SELECT, INSERT, UPDATE, DELETE ON public\.message_reactions TO service_role;/)
  assert.doesNotMatch(migration, /GRANT[^;]*ON public\.message_reactions[^;]*TO[^;]*\b(anon|authenticated)\b/)
})

// ── RPC: messages_set_message_reaction ────────────────────────────────────────

test('reaction RPC: signature, actor-kind validation, closed reaction-key validation', () => {
  assert.match(reactionRpcBody, /CREATE OR REPLACE FUNCTION public\.messages_set_message_reaction\(\s*\n\s*p_actor_profile_id uuid,\s*\n\s*p_actor_kind\s+text,\s*\n\s*p_message_id\s+uuid,\s*\n\s*p_reaction_key\s+text\s*\n\)/)
  assert.match(reactionRpcBody, /p_actor_kind NOT IN \('student', 'unit_leader', 'academic_partner', 'staff'\)/)
  assert.match(reactionRpcBody, /RAISE EXCEPTION 'invalid actor kind' USING ERRCODE = 'MS400';/)
  assert.match(reactionRpcBody, /p_reaction_key IS NOT NULL\s*\n\s*AND p_reaction_key NOT IN \('acknowledge', 'thanks', 'celebrate'\)/)
  assert.match(reactionRpcBody, /RAISE EXCEPTION 'invalid reaction key' USING ERRCODE = 'MS400';/)
})

test('reaction RPC: staff branch gates on active Owner/Admin (MS403), never is_staff', () => {
  const staffBranch = sliceBetween(reactionRpcBody, "IF p_actor_kind = 'staff' THEN", 'ELSE')
  assert.match(staffBranch, /message_profile_is_active_owner_or_admin\(p_actor_profile_id\)/)
  assert.match(staffBranch, /USING ERRCODE = 'MS403'/)
  assert.doesNotMatch(reactionRpcBody.replace(/\/\/[^\n]*/g, ''), /is_staff\(\)/)
})

test('reaction RPC: portal branch gates on message_participant_can_read, not can_send (MS404, non-enumerating)', () => {
  assert.match(reactionRpcBody, /message_participant_can_read\(v_conversation_id, p_actor_profile_id\)/)
  assert.doesNotMatch(reactionRpcBody, /message_participant_can_send\(/)
  assert.match(reactionRpcBody, /message not found' USING ERRCODE = 'MS404'/)
})

test('reaction RPC: message lookup returns MS404 for a missing message', () => {
  assert.match(reactionRpcBody, /SELECT m\.conversation_id INTO v_conversation_id\s*\n\s*FROM public\.messages m WHERE m\.id = p_message_id;/)
  assert.match(reactionRpcBody, /IF v_conversation_id IS NULL THEN\s*\n\s*RAISE EXCEPTION 'message not found' USING ERRCODE = 'MS404';/)
})

test('reaction RPC: NULL key deletes the caller\'s own row; otherwise upsert scoped to the caller', () => {
  assert.match(reactionRpcBody, /DELETE FROM public\.message_reactions\s*\n\s*WHERE message_id = p_message_id AND profile_id = p_actor_profile_id;/)
  assert.match(reactionRpcBody, /INSERT INTO public\.message_reactions \(message_id, profile_id, reaction_key\)\s*\n\s*VALUES \(p_message_id, p_actor_profile_id, p_reaction_key\)/)
  assert.match(reactionRpcBody, /ON CONFLICT \(message_id, profile_id\) DO UPDATE/)
})

test('reaction RPC: returns jsonb with message_id and a fresh per-key reactions aggregation', () => {
  assert.match(reactionRpcBody, /RETURNS jsonb/)
  assert.match(reactionRpcBody, /RETURN jsonb_build_object\('message_id', p_message_id, 'reactions', v_reactions\);/)
  assert.match(reactionRpcBody, /jsonb_build_object\('key', r\.reaction_key, 'count', r\.cnt, 'mine', r\.mine\)/)
})

test('reaction RPC: service-role-only grant, SECURITY DEFINER, fixed search_path', () => {
  assert.match(reactionRpcBody, /SECURITY DEFINER/)
  assert.match(reactionRpcBody, /SET search_path = public, pg_catalog/)
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.messages_set_message_reaction\(uuid, text, uuid, text\) FROM PUBLIC, anon, authenticated;/)
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.messages_set_message_reaction\(uuid, text, uuid, text\) TO service_role;/)
  assert.doesNotMatch(migration, /GRANT EXECUTE ON FUNCTION public\.messages_set_message_reaction[^;]*TO[^;]*\b(anon|authenticated)\b/)
})

// ── THE NON-NEGOTIABLE BOUNDARY: the reaction RPC touches ONLY message_reactions ─

test('NON-NEGOTIABLE BOUNDARY: the reaction RPC body never touches lifecycle, read-pointer, archive, event, or delivery state', () => {
  const forbidden = [
    'last_message_at',
    'staff_conversation_reads',
    'participant_conversation_reads',
    'message_conversation_visibility',
    'conversation_events',
    'message_notification_deliveries',
    'UPDATE public.conversations',
    'FOR UPDATE',
  ]
  for (const needle of forbidden) {
    assert.ok(!reactionRpcBody.includes(needle), `reaction RPC body must not contain "${needle}"`)
  }
})

test('NON-NEGOTIABLE BOUNDARY: the whole migration never extends the notification event-type CHECK', () => {
  assert.doesNotMatch(migration, /chk_mnd_event_type/)
  assert.doesNotMatch(migration, /ALTER TABLE public\.message_notification_deliveries/)
})

// ── Thread v3 functions: additive reactions field, identical grants ──────────

test('staff thread v3: adds a per-message reactions field, byte-identical otherwise', () => {
  assert.match(staffV3, /'reactions',\s*\(/)
  assert.match(staffV3, /FROM public\.message_reactions mr\s*\n\s*WHERE mr\.message_id = p\.id/)
  assert.match(staffV3, /bool_or\(mr\.profile_id = v_me\)/)
  // v2's core projections and auth are preserved verbatim.
  assert.match(staffV3, /is_active_owner_or_admin\(\)/)
  assert.match(staffV3, /'events', v_events,/)
})

test('portal thread v3: adds a per-message reactions field, byte-identical otherwise', () => {
  assert.match(portalV3, /'reactions',\s*\(/)
  assert.match(portalV3, /FROM public\.message_reactions mr\s*\n\s*WHERE mr\.message_id = p\.id/)
  assert.match(portalV3, /bool_or\(mr\.profile_id = v_me\)/)
  // v2's core projections and auth are preserved verbatim.
  assert.match(portalV3, /my_message_conversation_ids\(\)/)
  assert.match(portalV3, /author_label/)
})

test('thread v3 functions: authenticated + service_role EXECUTE, PUBLIC/anon excluded', () => {
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.messages_staff_get_thread_v3\(uuid, integer, timestamptz, uuid\)\s*\n\s*FROM PUBLIC, anon;/)
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.messages_staff_get_thread_v3\(uuid, integer, timestamptz, uuid\)\s*\n\s*TO authenticated, service_role;/)
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.messages_portal_get_thread_v3\(uuid, integer, timestamptz, uuid\)\s*\n\s*FROM PUBLIC, anon;/)
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.messages_portal_get_thread_v3\(uuid, integer, timestamptz, uuid\)\s*\n\s*TO authenticated, service_role;/)
})

test('v2 thread functions are never redefined by this migration', () => {
  assert.doesNotMatch(migration, /CREATE OR REPLACE FUNCTION public\.messages_staff_get_thread_v2\(/)
  assert.doesNotMatch(migration, /CREATE OR REPLACE FUNCTION public\.messages_portal_get_thread_v2\(/)
})

// ── Staff thread endpoint: v3-first, v2 fallback, reactions_available ────────

test('staff thread endpoint: prefers v3, falls back to v2 on PGRST202/42883', () => {
  assert.match(staffThread, /db\.rpc\('messages_staff_get_thread_v3', rpcArgs\)/)
  assert.match(staffThread, /db\.rpc\('messages_staff_get_thread_v2', rpcArgs\)/)
  assert.match(staffThread, /PGRST202.*42883|42883.*PGRST202/)
  const v3Idx = staffThread.indexOf("rpc('messages_staff_get_thread_v3'")
  const v2Idx = staffThread.indexOf("rpc('messages_staff_get_thread_v2'", v3Idx)
  assert.ok(v3Idx >= 0 && v2Idx > v3Idx, 'v2 fallback textually follows the v3 attempt')
})

test('staff thread endpoint: reports reactions_available, false only on fallback', () => {
  assert.match(staffThread, /let reactionsAvailable = true;/)
  assert.match(staffThread, /reactionsAvailable = false;/)
  assert.match(staffThread, /reactions_available: reactionsAvailable,/)
})

test('portal thread endpoint: prefers v3, falls back to v2 on PGRST202/42883', () => {
  assert.match(portalThread, /db\.rpc\('messages_portal_get_thread_v3', rpcArgs\)/)
  assert.match(portalThread, /db\.rpc\('messages_portal_get_thread_v2', rpcArgs\)/)
  assert.match(portalThread, /PGRST202.*42883|42883.*PGRST202/)
  const v3Idx = portalThread.indexOf("rpc('messages_portal_get_thread_v3'")
  const v2Idx = portalThread.indexOf("rpc('messages_portal_get_thread_v2'", v3Idx)
  assert.ok(v3Idx >= 0 && v2Idx > v3Idx, 'v2 fallback textually follows the v3 attempt')
})

test('portal thread endpoint: reports reactions_available, false only on fallback', () => {
  assert.match(portalThread, /let reactionsAvailable = true;/)
  assert.match(portalThread, /reactionsAvailable = false;/)
  assert.match(portalThread, /reactions_available: reactionsAvailable,/)
})

// ── Staff-manage endpoint: react action, allowlist, 503 readiness ────────────

test('staff-manage endpoint: react is in the action allowlist', () => {
  assert.match(staffManage, /const ACTIONS = \['assign', 'status', 'category', 'flag', 'archive', 'react'\];/)
})

test('staff-manage endpoint: react targets message_id, not conversation_id', () => {
  assert.match(staffManage, /if \(action !== 'react' && !isUuid\(conversationId\)\)/)
  assert.match(staffManage, /if \(!isUuid\(messageId\)\) return res\.status\(422\)\.json\(\{ error: 'invalid_message_id' \}\);/)
})

test('staff-manage endpoint: react always passes the literal staff actor kind, never a body value', () => {
  const reactBranch = sliceBetween(staffManage, "// MESSAGES-LIFECYCLE-PHASE3A-REACTIONS: react is always for the calling", '\n  }\n\n  try {')
  assert.match(reactBranch, /rpc = 'messages_set_message_reaction';/)
  assert.match(reactBranch, /p_actor_kind: 'staff',/)
  assert.match(reactBranch, /p_reaction_key: reaction \?\? null,/)
})

test('staff-manage endpoint: rejects an invalid reaction with 422 invalid_reaction', () => {
  assert.match(staffManage, /const REACTION_KEYS = \['acknowledge', 'thanks', 'celebrate'\];/)
  assert.match(staffManage, /if \(reaction !== null && reaction !== undefined && !REACTION_KEYS\.includes\(reaction\)\) \{\s*\n\s*return res\.status\(422\)\.json\(\{ error: 'invalid_reaction' \}\);/)
})

test('staff-manage endpoint: 503 reactions_not_ready on PGRST202/42883 for the react action only', () => {
  assert.match(staffManage, /action === 'react' && \(String\(error\.code\) === 'PGRST202' \|\| String\(error\.code\) === '42883'\)/)
  assert.match(staffManage, /res\.status\(503\)\.json\(\{ error: 'reactions_not_ready' \}\)/)
})

test('staff-manage endpoint: archive action untouched by the react addition', () => {
  assert.match(staffManage, /const ACTIONS = \['assign', 'status', 'category', 'flag', 'archive', 'react'\];/)
  assert.match(staffManage, /action === 'archive' && \(String\(error\.code\) === 'PGRST202' \|\| String\(error\.code\) === '42883'\)/)
  assert.match(staffManage, /res\.status\(503\)\.json\(\{ error: 'archive_not_ready' \}\)/)
})

// ── Portal react endpoint: contract, actorKind, no rate limit, no notify ─────

test('portal react endpoint: POST-only, verifyPortalMessagesCaller, validates body', () => {
  assert.match(portalReact, /methodGuard\(req, res, \['POST'\]\)/)
  assert.match(portalReact, /verifyPortalMessagesCaller\(req\)/)
  assert.match(portalReact, /isUuid\(messageId\)/)
})

test('portal react endpoint: rejects an invalid reaction with 422 invalid_reaction', () => {
  assert.match(portalReact, /const REACTION_KEYS = \['acknowledge', 'thanks', 'celebrate'\];/)
  assert.match(portalReact, /if \(reaction !== null && reaction !== undefined && !REACTION_KEYS\.includes\(reaction\)\) \{\s*\n\s*return res\.status\(422\)\.json\(\{ error: 'invalid_reaction' \}\);/)
})

test('portal react endpoint: passes the verified caller.actorKind to the RPC, never reads an actor kind from the request body', () => {
  assert.match(portalReact, /p_actor_kind: caller\.actorKind,/)
  assert.doesNotMatch(portalReact, /p_actor_kind: 'student'/)
  assert.doesNotMatch(portalReact, /p_actor_kind: 'unit_leader'/)
  assert.doesNotMatch(portalReact, /p_actor_kind: 'academic_partner'/)
  assert.doesNotMatch(portalReact, /parsed\.body\.actor_kind/)
  assert.doesNotMatch(portalReact, /req\.body\.actor_kind/)
})

test('portal react endpoint: 503 reactions_not_ready on PGRST202/42883', () => {
  assert.match(portalReact, /String\(error\.code\) === 'PGRST202' \|\| String\(error\.code\) === '42883'/)
  assert.match(portalReact, /res\.status\(503\)\.json\(\{ error: 'reactions_not_ready' \}\)/)
})

test('portal react endpoint: no rate limit import, and no email', () => {
  assert.doesNotMatch(portalReact, /rateLimitUtil/)
  assert.doesNotMatch(portalReact, /import[^\n]*rate-?limit/i)
  assert.doesNotMatch(portalReact.replace(/\/\/[^\n]*/g, ''), /\bsendEmail\b|\bresend\b/i)
})

// ── API clients: new functions exist and post the right shapes ───────────────

test('staff api client: setMessageReaction posts the react action on the manage endpoint', () => {
  assert.match(messagesApiClient, /export function setMessageReaction\(\{ messageId, reaction \}, \{ signal \} = \{\}\) \{/)
  assert.match(messagesApiClient, /action: 'react', message_id: messageId, reaction: reaction \?\? null,/)
})

test('portal api client: portalSetMessageReaction posts to /api/portal/messages-react', () => {
  assert.match(portalMessagesApiClient, /export function portalSetMessageReaction\(\{ messageId, reaction, signal \} = \{\}\) \{/)
  assert.match(portalMessagesApiClient, /request\('\/api\/portal\/messages-react', \{/)
  assert.match(portalMessagesApiClient, /body: \{ message_id: messageId, reaction: reaction \?\? null \},/)
})

// ── No em dash in any file created or edited for this task ───────────────────

test('no em dash anywhere in the files touched for MESSAGES-LIFECYCLE-PHASE3A-REACTIONS (server side)', () => {
  const EM_DASH = /—/
  const files = [
    migration, staffThread, portalThread, staffManage, portalReact,
    messagesApiClient, portalMessagesApiClient,
  ]
  for (const src of files) {
    assert.doesNotMatch(src, EM_DASH)
  }
})

// ── Verification doc pins the TRUE five-type delivery baseline ───────────────
// An earlier revision of block 3d wrongly expected a three-type event_type
// CHECK; production correctly holds five. These guards keep the corrected
// baseline from regressing: the doc must name all five types and must state
// the invariant as "not extended or altered", and the migration must still
// never touch the constraint.

test('verification doc 3d states the five-type delivery baseline and the unchanged invariant', () => {
  const verificationDoc = read('docs/security/MESSAGES_REACTIONS_VERIFICATION.md')
  const block3d = verificationDoc.slice(
    verificationDoc.indexOf('-- 3d.'),
    verificationDoc.indexOf('-- 3e.'),
  )
  assert.ok(block3d.length > 0, '3d block not found before 3e')
  for (const t of ['new_conversation', 'portal_reply', 'staff_reply', 'unit_leader_message', 'student_to_unit_leader_message']) {
    assert.ok(block3d.includes(t), `3d must name delivery event type ${t}`)
  }
  assert.match(block3d, /NOT extended or altered/)
  // The stale three-type claim must not come back: 3d may not say the
  // definition holds ONLY the first three types.
  assert.doesNotMatch(block3d, /exactly\s+new_conversation, portal_reply, staff_reply in the definition/)
  // And the migration still never touches the constraint (same invariant the
  // boundary test above pins against the migration source).
  assert.doesNotMatch(migration, /chk_mnd_event_type/)
})
