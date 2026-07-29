-- ============================================================================
-- MESSAGES-ARCHIVE-P1: per-user conversation archive (ADDITIVE)
-- ============================================================================
-- Owner instructions: run this ENTIRE file as one block in the Supabase SQL
-- editor. It is additive: one new table, one new RPC, two new list functions
-- carrying an explicit p_view parameter, and THREE REDEFINED (CREATE OR
-- REPLACE, same name) functions - messages_staff_unread_count and
-- messages_portal_unread_count (one added AND NOT EXISTS clause each) plus
-- messages_post_reply (the race-safety fix described below). No existing
-- table is altered, no row is rewritten, and v1/v2 of every list RPC are left
-- byte-for-byte untouched for rollback and for the pre-migration API
-- fallback. Read-only verification lives in
-- docs/security/MESSAGES_ARCHIVE_VERIFICATION.md.
--
-- THE CORE DESIGN: DERIVED ARCHIVE, NOT A STATUS FLAG. A conversation is
-- archived FOR ONE PROFILE iff a visibility row exists whose archived_at is AT
-- OR AFTER the conversation's last_message_at:
--
--   EXISTS (
--     SELECT 1 FROM public.message_conversation_visibility v
--     WHERE v.profile_id = <that profile>
--       AND v.conversation_id = c.id
--       AND v.archived_at >= c.last_message_at
--   )
--
-- A new message updates last_message_at, so the thread AUTOMATICALLY returns to
-- Active for every profile that archived it, the instant last_message_at moves
-- past their archived_at. There is no unarchive write, no auto-unarchive event,
-- and no race between "a new message arrived" and "the thread is still marked
-- archived": the predicate is evaluated fresh on every read.
--
-- ONE-USER ISOLATION: message_conversation_visibility is per (profile, thread)
-- UI state, exactly like staff_conversation_reads and
-- participant_conversation_reads. It is NOT part of the append-only messages /
-- conversation_events record. One profile archiving a thread never writes,
-- reads, or affects any other profile's row, and archiving/unarchiving emits no
-- email and no conversation_events row - the same posture the read pointers
-- already have.
--
-- READ, NOT SEND, GATES ARCHIVE for portal actors: message_participant_can_read
-- is the bar, so a frozen-but-readable thread (for example, a former Unit
-- Leader's ended assignment) may still be archived by the participant who can
-- no longer send into it. Staff gate on message_profile_is_active_owner_or_admin,
-- exactly like every other staff-management RPC.
--
-- RACE SAFETY (the reason messages_post_reply is ALSO redefined here): the
-- bare comparison "archived_at >= last_message_at" is NOT race-free on its
-- own, because Postgres now() is TRANSACTION-START time, not commit time. A
-- reply transaction that BEGAN before an archive transaction but COMMITS
-- after it would otherwise still stamp its message with a now() captured
-- before the archive, writing an OLDER last_message_at than the archive's
-- archived_at and leaving a newly-replied-to thread stuck archived
-- indefinitely for the archiving profile. The fix is that BOTH writers that
-- can move a conversation's last_message_at or a profile's archived_at for
-- it - messages_post_reply and messages_set_conversation_archived - take the
-- SAME conversation row lock (SELECT ... FOR UPDATE) before deriving ANY
-- timestamp, which serializes them against each other, and each then derives
-- its timestamp with GREATEST(...) against the OTHER side's already-visible,
-- already-committed state (never a bare now()/clock_timestamp() alone). This
-- guarantees whichever transaction's lock-and-derive step runs SECOND
-- produces a timestamp strictly ordered after the first one's effect,
-- regardless of which transaction's wall clock happens to read earlier.
--
-- REPLY-PATH AUDIT: every append to an EXISTING conversation - a staff
-- reply, a portal team reply, and a Unit Leader/student direct reply - flows
-- through messages_post_reply. The messages_start_* functions only ever
-- create BRAND-NEW conversations, which cannot yet hold a visibility row
-- (nothing can have archived a conversation that does not exist yet), so
-- locking exactly these two functions (messages_post_reply and
-- messages_set_conversation_archived) is sufficient to serialize every
-- writer relevant to the derived archive rule.
--
-- Grants and RLS follow the repository's established least-privilege pattern:
-- REVOKE ALL first, then GRANT the minimum. The new table is service-role only
-- (RLS enabled, ZERO policies - the same posture as
-- participant_conversation_reads). The new RPC is service-role only. The two
-- new list functions (_v3) keep the authenticated + service_role read-RPC
-- grant every prior Messages list RPC has; PUBLIC and anon never receive
-- anything.
--
-- This file is atomic (BEGIN/COMMIT) and designed to run once.
-- ============================================================================

BEGIN;

-- ── 1. message_conversation_visibility (per-user archive state) ─────────────
-- MESSAGES-ARCHIVE-P1: this table is per-user UI STATE - like the read
-- pointers in staff_conversation_reads / participant_conversation_reads - and
-- is deliberately NOT part of the append-only messages / conversation_events
-- record. No application role may read or write it directly; every access
-- goes through messages_set_conversation_archived or the derived predicate
-- inside the v3 list functions and the redefined unread counts below.
CREATE TABLE IF NOT EXISTS public.message_conversation_visibility (
  profile_id      uuid        NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  conversation_id uuid        NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  archived_at     timestamptz NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (profile_id, conversation_id)
);

COMMENT ON TABLE public.message_conversation_visibility IS
  'MESSAGES-ARCHIVE-P1: per-user conversation archive state (archived_at). Like staff_conversation_reads / participant_conversation_reads, this is per-user UI state, NOT part of the append-only message/event record - it holds no audit trail and is never evented. Service-role-only; no application role has any grant, and RLS is enabled with zero policies. Archive is always DERIVED at read time (archived_at >= conversations.last_message_at), so a new message automatically restores a thread to Active for every profile that archived it, with no additional write.';

-- The (conversation_id) leading lookup pattern is already covered by the PK for
-- profile-first probes; this index supports the conversation-first EXISTS
-- probes used by the v3 list functions and the redefined unread counts, keeps
-- the CASCADE delete from public.conversations efficient, AND (the archived_at
-- DESC tail) supports the MAX(archived_at) probe messages_post_reply's
-- race-safe v_now derivation runs against every visibility row for a
-- conversation.
CREATE INDEX IF NOT EXISTS idx_message_conversation_visibility_conversation
  ON public.message_conversation_visibility (conversation_id, archived_at DESC);

ALTER TABLE public.message_conversation_visibility ENABLE ROW LEVEL SECURITY;
-- No policy is added: RLS is enabled with ZERO policies, denying every
-- authenticated read/write by default, exactly like participant_conversation_reads
-- in Phase 1. service_role writes bypass RLS.

REVOKE ALL ON public.message_conversation_visibility FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.message_conversation_visibility TO service_role;

-- ── 2. messages_set_conversation_archived (service-role only, transactional) ─
-- Archives or unarchives ONE conversation for the calling profile ONLY. This is
-- the one-user-isolation guarantee: every INSERT/UPDATE/DELETE below is scoped
-- to p_actor_profile_id's own row and never touches any other profile's
-- visibility state.
--
-- SQLSTATE mapping (matches every other Messages RPC): MS400 -> 422 validation,
-- MS403 -> 403 forbidden, MS404 -> 404 not found (non-enumerating for portal
-- kinds - an inaccessible conversation and a missing one look identical).
CREATE OR REPLACE FUNCTION public.messages_set_conversation_archived(
  p_actor_profile_id uuid,
  p_actor_kind       text,
  p_conversation_id  uuid,
  p_archived         boolean
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_last_message_at timestamptz;
  v_archived_at      timestamptz;
  v_read_at          timestamptz;
BEGIN
  IF p_actor_kind NOT IN ('student', 'unit_leader', 'academic_partner', 'staff') THEN
    RAISE EXCEPTION 'invalid actor kind' USING ERRCODE = 'MS400';
  END IF;
  IF p_archived IS NULL THEN
    RAISE EXCEPTION 'archived is required' USING ERRCODE = 'MS400';
  END IF;

  IF p_actor_kind = 'staff' THEN
    IF NOT public.message_profile_is_active_owner_or_admin(p_actor_profile_id) THEN
      RAISE EXCEPTION 'staff actor must be an active owner or admin' USING ERRCODE = 'MS403';
    END IF;
  ELSE
    -- MESSAGES-ARCHIVE-P1: archive requires READ visibility, NOT send. A
    -- frozen-but-readable thread (for example a former Unit Leader's ended
    -- assignment) may still be archived by a participant who can no longer
    -- send into it. Non-enumerating: an inaccessible conversation and a
    -- missing one are indistinguishable to the caller.
    IF NOT public.message_participant_can_read(p_conversation_id, p_actor_profile_id) THEN
      RAISE EXCEPTION 'conversation not found' USING ERRCODE = 'MS404';
    END IF;
  END IF;

  -- MESSAGES-ARCHIVE-P1 (race fix): lock the conversation row and read its
  -- last_message_at BEFORE deriving or writing ANY timestamp. This is the
  -- serialization point that pairs with the matching FOR UPDATE in
  -- messages_post_reply: whichever of the two transactions gets here SECOND
  -- for the SAME conversation must wait for the first to commit, so the
  -- GREATEST(...) below always sees the other side's true, already-committed
  -- last_message_at rather than a possibly-stale snapshot. IF NOT FOUND also
  -- covers "conversation does not exist" for the staff branch (the portal
  -- branch's can_read check above already implies it exists via the FK, but
  -- this still fails closed defensively).
  SELECT last_message_at INTO v_last_message_at
  FROM public.conversations WHERE id = p_conversation_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'conversation not found' USING ERRCODE = 'MS404';
  END IF;

  IF p_archived THEN
    -- GREATEST against the just-locked v_last_message_at (never a bare
    -- clock_timestamp()/now()): guarantees archived_at >= last_message_at even
    -- when clock_timestamp() reads BEHIND the conversation's own
    -- last_message_at due to clock skew or transaction-start timing between
    -- sessions - the actual bug this fix prevents, a thread that a reply just
    -- reopened but which archiving would otherwise re-freeze as if the reply
    -- had never landed.
    v_archived_at := GREATEST(clock_timestamp(), v_last_message_at);

    INSERT INTO public.message_conversation_visibility (profile_id, conversation_id, archived_at)
    VALUES (p_actor_profile_id, p_conversation_id, v_archived_at)
    ON CONFLICT (profile_id, conversation_id) DO UPDATE SET archived_at = v_archived_at;

    -- MESSAGES-ARCHIVE-P1: archiving also clears the caller's own unread count
    -- by advancing THEIR OWN read pointer to the SERVER-DERIVED latest message
    -- time (never a client-supplied timestamp - mirrors messages_mark_read),
    -- taking the GREATEST with any existing pointer so this can never move a
    -- pointer backward.
    SELECT COALESCE(max(m.created_at), v_archived_at) INTO v_read_at
    FROM public.messages m WHERE m.conversation_id = p_conversation_id;

    IF p_actor_kind = 'staff' THEN
      INSERT INTO public.staff_conversation_reads (staff_profile_id, conversation_id, last_read_at)
      VALUES (p_actor_profile_id, p_conversation_id, v_read_at)
      ON CONFLICT (staff_profile_id, conversation_id) DO UPDATE
        SET last_read_at = GREATEST(public.staff_conversation_reads.last_read_at, v_read_at);
    ELSE
      INSERT INTO public.participant_conversation_reads (participant_profile_id, conversation_id, last_read_at)
      VALUES (p_actor_profile_id, p_conversation_id, v_read_at)
      ON CONFLICT (participant_profile_id, conversation_id) DO UPDATE
        SET last_read_at = GREATEST(public.participant_conversation_reads.last_read_at, v_read_at);
    END IF;
  ELSE
    -- MESSAGES-ARCHIVE-P1: unarchive deletes the caller's own row outright.
    -- ONLY p_actor_profile_id's row is ever affected.
    DELETE FROM public.message_conversation_visibility
    WHERE profile_id = p_actor_profile_id AND conversation_id = p_conversation_id;
  END IF;

  RETURN jsonb_build_object('archived', p_archived);
END;
$$;

COMMENT ON FUNCTION public.messages_set_conversation_archived(uuid, text, uuid, boolean) IS
  'MESSAGES-ARCHIVE-P1: archive or unarchive one conversation for the calling profile ONLY (one-user isolation - only p_actor_profile_id''s own visibility row is ever written or deleted; no other profile''s state is ever read or touched). Staff requires an active Owner/Admin (MS403); portal kinds (student, unit_leader, academic_partner) require message_participant_can_read - READ, not send, so a frozen-but-readable thread may still be archived - with a non-enumerating MS404 denial. Race safety: the conversation row is locked (SELECT ... FOR UPDATE) before any timestamp is derived, and archived_at is GREATEST(clock_timestamp(), the just-locked last_message_at) rather than a bare clock read, pairing with the matching lock in messages_post_reply so archiving can never race a concurrent reply into an incorrectly-stuck-archived state. Archiving also advances the caller''s own read pointer to the server-derived latest message time (GREATEST with any existing pointer; a client timestamp is never accepted), clearing their unread count. Unarchiving deletes the visibility row. No email is sent and no conversation_events row is written: like the read pointers, per-user visibility is intentionally NOT part of the append-only audit trail. Service-role only.';

REVOKE ALL ON FUNCTION public.messages_set_conversation_archived(uuid, text, uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.messages_set_conversation_archived(uuid, text, uuid, boolean) TO service_role;

-- ── 3. messages_post_reply (race fix; base = the Phase 0 definition) ────────
-- Base body copied verbatim from 20260730000001_messages_phase0_correctness.sql
-- (which itself is the currently-live definition). The ONLY changes:
--   1. The existing "SELECT status INTO v_status ..." becomes "... FOR UPDATE"
--      - the serialization point, paired with the matching lock in
--      messages_set_conversation_archived above, BEFORE any timestamp is
--      derived.
--   2. v_now is no longer initialized from now() at DECLARE time. After the
--      locked select, it is derived as GREATEST(clock_timestamp(), this
--      conversation's last_message_at + 1 microsecond, the MAX(archived_at)
--      across every profile who has archived this conversation + 1
--      microsecond), so this reply's timestamp is STRICTLY greater than every
--      prior archive of this conversation and than its own current
--      last_message_at, regardless of clock skew or which transaction's wall
--      clock happens to read earlier. Every existing use of v_now below
--      (messages.created_at, conversations.last_message_at, the read
--      pointer, the reopen event, the delivery row's next_attempt_at) is
--      UNCHANGED - it is simply now a race-safe value instead of a bare
--      now().
-- Nothing else in the function body changes from the Phase 0 definition.
CREATE OR REPLACE FUNCTION public.messages_post_reply(
  p_actor_profile_id uuid,
  p_actor_kind       text,
  p_conversation_id  uuid,
  p_body             text,
  p_delivery         jsonb
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_now            timestamptz;
  v_message_id     uuid;
  v_delivery_id    uuid;
  v_status         text;
  v_reopened       boolean := false;
  v_author_role    text;
  v_participant    uuid;
  v_expected_event text;
BEGIN
  IF p_actor_kind NOT IN ('student', 'staff', 'unit_leader', 'academic_partner') THEN
    RAISE EXCEPTION 'invalid actor kind' USING ERRCODE = 'MS400';
  END IF;
  IF char_length(btrim(coalesce(p_body, ''))) < 1 OR char_length(p_body) > 5000 THEN
    RAISE EXCEPTION 'body must be 1 to 5000 characters' USING ERRCODE = 'MS400';
  END IF;

  -- MESSAGES-ARCHIVE-P1 (race fix): lock the conversation row FIRST. This is
  -- the serialization point that pairs with messages_set_conversation_archived's
  -- FOR UPDATE on the SAME row - the two functions can never both proceed past
  -- this point for the same conversation at once.
  SELECT status INTO v_status FROM public.conversations WHERE id = p_conversation_id FOR UPDATE;
  IF v_status IS NULL THEN
    RAISE EXCEPTION 'conversation not found' USING ERRCODE = 'MS404';
  END IF;

  -- MESSAGES-ARCHIVE-P1 (race fix): with the row now locked, derive v_now so
  -- it is STRICTLY greater than this conversation's own current
  -- last_message_at AND strictly greater than every archived_at any profile
  -- has ever recorded for it. Under the lock just acquired, no concurrent
  -- messages_set_conversation_archived call can be mid-flight against this
  -- same conversation, so this MAX(archived_at) read is exact, and the +1
  -- microsecond on both floors is what proves - by construction, not by
  -- clock luck - that the derived archive rule (archived_at >= last_message_at)
  -- flips to Active for every profile once this reply commits.
  v_now := GREATEST(
    clock_timestamp(),
    (SELECT c.last_message_at + interval '1 microsecond' FROM public.conversations c WHERE c.id = p_conversation_id),
    (SELECT COALESCE(MAX(v.archived_at), '-infinity'::timestamptz) + interval '1 microsecond'
       FROM public.message_conversation_visibility v WHERE v.conversation_id = p_conversation_id)
  );

  IF p_actor_kind IN ('student', 'unit_leader', 'academic_partner') THEN
    -- SEND authorization, not read. A former Unit Leader can still READ this thread
    -- but must never add to it, and once a direct relationship ends the thread is
    -- frozen for BOTH portal parties. can_send requires current active scope. The
    -- academic partner path already flows through this same predicate today.
    IF NOT public.message_participant_can_send(p_conversation_id, p_actor_profile_id) THEN
      -- Non-enumerating: a readable-but-frozen thread and an invisible one are
      -- indistinguishable to the caller.
      RAISE EXCEPTION 'conversation not found' USING ERRCODE = 'MS404';
    END IF;

    -- PHASE0: the author role is the VERIFIED caller kind, never a hardcoded value.
    v_author_role := p_actor_kind;

    -- PHASE0: expected delivery event, allowlisted per actor kind. The declared
    -- event still has to survive message_assert_valid_delivery below; this CASE
    -- only decides which event this actor is permitted to declare.
    v_expected_event := CASE
      WHEN p_actor_kind = 'student' AND p_delivery->>'event_type' = 'student_to_unit_leader_message'
        THEN 'student_to_unit_leader_message'
      WHEN p_actor_kind = 'unit_leader' AND p_delivery->>'event_type' = 'unit_leader_message'
        THEN 'unit_leader_message'
      ELSE 'portal_reply'
    END;
  ELSE
    IF NOT public.message_profile_is_active_owner_or_admin(p_actor_profile_id) THEN
      RAISE EXCEPTION 'staff actor must be an active owner or admin' USING ERRCODE = 'MS403';
    END IF;
    -- UL-PORTAL: a conversation may hold TWO active portal participants, and staff
    -- must be able to intervene even after a unit assignment has ended. The
    -- delivery's declared recipient is authoritative and is validated to be a
    -- participant of THIS conversation who can still READ it. Read, not send: a
    -- former Unit Leader may still receive a staff reply.
    v_participant := NULLIF(p_delivery->>'recipient_profile_id', '')::uuid;
    IF v_participant IS NULL
       OR NOT EXISTS (
            SELECT 1 FROM public.conversation_participants cp
            WHERE cp.conversation_id = p_conversation_id
              AND cp.participant_profile_id = v_participant
              AND cp.removed_at IS NULL)
       OR NOT public.message_participant_can_read(p_conversation_id, v_participant) THEN
      RAISE EXCEPTION 'participant portal access is not active' USING ERRCODE = 'MS409';
    END IF;
    v_author_role    := 'staff';
    v_expected_event := 'staff_reply';
  END IF;

  -- REQUIRED durable delivery payload, validated before any authoritative write.
  PERFORM public.message_assert_valid_delivery(p_delivery, v_expected_event, p_actor_profile_id);

  -- A staff reply must target the conversation's active portal participant.
  IF p_actor_kind = 'staff'
     AND NULLIF(p_delivery->>'recipient_profile_id', '')::uuid IS DISTINCT FROM v_participant THEN
    RAISE EXCEPTION 'staff reply must notify the active conversation participant'
      USING ERRCODE = 'MS400';
  END IF;

  -- Automatic reopen on reply to a resolved conversation.
  IF v_status = 'resolved' THEN
    UPDATE public.conversations
    SET status = 'open', resolved_at = NULL, updated_at = v_now
    WHERE id = p_conversation_id;
    INSERT INTO public.conversation_events (conversation_id, event_type, actor_profile_id, from_value, to_value, created_at)
    VALUES (p_conversation_id, 'reopened', p_actor_profile_id, 'resolved', 'open', v_now);
    v_reopened := true;
  END IF;

  INSERT INTO public.messages (conversation_id, author_profile_id, author_role, body, created_at)
  VALUES (p_conversation_id, p_actor_profile_id, v_author_role, p_body, v_now)
  RETURNING id INTO v_message_id;

  UPDATE public.conversations
  SET last_message_at = v_now, updated_at = v_now
  WHERE id = p_conversation_id;

  IF p_actor_kind IN ('student', 'unit_leader', 'academic_partner') THEN
    INSERT INTO public.participant_conversation_reads (participant_profile_id, conversation_id, last_read_at)
    VALUES (p_actor_profile_id, p_conversation_id, v_now)
    ON CONFLICT (participant_profile_id, conversation_id) DO UPDATE SET last_read_at = v_now;
  ELSE
    INSERT INTO public.staff_conversation_reads (staff_profile_id, conversation_id, last_read_at)
    VALUES (p_actor_profile_id, p_conversation_id, v_now)
    ON CONFLICT (staff_profile_id, conversation_id) DO UPDATE SET last_read_at = v_now;
  END IF;

  -- Durable queued delivery row, same transaction, no silent conflict skip.
  BEGIN
    INSERT INTO public.message_notification_deliveries (
      conversation_id, message_id, triggered_by_profile_id, recipient_profile_id,
      recipient_email, recipient_kind, event_type, idempotency_key,
      queue_status, next_attempt_at,
      snapshot_sender_name, snapshot_subject, snapshot_category, cta_path
    ) VALUES (
      p_conversation_id, v_message_id, p_actor_profile_id,
      NULLIF(p_delivery->>'recipient_profile_id', '')::uuid,
      p_delivery->>'recipient_email', p_delivery->>'recipient_kind',
      p_delivery->>'event_type', p_delivery->>'idempotency_key',
      'queued', v_now,
      p_delivery->>'snapshot_sender_name', p_delivery->>'snapshot_subject',
      p_delivery->>'snapshot_category', p_delivery->>'cta_path'
    )
    RETURNING id INTO v_delivery_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'duplicate notification delivery for this message'
      USING ERRCODE = 'MS409';
  END;

  IF v_delivery_id IS NULL THEN
    RAISE EXCEPTION 'delivery row was not created' USING ERRCODE = 'MS409';
  END IF;

  RETURN jsonb_build_object(
    'message_id', v_message_id,
    'delivery_id', v_delivery_id,
    'created_at', v_now,
    'reopened', v_reopened
  );
END;
$$;

REVOKE ALL ON FUNCTION public.messages_post_reply(uuid, text, uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.messages_post_reply(uuid, text, uuid, text, jsonb) TO service_role;

COMMENT ON FUNCTION public.messages_post_reply(uuid, text, uuid, text, jsonb) IS
  'MESSAGES-ARCHIVE-P1 (race fix): identical to the Phase 0 definition (20260730000001) except the conversation row is now locked (SELECT ... FOR UPDATE) before any timestamp is derived, and v_now is computed as GREATEST(clock_timestamp(), this conversation''s last_message_at + 1 microsecond, the MAX(archived_at) across every profile who has archived this conversation + 1 microsecond) instead of a bare now(). This guarantees a reply is always ordered strictly after every prior archive of its conversation, regardless of clock skew or transaction-start timing between sessions. Authorization, reopen, the message insert, the read pointer, and the delivery row are unchanged from Phase 0.';

-- ── 4. messages_staff_list_conversations_v3 (v2 body verbatim + p_view) ──────
-- Full body copied from messages_staff_list_conversations_v2
-- (20260716000004_messages_phase4_staff_inbox_filter_modes.sql), unchanged
-- except: the added p_view parameter/validation, the added is_archived
-- projection, and the added view predicate in the WHERE clause. v2 is left
-- untouched for rollback and as the pre-migration API fallback.
CREATE OR REPLACE FUNCTION public.messages_staff_list_conversations_v3(
  p_limit               integer     DEFAULT 25,
  p_cursor_ts           timestamptz DEFAULT NULL,
  p_cursor_id           uuid        DEFAULT NULL,
  p_status              text        DEFAULT NULL,
  p_assignee_mode       text        DEFAULT 'any',
  p_assignee_profile_id uuid        DEFAULT NULL,
  p_category_mode       text        DEFAULT 'any',
  p_category            text        DEFAULT NULL,
  p_flagged             boolean     DEFAULT NULL,
  p_search              text        DEFAULT NULL,
  p_view                text        DEFAULT 'active'
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER STABLE
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_me       uuid    := public.portal_profile_id();
  v_limit    integer := LEAST(GREATEST(COALESCE(p_limit, 25), 1), 100);
  v_amode    text    := COALESCE(p_assignee_mode, 'any');
  v_cmode    text    := COALESCE(p_category_mode, 'any');
  v_view     text    := COALESCE(p_view, 'active');
  v_search   text    := NULLIF(btrim(COALESCE(p_search, '')), '');
  v_category text    := NULLIF(btrim(COALESCE(p_category, '')), '');
  v_rows     jsonb;
BEGIN
  -- Authorization first: active Owner or Admin only.
  IF NOT public.is_active_owner_or_admin() THEN
    RAISE EXCEPTION 'staff access required' USING ERRCODE = 'MS403';
  END IF;

  -- Status: null means all; otherwise one of the three approved values.
  IF p_status IS NOT NULL AND p_status NOT IN ('open', 'waiting', 'resolved') THEN
    RAISE EXCEPTION 'invalid status' USING ERRCODE = 'MS400';
  END IF;

  -- Assignee mode. 'specific' requires a profile id; 'any' and 'unassigned'
  -- ignore it entirely. The future UI option Me is simply 'specific' with the
  -- server-verified current staff profile id, so no separate mode exists.
  IF v_amode NOT IN ('any', 'unassigned', 'specific') THEN
    RAISE EXCEPTION 'invalid assignee mode' USING ERRCODE = 'MS400';
  END IF;
  IF v_amode = 'specific' AND p_assignee_profile_id IS NULL THEN
    RAISE EXCEPTION 'specific assignee mode requires an assignee profile id' USING ERRCODE = 'MS400';
  END IF;

  -- Category mode. 'specific' requires one approved category.
  IF v_cmode NOT IN ('any', 'uncategorized', 'specific') THEN
    RAISE EXCEPTION 'invalid category mode' USING ERRCODE = 'MS400';
  END IF;
  IF v_cmode = 'specific' THEN
    IF v_category IS NULL THEN
      RAISE EXCEPTION 'specific category mode requires a category' USING ERRCODE = 'MS400';
    END IF;
    IF v_category NOT IN (
      'Placement and matching', 'Scheduling', 'Onboarding requirements',
      'Clinical rotation support', 'Preceptor support', 'Portal or account help',
      'General question'
    ) THEN
      RAISE EXCEPTION 'invalid category' USING ERRCODE = 'MS400';
    END IF;
  END IF;

  -- MESSAGES-ARCHIVE-P1: view. 'active' (default) hides threads the caller
  -- archived, 'archived' shows only those, 'all' ignores archive state.
  IF v_view NOT IN ('active', 'archived', 'all') THEN
    RAISE EXCEPTION 'invalid view' USING ERRCODE = 'MS400';
  END IF;

  -- A cursor is both parts or neither. A partial cursor is rejected rather than
  -- silently returning an empty page (a null tie-breaker makes the row
  -- comparison null, which matches nothing).
  IF (p_cursor_ts IS NULL) <> (p_cursor_id IS NULL) THEN
    RAISE EXCEPTION 'invalid cursor' USING ERRCODE = 'MS400';
  END IF;

  SELECT COALESCE(jsonb_agg(r ORDER BY r.last_message_at DESC, r.id DESC), '[]'::jsonb) INTO v_rows
  FROM (
    SELECT
      c.id, c.subject, c.category, c.status, c.last_message_at,
      c.follow_up_flagged, c.assigned_staff_profile_id,
      (SELECT up.full_name FROM public.user_profiles up WHERE up.id = c.assigned_staff_profile_id) AS assignee_name,
      c.related_student_id,
      (SELECT left(m.body, 160) FROM public.messages m
        WHERE m.conversation_id = c.id ORDER BY m.created_at DESC, m.id DESC LIMIT 1) AS latest_preview,
      (SELECT count(*) FROM public.messages m
        WHERE m.conversation_id = c.id
          AND m.author_role <> 'staff'
          AND m.created_at > COALESCE(
            (SELECT r2.last_read_at FROM public.staff_conversation_reads r2
              WHERE r2.staff_profile_id = v_me AND r2.conversation_id = c.id),
            '-infinity'::timestamptz)) AS unread_count,
      (SELECT cp.participant_profile_id FROM public.conversation_participants cp
        WHERE cp.conversation_id = c.id AND cp.removed_at IS NULL LIMIT 1) AS participant_profile_id,
      (SELECT up.full_name FROM public.user_profiles up
        WHERE up.id = (SELECT cp.participant_profile_id FROM public.conversation_participants cp
                        WHERE cp.conversation_id = c.id AND cp.removed_at IS NULL LIMIT 1)) AS participant_name,
      COALESCE(public.message_recipient_has_active_access(
        c.id,
        (SELECT cp.participant_profile_id FROM public.conversation_participants cp
          WHERE cp.conversation_id = c.id AND cp.removed_at IS NULL LIMIT 1)
      ), false) AS participant_access_active,
      -- MESSAGES-ARCHIVE-P1: derived archive state for THIS caller. A new
      -- message advances last_message_at, so an archived thread auto-returns to
      -- Active the instant it out-ages the caller's archived_at - no write, no
      -- race, and no unarchive event to log.
      EXISTS (
        SELECT 1 FROM public.message_conversation_visibility v
        WHERE v.profile_id = v_me
          AND v.conversation_id = c.id
          AND v.archived_at >= c.last_message_at
      ) AS is_archived
    FROM public.conversations c
    WHERE (p_status IS NULL OR c.status = p_status)
      -- Explicit assignee mode: 'unassigned' is now expressible.
      AND (
        v_amode = 'any'
        OR (v_amode = 'unassigned' AND c.assigned_staff_profile_id IS NULL)
        OR (v_amode = 'specific'   AND c.assigned_staff_profile_id = p_assignee_profile_id)
      )
      -- Explicit category mode: 'uncategorized' is now expressible.
      AND (
        v_cmode = 'any'
        OR (v_cmode = 'uncategorized' AND c.category IS NULL)
        OR (v_cmode = 'specific'      AND c.category = v_category)
      )
      AND (p_flagged IS NULL OR c.follow_up_flagged = p_flagged)
      -- Subject only, exactly as the applied Phase 3 function. Message bodies
      -- are never searched.
      AND (v_search IS NULL OR c.subject ILIKE '%' || v_search || '%')
      -- MESSAGES-ARCHIVE-P1: view filter, using the SAME derived rule as the
      -- projected is_archived column above.
      AND (
        v_view = 'all'
        OR (
          v_view = 'active'
          AND NOT EXISTS (
            SELECT 1 FROM public.message_conversation_visibility v
            WHERE v.profile_id = v_me AND v.conversation_id = c.id
              AND v.archived_at >= c.last_message_at
          )
        )
        OR (
          v_view = 'archived'
          AND EXISTS (
            SELECT 1 FROM public.message_conversation_visibility v
            WHERE v.profile_id = v_me AND v.conversation_id = c.id
              AND v.archived_at >= c.last_message_at
          )
        )
      )
      -- Stable cursor: every filter above is applied BEFORE the limit, so
      -- Unassigned and Uncategorized page correctly across the whole result set.
      AND (p_cursor_ts IS NULL OR (c.last_message_at, c.id) < (p_cursor_ts, p_cursor_id))
    ORDER BY c.last_message_at DESC, c.id DESC
    LIMIT v_limit
  ) r;

  RETURN jsonb_build_object('conversations', v_rows, 'limit', v_limit);
END;
$$;

COMMENT ON FUNCTION public.messages_staff_list_conversations_v3(integer, timestamptz, uuid, text, text, uuid, text, text, boolean, text, text) IS
  'MESSAGES-ARCHIVE-P1: staff conversation inbox. Verbatim copy of messages_staff_list_conversations_v2''s body plus one added parameter, p_view (active default | archived | all), and one added projection, is_archived. Archive state is DERIVED per caller from message_conversation_visibility.archived_at >= conversations.last_message_at, so a new message auto-restores an archived thread with no write and no race. Active Owner/Admin only via is_active_owner_or_admin(); is_staff() is never used. v2 (messages_staff_list_conversations_v2) is left unchanged for rollback and as the pre-migration API fallback.';

REVOKE ALL ON FUNCTION public.messages_staff_list_conversations_v3(integer, timestamptz, uuid, text, text, uuid, text, text, boolean, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.messages_staff_list_conversations_v3(integer, timestamptz, uuid, text, text, uuid, text, text, boolean, text, text)
  TO authenticated, service_role;

-- ── 5. messages_portal_list_conversations_v3 (v2 body verbatim + p_view) ─────
-- Full body copied from messages_portal_list_conversations_v2
-- (20260730000001_messages_phase0_correctness.sql), unchanged except: the added
-- p_view parameter/validation, the added is_archived projection, and the added
-- view predicate in the WHERE clause. v2 is left untouched for rollback and as
-- the pre-migration API fallback (which itself falls back further to v1).
CREATE OR REPLACE FUNCTION public.messages_portal_list_conversations_v3(
  p_limit     integer     DEFAULT 25,
  p_cursor_ts timestamptz DEFAULT NULL,
  p_cursor_id uuid        DEFAULT NULL,
  p_view      text        DEFAULT 'active'
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER STABLE
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_me    uuid    := public.portal_profile_id();
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 25), 1), 100);
  v_view  text    := COALESCE(p_view, 'active');
  v_rows  jsonb;
BEGIN
  -- MESSAGES-ARCHIVE-P1: view. 'active' (default) hides threads the caller
  -- archived, 'archived' shows only those, 'all' ignores archive state.
  IF v_view NOT IN ('active', 'archived', 'all') THEN
    RAISE EXCEPTION 'invalid view' USING ERRCODE = 'MS400';
  END IF;

  IF v_me IS NULL THEN
    RETURN jsonb_build_object('conversations', '[]'::jsonb, 'next_cursor', NULL);
  END IF;

  SELECT COALESCE(jsonb_agg(r ORDER BY r.last_message_at DESC, r.id DESC), '[]'::jsonb) INTO v_rows
  FROM (
    SELECT
      c.id,
      c.subject,
      c.category,
      public.message_portal_status_label(c.status) AS status,
      c.last_message_at,
      (SELECT left(m.body, 160) FROM public.messages m
        WHERE m.conversation_id = c.id ORDER BY m.created_at DESC, m.id DESC LIMIT 1) AS latest_preview,
      -- Per-row unread rule matches messages_portal_unread_count (any message
      -- NOT authored by me and newer than my read pointer), exactly as v2.
      (SELECT count(*) FROM public.messages m
        WHERE m.conversation_id = c.id
          AND m.author_profile_id <> v_me
          AND m.created_at > COALESCE(
            (SELECT r2.last_read_at FROM public.participant_conversation_reads r2
              WHERE r2.participant_profile_id = v_me AND r2.conversation_id = c.id),
            '-infinity'::timestamptz)) AS unread_count,
      true AS can_reply,
      -- MESSAGES-ARCHIVE-P1: derived archive state for THIS caller. A new
      -- message advances last_message_at, so an archived thread auto-returns to
      -- Active the instant it out-ages the caller's archived_at - no write, no
      -- race, and no unarchive event to log.
      EXISTS (
        SELECT 1 FROM public.message_conversation_visibility v
        WHERE v.profile_id = v_me
          AND v.conversation_id = c.id
          AND v.archived_at >= c.last_message_at
      ) AS is_archived
    FROM public.conversations c
    WHERE c.id IN (SELECT public.my_message_conversation_ids())
      -- MESSAGES-ARCHIVE-P1: view filter, using the SAME derived rule as the
      -- projected is_archived column above.
      AND (
        v_view = 'all'
        OR (
          v_view = 'active'
          AND NOT EXISTS (
            SELECT 1 FROM public.message_conversation_visibility v
            WHERE v.profile_id = v_me AND v.conversation_id = c.id
              AND v.archived_at >= c.last_message_at
          )
        )
        OR (
          v_view = 'archived'
          AND EXISTS (
            SELECT 1 FROM public.message_conversation_visibility v
            WHERE v.profile_id = v_me AND v.conversation_id = c.id
              AND v.archived_at >= c.last_message_at
          )
        )
      )
      AND (p_cursor_ts IS NULL OR (c.last_message_at, c.id) < (p_cursor_ts, p_cursor_id))
    ORDER BY c.last_message_at DESC, c.id DESC
    LIMIT v_limit
  ) r;

  RETURN jsonb_build_object('conversations', v_rows, 'limit', v_limit);
END;
$$;

COMMENT ON FUNCTION public.messages_portal_list_conversations_v3(integer, timestamptz, uuid, text) IS
  'MESSAGES-ARCHIVE-P1: portal conversation list. Verbatim copy of messages_portal_list_conversations_v2''s body plus one added parameter, p_view (active default | archived | all), and one added projection, is_archived. Archive state is DERIVED per caller from message_conversation_visibility.archived_at >= conversations.last_message_at, so a new message auto-restores an archived thread with no write and no race. v2 (messages_portal_list_conversations_v2) is left unchanged for rollback and as the pre-migration API fallback (which itself falls back further to v1).';

REVOKE ALL ON FUNCTION public.messages_portal_list_conversations_v3(integer, timestamptz, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.messages_portal_list_conversations_v3(integer, timestamptz, uuid, text) TO authenticated, service_role;

-- ── 6. Unread counts: archived threads contribute nothing to either badge ────
-- MESSAGES-ARCHIVE-P1: both functions are REDEFINED (CREATE OR REPLACE, SAME
-- NAME) with ONE added AND NOT EXISTS clause using the SAME derived rule as the
-- v3 list functions above. Nothing else in either body changes. Rollback for
-- each is re-running its prior definition (both are reproduced verbatim, minus
-- the added clause, in docs/security/MESSAGES_ARCHIVE_VERIFICATION.md).

-- Prior definition: 20260716000002_messages_phase3_api_foundation.sql.
CREATE OR REPLACE FUNCTION public.messages_staff_unread_count()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER STABLE
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_me uuid := public.portal_profile_id();
BEGIN
  IF NOT public.is_active_owner_or_admin() THEN
    RAISE EXCEPTION 'staff access required' USING ERRCODE = 'MS403';
  END IF;
  RETURN (
    SELECT COALESCE(count(*), 0)::integer
    FROM public.messages m
    WHERE m.author_role <> 'staff'
      AND m.created_at > COALESCE(
        (SELECT r.last_read_at FROM public.staff_conversation_reads r
          WHERE r.staff_profile_id = v_me AND r.conversation_id = m.conversation_id),
        '-infinity'::timestamptz)
      -- MESSAGES-ARCHIVE-P1: an archived thread contributes nothing to the
      -- badge. Derived, so a new message auto-restores it with no write.
      AND NOT EXISTS (
        SELECT 1 FROM public.message_conversation_visibility v
        JOIN public.conversations c ON c.id = v.conversation_id
        WHERE v.profile_id = v_me
          AND v.conversation_id = m.conversation_id
          AND v.archived_at >= c.last_message_at
      )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.messages_staff_unread_count() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.messages_staff_unread_count() TO authenticated, service_role;

-- Prior definition: 20260720000000_unit_leader_portal_foundation.sql (section
-- 8f, the live non-rollback definition in that file).
CREATE OR REPLACE FUNCTION public.messages_portal_unread_count()
RETURNS integer
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public, pg_catalog
AS $$
  SELECT COALESCE(count(*), 0)::integer
  FROM public.messages m
  WHERE m.conversation_id IN (SELECT public.my_message_conversation_ids())
    AND m.author_profile_id <> public.portal_profile_id()
    AND m.created_at > COALESCE(
      (SELECT r.last_read_at FROM public.participant_conversation_reads r
        WHERE r.participant_profile_id = public.portal_profile_id()
          AND r.conversation_id = m.conversation_id),
      '-infinity'::timestamptz)
    -- MESSAGES-ARCHIVE-P1: an archived thread contributes nothing to the
    -- badge. Derived, so a new message auto-restores it with no write.
    AND NOT EXISTS (
      SELECT 1 FROM public.message_conversation_visibility v
      JOIN public.conversations c ON c.id = v.conversation_id
      WHERE v.profile_id = public.portal_profile_id()
        AND v.conversation_id = m.conversation_id
        AND v.archived_at >= c.last_message_at
    );
$$;

REVOKE ALL ON FUNCTION public.messages_portal_unread_count() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.messages_portal_unread_count() TO authenticated, service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- Read-only verification is intentionally NOT included here. After applying,
-- run docs/security/MESSAGES_ARCHIVE_VERIFICATION.md.
