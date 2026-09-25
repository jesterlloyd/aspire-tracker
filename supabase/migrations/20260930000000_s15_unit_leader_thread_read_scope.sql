-- supabase/migrations/20260930000000_s15_unit_leader_thread_read_scope.sql
--
-- S-15 (FINDINGS_REGISTER.md): a Unit Leader who loses scope for a unit loses READ
-- access to that unit's threads immediately. No grace period.
--
-- Owner-gated. Apply as ONE block in the Supabase SQL editor. Checks, run one section
-- at a time, are in db/audit/s15_unit_leader_thread_read_scope_checks.sql: PRE sections
-- first, then this file, then POST sections.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHAT WAS WRONG
-- ─────────────────────────────────────────────────────────────────────────────
-- message_participant_can_read's unit_leader branch required three things: an
-- unremoved participant row, an active account, and an active unit_leader ROLE grant.
-- It never asked user_unit_scopes. message_participant_can_send did (20260720000000,
-- kept through 20260724000001, 20260728000000 and 20260828000000), so a Unit Leader
-- whose scope for unit X was revoked, or simply expired, could no longer WRITE in X's
-- threads but could still read them: list, thread, unread count, archive and reactions
-- all authorize through my_message_conversation_ids() or can_read directly, and every
-- one of them inherited the gap.
--
-- That was a decision at the time, not an oversight: VERIFY 7c of
-- db/audit/unit_leader_portal_preflight_and_verification.sql PASSED only when can_read
-- did NOT query user_unit_scopes, "so that history is preserved after an assignment
-- ends". The Owner reversed it on 2026-09-24: access ends when scope ends.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHAT THIS DOES, AND WHY THIS WAY
-- ─────────────────────────────────────────────────────────────────────────────
-- The unit_leader branch of can_read gains the SAME active-scope test can_send already
-- applies, in the same shape, so the two predicates cannot disagree for a Unit Leader:
--
--   * a unit-scoped participant row (scope_unit_key set: direct_student and
--     team_student_context threads) needs an active user_unit_scopes row for THAT unit;
--   * a general row (scope_unit_key NULL: team_general threads) needs ANY active unit
--     scope, through message_profile_has_active_unit_leader_portal_scope(), exactly as
--     can_send tests it.
--
-- Enforced in the READ PREDICATE, never by writing conversation_participants.removed_at:
--   1. participant rows stay as history (Messages Phase 1 decision; the row is the
--      identity-backed record of who was in the thread), and current access is derived
--      live from the grant and the scope;
--   2. no code runs when a scope lapses through expires_at, so a write-on-revoke would
--      miss every expiry. A predicate evaluated at read time misses nothing.
-- revoke_portal_access is not changed by this migration.
--
-- Scope is by UNIT only. user_unit_scopes.cohort_id (NULL = all cohorts) is not
-- consulted here, because can_send does not consult it either and a unit_leader
-- participant row cannot carry a cohort (chk_participant_role_scope). Gating by cohort
-- would be a second rule, decided separately.
--
-- What ELSE changes, because it reads can_read:
--   * my_message_conversation_ids() (list, unread count, thread) now omits the threads;
--   * message_recipient_has_active_access() delegates to can_read, so a staff reply no
--     longer notifies a Unit Leader who has lost the thread's unit, and the staff reply
--     RPC refuses a delivery that names such a Unit Leader as its recipient (MS409,
--     "participant portal access is not active"), which is the existing rule for any
--     participant who cannot read.
-- Nothing else moves: the student, academic_partner and nursing_academic branches are
-- byte-for-byte the 20260828000000 text; can_send, my_message_conversation_ids and the
-- staff policies (is_active_owner_or_admin) are untouched. Signature, SECURITY DEFINER,
-- STABLE, the pinned search_path and the grants are restated exactly.
--
-- Rollback: at the end of this file.

BEGIN;

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
          -- S-15: current scope for THIS thread's unit, tested exactly as
          -- message_participant_can_send tests it. A revoked or expired scope fails
          -- here at read time; nothing has to be written for access to end.
          AND (
            (
              cp.scope_unit_key IS NOT NULL
              AND EXISTS (
                SELECT 1 FROM public.user_unit_scopes s
                WHERE s.user_profile_id = p_profile_id
                  AND s.unit_key = cp.scope_unit_key
                  AND s.revoked_at IS NULL
                  AND s.starts_at <= now()
                  AND (s.expires_at IS NULL OR s.expires_at > now())
              )
            )
            OR
            (
              cp.scope_unit_key IS NULL
              AND public.message_profile_has_active_unit_leader_portal_scope(p_profile_id)
            )
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

COMMENT ON FUNCTION public.message_participant_can_read(uuid, uuid) IS
  'May this profile READ this conversation right now? Student: active student portal (unlinked general row) or active student grant plus an unrevoked link to the scoped student. Unit Leader (S-15, 20260930000000): active account, active unit_leader grant, AND an active user_unit_scopes row for the participant row''s unit (any active unit scope for a general row), tested exactly as message_participant_can_send tests it, so read ends when scope ends. Academic Partner: active account, active academic_partner grant, active school scope matching the row, general thread only. Nursing Education & Leadership: active account, active nursing_academic grant, general thread only. Participant rows are never removed for scope loss; access is derived live.';

-- Grants restated exactly as 20260828000000 left them: service_role only.
REVOKE ALL ON FUNCTION public.message_participant_can_read(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.message_participant_can_read(uuid, uuid)
  TO service_role;

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────────
-- Rollback (Owner-gated, one block). Restores the 20260828000000 unit_leader branch,
-- which is this file's branch WITHOUT the "S-15" scope test. Everything else in the
-- function is identical, so the rollback is: re-run the CREATE OR REPLACE FUNCTION
-- public.message_participant_can_read block from
-- supabase/migrations/20260828000000_enable_nursing_academic_portal_utilities.sql
-- (section 3 of that file), followed by the same REVOKE and GRANT as above. No table,
-- row, policy or other function is touched by this migration, so nothing else needs
-- restoring. After rolling back, VERIFY 7c of
-- db/audit/unit_leader_portal_preflight_and_verification.sql passes again and S-15
-- reopens.
-- ─────────────────────────────────────────────────────────────────────────────
