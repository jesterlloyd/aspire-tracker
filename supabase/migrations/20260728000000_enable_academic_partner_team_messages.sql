-- ############################################################################
-- Enable Academic Partner general team messages
--
-- Owner-gated. NOT auto-applied by this branch. Activates Academic Partner <-> ASPIRE Team
-- general messaging by extending the existing SECURITY DEFINER message predicates and adding a
-- dedicated Academic Partner start RPC, admitting the academic_partner / school participant shape the
-- schema already reserves (conversation_participants.chk_participant_role_scope; see
-- 20260724000001_general_team_threads_backend.sql).
--
-- ATOMIC: the entire executable migration runs inside ONE transaction (BEGIN ... COMMIT). If any
-- statement fails, the whole change rolls back and no partial messaging capability can remain. The
-- capability sentinel (public.ap_team_messaging_capability) is created LAST, after every authorization
-- function and grant has succeeded, so the server capability gate can never report enabled from a
-- half-applied migration. Verification queries are OUTSIDE the transaction, as comments.
--
-- Smallest safe extension. Student, Unit Leader, Owner, Admin, and staff behavior is preserved: the
-- public general-team start RPC keeps its EXACT signature and admits ONLY student and unit_leader
-- (as before); its body is refactored to delegate to a shared internal core so the workflow is not
-- duplicated. A dedicated academic_partner RPC handles the school-scoped path.
--
-- Security model for the academic_partner path (all server-derived, never browser-supplied for
-- authorization):
--   * caller must have an active academic_partner role grant AND at least one active user_school_scopes
--     row (message_profile_has_active_academic_partner_portal_scope);
--   * a thread is readable/sendable only by a participant whose row is participant_role =
--     'academic_partner', scope_kind = 'school', with scope_school_key matching one of the caller's
--     ACTIVE user_school_scopes.school_key by EXACT equality (WCU Anaheim vs North Hollywood, being
--     distinct canonical school_key values, stay isolated -- never LIKE/substring/email/display-name);
--   * general threads only: student/unit/cohort context is NULL on BOTH the participant and the
--     conversation (the canonical general-team discriminator; there is no stored thread_kind column);
--   * the recipient is LOCKED to the ASPIRE Team shared inbox (aspire@cshs.org), asserted before any
--     write;
--   * a multi-school Academic Partner supplies the selected school through the server, which verifies
--     it against active scopes and passes only the verified canonical key to the RPC; the RPC
--     re-verifies. A single-school caller is auto-resolved server-side. Missing/invalid selection fails
--     closed before any write.
--
-- All functions keep SECURITY DEFINER, the repository search_path convention
-- (SET search_path = public, pg_catalog), schema-qualified references, and least-privilege grants
-- (service_role EXECUTE only; the internal core is revoked from everyone and invoked only by the two
-- SECURITY DEFINER entry RPCs).
-- ############################################################################

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. Active Academic Partner portal scope predicate (mirrors the student / unit_leader helpers)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.message_profile_has_active_academic_partner_portal_scope(
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
        AND g.role = 'academic_partner'
        AND g.revoked_at IS NULL
        AND g.starts_at <= now()
        AND (g.expires_at IS NULL OR g.expires_at > now())
    )
    AND EXISTS (
      SELECT 1 FROM public.user_school_scopes s
      WHERE s.user_profile_id = p_profile_id
        AND s.revoked_at IS NULL
        AND s.starts_at <= now()
        AND (s.expires_at IS NULL OR s.expires_at > now())
    );
$$;

-- ----------------------------------------------------------------------------
-- 2. Read predicate: student + unit_leader branches unchanged; add academic_partner
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
      )
  );
$$;

-- ----------------------------------------------------------------------------
-- 3. Send predicate: unchanged. It composes message_participant_can_read (which now admits the
--    academic_partner branch) and additionally guards ONLY the unit_leader staleness case. An
--    academic_partner's active-scope requirement is already fully enforced inside can_read, so no
--    academic_partner-specific clause is needed here; re-declared byte-for-byte for completeness.
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
-- 4a. Internal CORE workflow for starting a general ASPIRE Team thread. Shared by the public
--     student/unit_leader RPC and the dedicated academic_partner RPC so the idempotency ledger, rate
--     limits, delivery validation, and conversation/message/event/read/delivery inserts are written
--     ONCE. Not granted to anyone: it is invoked only from the two SECURITY DEFINER entry RPCs, which
--     execute as the owner. p_scope_school_key is NULL for student/unit_leader and the SERVER-VERIFIED
--     canonical school_key for academic_partner.
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
  IF p_actor_kind NOT IN ('student', 'unit_leader', 'academic_partner') THEN
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
  IF p_actor_kind = 'academic_partner' THEN
    v_ap_recipient_kind    := coalesce(p_delivery->>'recipient_kind', '');
    v_ap_recipient_email   := lower(btrim(coalesce(p_delivery->>'recipient_email', '')));
    v_ap_recipient_profile := nullif(btrim(coalesce(p_delivery->>'recipient_profile_id', '')), '');
    IF v_ap_recipient_kind <> 'shared_inbox'
       OR v_ap_recipient_email <> 'aspire@cshs.org'
       OR v_ap_recipient_profile IS NOT NULL THEN
      RAISE EXCEPTION 'academic partner messages must be sent to the ASPIRE Team' USING ERRCODE = 'MS403';
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
  ELSE
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
  ELSE
    -- academic_partner: school-scoped participant with the verified authorized school. No student/unit
    -- context, matching chk_participant_role_scope for the academic_partner shape.
    INSERT INTO public.conversation_participants (
      conversation_id, participant_profile_id, participant_role, scope_kind,
      scope_student_id, scope_unit_key, scope_school_key, scope_cohort_id, added_at
    ) VALUES (
      v_conversation_id, p_actor_profile_id, 'academic_partner', 'school',
      NULL, NULL, v_school_key, NULL, v_now
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
  'Internal only (not granted; invoked by the two SECURITY DEFINER entry RPCs). Idempotent general ASPIRE Team thread workflow: ledger, rate limits, delivery validation, and conversation/message/event/read/delivery inserts. p_scope_school_key is NULL for student/unit_leader and the SERVER-VERIFIED canonical school_key for academic_partner (re-verified here as an active scope; exact match keeps WCU campuses isolated). Academic Partner deliveries are locked to aspire@cshs.org before any write.';

-- ----------------------------------------------------------------------------
-- 4b. Public general-team start RPC. EXACT original signature; behavior for Student and Unit Leader is
--     preserved (a thin, behavior-identical wrapper over the core). Academic Partner is NOT accepted
--     here -- it has its own dedicated RPC (4c) -- so this signature keeps its original student/UL-only
--     contract.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.messages_start_general_team_conversation(
  p_actor_profile_id       uuid,
  p_actor_kind             text,
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
  IF p_actor_kind NOT IN ('student', 'unit_leader') THEN
    RAISE EXCEPTION 'invalid actor kind' USING ERRCODE = 'MS400';
  END IF;
  RETURN public.messages_start_general_team_conversation_core(
    p_actor_profile_id, p_actor_kind, p_request_id, p_payload_fingerprint,
    p_subject, p_category, p_body, p_delivery, NULL
  );
END;
$$;

COMMENT ON FUNCTION public.messages_start_general_team_conversation(uuid, text, uuid, text, text, text, text, jsonb) IS
  'Service-role-only. Idempotently starts a general portal-to-ASPIRE Team conversation for an active Student or an active Unit Leader with at least one active unit scope (academic_partner uses messages_start_general_team_conversation_ap). Behavior is unchanged from 20260724000001; the body now delegates to the shared internal core. Same idempotency ledger and ASPIRE Team shared-inbox delivery.';

-- ----------------------------------------------------------------------------
-- 4c. Dedicated Academic Partner start RPC. Distinct name (no ambiguous Supabase overload). The server
--     passes the SELECTED, already-verified canonical school_key; this RPC re-verifies it is an active
--     scope for the actor (browser selection is never authorization), then delegates to the core.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.messages_start_general_team_conversation_ap(
  p_actor_profile_id       uuid,
  p_request_id             uuid,
  p_payload_fingerprint    text,
  p_subject                text,
  p_category               text,
  p_body                   text,
  p_delivery               jsonb,
  p_school_key             text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_school text := btrim(coalesce(p_school_key, ''));
BEGIN
  -- Verify the active academic_partner ROLE GRANT (and at least one active school scope) FIRST, before
  -- delegating to the core. The core performs the idempotency-ledger lookup and can return a COMPLETED
  -- replay before its own access checks; gating here ensures a revoked/expired academic_partner can
  -- never reach that replay path and receive a prior thread's result. The core re-checks too (defense
  -- in depth).
  IF NOT public.message_profile_has_active_academic_partner_portal_scope(p_actor_profile_id) THEN
    RAISE EXCEPTION 'academic partner access is not active' USING ERRCODE = 'MS403';
  END IF;
  IF v_school = '' THEN
    RAISE EXCEPTION 'academic partner school scope is required' USING ERRCODE = 'MS400';
  END IF;
  -- The supplied canonical key must be an ACTIVE scope for this actor (exact match). Fail closed
  -- before any write. The core re-verifies as well (defense in depth).
  IF NOT EXISTS (
    SELECT 1 FROM public.user_school_scopes s
    WHERE s.user_profile_id = p_actor_profile_id
      AND s.school_key = v_school
      AND s.revoked_at IS NULL
      AND s.starts_at <= now()
      AND (s.expires_at IS NULL OR s.expires_at > now())
  ) THEN
    RAISE EXCEPTION 'academic partner school scope is not active' USING ERRCODE = 'MS403';
  END IF;
  RETURN public.messages_start_general_team_conversation_core(
    p_actor_profile_id, 'academic_partner', p_request_id, p_payload_fingerprint,
    p_subject, p_category, p_body, p_delivery, v_school
  );
END;
$$;

COMMENT ON FUNCTION public.messages_start_general_team_conversation_ap(uuid, uuid, text, text, text, text, jsonb, text) IS
  'Service-role-only. Idempotently starts a general Academic Partner -> ASPIRE Team conversation. p_school_key is the SERVER-VERIFIED selected canonical school_key (a single-school AP is auto-resolved server-side; a multi-school AP supplies the selected school, verified against active user_school_scopes before it reaches here). This RPC re-verifies it is an active scope (exact match; WCU isolated), then delegates to the shared core. General-thread null context and the fixed aspire@cshs.org recipient are enforced in the core before any write.';

-- ----------------------------------------------------------------------------
-- 5. Grants for the authorization + entry functions (least privilege; service_role only). The internal
--    core is revoked from everyone and granted to NO ONE: it is invoked only by the two SECURITY
--    DEFINER entry RPCs, which execute as the owner. CREATE OR REPLACE preserves existing grants on the
--    replaced functions; all are re-affirmed to keep this migration self-contained.
-- ----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.message_profile_has_active_academic_partner_portal_scope(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.message_participant_can_read(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.message_participant_can_send(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.messages_start_general_team_conversation_core(uuid, text, uuid, text, text, text, text, jsonb, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.messages_start_general_team_conversation(uuid, text, uuid, text, text, text, text, jsonb)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.messages_start_general_team_conversation_ap(uuid, uuid, text, text, text, text, jsonb, text)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.message_profile_has_active_academic_partner_portal_scope(uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.message_participant_can_read(uuid, uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.message_participant_can_send(uuid, uuid)
  TO service_role;
-- NOTE: messages_start_general_team_conversation_core is intentionally NOT granted (internal only).
GRANT EXECUTE ON FUNCTION public.messages_start_general_team_conversation(uuid, text, uuid, text, text, text, text, jsonb)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.messages_start_general_team_conversation_ap(uuid, uuid, text, text, text, text, jsonb, text)
  TO service_role;

-- ----------------------------------------------------------------------------
-- 6. Database capability sentinel. Created LAST, after every authorization function and grant above
--    has succeeded within this transaction, so its presence proves the WHOLE migration committed. The
--    server capability gate probes it (service_role, read-only, no mutation) before reporting Academic
--    Partner messaging enabled; an undefined_function error means not-applied and the feature stays
--    fail-closed. It can never be a false positive from an anonymous/RLS-limited probe.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ap_team_messaging_capability()
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_catalog
AS $$
  SELECT true;
$$;

COMMENT ON FUNCTION public.ap_team_messaging_capability() IS
  'Capability sentinel for Academic Partner team messaging. Returns true. Created last in the enable_academic_partner_team_messages migration, so its existence proves the AP read/send predicates and the dedicated AP start RPC committed atomically. Probed server-side (service_role) by the AP messaging capability gate.';

REVOKE ALL ON FUNCTION public.ap_team_messaging_capability()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ap_team_messaging_capability()
  TO service_role;

COMMIT;

-- ############################################################################
-- Verification (run AFTER applying; expect the described results). OUTSIDE the transaction.
-- ############################################################################
-- (a) All expected functions exist with SECURITY DEFINER (except the IMMUTABLE sentinel) and a locked
--     search_path, and the ORIGINAL student/unit_leader RPC signature is still available:
--   SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args, p.prosecdef, p.proconfig
--   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE n.nspname = 'public'
--     AND p.proname IN (
--       'message_profile_has_active_academic_partner_portal_scope',
--       'message_participant_can_read', 'message_participant_can_send',
--       'messages_start_general_team_conversation',
--       'messages_start_general_team_conversation_core',
--       'messages_start_general_team_conversation_ap',
--       'ap_team_messaging_capability')
--   ORDER BY p.proname, args;
--   -- Expect exactly ONE messages_start_general_team_conversation with 8 args
--   --   (uuid, text, uuid, text, text, text, text, jsonb)  [student/unit_leader],
--   -- exactly ONE messages_start_general_team_conversation_ap with 8 args
--   --   (uuid, uuid, text, text, text, text, jsonb, text)  [academic_partner], and
--   -- exactly ONE _core with 9 args. No stray/prior overload of the 8-arg RPC that accepts
--   -- academic_partner. prosecdef = true for all except the sentinel; proconfig has the search_path.
--
-- (b) Grants are service_role only, and the internal core is granted to NO ONE:
--   SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args, r.rolname,
--          has_function_privilege(r.rolname, p.oid, 'EXECUTE') AS can_exec
--   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--   CROSS JOIN (VALUES ('anon'),('authenticated'),('service_role')) AS r(rolname)
--   WHERE n.nspname='public' AND p.proname IN (
--     'message_participant_can_read','message_participant_can_send',
--     'messages_start_general_team_conversation','messages_start_general_team_conversation_ap',
--     'messages_start_general_team_conversation_core','ap_team_messaging_capability',
--     'message_profile_has_active_academic_partner_portal_scope')
--   ORDER BY p.proname;
--   -- Expect can_exec = true only for service_role, and FALSE for service_role on _core too
--   -- (internal-only; invoked by the definer entry RPCs, not granted).
--
-- (c) Capability sentinel:  SELECT public.ap_team_messaging_capability();   -- expect true
--
-- (d) Student/Unit Leader unchanged: re-run the existing messaging regression suite against the DB, or
--     spot-check message_participant_can_read/can_send for known student/unit_leader rows.

-- ############################################################################
-- Rollback considerations (ordered; corrected function set)
-- ############################################################################
-- Additive and idempotent (CREATE OR REPLACE + grants). No table, column, or data changed, so there is
-- no data to back out. To fully revert Academic Partner messaging, run inside one transaction:
--   1. Re-apply the prior definitions of message_participant_can_read, message_participant_can_send,
--      and messages_start_general_team_conversation from
--      20260724000001_general_team_threads_backend.sql (which reject academic_partner and admit no
--      academic_partner participant rows).
--   2. DROP FUNCTION public.messages_start_general_team_conversation_ap(uuid, uuid, text, text, text, text, jsonb, text);
--   3. DROP FUNCTION public.messages_start_general_team_conversation_core(uuid, text, uuid, text, text, text, text, jsonb, text);
--   4. DROP FUNCTION public.ap_team_messaging_capability();
--   5. DROP FUNCTION public.message_profile_has_active_academic_partner_portal_scope(uuid);
-- Faster operational disable WITHOUT any SQL: unset the server env AP_MESSAGING_ENABLED (or set it to
-- anything other than 'true') and redeploy. The capability gate then reports disabled and the feature
-- is fail-closed even while this migration remains applied. No backfill is performed or required.
