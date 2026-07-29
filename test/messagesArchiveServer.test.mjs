// MESSAGES-ARCHIVE-P1: server-half regression guards for per-user conversation
// archive. Static-source assertions, matching the repository test stack. No
// real API call, RPC, conversation, or email.
//
// Companion migration: supabase/migrations/20260730000002_messages_phase1_archive.sql
// Companion docs: docs/security/MESSAGES_ARCHIVE_VERIFICATION.md,
//                 docs/security/OWNER_SQL_GATE.md
//
// Run: node --test test/messagesArchiveServer.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

const migration = read('supabase/migrations/20260730000002_messages_phase1_archive.sql')
const staffList = read('api/messages-staff-list.js')
const staffManage = read('api/messages-staff-manage.js')
const portalList = read('api/portal/messages-list.js')
const portalArchive = read('api/portal/messages-archive.js')
const verificationDoc = read('docs/security/MESSAGES_ARCHIVE_VERIFICATION.md')
const gateDoc = read('docs/security/OWNER_SQL_GATE.md')

// Slices of the migration scoped to one function/section, for assertions that
// must hold LOCALLY (not merely "somewhere in the file").
const sliceBetween = (src, startMarker, endMarker) => {
  const start = src.indexOf(startMarker)
  assert.ok(start >= 0, `marker not found: ${startMarker}`)
  const end = endMarker ? src.indexOf(endMarker, start + startMarker.length) : src.length
  assert.ok(end > start, `end marker not found after start: ${endMarker}`)
  return src.slice(start, end)
}

const tableDdl = sliceBetween(migration, 'CREATE TABLE IF NOT EXISTS public.message_conversation_visibility', 'CREATE OR REPLACE FUNCTION public.messages_set_conversation_archived')
const rpcBody = sliceBetween(migration, 'CREATE OR REPLACE FUNCTION public.messages_set_conversation_archived', 'CREATE OR REPLACE FUNCTION public.messages_post_reply')
const replyBody = sliceBetween(migration, 'CREATE OR REPLACE FUNCTION public.messages_post_reply', 'CREATE OR REPLACE FUNCTION public.messages_staff_list_conversations_v3')
const staffV3 = sliceBetween(migration, 'CREATE OR REPLACE FUNCTION public.messages_staff_list_conversations_v3', 'CREATE OR REPLACE FUNCTION public.messages_portal_list_conversations_v3')
const portalV3 = sliceBetween(migration, 'CREATE OR REPLACE FUNCTION public.messages_portal_list_conversations_v3', 'CREATE OR REPLACE FUNCTION public.messages_staff_unread_count')
const staffUnread = sliceBetween(migration, 'CREATE OR REPLACE FUNCTION public.messages_staff_unread_count', 'CREATE OR REPLACE FUNCTION public.messages_portal_unread_count')
const portalUnread = sliceBetween(migration, 'CREATE OR REPLACE FUNCTION public.messages_portal_unread_count', 'COMMIT;')

// ── Migration: one transaction ────────────────────────────────────────────────

test('migration: single atomic transaction', () => {
  const begins = [...migration.matchAll(/^BEGIN;$/gm)]
  const commits = [...migration.matchAll(/^COMMIT;$/gm)]
  assert.equal(begins.length, 1, 'exactly one transactional BEGIN;')
  assert.equal(commits.length, 1, 'exactly one transactional COMMIT;')
  assert.ok(migration.indexOf('BEGIN;') < migration.indexOf('CREATE TABLE IF NOT EXISTS public.message_conversation_visibility'))
  assert.ok(migration.lastIndexOf('COMMIT;') > migration.lastIndexOf('GRANT EXECUTE ON FUNCTION public.messages_portal_unread_count'))
})

// ── Table: shape, cascade, PK, RLS, service-role-only grants ─────────────────

test('table: minimal columns with CASCADE and a composite primary key', () => {
  assert.match(tableDdl, /profile_id\s+uuid\s+NOT NULL REFERENCES public\.user_profiles\(id\) ON DELETE CASCADE/)
  assert.match(tableDdl, /conversation_id\s+uuid\s+NOT NULL REFERENCES public\.conversations\(id\) ON DELETE CASCADE/)
  assert.match(tableDdl, /archived_at\s+timestamptz\s+NOT NULL/)
  assert.match(tableDdl, /PRIMARY KEY \(profile_id, conversation_id\)/)
})

test('table: RLS enabled with zero policies (service-role only)', () => {
  assert.match(migration, /ALTER TABLE public\.message_conversation_visibility ENABLE ROW LEVEL SECURITY;/)
  assert.doesNotMatch(migration, /CREATE POLICY[^;]*message_conversation_visibility/)
})

test('table: REVOKE ALL from every application role, then GRANT to service_role only', () => {
  assert.match(migration, /REVOKE ALL ON public\.message_conversation_visibility FROM PUBLIC, anon, authenticated, service_role;/)
  assert.match(migration, /GRANT SELECT, INSERT, UPDATE, DELETE ON public\.message_conversation_visibility TO service_role;/)
  assert.doesNotMatch(migration, /GRANT[^;]*ON public\.message_conversation_visibility[^;]*TO[^;]*\b(anon|authenticated)\b/)
})

test('table: an index supports the conversation-first EXISTS probes and the MAX(archived_at) race-fix probe', () => {
  assert.match(migration, /CREATE INDEX IF NOT EXISTS idx_message_conversation_visibility_conversation\s*\n\s*ON public\.message_conversation_visibility \(conversation_id, archived_at DESC\);/)
})

test('table: is documented as per-user UI state, not part of the append-only record', () => {
  assert.match(migration, /COMMENT ON TABLE public\.message_conversation_visibility IS/)
  const comment = sliceBetween(migration, 'COMMENT ON TABLE public.message_conversation_visibility', 'CREATE INDEX')
  assert.match(comment, /NOT part of the append-only/)
})

// ── RPC: messages_set_conversation_archived ───────────────────────────────────

test('RPC: signature and kind validation', () => {
  assert.match(rpcBody, /CREATE OR REPLACE FUNCTION public\.messages_set_conversation_archived\(\s*\n\s*p_actor_profile_id uuid,\s*\n\s*p_actor_kind\s+text,\s*\n\s*p_conversation_id\s+uuid,\s*\n\s*p_archived\s+boolean\s*\n\)/)
  assert.match(rpcBody, /p_actor_kind NOT IN \('student', 'unit_leader', 'academic_partner', 'staff'\)/)
  assert.match(rpcBody, /RAISE EXCEPTION 'invalid actor kind' USING ERRCODE = 'MS400';/)
})

test('RPC: staff branch gates on active Owner/Admin (MS403), never is_staff', () => {
  const staffBranch = sliceBetween(rpcBody, "IF p_actor_kind = 'staff' THEN", 'ELSE')
  assert.match(staffBranch, /message_profile_is_active_owner_or_admin\(p_actor_profile_id\)/)
  assert.match(staffBranch, /USING ERRCODE = 'MS403'/)
  assert.doesNotMatch(strip(rpcBody), /is_staff\(\)/)
})

test('RPC: portal branch gates on message_participant_can_read, not can_send (MS404, non-enumerating)', () => {
  assert.match(rpcBody, /message_participant_can_read\(p_conversation_id, p_actor_profile_id\)/)
  assert.doesNotMatch(rpcBody, /message_participant_can_send\(p_conversation_id, p_actor_profile_id\)/)
  assert.match(rpcBody, /conversation not found' USING ERRCODE = 'MS404'/)
})

test('RPC: writes and deletes ONLY the caller\'s own row (one-user isolation)', () => {
  // Both the archive INSERT and the unarchive DELETE key off p_actor_profile_id,
  // never any other profile id.
  assert.match(rpcBody, /VALUES \(p_actor_profile_id, p_conversation_id, v_archived_at\)/)
  assert.match(rpcBody, /DELETE FROM public\.message_conversation_visibility\s*\n\s*WHERE profile_id = p_actor_profile_id AND conversation_id = p_conversation_id;/)
  assert.match(rpcBody, /ON CONFLICT \(profile_id, conversation_id\) DO UPDATE SET archived_at = v_archived_at;/)
})

test('RPC: read-pointer advance is server-derived and never moves backward (GREATEST)', () => {
  assert.match(rpcBody, /SELECT COALESCE\(max\(m\.created_at\), v_archived_at\) INTO v_read_at\s*\n\s*FROM public\.messages m WHERE m\.conversation_id = p_conversation_id;/)
  assert.match(rpcBody, /GREATEST\(public\.staff_conversation_reads\.last_read_at, v_read_at\)/)
  assert.match(rpcBody, /GREATEST\(public\.participant_conversation_reads\.last_read_at, v_read_at\)/)
  // A client-supplied timestamp is never accepted.
  assert.doesNotMatch(rpcBody, /p_archived_at\b/)
  assert.doesNotMatch(rpcBody, /p_last_read_at/)
})

test('RPC (race fix): locks the conversation row before deriving archived_at', () => {
  assert.match(rpcBody, /SELECT last_message_at INTO v_last_message_at\s*\n\s*FROM public\.conversations WHERE id = p_conversation_id FOR UPDATE;/)
  assert.match(rpcBody, /IF NOT FOUND THEN\s*\n\s*RAISE EXCEPTION 'conversation not found' USING ERRCODE = 'MS404';/)
  assert.match(rpcBody, /v_archived_at := GREATEST\(clock_timestamp\(\), v_last_message_at\);/)
  // The lock and derivation happen BEFORE the archive/unarchive write.
  const lockIdx = rpcBody.indexOf('FOR UPDATE;')
  const writeIdx = rpcBody.indexOf('INSERT INTO public.message_conversation_visibility')
  assert.ok(lockIdx >= 0 && writeIdx > lockIdx, 'the row lock precedes the visibility write')
})

test('RPC: reads/writes the correct pointer table per actor kind', () => {
  assert.match(rpcBody, /INSERT INTO public\.staff_conversation_reads \(staff_profile_id, conversation_id, last_read_at\)/)
  assert.match(rpcBody, /INSERT INTO public\.participant_conversation_reads \(participant_profile_id, conversation_id, last_read_at\)/)
})

test('RPC: returns jsonb with the archived flag', () => {
  assert.match(rpcBody, /RETURNS jsonb/)
  assert.match(rpcBody, /RETURN jsonb_build_object\('archived', p_archived\);/)
})

test('RPC: no email and no conversation_events insert (per-user visibility is not evented)', () => {
  assert.doesNotMatch(rpcBody, /INSERT INTO public\.conversation_events/)
  assert.doesNotMatch(rpcBody, /message_notification_deliveries/)
  assert.doesNotMatch(strip(rpcBody), /\bsendEmail\b|\bresend\b/i)
})

test('RPC: service-role-only grant, SECURITY DEFINER, fixed search_path', () => {
  assert.match(rpcBody, /SECURITY DEFINER/)
  assert.match(rpcBody, /SET search_path = public, pg_catalog/)
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.messages_set_conversation_archived\(uuid, text, uuid, boolean\) FROM PUBLIC, anon, authenticated;/)
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.messages_set_conversation_archived\(uuid, text, uuid, boolean\) TO service_role;/)
})

// ── messages_post_reply (race fix): redefined in the SAME migration ──────────
// Base = the Phase 0 definition (20260730000001). Only the row lock and the
// v_now derivation change; everything else must remain byte-identical.

test('reply RPC (race fix): the conversation row is locked before any timestamp is derived', () => {
  assert.match(replyBody, /SELECT status INTO v_status FROM public\.conversations WHERE id = p_conversation_id FOR UPDATE;/)
  assert.match(replyBody, /IF v_status IS NULL THEN\s*\n\s*RAISE EXCEPTION 'conversation not found' USING ERRCODE = 'MS404';/)
  // The old, unlocked Phase 0 select is gone.
  assert.doesNotMatch(replyBody, /SELECT status INTO v_status FROM public\.conversations WHERE id = p_conversation_id;\n/)
})

test('reply RPC (race fix): v_now is not initialized from now() in DECLARE', () => {
  const declareBlock = sliceBetween(replyBody, 'DECLARE', 'BEGIN')
  assert.match(declareBlock, /v_now\s+timestamptz;/)
  assert.doesNotMatch(declareBlock, /v_now\s+timestamptz\s*:=\s*now\(\)/)
})

test('reply RPC (race fix): v_now is GREATEST(clock, last_message_at+1us, MAX(archived_at)+1us), derived after the lock', () => {
  assert.match(replyBody, /v_now := GREATEST\(\s*\n\s*clock_timestamp\(\),\s*\n\s*\(SELECT c\.last_message_at \+ interval '1 microsecond' FROM public\.conversations c WHERE c\.id = p_conversation_id\),\s*\n\s*\(SELECT COALESCE\(MAX\(v\.archived_at\), '-infinity'::timestamptz\) \+ interval '1 microsecond'\s*\n\s*FROM public\.message_conversation_visibility v WHERE v\.conversation_id = p_conversation_id\)\s*\n\s*\);/)
  // The derivation happens strictly after the lock, and strictly before the
  // first authorization branch that uses v_now-independent logic.
  const lockIdx = replyBody.indexOf('FOR UPDATE;')
  const deriveIdx = replyBody.indexOf('v_now := GREATEST(')
  assert.ok(lockIdx >= 0 && deriveIdx > lockIdx, 'v_now is derived after the row lock')
})

test('reply RPC (race fix): every other line matches the Phase 0 definition verbatim', () => {
  // Authorization, reopen, message insert, read pointer, and delivery all keep
  // using v_now exactly as Phase 0 did.
  assert.match(replyBody, /message_participant_can_send\(p_conversation_id, p_actor_profile_id\)/)
  assert.match(replyBody, /v_author_role := p_actor_kind;/)
  assert.match(replyBody, /VALUES \(p_conversation_id, 'reopened', p_actor_profile_id, 'resolved', 'open', v_now\);/)
  assert.match(replyBody, /VALUES \(p_conversation_id, p_actor_profile_id, v_author_role, p_body, v_now\)/)
  assert.match(replyBody, /SET last_message_at = v_now, updated_at = v_now/)
  assert.match(replyBody, /ON CONFLICT \(participant_profile_id, conversation_id\) DO UPDATE SET last_read_at = v_now;/)
  assert.match(replyBody, /ON CONFLICT \(staff_profile_id, conversation_id\) DO UPDATE SET last_read_at = v_now;/)
  assert.match(replyBody, /'queued', v_now,/)
})

test('reply RPC (race fix): service-role-only grant restated, comment documents the fix', () => {
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.messages_post_reply\(uuid, text, uuid, text, jsonb\) FROM PUBLIC, anon, authenticated;/)
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.messages_post_reply\(uuid, text, uuid, text, jsonb\) TO service_role;/)
  assert.match(migration, /COMMENT ON FUNCTION public\.messages_post_reply\(uuid, text, uuid, text, jsonb\) IS/)
})

test('migration header documents the race, the fix, and the reply-path audit', () => {
  assert.match(migration, /RACE SAFETY/)
  assert.match(migration, /TRANSACTION-START time/)
  assert.match(migration, /REPLY-PATH AUDIT/)
  assert.match(migration, /messages_start_\* functions only ever\s*\n-- create BRAND-NEW conversations/)
})

// ── Concurrency simulation: models the Owner's exact clock-skew scenario ─────
// Pure JS model of the two serialized critical sections, exactly as the SQL
// computes them. This does not touch a database; it proves the ARITHMETIC the
// migration relies on is correct under the reported interleaving.

function simulateArchive({ clock, lastMessageAt }) {
  // archived_at := GREATEST(clock_timestamp(), last_message_at)
  return Math.max(clock, lastMessageAt)
}

function simulateReply({ clock, lastMessageAt, maxArchivedAt }) {
  // v_now := GREATEST(clock_timestamp(), last_message_at + 1us, max(archived_at) + 1us)
  const EPSILON = 1e-6 // 1 microsecond, modeled in the same time unit as the inputs
  return Math.max(clock, lastMessageAt + EPSILON, (maxArchivedAt ?? -Infinity) + EPSILON)
}

function isArchived({ archivedAt, lastMessageAt }) {
  return archivedAt !== null && archivedAt >= lastMessageAt
}

function unreadCount({ authorProfileId, recipientProfileId, messageCreatedAt, recipientReadPointer, archived }) {
  const authoredByOther = authorProfileId !== recipientProfileId
  const isNew = messageCreatedAt > recipientReadPointer
  return authoredByOther && isNew && !archived ? 1 : 0
}

test('concurrency simulation: reply committing after an earlier-clock archive still wins (Owner scenario)', () => {
  // Owner's scenario: a reply transaction BEGINS at t=0 (old wall clock reading
  // captured at transaction start), an archive transaction runs and commits at
  // t=2, and the reply transaction only then acquires the row lock at t=3 - but
  // WITH A WALL CLOCK READING EARLIER THAN THE ARCHIVE's (clock skew: this
  // session's clock_timestamp() reads 1, even though the archive's commit
  // reflects "real" time 2). The bare comparison would have compared the
  // reply's stale now()=0 against archived_at=2 and left the thread archived;
  // the fix's GREATEST(...) against the LOCKED, already-committed
  // last_message_at/archived_at must still make the reply win.
  const lastMessageAtBeforeArchive = 0 // the conversation's last_message_at when the archive ran
  const archivedAt = simulateArchive({ clock: 2, lastMessageAt: lastMessageAtBeforeArchive })
  assert.equal(archivedAt, 2, 'archive locks in at the later of clock/last_message_at')

  // The reply's transaction now proceeds (it had to wait for the archive's
  // lock to release), reads the conversation's CURRENT last_message_at (still
  // lastMessageAtBeforeArchive, since the archive never advances it) and the
  // CURRENT max(archived_at) (now 2, from the archive that just committed).
  const replyLastMessageAt = simulateReply({
    clock: 1, // clock skew: this session's clock reads BEHIND the archive's effective time
    lastMessageAt: lastMessageAtBeforeArchive,
    maxArchivedAt: archivedAt,
  })

  // (1) The reply's derived timestamp is strictly greater than the archive.
  assert.ok(replyLastMessageAt > archivedAt, 'reply is ordered strictly after the archive')

  // (2) The derived rule now reads Active (archived_at >= last_message_at is FALSE).
  assert.equal(isArchived({ archivedAt, lastMessageAt: replyLastMessageAt }), false, 'thread is Active after the reply')

  // (3) The recipient (the profile who archived, now receiving a fresh message)
  // sees exactly one unread message.
  const recipient = 'archiver-profile'
  const sender = 'other-profile'
  const recipientUnread = unreadCount({
    authorProfileId: sender,
    recipientProfileId: recipient,
    messageCreatedAt: replyLastMessageAt,
    recipientReadPointer: lastMessageAtBeforeArchive,
    archived: isArchived({ archivedAt, lastMessageAt: replyLastMessageAt }),
  })
  assert.equal(recipientUnread, 1, 'the recipient sees the new message as unread')

  // (4) The sender never counts their own message as unread.
  const senderUnread = unreadCount({
    authorProfileId: sender,
    recipientProfileId: sender,
    messageCreatedAt: replyLastMessageAt,
    recipientReadPointer: replyLastMessageAt, // the sender's own pointer advances with their send
    archived: isArchived({ archivedAt, lastMessageAt: replyLastMessageAt }),
  })
  assert.equal(senderUnread, 0, 'the sender is never notified of their own message')
})

test('concurrency simulation: benign ordering (archive AFTER the reply commits) stays archived', () => {
  // The reply commits first; last_message_at moves forward. The archive then
  // runs against the ALREADY-UPDATED last_message_at and locks in at or after
  // it, so the caller's intent (archive this, including the reply they just
  // saw) is honored - it is not automatically un-archived.
  const replyLastMessageAt = simulateReply({ clock: 5, lastMessageAt: 0, maxArchivedAt: null })
  assert.ok(replyLastMessageAt > 0)

  const archivedAt = simulateArchive({ clock: 6, lastMessageAt: replyLastMessageAt })
  assert.ok(archivedAt >= replyLastMessageAt, 'archive locks in at or after the reply it can already see')
  assert.equal(isArchived({ archivedAt, lastMessageAt: replyLastMessageAt }), true, 'thread stays archived - user intent preserved')
})

// ── Derived rule: present in both v3 list functions and both unread counts ───

const DERIVED_RULE = /archived_at >= c\.last_message_at/

test('derived rule appears in messages_staff_list_conversations_v3', () => {
  assert.match(staffV3, DERIVED_RULE)
  assert.match(staffV3, /p_view\s+text\s+DEFAULT 'active'/)
  assert.match(staffV3, /v_view NOT IN \('active', 'archived', 'all'\)/)
  assert.match(staffV3, /AS is_archived/)
})

test('derived rule appears in messages_portal_list_conversations_v3', () => {
  assert.match(portalV3, DERIVED_RULE)
  assert.match(portalV3, /p_view\s+text\s+DEFAULT 'active'/)
  assert.match(portalV3, /v_view NOT IN \('active', 'archived', 'all'\)/)
  assert.match(portalV3, /AS is_archived/)
})

test('derived rule appears in the redefined messages_staff_unread_count', () => {
  assert.match(staffUnread, DERIVED_RULE)
  assert.match(staffUnread, /AND NOT EXISTS \(/)
})

test('derived rule appears in the redefined messages_portal_unread_count', () => {
  assert.match(portalUnread, DERIVED_RULE)
  assert.match(portalUnread, /AND NOT EXISTS \(/)
})

test('v3 bodies are otherwise copied verbatim from v2 (same core projections/filters)', () => {
  // Staff v3 keeps the exact v2 filter-mode machinery.
  assert.match(staffV3, /v_amode NOT IN \('any', 'unassigned', 'specific'\)/)
  assert.match(staffV3, /v_cmode NOT IN \('any', 'uncategorized', 'specific'\)/)
  assert.match(staffV3, /participant_access_active/)
  // Portal v3 keeps the exact Phase 0 per-row unread rule.
  assert.match(portalV3, /m\.author_profile_id <> v_me/)
  assert.match(portalV3, /my_message_conversation_ids\(\)/)
})

test('unread-count redefinitions change nothing else in their bodies', () => {
  // Staff: still gated on active Owner/Admin, still author_role <> 'staff'.
  assert.match(staffUnread, /is_active_owner_or_admin\(\)/)
  assert.match(staffUnread, /m\.author_role <> 'staff'/)
  // Portal: still scoped to my_message_conversation_ids and author_profile_id <> me.
  assert.match(portalUnread, /my_message_conversation_ids\(\)/)
  assert.match(portalUnread, /m\.author_profile_id <> public\.portal_profile_id\(\)/)
})

// ── v1/v2 are never redefined by this migration ───────────────────────────────

test('v1/v2 of every list RPC are not touched by this migration', () => {
  assert.doesNotMatch(migration, /CREATE OR REPLACE FUNCTION public\.messages_staff_list_conversations\(/)
  assert.doesNotMatch(migration, /CREATE OR REPLACE FUNCTION public\.messages_staff_list_conversations_v2\(/)
  assert.doesNotMatch(migration, /CREATE OR REPLACE FUNCTION public\.messages_portal_list_conversations\(/)
  assert.doesNotMatch(migration, /CREATE OR REPLACE FUNCTION public\.messages_portal_list_conversations_v2\(/)
})

// ── Grants: v3 functions carry the standard read-RPC grant ───────────────────

test('v3 functions: authenticated + service_role EXECUTE, PUBLIC/anon excluded', () => {
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.messages_staff_list_conversations_v3\([^)]*\)\s*\n\s*FROM PUBLIC, anon;/)
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.messages_staff_list_conversations_v3\([^)]*\)\s*\n\s*TO authenticated, service_role;/)
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.messages_portal_list_conversations_v3\([^)]*\) FROM PUBLIC, anon;/)
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.messages_portal_list_conversations_v3\([^)]*\) TO authenticated, service_role;/)
})

// ── Append-only invariant: untouched ──────────────────────────────────────────

test('append-only: no UPDATE/DELETE on messages or conversation_events, no new grants on them', () => {
  assert.doesNotMatch(migration, /UPDATE public\.messages\b/)
  assert.doesNotMatch(migration, /DELETE FROM public\.messages\b/)
  assert.doesNotMatch(migration, /UPDATE public\.conversation_events\b/)
  assert.doesNotMatch(migration, /DELETE FROM public\.conversation_events\b/)
  // Word-boundary guarded: must not false-positive on the (intended) FUNCTION
  // grants for messages_set_conversation_archived / messages_staff_list_*_v3 /
  // messages_portal_list_*_v3, whose names start with "messages" too.
  assert.doesNotMatch(migration, /GRANT[^;]*ON (TABLE )?public\.(messages|conversation_events)(?![\w])/)
})

test('no em dash anywhere in the migration or the verification doc', () => {
  const EM_DASH = /—/
  assert.doesNotMatch(migration, EM_DASH)
  assert.doesNotMatch(verificationDoc, EM_DASH)
})

// ── Staff-list endpoint: view validation, v3-first with v2 fallback ──────────

test('staff-list endpoint: view query param defaults to active and rejects invalid values', () => {
  assert.match(staffList, /const VIEWS = \['active', 'archived', 'all'\];/)
  assert.match(staffList, /const view = req\.query\?\.view === undefined \? 'active' : req\.query\.view;/)
  assert.match(staffList, /if \(!VIEWS\.includes\(view\)\) return res\.status\(422\)\.json\(\{ error: 'invalid_view' \}\);/)
})

test('staff-list endpoint: prefers v3, falls back to v2 on PGRST202/42883', () => {
  assert.match(staffList, /db\.rpc\('messages_staff_list_conversations_v3', \{ \.\.\.rpcArgs, p_view: view \}\)/)
  assert.match(staffList, /db\.rpc\('messages_staff_list_conversations_v2', rpcArgs\)/)
  assert.match(staffList, /PGRST202.*42883|42883.*PGRST202/)
  const v3Idx = staffList.indexOf("rpc('messages_staff_list_conversations_v3'")
  const v2Idx = staffList.indexOf("rpc('messages_staff_list_conversations_v2'", v3Idx)
  assert.ok(v3Idx >= 0 && v2Idx > v3Idx, 'v2 fallback textually follows the v3 attempt')
})

test('staff-list endpoint: reports archive_available and passes through row data untouched', () => {
  assert.match(staffList, /let archiveAvailable = true;/)
  assert.match(staffList, /archiveAvailable = false;/)
  assert.match(staffList, /archive_available: archiveAvailable,/)
  // Rows are forwarded as-is; is_archived needs no special handling here.
  assert.match(staffList, /const conversations = data\?\.conversations \|\| \[\];/)
})

// ── Staff-manage endpoint: archive action, allowlist, 503 readiness ──────────

test('staff-manage endpoint: archive is in the action allowlist', () => {
  // MESSAGES-LIFECYCLE-PHASE3A-REACTIONS added 'react' alongside 'archive'; the
  // allowlist pin is updated to match, archive's own position is unchanged.
  assert.match(staffManage, /const ACTIONS = \['assign', 'status', 'category', 'flag', 'archive', 'react'\];/)
})

test('staff-manage endpoint: archive action validates the boolean and always targets staff kind', () => {
  const archiveBranch = sliceBetween(staffManage, "// MESSAGES-ARCHIVE-P1: archive is always for the calling staff profile.", '}\n\n  try {')
  assert.match(archiveBranch, /typeof parsed\.body\.archived !== 'boolean'/)
  assert.match(archiveBranch, /rpc = 'messages_set_conversation_archived';/)
  assert.match(archiveBranch, /p_actor_kind: 'staff',/)
})

test('staff-manage endpoint: 503 archive_not_ready on PGRST202/42883 for the archive action only', () => {
  assert.match(staffManage, /action === 'archive' && \(String\(error\.code\) === 'PGRST202' \|\| String\(error\.code\) === '42883'\)/)
  assert.match(staffManage, /res\.status\(503\)\.json\(\{ error: 'archive_not_ready' \}\)/)
})

test('staff-manage endpoint: no email and no conversation_events for any action (unchanged)', () => {
  assert.doesNotMatch(strip(staffManage), /\bsendEmail\b|\bresend\b/i)
})

// ── Portal list endpoint: view validation, v3 -> v2 -> v1 fallback chain ─────

test('portal list endpoint: view query param defaults to active and rejects invalid values', () => {
  assert.match(portalList, /const VIEWS = \['active', 'archived', 'all'\];/)
  assert.match(portalList, /const view = req\.query\?\.view === undefined \? 'active' : req\.query\.view;/)
  assert.match(portalList, /if \(!VIEWS\.includes\(view\)\) return res\.status\(422\)\.json\(\{ error: 'invalid_view' \}\);/)
})

test('portal list endpoint: prefers v3, falls back to v2, then to v1 (Phase 0 chain preserved)', () => {
  assert.match(portalList, /db\.rpc\('messages_portal_list_conversations_v3', \{ \.\.\.rpcArgs, p_view: view \}\)/)
  const v3Idx = portalList.indexOf("rpc('messages_portal_list_conversations_v3'")
  const v2Idx = portalList.indexOf("rpc('messages_portal_list_conversations_v2'", v3Idx)
  const v1Idx = portalList.indexOf("rpc('messages_portal_list_conversations'", v2Idx)
  assert.ok(v3Idx >= 0, 'v3 attempted')
  assert.ok(v2Idx > v3Idx, 'v2 fallback follows the v3 attempt')
  assert.ok(v1Idx > v2Idx, 'v1 fallback follows the v2 attempt')
})

test('portal list endpoint: reports archive_available and still classifies rows afterward', () => {
  assert.match(portalList, /let archiveAvailable = true;/)
  assert.match(portalList, /archiveAvailable = false;/)
  assert.match(portalList, /archive_available: archiveAvailable,/)
  assert.match(portalList, /classifyPortalConversations\(svc, conversations, caller\.profile\.id\)/)
})

// ── Portal archive endpoint: contract, actorKind, no rate limit ──────────────

test('portal archive endpoint: POST-only, verifyPortalMessagesCaller, validates body', () => {
  assert.match(portalArchive, /methodGuard\(req, res, \['POST'\]\)/)
  assert.match(portalArchive, /verifyPortalMessagesCaller\(req\)/)
  assert.match(portalArchive, /isUuid\(conversationId\)/)
  assert.match(portalArchive, /typeof parsed\.body\.archived !== 'boolean'/)
})

test('portal archive endpoint: passes the verified caller.actorKind to the RPC, never a hardcoded kind', () => {
  assert.match(portalArchive, /p_actor_kind: caller\.actorKind,/)
  assert.doesNotMatch(portalArchive, /p_actor_kind: 'student'/)
  assert.doesNotMatch(portalArchive, /p_actor_kind: 'unit_leader'/)
  assert.doesNotMatch(portalArchive, /p_actor_kind: 'academic_partner'/)
})

test('portal archive endpoint: 503 archive_not_ready on PGRST202/42883', () => {
  assert.match(portalArchive, /String\(error\.code\) === 'PGRST202' \|\| String\(error\.code\) === '42883'/)
  assert.match(portalArchive, /res\.status\(503\)\.json\(\{ error: 'archive_not_ready' \}\)/)
})

test('portal archive endpoint: no rate limit (it is not message creation) and no email', () => {
  assert.doesNotMatch(strip(portalArchive), /rate.?limit/i)
  assert.doesNotMatch(strip(portalArchive), /\bsendEmail\b|\bresend\b/i)
})

// ── Docs: verification and rollback ──────────────────────────────────────────

test('verification doc: covers prechecks, postchecks, behavior probe, and rollback', () => {
  assert.match(verificationDoc, /Pre-application state checks/)
  assert.match(verificationDoc, /Post-application checks/)
  assert.match(verificationDoc, /Behavior probe/)
  assert.match(verificationDoc, /Rollback/)
  // Rollback includes both prior unread-count definitions inline (copy-paste).
  assert.match(verificationDoc, /messages_staff_unread_count/)
  assert.match(verificationDoc, /messages_portal_unread_count/)
  assert.match(verificationDoc, /DROP FUNCTION IF EXISTS public\.messages_staff_list_conversations_v3/)
  assert.match(verificationDoc, /DROP FUNCTION IF EXISTS public\.messages_portal_list_conversations_v3/)
  assert.match(verificationDoc, /DROP FUNCTION IF EXISTS public\.messages_set_conversation_archived/)
  assert.match(verificationDoc, /DROP TABLE IF EXISTS public\.message_conversation_visibility/)
})

test('OWNER_SQL_GATE follow-up entry matches the Phase 0 entry\'s format', () => {
  assert.match(gateDoc, /## Follow-up: Messages Lifecycle Phase 1, archive \(independent of the ordered list above\)/)
  assert.match(gateDoc, /\*\*File:\*\* `supabase\/migrations\/20260730000002_messages_phase1_archive\.sql`/)
  assert.match(gateDoc, /explicitly transactional \(BEGIN\/COMMIT\)/)
  assert.match(gateDoc, /\*\*Unlocks:\*\*/)
  assert.match(gateDoc, /Application and verification order/)
  assert.match(gateDoc, /Deployment note:/)
})

test('no em dash anywhere in the endpoint files or OWNER_SQL_GATE follow-up', () => {
  const EM_DASH = /—/
  for (const src of [staffList, staffManage, portalList, portalArchive, gateDoc]) {
    assert.doesNotMatch(src, EM_DASH)
  }
})

// ── Refinement: section 4c must be a rollback-safe transactional probe ───────

test('verification 4c is a rollback-safe locking probe: no COMMIT, sessions end in ROLLBACK, serialization-only scope', () => {
  const doc = read('docs/security/MESSAGES_ARCHIVE_VERIFICATION.md')
  const start = doc.indexOf('### 4c.')
  assert.ok(start > -1)
  const restMatch = doc.slice(start + 6).search(/\n#{2,3} /)
  const section = doc.slice(start, restMatch === -1 ? undefined : start + 6 + restMatch)

  // Renamed: rollback-safe transactional probe, never "read-only-safe".
  assert.match(section, /rollback-safe transactional probe/)
  assert.doesNotMatch(section, /read-only-safe/)

  // Scope honesty: serialization only; the adverse ordering is proven by the
  // automated simulation, and the doc must not claim production reproduction.
  assert.match(section, /SERIALIZATION ONLY/)
  assert.match(section, /AUTOMATED concurrency simulation/)
  assert.doesNotMatch(section, /reproduces the exact race/)

  // The probe's SQL: the FOR UPDATE lock, the visible block, and ROLLBACK-only
  // transaction endings - no COMMIT statement anywhere in 4c's SQL.
  const sql = [...section.matchAll(/```sql([\s\S]*?)```/g)].map(m => m[1]).join('\n')
  assert.match(sql, /FOR UPDATE/)
  assert.doesNotMatch(sql, /^\s*COMMIT;/m, '4c SQL must contain no COMMIT statement')
  const rollbacks = (sql.match(/^ROLLBACK;/gm) || []).length
  assert.ok(rollbacks >= 2, `both sessions end with ROLLBACK (found ${rollbacks})`)
  assert.match(section, /must BLOCK/)
  // Step 4's transaction block ends with ROLLBACK as its final statement.
  const step4 = [...section.matchAll(/```sql([\s\S]*?)```/g)].map(m => m[1]).find(b => /STEP 4/.test(b))
  assert.ok(step4, 'step 4 block present')
  const lastStatement = step4.trim().split('\n').filter(l => l.trim() && !l.trim().startsWith('--')).pop()
  assert.match(lastStatement, /^ROLLBACK;/)
})
