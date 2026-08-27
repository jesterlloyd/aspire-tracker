-- ############################################################################
-- Enable Nursing Education & Leadership portal utilities (Messages + Feedback)
--
-- NA-PORTAL-UTILITIES-1. Owner-gated. NOT auto-applied by this branch. Activates, for the
-- nursing_academic portal role, the two capabilities every other portal already has:
--   * general Nursing Education & Leadership <-> ASPIRE Team messages, and
--   * portal feedback (Send feedback / Report a Bug).
--
-- Mirrors 20260728000000_enable_academic_partner_team_messages.sql: the SECURITY DEFINER
-- authorization predicates and the shared general-team start core are re-declared from their LATEST
-- applied definitions with ONLY the additive nursing_academic arms (assembled and assertion-patched
-- from the source migrations so nothing else drifts). Unlike the AP enablement, the nursing_academic
-- participant shape was NOT pre-reserved by the schema, so this migration also widens four CHECK
-- constraints (participant scope kind + role/scope shape, conversation creator role, message author
-- role) and the portal feedback role CHECK - all strictly additive.
--
-- Security model for the nursing_academic path (all server-derived):
--   * caller must hold an ACTIVE nursing_academic role grant (the role is org-wide by design:
--     NURSING-ACADEMICS-1 has no narrower scope table);
--   * a thread is readable/sendable only by a participant row with participant_role =
--     'nursing_academic', scope_kind = 'general', and NO student/unit/school/cohort context, on a
--     conversation that itself carries no student/unit/cohort context (general team threads only);
--   * the recipient is LOCKED to the ASPIRE Team shared inbox (aspire@cshs.org), asserted before
--     any write, exactly like the Academic Partner path.
--
-- ATOMIC: one transaction; the capability sentinel (public.na_portal_utilities_capability) is
-- created LAST so the server gate can never report enabled from a half-applied migration.
-- Copy ONLY the BEGIN..COMMIT block into the SQL editor; verification and rollback are comments.
-- ############################################################################

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. Widened CHECK constraints (additive; existing rows all satisfy the new lists)
-- ----------------------------------------------------------------------------
ALTER TABLE public.conversation_participants
  DROP CONSTRAINT IF EXISTS chk_participant_scope_kind;
ALTER TABLE public.conversation_participants
  ADD CONSTRAINT chk_participant_scope_kind
    CHECK (scope_kind IN ('student', 'unit', 'school', 'general'));

ALTER TABLE public.conversation_participants
  DROP CONSTRAINT IF EXISTS chk_participant_role_scope;
ALTER TABLE public.conversation_participants
  ADD CONSTRAINT chk_participant_role_scope CHECK (
    (participant_role = 'student'
      AND scope_kind = 'student'
      AND scope_unit_key IS NULL
      AND scope_school_key IS NULL
      AND scope_cohort_id IS NULL)
    OR
    (participant_role = 'preceptor'
      AND scope_kind = 'student'
      AND scope_student_id IS NOT NULL
      AND scope_unit_key IS NULL
      AND scope_school_key IS NULL)
    OR
    (participant_role = 'unit_leader'
      AND scope_kind = 'unit'
      AND scope_school_key IS NULL
      AND scope_cohort_id IS NULL)
    OR
    (participant_role = 'academic_partner'
      AND scope_kind = 'school'
      AND scope_school_key IS NOT NULL
      AND scope_student_id IS NULL
      AND scope_unit_key IS NULL)
    OR
    (participant_role = 'nursing_academic'
      AND scope_kind = 'general'
      AND scope_student_id IS NULL
      AND scope_unit_key IS NULL
      AND scope_school_key IS NULL
      AND scope_cohort_id IS NULL)
  );

ALTER TABLE public.conversations
  DROP CONSTRAINT IF EXISTS chk_conversations_created_by_role;
ALTER TABLE public.conversations
  ADD CONSTRAINT chk_conversations_created_by_role
    CHECK (created_by_role IN ('student', 'unit_leader', 'academic_partner', 'preceptor', 'staff', 'nursing_academic'));

ALTER TABLE public.messages
  DROP CONSTRAINT IF EXISTS chk_messages_author_role;
ALTER TABLE public.messages
  ADD CONSTRAINT chk_messages_author_role
    CHECK (author_role IN ('student', 'unit_leader', 'academic_partner', 'preceptor', 'staff', 'nursing_academic'));

ALTER TABLE public.portal_feedback_submissions
  DROP CONSTRAINT IF EXISTS chk_portal_feedback_role;
ALTER TABLE public.portal_feedback_submissions
  ADD CONSTRAINT chk_portal_feedback_role
    CHECK (portal_role IN ('student', 'unit_leader', 'academic_partner', 'nursing_academic'));

-- ----------------------------------------------------------------------------
-- 2. Active Nursing Education & Leadership portal predicate (org-wide grant)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.message_profile_has_active_nursing_academic_portal_scope(
  p_profile_id uuid
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_catalog
AS $$
  SELECT public.message_profile_is_active(p_profile_id)
    AND EXISTS (
      SELECT 1 FROM public.user_role_grants g
      WHERE g.user_profile_id = p_profile_id
        AND g.role = 'nursing_academic'
        AND g.revoked_at IS NULL
        AND g.starts_at <= now()
        AND (g.expires_at IS NULL OR g.expires_at > now())
    );
$$;

-- ----------------------------------------------------------------------------
-- 3. Read predicate: student / unit_leader / academic_partner branches byte-identical to
--    20260728000000; the nursing_academic branch is ADDED.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.message_participant_can_read(
  p_conversation_id uuid,
  p_profile_id      uuid
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_catalog
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.conversation_participants cp
    WHERE cp.conversation_id = p_conversation_id
      AND cp.participant_profile_id = p_profile_id
      AND cp.removed_at IS NULL
      AND (
        (
          cp.participant_role = 'student'
          AND cp.scope_kind = 'student'
          AND (
            (
              cp.scope_student_id IS NULL
              AND public.message_profile_has_active_student_portal(p_profile_id)
            )
            OR
            (
              cp.scope_student_id IS NOT NULL
              AND EXISTS (
                SELECT 1 FROM public.user_role_grants g
                WHERE g.user_profile_id = p_profile_id
                  AND g.role = 'student'
                  AND g.revoked_at IS NULL
                  AND g.starts_at <= now()
                  AND (g.expires_at IS NULL OR g.expires_at > now())
              )
              AND EXISTS (
                SELECT 1 FROM public.user_student_links l
                WHERE l.user_profile_id = p_profile_id
                  AND l.student_id = cp.scope_student_id
                  AND l.revoked_at IS NULL
              )
            )
          )
        )
        OR
        (
          cp.participant_role = 'unit_leader'
          AND cp.scope_kind = 'unit'
          AND public.message_profile_is_active(p_profile_id)
          AND EXISTS (
            SELECT 1 FROM public.user_role_grants g
            WHERE g.user_profile_id = p_profile_id
              AND g.role = 'unit_leader'
              AND g.revoked_at IS NULL
              AND g.starts_at <= now()
              AND (g.expires_at IS NULL OR g.expires_at > now())
          )
        )
        OR
        (
          -- ADDED: an Academic Partner reads a GENERAL school thread ONLY. This is enforced
          -- EXPLICITLY, not by comment or the participant CHECK constraint alone:
          --   * the participant row is a school-scoped academic_partner row with NO student/unit/cohort
          --     context (scope_student_id / scope_unit_key / scope_cohort_id all NULL);
          --   * the CONVERSATION itself carries no student/unit/cohort context. Because there is no
          --     stored thread_kind column, the school-scoped participant PLUS these null-context checks
          --     ARE the canonical general-team discriminator;
          --   * scope_school_key EXACTLY matches one of the caller's active school scopes (WCU campuses
          --     isolated; never LIKE/substring/email-domain/display-name; revoked/expired fails closed).
          -- A removed participant row is already excluded by cp.removed_at IS NULL above.
          cp.participant_role = 'academic_partner'
          AND cp.scope_kind = 'school'
          AND cp.scope_school_key IS NOT NULL
          AND cp.scope_student_id IS NULL
          AND cp.scope_unit_key IS NULL
          AND cp.scope_cohort_id IS NULL
          AND public.message_profile_is_active(p_profile_id)
          AND EXISTS (
            SELECT 1 FROM public.conversations c
            WHERE c.id = cp.conversation_id
              AND c.related_student_id IS NULL
              AND c.related_unit_key IS NULL
              AND c.related_cohort_id IS NULL
          )
          AND EXISTS (
            SELECT 1 FROM public.user_role_grants g
            WHERE g.user_profile_id = p_profile_id
              AND g.role = 'academic_partner'
              AND g.revoked_at IS NULL
              AND g.starts_at <= now()
              AND (g.expires_at IS NULL OR g.expires_at > now())
          )
          AND EXISTS (
            SELECT 1 FROM public.user_school_scopes s
            WHERE s.user_profile_id = p_profile_id
              AND s.school_key = cp.scope_school_key
              AND s.revoked_at IS NULL
              AND s.starts_at <= now()
              AND (s.expires_at IS NULL OR s.expires_at > now())
          )
        )
        OR
        (
          -- ADDED (NA-PORTAL-UTILITIES-1): a Nursing Education & Leadership member reads a GENERAL
          -- team thread ONLY. Enforced EXPLICITLY:
          --   * the participant row is a nursing_academic row with scope_kind = 'general' and NO
          --     student/unit/school/cohort context;
          --   * the CONVERSATION itself carries no student/unit/cohort context (with the school-less
          --     participant shape, these null-context checks ARE the general-team discriminator);
          --   * the caller holds an ACTIVE nursing_academic role grant. The role is org-wide by
          --     design (NURSING-ACADEMICS-1); no narrower scope table exists for it.
          cp.participant_role = 'nursing_academic'
          AND cp.scope_kind = 'general'
          AND cp.scope_student_id IS NULL
          AND cp.scope_unit_key IS NULL
          AND cp.scope_school_key IS NULL
          AND cp.scope_cohort_id IS NULL
          AND public.message_profile_is_active(p_profile_id)
          AND EXISTS (
            SELECT 1 FROM public.conversations c
            WHERE c.id = cp.conversation_id
              AND c.related_student_id IS NULL
              AND c.related_unit_key IS NULL
              AND c.related_cohort_id IS NULL
          )
          AND EXISTS (
            SELECT 1 FROM public.user_role_grants g
            WHERE g.user_profile_id = p_profile_id
              AND g.role = 'nursing_academic'
              AND g.revoked_at IS NULL
              AND g.starts_at <= now()
              AND (g.expires_at IS NULL OR g.expires_at > now())
          )
        )
      )
  );
$$;

-- ----------------------------------------------------------------------------
-- 4. Send predicate: unchanged composition (can_read now admits nursing_academic; the extra guard
--    remains unit_leader-staleness only). Re-declared byte-for-byte for completeness.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.message_participant_can_send(
  p_conversation_id uuid,
  p_profile_id      uuid
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_catalog
AS $$
  SELECT
    public.message_participant_can_read(p_conversation_id, p_profile_id)
    AND NOT EXISTS (
      SELECT 1
      FROM public.conversation_participants cp
      WHERE cp.conversation_id = p_conversation_id
        AND cp.removed_at IS NULL
        AND cp.participant_role = 'unit_leader'
        AND (
          (
            cp.scope_unit_key IS NOT NULL
            AND NOT EXISTS (
              SELECT 1 FROM public.user_unit_scopes s
              WHERE s.user_profile_id = cp.participant_profile_id
                AND s.unit_key = cp.scope_unit_key
                AND s.revoked_at IS NULL
                AND s.starts_at <= now()
                AND (s.expires_at IS NULL OR s.expires_at > now())
            )
          )
          OR
          (
            cp.scope_unit_key IS NULL
            AND NOT public.message_profile_has_active_unit_leader_portal_scope(cp.participant_profile_id)
          )
        )
    );
$$;

-- ----------------------------------------------------------------------------
-- 5. General-team start core: re-declared from 20260728000000 with the additive nursing_academic
--    arms (kind list, shared-inbox recipient lock, access check, participant shape). Student,
--    Unit Leader, and Academic Partner behavior is byte-identical.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.messages_start_general_team_conversation_core(
  p_actor_profile_id       uuid,
  p_actor_kind             text,
  p_request_id             uuid,
  p_payload_fingerprint    text,
  p_subject                text,
  p_category               text,
  p_body                   text,
  p_delivery               jsonb,
  p_scope_school_key       text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_now              timestamptz := now();
  v_request_row_id   uuid;
  v_existing         public.message_creation_requests%ROWTYPE;
  v_conversation_id  uuid;
  v_message_id       uuid;
  v_delivery_id      uuid;
  v_subject          text := btrim(coalesce(p_subject, ''));
  v_category         text := nullif(btrim(coalesce(p_category, '')), '');
  v_rate             jsonb;
  v_school_key       text;        -- the verified authorized school (academic_partner only)
  v_ap_recipient_kind    text;    -- fixed-recipient assertion (academic_partner only)
  v_ap_recipient_email   text;
  v_ap_recipient_profile text;
BEGIN
  IF p_actor_kind NOT IN ('student', 'unit_leader', 'academic_partner', 'nursing_academic') THEN
    RAISE EXCEPTION 'invalid actor kind' USING ERRCODE = 'MS400';
  END IF;
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'request id is required' USING ERRCODE = 'MS400';
  END IF;
  IF p_payload_fingerprint IS NULL OR p_payload_fingerprint !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'payload fingerprint is invalid' USING ERRCODE = 'MS400';
  END IF;
  IF char_length(v_subject) < 3 OR char_length(v_subject) > 120 THEN
    RAISE EXCEPTION 'subject must be 3 to 120 characters' USING ERRCODE = 'MS400';
  END IF;
  IF v_category IS DISTINCT FROM 'General question' THEN
    RAISE EXCEPTION 'general team category must be General question' USING ERRCODE = 'MS400';
  END IF;
  IF char_length(btrim(coalesce(p_body, ''))) < 1 OR char_length(p_body) > 5000 THEN
    RAISE EXCEPTION 'body must be 1 to 5000 characters' USING ERRCODE = 'MS400';
  END IF;

  -- Academic Partner: the recipient is LOCKED to the ASPIRE Team shared inbox. The shared validator
  -- message_assert_valid_delivery already forces recipient_kind = 'shared_inbox' for new_conversation,
  -- but does NOT pin the exact address, so the AP path additionally requires the canonical
  -- aspire@cshs.org recipient (lib/server/messages/config.js SHARED_INBOX_EMAIL), the shared_inbox
  -- kind, and NO recipient_profile_id (never an arbitrary staff member / recipient). Checked BEFORE any
  -- write (before the idempotency ledger insert), so a rejected recipient leaves no row. Generic safe
  -- error; no individual staff identity is disclosed.
  IF p_actor_kind IN ('academic_partner', 'nursing_academic') THEN
    v_ap_recipient_kind    := coalesce(p_delivery->>'recipient_kind', '');
    v_ap_recipient_email   := lower(btrim(coalesce(p_delivery->>'recipient_email', '')));
    v_ap_recipient_profile := nullif(btrim(coalesce(p_delivery->>'recipient_profile_id', '')), '');
    IF v_ap_recipient_kind <> 'shared_inbox'
       OR v_ap_recipient_email <> 'aspire@cshs.org'
       OR v_ap_recipient_profile IS NOT NULL THEN
      RAISE EXCEPTION 'portal messages must be sent to the ASPIRE Team' USING ERRCODE = 'MS403';
    END IF;
  END IF;

  INSERT INTO public.message_creation_requests (
    actor_profile_id, operation_kind, request_id, payload_fingerprint,
    status, created_at, updated_at
  ) VALUES (
    p_actor_profile_id, 'general_team_thread_start', p_request_id,
    p_payload_fingerprint, 'in_progress', v_now, v_now
  )
  ON CONFLICT (actor_profile_id, operation_kind, request_id) DO NOTHING
  RETURNING id INTO v_request_row_id;

  IF v_request_row_id IS NULL THEN
    SELECT *
    INTO v_existing
    FROM public.message_creation_requests
    WHERE actor_profile_id = p_actor_profile_id
      AND operation_kind = 'general_team_thread_start'
      AND request_id = p_request_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'request idempotency state was not found' USING ERRCODE = 'MS409';
    END IF;
    IF v_existing.payload_fingerprint IS DISTINCT FROM p_payload_fingerprint THEN
      RAISE EXCEPTION 'request id was already used with a different payload' USING ERRCODE = 'MS409';
    END IF;
    IF v_existing.status = 'completed'
       AND v_existing.conversation_id IS NOT NULL
       AND v_existing.message_id IS NOT NULL
       AND v_existing.delivery_id IS NOT NULL THEN
      RETURN jsonb_build_object(
        'conversation_id', v_existing.conversation_id,
        'message_id', v_existing.message_id,
        'delivery_id', v_existing.delivery_id,
        'created_at', v_existing.completed_at,
        'status', 'open',
        'thread_kind', 'team_general',
        'idempotent_replay', true
      );
    END IF;

    RAISE EXCEPTION 'request is already in progress' USING ERRCODE = 'MS409';
  END IF;

  IF p_actor_kind = 'student' THEN
    IF NOT public.message_profile_has_active_student_portal(p_actor_profile_id) THEN
      RAISE EXCEPTION 'student portal access is not active' USING ERRCODE = 'MS403';
    END IF;
  ELSIF p_actor_kind = 'unit_leader' THEN
    IF NOT public.message_profile_has_active_unit_leader_portal_scope(p_actor_profile_id) THEN
      RAISE EXCEPTION 'unit leader access is not active' USING ERRCODE = 'MS403';
    END IF;
  ELSIF p_actor_kind = 'academic_partner' THEN
    -- academic_partner: verify active grant + scope, then re-verify the SERVER-SUPPLIED school key is
    -- an active scope for this actor (browser selection is never trusted; the caller passes only a
    -- server-verified canonical key, and this is the SQL re-verification). Exact match => WCU isolated.
    IF NOT public.message_profile_has_active_academic_partner_portal_scope(p_actor_profile_id) THEN
      RAISE EXCEPTION 'academic partner access is not active' USING ERRCODE = 'MS403';
    END IF;
    v_school_key := btrim(coalesce(p_scope_school_key, ''));
    IF v_school_key = '' THEN
      RAISE EXCEPTION 'academic partner school scope is required' USING ERRCODE = 'MS400';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.user_school_scopes s
      WHERE s.user_profile_id = p_actor_profile_id
        AND s.school_key = v_school_key
        AND s.revoked_at IS NULL
        AND s.starts_at <= v_now
        AND (s.expires_at IS NULL OR s.expires_at > v_now)
    ) THEN
      RAISE EXCEPTION 'academic partner school scope is not active' USING ERRCODE = 'MS403';
    END IF;
  ELSE
    -- nursing_academic: an active org-wide grant is the whole requirement (no
    -- narrower scope exists for the role by design). p_scope_school_key is
    -- ignored for this kind.
    IF NOT public.message_profile_has_active_nursing_academic_portal_scope(p_actor_profile_id) THEN
      RAISE EXCEPTION 'nursing education access is not active' USING ERRCODE = 'MS403';
    END IF;
  END IF;

  SELECT public.consume_message_rate_limit(
    p_actor_profile_id, 'new_conversation', 3600, 5
  ) INTO v_rate;
  IF NOT COALESCE((v_rate->>'allowed')::boolean, false) THEN
    RAISE EXCEPTION 'new conversation rate limited' USING ERRCODE = 'MS429';
  END IF;

  SELECT public.consume_message_rate_limit(
    p_actor_profile_id, 'message', 600, 20
  ) INTO v_rate;
  IF NOT COALESCE((v_rate->>'allowed')::boolean, false) THEN
    RAISE EXCEPTION 'message rate limited' USING ERRCODE = 'MS429';
  END IF;

  -- Shared delivery invariants (no content, shared_inbox kind for new_conversation, snapshot/CTA
  -- fields, sender != recipient). For academic_partner the exact aspire@cshs.org recipient was already
  -- pre-asserted above, before any write.
  PERFORM public.message_assert_valid_delivery(p_delivery, 'new_conversation', p_actor_profile_id);

  INSERT INTO public.conversations (
    subject, category, status, created_by_profile_id, created_by_role,
    related_student_id, related_unit_key, related_school_key, related_cohort_id,
    last_message_at, created_at, updated_at
  ) VALUES (
    v_subject, v_category, 'open', p_actor_profile_id, p_actor_kind,
    NULL, NULL, NULL, NULL,
    v_now, v_now, v_now
  ) RETURNING id INTO v_conversation_id;

  IF p_actor_kind = 'student' THEN
    INSERT INTO public.conversation_participants (
      conversation_id, participant_profile_id, participant_role, scope_kind,
      scope_student_id, scope_unit_key, scope_school_key, scope_cohort_id, added_at
    ) VALUES (
      v_conversation_id, p_actor_profile_id, 'student', 'student',
      NULL, NULL, NULL, NULL, v_now
    );
  ELSIF p_actor_kind = 'unit_leader' THEN
    INSERT INTO public.conversation_participants (
      conversation_id, participant_profile_id, participant_role, scope_kind,
      scope_student_id, scope_unit_key, scope_school_key, scope_cohort_id, added_at
    ) VALUES (
      v_conversation_id, p_actor_profile_id, 'unit_leader', 'unit',
      NULL, NULL, NULL, NULL, v_now
    );
  ELSIF p_actor_kind = 'academic_partner' THEN
    -- academic_partner: school-scoped participant with the verified authorized school. No student/unit
    -- context, matching chk_participant_role_scope for the academic_partner shape.
    INSERT INTO public.conversation_participants (
      conversation_id, participant_profile_id, participant_role, scope_kind,
      scope_student_id, scope_unit_key, scope_school_key, scope_cohort_id, added_at
    ) VALUES (
      v_conversation_id, p_actor_profile_id, 'academic_partner', 'school',
      NULL, NULL, v_school_key, NULL, v_now
    );
  ELSE
    -- nursing_academic: general-scope participant with no student/unit/school/cohort
    -- context, matching the chk_participant_role_scope nursing_academic shape.
    INSERT INTO public.conversation_participants (
      conversation_id, participant_profile_id, participant_role, scope_kind,
      scope_student_id, scope_unit_key, scope_school_key, scope_cohort_id, added_at
    ) VALUES (
      v_conversation_id, p_actor_profile_id, 'nursing_academic', 'general',
      NULL, NULL, NULL, NULL, v_now
    );
  END IF;

  INSERT INTO public.messages (conversation_id, author_profile_id, author_role, body, created_at)
  VALUES (v_conversation_id, p_actor_profile_id, p_actor_kind, p_body, v_now)
  RETURNING id INTO v_message_id;

  INSERT INTO public.conversation_events (conversation_id, event_type, actor_profile_id, to_value, created_at)
  VALUES (v_conversation_id, 'created', p_actor_profile_id, 'open', v_now);

  INSERT INTO public.participant_conversation_reads (participant_profile_id, conversation_id, last_read_at)
  VALUES (p_actor_profile_id, v_conversation_id, v_now)
  ON CONFLICT (participant_profile_id, conversation_id) DO UPDATE SET last_read_at = v_now;

  BEGIN
    INSERT INTO public.message_notification_deliveries (
      conversation_id, message_id, triggered_by_profile_id, recipient_profile_id,
      recipient_email, recipient_kind, event_type, idempotency_key,
      queue_status, next_attempt_at,
      snapshot_sender_name, snapshot_subject, snapshot_category, cta_path
    ) VALUES (
      v_conversation_id, v_message_id, p_actor_profile_id,
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

  UPDATE public.message_creation_requests
  SET status = 'completed',
      conversation_id = v_conversation_id,
      message_id = v_message_id,
      delivery_id = v_delivery_id,
      completed_at = v_now,
      updated_at = v_now
  WHERE id = v_request_row_id;

  RETURN jsonb_build_object(
    'conversation_id', v_conversation_id,
    'message_id', v_message_id,
    'delivery_id', v_delivery_id,
    'created_at', v_now,
    'status', 'open',
    'thread_kind', 'team_general',
    'idempotent_replay', false
  );
END;
$$;

COMMENT ON FUNCTION public.messages_start_general_team_conversation_core(uuid, text, uuid, text, text, text, text, jsonb, text) IS
  'Internal only (not granted; invoked by the SECURITY DEFINER entry RPCs). Idempotent general ASPIRE Team thread workflow: ledger, rate limits, delivery validation, and conversation/message/event/read/delivery inserts. p_scope_school_key is NULL for student/unit_leader/nursing_academic and the SERVER-VERIFIED canonical school_key for academic_partner. Academic Partner and Nursing Education & Leadership deliveries are locked to aspire@cshs.org before any write.';

-- ----------------------------------------------------------------------------
-- 6. Dedicated Nursing Education & Leadership start RPC. Distinct name (no ambiguous overload).
--    Verifies the active nursing_academic grant BEFORE delegating (the core can return a completed
--    idempotent replay before its own access checks; gating here keeps a revoked caller away from
--    that replay path). The core re-checks too (defense in depth).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.messages_start_general_team_conversation_na(
  p_actor_profile_id       uuid,
  p_request_id             uuid,
  p_payload_fingerprint    text,
  p_subject                text,
  p_category               text,
  p_body                   text,
  p_delivery               jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF NOT public.message_profile_has_active_nursing_academic_portal_scope(p_actor_profile_id) THEN
    RAISE EXCEPTION 'nursing education access is not active' USING ERRCODE = 'MS403';
  END IF;
  RETURN public.messages_start_general_team_conversation_core(
    p_actor_profile_id, 'nursing_academic', p_request_id, p_payload_fingerprint,
    p_subject, p_category, p_body, p_delivery, NULL
  );
END;
$$;

COMMENT ON FUNCTION public.messages_start_general_team_conversation_na(uuid, uuid, text, text, text, text, jsonb) IS
  'Service-role-only. Idempotently starts a general Nursing Education & Leadership -> ASPIRE Team conversation for a caller with an ACTIVE nursing_academic grant. General-thread null context and the fixed aspire@cshs.org recipient are enforced in the core before any write.';

-- ----------------------------------------------------------------------------
-- 7. Portal feedback RPC: re-declared from 20260724000000 with ONLY the widened portal_role list.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.submit_portal_feedback_report(
  p_reporter_context    jsonb,
  p_payload             jsonb,
  p_payload_fingerprint text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_now                 timestamptz := now();
  v_profile_id          uuid := (p_reporter_context->>'reporter_profile_id')::uuid;
  v_request_id          text := p_payload->>'request_id';
  v_existing            public.portal_feedback_submissions%ROWTYPE;
  v_submission          public.portal_feedback_submissions%ROWTYPE;
  v_delivery_id         uuid;
  v_count               integer;
  v_window              timestamptz;
  v_reset_at            timestamptz;
BEGIN
  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'missing reporter profile id' USING ERRCODE = 'PF400';
  END IF;
  IF p_reporter_context->>'portal_role' NOT IN ('student', 'unit_leader', 'academic_partner', 'nursing_academic') THEN
    RAISE EXCEPTION 'invalid portal role' USING ERRCODE = 'PF400';
  END IF;
  IF p_payload->>'type' NOT IN ('feedback', 'bug') THEN
    RAISE EXCEPTION 'invalid submission type' USING ERRCODE = 'PF400';
  END IF;

  -- Serialize the idempotency lane for this reporter/request id before the
  -- existence check, rate consumption, authoritative insert, and outbox insert.
  -- This prevents concurrent identical first attempts from over-consuming the
  -- accepted-submission rate limit or surfacing a raw unique-constraint error.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(v_profile_id::text || ':' || COALESCE(v_request_id, ''), 0)
  );

  SELECT *
  INTO v_existing
  FROM public.portal_feedback_submissions s
  WHERE s.reporter_profile_id = v_profile_id
    AND s.request_id = v_request_id
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing.payload_fingerprint <> p_payload_fingerprint THEN
      RAISE EXCEPTION 'request id reused with different payload' USING ERRCODE = 'PF409';
    END IF;

    SELECT d.id INTO v_delivery_id
    FROM public.portal_feedback_deliveries d
    WHERE d.submission_id = v_existing.id;

    RETURN jsonb_build_object(
      'submission_id', v_existing.id,
      'delivery_id', v_delivery_id,
      'created_at', v_existing.created_at,
      'created', false,
      'replayed', true
    );
  END IF;

  DELETE FROM public.portal_feedback_rate_limits
  WHERE ctid IN (
    SELECT ctid FROM public.portal_feedback_rate_limits
    WHERE window_start < v_now - interval '24 hours'
    LIMIT 50
  );

  INSERT INTO public.portal_feedback_rate_limits AS r (
    reporter_profile_id, action_kind, window_start, count
  )
  VALUES (v_profile_id, 'portal_feedback_submission', v_now, 1)
  ON CONFLICT (reporter_profile_id, action_kind) DO UPDATE
  SET count = CASE
        WHEN r.window_start + interval '1 hour' <= v_now THEN 1
        ELSE r.count + 1
      END,
      window_start = CASE
        WHEN r.window_start + interval '1 hour' <= v_now THEN v_now
        ELSE r.window_start
      END
  RETURNING count, window_start INTO v_count, v_window;

  v_reset_at := v_window + interval '1 hour';
  IF v_count > 5 THEN
    RAISE EXCEPTION 'portal feedback rate limited' USING ERRCODE = 'PF429';
  END IF;

  INSERT INTO public.portal_feedback_submissions (
    request_id,
    payload_fingerprint,
    reporter_profile_id,
    reporter_display_name,
    reporter_email,
    portal_role,
    portal_type,
    submission_type,
    pathname,
    section,
    message,
    build_sha,
    environment,
    expected_behavior,
    actual_behavior,
    reproduction_steps,
    viewport_width,
    viewport_height
  )
  VALUES (
    v_request_id,
    p_payload_fingerprint,
    v_profile_id,
    NULLIF(p_reporter_context->>'reporter_display_name', ''),
    NULLIF(p_reporter_context->>'reporter_email', ''),
    p_reporter_context->>'portal_role',
    p_reporter_context->>'portal_type',
    p_payload->>'type',
    p_payload->>'pathname',
    NULLIF(p_payload->>'section', ''),
    p_payload->>'message',
    NULLIF(p_payload->>'build_sha', ''),
    NULLIF(p_payload->>'environment', ''),
    NULLIF(p_payload->>'expected_behavior', ''),
    NULLIF(p_payload->>'actual_behavior', ''),
    NULLIF(p_payload->>'reproduction_steps', ''),
    NULLIF(p_payload->>'viewport_width', '')::integer,
    NULLIF(p_payload->>'viewport_height', '')::integer
  )
  RETURNING * INTO v_submission;

  INSERT INTO public.portal_feedback_deliveries (
    submission_id,
    recipient_email,
    idempotency_key,
    delivery_status,
    next_retry_at
  )
  VALUES (
    v_submission.id,
    'aspire@cshs.org',
    'portal_feedback_v1:' || v_submission.id::text,
    'pending',
    v_now
  )
  RETURNING id INTO v_delivery_id;

  RETURN jsonb_build_object(
    'submission_id', v_submission.id,
    'delivery_id', v_delivery_id,
    'created_at', v_submission.created_at,
    'created', true,
    'replayed', false,
    'rate_limit', jsonb_build_object(
      'limit', 5,
      'remaining', GREATEST(0, 5 - v_count),
      'reset_at', v_reset_at
    )
  );
END;
$$;

-- ----------------------------------------------------------------------------
-- 8. Grants (least privilege; service_role only; the core stays granted to NO ONE)
-- ----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.message_profile_has_active_nursing_academic_portal_scope(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.message_participant_can_read(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.message_participant_can_send(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.messages_start_general_team_conversation_core(uuid, text, uuid, text, text, text, text, jsonb, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.messages_start_general_team_conversation_na(uuid, uuid, text, text, text, text, jsonb)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.submit_portal_feedback_report(jsonb, jsonb, text)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.message_profile_has_active_nursing_academic_portal_scope(uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.message_participant_can_read(uuid, uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.message_participant_can_send(uuid, uuid)
  TO service_role;
-- NOTE: messages_start_general_team_conversation_core is intentionally NOT granted (internal only).
GRANT EXECUTE ON FUNCTION public.messages_start_general_team_conversation_na(uuid, uuid, text, text, text, text, jsonb)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.submit_portal_feedback_report(jsonb, jsonb, text)
  TO service_role;

-- ----------------------------------------------------------------------------
-- 9. Capability sentinel. Created LAST inside the transaction, so its presence proves the whole
--    migration committed. Probed server-side (service_role) before the Nursing Education &
--    Leadership Messages / Feedback capabilities are reported enabled.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.na_portal_utilities_capability()
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_catalog
AS $$
  SELECT true;
$$;

COMMENT ON FUNCTION public.na_portal_utilities_capability() IS
  'Capability sentinel for Nursing Education & Leadership portal Messages + Feedback. Returns true. Created last in the enable_nursing_academic_portal_utilities migration so its existence proves the widened constraints, predicates, start RPC, and feedback role all committed atomically.';

REVOKE ALL ON FUNCTION public.na_portal_utilities_capability()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.na_portal_utilities_capability()
  TO service_role;

COMMIT;

-- ############################################################################
-- Verification (run AFTER applying; OUTSIDE the transaction)
-- ############################################################################
-- V1: sentinel:
--   SELECT public.na_portal_utilities_capability();   -- expect true
--
-- V2: the widened constraints exist:
--   SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
--   WHERE conname IN ('chk_participant_scope_kind', 'chk_participant_role_scope',
--                     'chk_conversations_created_by_role', 'chk_messages_author_role',
--                     'chk_portal_feedback_role');
--   -- each definition includes 'nursing_academic' (and scope kind includes 'general').
--
-- V3: functions exist with SECURITY DEFINER + locked search_path, exactly one _na RPC (7 args):
--   SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args, p.prosecdef, p.proconfig
--   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE n.nspname = 'public' AND p.proname IN (
--     'message_profile_has_active_nursing_academic_portal_scope',
--     'messages_start_general_team_conversation_na', 'na_portal_utilities_capability')
--   ORDER BY p.proname;
--
-- V4: grants are service_role only, and the core remains granted to NO ONE:
--   SELECT p.proname, r.rolname, has_function_privilege(r.rolname, p.oid, 'EXECUTE') AS can_exec
--   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--   CROSS JOIN (VALUES ('anon'),('authenticated'),('service_role')) AS r(rolname)
--   WHERE n.nspname='public' AND p.proname IN (
--     'messages_start_general_team_conversation_na',
--     'messages_start_general_team_conversation_core', 'na_portal_utilities_capability')
--   ORDER BY p.proname, r.rolname;
--   -- can_exec true ONLY for service_role, and FALSE for service_role on _core.
--
-- V5: existing portals unchanged: spot-check message_participant_can_read/can_send for a known
--     student and unit_leader conversation row (expect prior results), and
--     SELECT count(*) FROM portal_feedback_submissions;  -- unchanged row count.

-- ############################################################################
-- Rollback (ordered, one transaction; additive change, no data to back out)
-- ############################################################################
--   1. Re-apply message_participant_can_read / can_send and the start core from
--      20260728000000_enable_academic_partner_team_messages.sql (which reject nursing_academic), and
--      submit_portal_feedback_report from 20260724000000 (three-role list).
--   2. DROP FUNCTION public.messages_start_general_team_conversation_na(uuid, uuid, text, text, text, text, jsonb);
--   3. DROP FUNCTION public.na_portal_utilities_capability();
--   4. DROP FUNCTION public.message_profile_has_active_nursing_academic_portal_scope(uuid);
--   5. Narrow the five CHECK constraints back (only safe once no nursing_academic
--      conversation/message/participant/feedback rows exist).
-- Faster operational disable WITHOUT SQL: unset NA_MESSAGING_ENABLED (messages fail closed via the
-- env+sentinel gate); feedback has no env flag and requires the SQL rollback to disable.
