-- ============================================================================
-- UNIT LEADER PORTAL: transactional integrity follow-up
-- ============================================================================
-- *** APPLY MANUALLY (Owner/Jester), AFTER 20260720000000_unit_leader_portal_    ***
-- *** foundation.sql, and ONLY after running every preflight query in            ***
-- *** db/audit/unit_leader_transactional_integrity_preflight_and_verification.sql ***
-- *** separately. Run the ENTIRE file once (transactional).                      ***
--
-- Why this exists. Three defects in the first implementation could not be fixed in
-- application code:
--
--   1. AUDIT WAS BEST EFFORT. A placement response updated the request and THEN
--      inserted its history row as a separate statement. A failure between them
--      produced a successful state change with no history. Section 2 makes the two
--      writes one transaction.
--
--   2. CAPACITY REPLACEMENT WAS NOT ATOMIC. It inserted the replacement, then
--      stamped the prior row superseded, with a compensating delete on failure.
--      Under concurrency two callers could both pass the pre-checks. Section 3
--      makes it one transaction with row locking and stale-write protection.
--
--   3. PORTAL THREAD AUTHORSHIP WAS A BINARY. messages_portal_get_thread_v2
--      projected 'staff' or 'me', collapsing author_profile_id and author_role
--      before the API ever saw them. A student reading a Unit Leader's message
--      would see it attributed to THEMSELVES, and no application-layer fix was
--      possible because the identity never left the database. Section 4 replaces
--      the projection with an identity-based three-way one.
--
-- A CREATE OR REPLACE FUNCTION is a production database change even when it adds no
-- table or column, so all of it is committed here rather than applied out of band.
--
-- Wave F-2 boundary: no bucket, no storage policy, no student file reference, and
-- no role behavior is touched. Nothing is granted to anon.
--
-- Sections
--   1. Audit-completeness columns (acting role on the two single-insert tables)
--   2. unit_placement_respond      atomic response + history
--   3. unit_capacity_submit        atomic supersede + insert
--   4. messages_portal_get_thread_v2 three-way author projection
-- ============================================================================

BEGIN;

-- ############################################################################
-- 1. Audit-completeness columns
-- ############################################################################
-- The locked audit fields include the ACTING ROLE. unit_placement_request_events
-- already carries actor_role. The milestone and nomination tables record the actor
-- profile but inferred the role from which column was populated, which is implicit.
-- These columns make it explicit without adding a second audit row anywhere.
--
-- Both tables are the audit of record for their workflow: a Unit Leader action is a
-- single INSERT carrying full attribution, the rows are never hard deleted, and a
-- correction is additive. That is why they need no companion event table.

ALTER TABLE public.unit_student_milestones
  ADD COLUMN IF NOT EXISTS confirmed_by_role text NOT NULL DEFAULT 'unit_leader';
ALTER TABLE public.unit_student_milestones
  DROP CONSTRAINT IF EXISTS chk_usm_confirmed_by_role;
ALTER TABLE public.unit_student_milestones
  ADD CONSTRAINT chk_usm_confirmed_by_role CHECK (confirmed_by_role IN ('unit_leader', 'staff'));

ALTER TABLE public.unit_preceptor_nominations
  ADD COLUMN IF NOT EXISTS nominated_by_role text NOT NULL DEFAULT 'unit_leader';
ALTER TABLE public.unit_preceptor_nominations
  DROP CONSTRAINT IF EXISTS chk_upn_nominated_by_role;
ALTER TABLE public.unit_preceptor_nominations
  ADD CONSTRAINT chk_upn_nominated_by_role CHECK (nominated_by_role IN ('unit_leader', 'staff'));


-- ############################################################################
-- 2. unit_placement_respond: atomic response and history
-- ############################################################################
-- One transaction: authorize, guard, update, append history. A successful state
-- change can no longer exist without its history row, because a failure anywhere
-- rolls the whole function back.
--
-- Authorization is re-derived INSIDE the function from the actor profile, so the
-- API cannot pass a request id it has not been authorized for. It requires an
-- ACTIVE unit_leader grant and an ACTIVE user_unit_scopes row covering the
-- request's unit AND cohort.
--
-- ASPIRE authority: only unit_response is written. aspire_status is never touched,
-- and the update is guarded on aspire_status = 'open' so a response cannot land
-- after ASPIRE has decided.
CREATE OR REPLACE FUNCTION public.unit_placement_respond(
  p_actor_profile_id uuid,
  p_request_id       uuid,
  p_unit_response    text,
  p_comment          text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_now      timestamptz := now();
  v_row      public.unit_placement_requests%ROWTYPE;
  v_from     text;
  v_comment  text := nullif(btrim(coalesce(p_comment, '')), '');
BEGIN
  IF p_unit_response NOT IN ('accepted', 'declined', 'changes_requested') THEN
    RAISE EXCEPTION 'invalid unit response' USING ERRCODE = 'MS400';
  END IF;
  IF p_unit_response = 'changes_requested' AND v_comment IS NULL THEN
    RAISE EXCEPTION 'a comment is required when requesting changes' USING ERRCODE = 'MS400';
  END IF;
  IF v_comment IS NOT NULL AND char_length(v_comment) > 2000 THEN
    RAISE EXCEPTION 'comment is too long' USING ERRCODE = 'MS400';
  END IF;

  -- Lock the request for the duration of the transaction. Two concurrent responses
  -- serialize here instead of racing the aspire_status guard.
  SELECT * INTO v_row
  FROM public.unit_placement_requests
  WHERE id = p_request_id
  FOR UPDATE;

  -- Non-enumerating: missing and out of scope are indistinguishable.
  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'not found' USING ERRCODE = 'MS404';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.user_role_grants g
    WHERE g.user_profile_id = p_actor_profile_id
      AND g.role = 'unit_leader'
      AND g.revoked_at IS NULL
      AND g.starts_at <= v_now
      AND (g.expires_at IS NULL OR g.expires_at > v_now)
  ) THEN
    RAISE EXCEPTION 'not found' USING ERRCODE = 'MS404';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.user_unit_scopes s
    WHERE s.user_profile_id = p_actor_profile_id
      AND s.unit_key = v_row.unit_key
      AND (s.cohort_id IS NULL OR s.cohort_id = v_row.cohort_id)
      AND s.revoked_at IS NULL
      AND s.starts_at <= v_now
      AND (s.expires_at IS NULL OR s.expires_at > v_now)
  ) THEN
    RAISE EXCEPTION 'not found' USING ERRCODE = 'MS404';
  END IF;

  IF v_row.aspire_status <> 'open' THEN
    RAISE EXCEPTION 'ASPIRE has already decided this request' USING ERRCODE = 'MS409';
  END IF;

  v_from := v_row.unit_response;

  UPDATE public.unit_placement_requests
  SET unit_response           = p_unit_response,
      unit_comment            = v_comment,
      responded_by_profile_id = p_actor_profile_id,
      responded_at            = v_now,
      updated_at              = v_now
  WHERE id = p_request_id
  RETURNING * INTO v_row;

  -- Same transaction. The history row cannot be missing from a successful change.
  INSERT INTO public.unit_placement_request_events (
    request_id, event_type, actor_profile_id, actor_role, unit_key,
    from_value, to_value, comment, created_at
  ) VALUES (
    p_request_id, 'unit_response', p_actor_profile_id, 'unit_leader', v_row.unit_key,
    v_from, p_unit_response, v_comment, v_now
  );

  RETURN jsonb_build_object(
    'id', v_row.id,
    'student_id', v_row.student_id,
    'cohort_id', v_row.cohort_id,
    'unit_key', v_row.unit_key,
    'unit_response', v_row.unit_response,
    'unit_comment', v_row.unit_comment,
    'responded_at', v_row.responded_at,
    'aspire_status', v_row.aspire_status,
    'aspire_note', v_row.aspire_note,
    'aspire_decided_at', v_row.aspire_decided_at,
    'awaiting_aspire_confirmation', (v_row.aspire_status = 'open'),
    'due_at', v_row.due_at,
    'created_at', v_row.created_at
  );
END $$;

REVOKE ALL ON FUNCTION public.unit_placement_respond(uuid, uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.unit_placement_respond(uuid, uuid, text, text)
  TO service_role;


-- ############################################################################
-- 3. unit_capacity_submit: atomic supersede and insert
-- ############################################################################
-- One transaction: authorize, lock the prior row, guard, supersede, insert. Under
-- concurrency the FOR UPDATE lock serializes two correction attempts, and the
-- partial unique index uq_ucs_live remains the final backstop for exactly one live
-- submission per unit, cohort, period, and shift.
--
-- ASPIRE authority: review_status is never written here.
CREATE OR REPLACE FUNCTION public.unit_capacity_submit(
  p_actor_profile_id uuid,
  p_unit_key         text,
  p_cohort_id        uuid,
  p_period_label     text,
  p_shift            text,
  p_student_count    integer,
  p_notes            text DEFAULT NULL,
  p_supersedes_id    uuid DEFAULT NULL,
  p_period_start_date date DEFAULT NULL,
  p_period_end_date   date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_now    timestamptz := now();
  v_prior  public.unit_capacity_submissions%ROWTYPE;
  v_new    public.unit_capacity_submissions%ROWTYPE;
  v_notes  text := nullif(btrim(coalesce(p_notes, '')), '');
  v_label  text := btrim(coalesce(p_period_label, ''));
BEGIN
  IF p_shift NOT IN ('any', 'day', 'evening', 'night', 'weekend') THEN
    RAISE EXCEPTION 'invalid shift' USING ERRCODE = 'MS400';
  END IF;
  IF p_student_count IS NULL OR p_student_count < 0 OR p_student_count > 99 THEN
    RAISE EXCEPTION 'invalid student count' USING ERRCODE = 'MS400';
  END IF;
  IF char_length(v_label) < 1 OR char_length(v_label) > 120 THEN
    RAISE EXCEPTION 'invalid period label' USING ERRCODE = 'MS400';
  END IF;
  IF v_notes IS NOT NULL AND char_length(v_notes) > 2000 THEN
    RAISE EXCEPTION 'notes are too long' USING ERRCODE = 'MS400';
  END IF;
  IF p_period_start_date IS NOT NULL AND p_period_end_date IS NOT NULL
     AND p_period_end_date < p_period_start_date THEN
    RAISE EXCEPTION 'period end is before period start' USING ERRCODE = 'MS400';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.user_role_grants g
    WHERE g.user_profile_id = p_actor_profile_id
      AND g.role = 'unit_leader'
      AND g.revoked_at IS NULL
      AND g.starts_at <= v_now
      AND (g.expires_at IS NULL OR g.expires_at > v_now)
  ) THEN
    RAISE EXCEPTION 'unit leader access is not active' USING ERRCODE = 'MS403';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.user_unit_scopes s
    WHERE s.user_profile_id = p_actor_profile_id
      AND s.unit_key = p_unit_key
      AND (s.cohort_id IS NULL OR s.cohort_id = p_cohort_id)
      AND s.revoked_at IS NULL
      AND s.starts_at <= v_now
      AND (s.expires_at IS NULL OR s.expires_at > v_now)
  ) THEN
    RAISE EXCEPTION 'unit is not in scope' USING ERRCODE = 'MS403';
  END IF;

  IF p_supersedes_id IS NOT NULL THEN
    -- Lock the row being replaced BEFORE re-reading its state, so a concurrent
    -- correction cannot pass the same guard.
    SELECT * INTO v_prior
    FROM public.unit_capacity_submissions
    WHERE id = p_supersedes_id
    FOR UPDATE;

    IF v_prior.id IS NULL THEN
      RAISE EXCEPTION 'not found' USING ERRCODE = 'MS404';
    END IF;
    IF v_prior.unit_key <> p_unit_key OR v_prior.cohort_id <> p_cohort_id THEN
      RAISE EXCEPTION 'superseded submission is out of scope' USING ERRCODE = 'MS403';
    END IF;
    -- Stale-write protection: the row must still be live and unreviewed.
    IF v_prior.superseded_at IS NOT NULL THEN
      RAISE EXCEPTION 'submission was already superseded' USING ERRCODE = 'MS409';
    END IF;
    IF v_prior.review_status <> 'submitted' THEN
      RAISE EXCEPTION 'submission was already reviewed' USING ERRCODE = 'MS409';
    END IF;

    UPDATE public.unit_capacity_submissions
    SET superseded_at = v_now
    WHERE id = p_supersedes_id AND superseded_at IS NULL;
  END IF;

  INSERT INTO public.unit_capacity_submissions (
    unit_key, cohort_id, period_label, period_start_date, period_end_date,
    shift, student_count, notes, supersedes_id,
    submitted_by_profile_id, submitted_at
  ) VALUES (
    p_unit_key, p_cohort_id, v_label, p_period_start_date, p_period_end_date,
    p_shift, p_student_count, v_notes, p_supersedes_id,
    p_actor_profile_id, v_now
  )
  RETURNING * INTO v_new;

  RETURN jsonb_build_object(
    'id', v_new.id,
    'unit_key', v_new.unit_key,
    'cohort_id', v_new.cohort_id,
    'period_label', v_new.period_label,
    'period_start_date', v_new.period_start_date,
    'period_end_date', v_new.period_end_date,
    'shift', v_new.shift,
    'student_count', v_new.student_count,
    'notes', v_new.notes,
    'review_status', v_new.review_status,
    'awaiting_aspire_review', (v_new.review_status = 'submitted'),
    'supersedes_id', v_new.supersedes_id,
    'superseded_at', v_new.superseded_at,
    'is_live', (v_new.superseded_at IS NULL),
    'submitted_at', v_new.submitted_at
  );
END $$;

REVOKE ALL ON FUNCTION public.unit_capacity_submit(uuid, text, uuid, text, text, integer, text, uuid, date, date)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.unit_capacity_submit(uuid, text, uuid, text, text, integer, text, uuid, date, date)
  TO service_role;


-- ############################################################################
-- 4. messages_portal_get_thread_v2: three-way author projection
-- ############################################################################
-- CREATE OR REPLACE, so the existing grants are preserved and the signature is
-- unchanged: (uuid, integer, timestamptz, uuid).
CREATE OR REPLACE FUNCTION public.messages_portal_get_thread_v2(
  p_conversation_id uuid,
  p_limit           integer     DEFAULT 50,
  p_cursor_ts       timestamptz DEFAULT NULL,
  p_cursor_id       uuid        DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER STABLE
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_me         uuid := public.portal_profile_id();
  v_limit      integer := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100);
  v_conv       jsonb;
  v_msgs       jsonb;
  v_oldest_ts  timestamptz;
  v_oldest_id  uuid;
  v_count      integer;
  v_has_more   boolean := false;
BEGIN
  -- A cursor is both parts or neither. A partial cursor is rejected rather than
  -- silently returning an empty page: a null tie-breaker makes the row
  -- comparison null, which matches nothing and would look like "no history".
  IF (p_cursor_ts IS NULL) <> (p_cursor_id IS NULL) THEN
    RAISE EXCEPTION 'invalid cursor' USING ERRCODE = 'MS400';
  END IF;

  -- Non-enumerating: an inaccessible conversation returns NULL exactly like a
  -- missing one, so a student cannot probe for conversation ids. Access comes
  -- ONLY from active student participation in this specific conversation.
  -- my_message_conversation_ids() requires an unremoved student participant row,
  -- a live student role grant, and an active student link matching the
  -- participant scope. Related staff assignment, subject, school, cohort, unit,
  -- placement, notification recipient, matching email, and student_id alone
  -- grant nothing here, and no staff helper is consulted.
  IF v_me IS NULL OR p_conversation_id NOT IN (SELECT public.my_message_conversation_ids()) THEN
    RETURN NULL;
  END IF;

  -- Conversation projection is byte-identical to v1: the student sees a coarse
  -- status label rather than the staff workflow status, and never an assignee,
  -- a flag, an internal note, or any email address.
  SELECT jsonb_build_object(
    'id', c.id, 'subject', c.subject, 'category', c.category,
    'status', public.message_portal_status_label(c.status),
    'last_message_at', c.last_message_at, 'can_reply', true
  ) INTO v_conv
  FROM public.conversations c WHERE c.id = p_conversation_id;

  IF v_conv IS NULL THEN
    RETURN NULL;
  END IF;

  -- Newest-first selection, BOUNDED BY LIMIT, then reordered ascending for
  -- chronological display. The inner query never aggregates the whole thread.
  --   no cursor      -> the newest v_limit messages
  --   with a cursor  -> the newest v_limit messages STRICTLY OLDER than it
  -- The (created_at, id) row comparison is a deterministic tuple cursor: id
  -- breaks ties so two messages sharing a timestamp still paginate exactly once,
  -- with no duplicate and no skipped row.
  WITH page AS (
    SELECT m.id, m.body, m.created_at, m.author_role, m.author_profile_id
    FROM public.messages m
    WHERE m.conversation_id = p_conversation_id
      AND (p_cursor_ts IS NULL OR (m.created_at, m.id) < (p_cursor_ts, p_cursor_id))
    ORDER BY m.created_at DESC, m.id DESC
    LIMIT v_limit
  ),
  -- The oldest row of the BOUNDED page is the backward cursor. Taken from the
  -- page itself, so no extra scan and no offset arithmetic.
  oldest AS (
    SELECT p.created_at, p.id FROM page p ORDER BY p.created_at, p.id LIMIT 1
  )
  SELECT
    COALESCE(jsonb_agg(
      jsonb_build_object(
        'id', p.id,
        'body', p.body,
        'created_at', p.created_at,
        -- UL-PORTAL three-way author projection.
        --
        -- v1 and v2 collapsed authorship to a BINARY: staff, or "me". In a direct
        -- Unit Leader to student thread that is wrong in both directions. A student
        -- reading a Unit Leader's message would see it attributed to themselves,
        -- because any non-staff author fell through to 'me' / 'You'.
        --
        -- The viewer is now compared by IDENTITY, not by role:
        --   me           author_profile_id = portal_profile_id()   -> 'You'
        --   staff        author_role = 'staff'                     -> 'ASPIRE Team'
        --   participant  the other portal party                    -> their name
        --
        -- EXISTING BEHAVIOR IS PRESERVED EXACTLY. In a student to ASPIRE Team thread
        -- the only authors are the viewing student (identity match -> 'me'/'You',
        -- as before) and staff (-> 'staff'/'ASPIRE Team', as before). The third
        -- branch is unreachable there because no second portal participant exists.
        --
        -- A participant name is the account's user_profiles.full_name, which is the
        -- same identity-backed source already used for a staff display name. No
        -- email is ever projected, for any author.
        'author_type',  CASE
          WHEN p.author_profile_id = public.portal_profile_id() THEN 'me'
          WHEN p.author_role = 'staff' THEN 'staff'
          ELSE 'participant' END,
        'author_label', CASE
          WHEN p.author_profile_id = public.portal_profile_id() THEN 'You'
          WHEN p.author_role = 'staff' THEN 'ASPIRE Team'
          ELSE COALESCE(
            (SELECT up.full_name FROM public.user_profiles up WHERE up.id = p.author_profile_id),
            CASE p.author_role
              WHEN 'unit_leader' THEN 'Unit Leader'
              WHEN 'student' THEN 'ASPIRE student'
              ELSE 'ASPIRE' END) END,
        'author_name',  CASE
          WHEN p.author_profile_id = public.portal_profile_id() THEN NULL
          ELSE (SELECT up.full_name FROM public.user_profiles up WHERE up.id = p.author_profile_id)
          END,
        -- The acting role is now surfaced so the UI can badge a Unit Leader
        -- distinctly from ASPIRE staff without inferring it from the label.
        'author_role', p.author_role
      ) ORDER BY p.created_at, p.id
    ), '[]'::jsonb),
    (SELECT o.created_at FROM oldest o),
    (SELECT o.id FROM oldest o),
    count(*)::integer
  INTO v_msgs, v_oldest_ts, v_oldest_id, v_count
  FROM page p;

  -- Older history remains only when a message exists strictly older than the
  -- oldest row of this page. Bounded existence check, never a full fetch. This
  -- is what lets the API report has_more without over-fetching by one row.
  IF v_count > 0 AND v_oldest_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM public.messages m
      WHERE m.conversation_id = p_conversation_id
        AND (m.created_at, m.id) < (v_oldest_ts, v_oldest_id)
    ) INTO v_has_more;
  END IF;

  RETURN jsonb_build_object(
    'conversation', v_conv,
    'messages', v_msgs,
    'limit', v_limit,
    'has_more', v_has_more,
    -- next_cursor points at the OLDEST message of this page, so the next request
    -- continues BACKWARD through history. Null when no older history remains.
    'next_cursor', CASE WHEN v_has_more
      THEN jsonb_build_object('cursor_ts', v_oldest_ts, 'cursor_id', v_oldest_id)
      ELSE NULL END
  );
END;
$$;

COMMIT;


-- ============================================================================
-- Verification: see
-- db/audit/unit_leader_transactional_integrity_preflight_and_verification.sql
-- ============================================================================

-- Rollback. Restores the Phase 5 author projection verbatim, drops the two new
-- RPCs, and removes the two audit columns. The columns carry only values written
-- after this migration, and every default is 'unit_leader', so dropping them
-- discards no pre-existing attribution.
/*
BEGIN;

CREATE OR REPLACE FUNCTION public.messages_portal_get_thread_v2(
  p_conversation_id uuid,
  p_limit           integer     DEFAULT 50,
  p_cursor_ts       timestamptz DEFAULT NULL,
  p_cursor_id       uuid        DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER STABLE
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_me         uuid := public.portal_profile_id();
  v_limit      integer := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100);
  v_conv       jsonb;
  v_msgs       jsonb;
  v_oldest_ts  timestamptz;
  v_oldest_id  uuid;
  v_count      integer;
  v_has_more   boolean := false;
BEGIN
  -- A cursor is both parts or neither. A partial cursor is rejected rather than
  -- silently returning an empty page: a null tie-breaker makes the row
  -- comparison null, which matches nothing and would look like "no history".
  IF (p_cursor_ts IS NULL) <> (p_cursor_id IS NULL) THEN
    RAISE EXCEPTION 'invalid cursor' USING ERRCODE = 'MS400';
  END IF;

  -- Non-enumerating: an inaccessible conversation returns NULL exactly like a
  -- missing one, so a student cannot probe for conversation ids. Access comes
  -- ONLY from active student participation in this specific conversation.
  -- my_message_conversation_ids() requires an unremoved student participant row,
  -- a live student role grant, and an active student link matching the
  -- participant scope. Related staff assignment, subject, school, cohort, unit,
  -- placement, notification recipient, matching email, and student_id alone
  -- grant nothing here, and no staff helper is consulted.
  IF v_me IS NULL OR p_conversation_id NOT IN (SELECT public.my_message_conversation_ids()) THEN
    RETURN NULL;
  END IF;

  -- Conversation projection is byte-identical to v1: the student sees a coarse
  -- status label rather than the staff workflow status, and never an assignee,
  -- a flag, an internal note, or any email address.
  SELECT jsonb_build_object(
    'id', c.id, 'subject', c.subject, 'category', c.category,
    'status', public.message_portal_status_label(c.status),
    'last_message_at', c.last_message_at, 'can_reply', true
  ) INTO v_conv
  FROM public.conversations c WHERE c.id = p_conversation_id;

  IF v_conv IS NULL THEN
    RETURN NULL;
  END IF;

  -- Newest-first selection, BOUNDED BY LIMIT, then reordered ascending for
  -- chronological display. The inner query never aggregates the whole thread.
  --   no cursor      -> the newest v_limit messages
  --   with a cursor  -> the newest v_limit messages STRICTLY OLDER than it
  -- The (created_at, id) row comparison is a deterministic tuple cursor: id
  -- breaks ties so two messages sharing a timestamp still paginate exactly once,
  -- with no duplicate and no skipped row.
  WITH page AS (
    SELECT m.id, m.body, m.created_at, m.author_role, m.author_profile_id
    FROM public.messages m
    WHERE m.conversation_id = p_conversation_id
      AND (p_cursor_ts IS NULL OR (m.created_at, m.id) < (p_cursor_ts, p_cursor_id))
    ORDER BY m.created_at DESC, m.id DESC
    LIMIT v_limit
  ),
  -- The oldest row of the BOUNDED page is the backward cursor. Taken from the
  -- page itself, so no extra scan and no offset arithmetic.
  oldest AS (
    SELECT p.created_at, p.id FROM page p ORDER BY p.created_at, p.id LIMIT 1
  )
  SELECT
    COALESCE(jsonb_agg(
      jsonb_build_object(
        'id', p.id,
        'body', p.body,
        'created_at', p.created_at,
        -- Author projection is byte-identical to v1. Staff are labeled as the
        -- team, with an optional staff display name and never a staff email.
        'author_type',  CASE WHEN p.author_role = 'staff' THEN 'staff' ELSE 'me' END,
        'author_label', CASE WHEN p.author_role = 'staff' THEN 'ASPIRE Team' ELSE 'You' END,
        'author_name',  CASE WHEN p.author_role = 'staff'
          THEN (SELECT up.full_name FROM public.user_profiles up WHERE up.id = p.author_profile_id)
          ELSE NULL END
      ) ORDER BY p.created_at, p.id
    ), '[]'::jsonb),
    (SELECT o.created_at FROM oldest o),
    (SELECT o.id FROM oldest o),
    count(*)::integer
  INTO v_msgs, v_oldest_ts, v_oldest_id, v_count
  FROM page p;

  -- Older history remains only when a message exists strictly older than the
  -- oldest row of this page. Bounded existence check, never a full fetch. This
  -- is what lets the API report has_more without over-fetching by one row.
  IF v_count > 0 AND v_oldest_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM public.messages m
      WHERE m.conversation_id = p_conversation_id
        AND (m.created_at, m.id) < (v_oldest_ts, v_oldest_id)
    ) INTO v_has_more;
  END IF;

  RETURN jsonb_build_object(
    'conversation', v_conv,
    'messages', v_msgs,
    'limit', v_limit,
    'has_more', v_has_more,
    -- next_cursor points at the OLDEST message of this page, so the next request
    -- continues BACKWARD through history. Null when no older history remains.
    'next_cursor', CASE WHEN v_has_more
      THEN jsonb_build_object('cursor_ts', v_oldest_ts, 'cursor_id', v_oldest_id)
      ELSE NULL END
  );
END;
$$;

DROP FUNCTION IF EXISTS public.unit_capacity_submit(uuid, text, uuid, text, text, integer, text, uuid, date, date);
DROP FUNCTION IF EXISTS public.unit_placement_respond(uuid, uuid, text, text);

ALTER TABLE public.unit_preceptor_nominations DROP CONSTRAINT IF EXISTS chk_upn_nominated_by_role;
ALTER TABLE public.unit_preceptor_nominations DROP COLUMN IF EXISTS nominated_by_role;
ALTER TABLE public.unit_student_milestones DROP CONSTRAINT IF EXISTS chk_usm_confirmed_by_role;
ALTER TABLE public.unit_student_milestones DROP COLUMN IF EXISTS confirmed_by_role;

COMMIT;
*/
