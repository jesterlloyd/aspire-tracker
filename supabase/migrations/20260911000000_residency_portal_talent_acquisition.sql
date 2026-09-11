-- ============================================================================
-- RESIDENCY PORTAL: the fifth portal role, talent_acquisition
-- ============================================================================
-- *** APPLY MANUALLY (Owner/Jester). Claude Code has applied NOTHING. ***
--
-- Adds the portal role for Cedars-Sinai Talent Acquisition staff. They use the
-- Residency Portal: the staff Residency workspace (At a Glance, Support,
-- Profiles & Interest, Residency, Evaluation) mounted under /portal/residency.
-- Additive and transactional. It rewrites no data and touches no table,
-- policy, or view other than the constraint and two functions named below.
--
-- WHAT THIS FILE DOES
--   1. Widens the user_role_grants role CHECK to include 'talent_acquisition'.
--   2. CREATE OR REPLACEs provision_portal_access and revoke_portal_access.
--      Their bodies are copied byte-for-byte from 20260824000000 (the
--      Nursing Education & Leadership foundation), changing ONLY the role
--      allowlist in each (the two IN lists gain 'talent_acquisition'). Like
--      nursing_academic, a talent_acquisition grant requires and writes NO
--      scope rows: every residency cohort is in scope by the role itself.
--      Signatures are unchanged and the EXECUTE grants are re-stated.
--   3. Widens aspire_events_audiences_check (from 20260908000000) so an event
--      can be ticked for Talent Acquisition in "Who sees this". Every existing
--      value is carried through, so no stored event can fall outside it.
--
-- WHAT THIS FILE DOES NOT DO
--   - It does not add talent_acquisition to the messaging, feedback, or
--     conversation constraints. Those features are not enabled for this role.
--   - It opens no NGRP table or function to the role. Every ngrp_* object
--     stays server-only; the Residency endpoints decide access in the API.
--
-- FAIL-CLOSED BEFORE THIS IS APPLIED
--   invite-portal-user for talent_acquisition fails with PT400 from the live
--   provision_portal_access, so no grant can exist and the Residency Portal
--   resolves to the no-access card. The four existing roles are unaffected.
--
-- DEPLOY ORDER: APPLY THIS BEFORE THE APP CODE SHIPS. Until the audiences
--   CHECK is widened, saving an event with the new Talent Acquisition box
--   ticked is refused by the database.
--
-- ── PREFLIGHT (run and review BEFORE the transaction) ────────────────────────
--   See db/audit/residency_portal_talent_acquisition_checks.sql, PRE 1 to PRE 3.
--   PRE 1 expects user_role_grants_role_check with the FOUR-role IN list. If it
--   names the constraint differently, substitute that name in step 1 below.

BEGIN;

-- ── 1. Widen the user_role_grants role CHECK ────────────────────────────────

ALTER TABLE public.user_role_grants
  DROP CONSTRAINT IF EXISTS user_role_grants_role_check;
ALTER TABLE public.user_role_grants
  ADD CONSTRAINT user_role_grants_role_check
  CHECK (role IN ('student', 'unit_leader', 'academic_partner', 'nursing_academic', 'talent_acquisition'));

-- ── 2. Lifecycle functions with the widened allowlist ───────────────────────
-- Copied from 20260824000000 lines 95-461; only the two allowlists differ.

CREATE OR REPLACE FUNCTION public.provision_portal_access(
  p_auth_user_id  uuid,
  p_email         text,
  p_full_name     text,
  p_role          text,
  p_granted_by    uuid        DEFAULT NULL,
  p_expires_at    timestamptz DEFAULT NULL,
  p_student_id    uuid        DEFAULT NULL,
  p_unit_keys     text[]      DEFAULT NULL,
  p_school_keys   text[]      DEFAULT NULL,
  p_cohort_id     uuid        DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_profile_id   uuid;
  v_existing     record;
  v_grant        record;
  v_grant_id     uuid;
  v_grant_action text;
  v_links        jsonb := '[]'::jsonb;
  v_units        jsonb := '[]'::jsonb;
  v_schools      jsonb := '[]'::jsonb;
  v_key          text;
  v_row          record;
  v_id           uuid;
  v_action       text;
  v_created_any  boolean := false;
  v_zero         constant uuid := '00000000-0000-0000-0000-000000000000';
BEGIN
  -- 1a. Validate role and the scope payload it requires. nursing_academic is
  --     organization-wide by design: it requires no scope payload at all.
  IF p_role NOT IN ('student', 'unit_leader', 'academic_partner', 'nursing_academic', 'talent_acquisition') THEN
    RAISE EXCEPTION 'unsupported portal role: %', p_role USING ERRCODE = 'PT400';
  END IF;
  IF p_auth_user_id IS NULL THEN
    RAISE EXCEPTION 'auth_user_id is required' USING ERRCODE = 'PT400';
  END IF;
  IF p_role = 'student' THEN
    IF p_student_id IS NULL THEN
      RAISE EXCEPTION 'student_id is required for a student grant' USING ERRCODE = 'PT400';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.students WHERE id = p_student_id) THEN
      RAISE EXCEPTION 'no student record for id %', p_student_id USING ERRCODE = 'PT404';
    END IF;
  ELSIF p_role = 'unit_leader' THEN
    IF p_unit_keys IS NULL OR array_length(p_unit_keys, 1) IS NULL THEN
      RAISE EXCEPTION 'at least one unit_key is required for a unit_leader grant' USING ERRCODE = 'PT400';
    END IF;
  ELSIF p_role = 'academic_partner' THEN
    IF p_school_keys IS NULL OR array_length(p_school_keys, 1) IS NULL THEN
      RAISE EXCEPTION 'at least one school_key is required for an academic_partner grant' USING ERRCODE = 'PT400';
    END IF;
  END IF;

  -- 1b. Resolve or create the user_profiles row. The three-identity model is
  --     preserved: id is never forced to equal auth_user_id, and role is set to
  --     'portal' only when the profile is not an existing staff account.
  SELECT id, role INTO v_existing
  FROM public.user_profiles
  WHERE auth_user_id = p_auth_user_id
  LIMIT 1;

  IF FOUND THEN
    v_profile_id := v_existing.id;
    IF v_existing.role IS NULL OR v_existing.role = '' OR v_existing.role = 'portal' THEN
      UPDATE public.user_profiles
      SET full_name     = COALESCE(NULLIF(p_full_name, ''), full_name),
          role          = 'portal',
          login_enabled = true,
          is_active     = true
      WHERE id = v_profile_id;
    END IF;
  ELSE
    -- No profile is linked to this auth user yet. Claim an UNLINKED profile
    -- with the same email if one exists; never hijack a profile already bound
    -- to a different auth user.
    SELECT id, role INTO v_existing
    FROM public.user_profiles
    WHERE email = p_email AND auth_user_id IS NULL
    LIMIT 1;

    IF FOUND THEN
      v_profile_id := v_existing.id;
      UPDATE public.user_profiles
      SET auth_user_id  = p_auth_user_id,
          full_name     = COALESCE(NULLIF(p_full_name, ''), full_name),
          role          = CASE
                            WHEN v_existing.role IS NULL OR v_existing.role = '' OR v_existing.role = 'portal'
                            THEN 'portal' ELSE v_existing.role
                          END,
          login_enabled = true,
          is_active     = true
      WHERE id = v_profile_id;
    ELSE
      INSERT INTO public.user_profiles
        (auth_user_id, full_name, email, role, is_owner, is_active, login_enabled)
      VALUES
        (p_auth_user_id, p_full_name, p_email, 'portal', false, true, true)
      RETURNING id INTO v_profile_id;
      v_created_any := true;
    END IF;
  END IF;

  -- 1c. Role grant: create, renew, or idempotently reuse (active-slot aware).
  SELECT id, starts_at, expires_at INTO v_grant
  FROM public.user_role_grants
  WHERE user_profile_id = v_profile_id AND role = p_role AND revoked_at IS NULL
  LIMIT 1;

  IF NOT FOUND THEN
    -- No active-slot occupant (never granted, or only revoked history remains).
    INSERT INTO public.user_role_grants (user_profile_id, role, granted_by, expires_at)
    VALUES (v_profile_id, p_role, p_granted_by, p_expires_at)
    RETURNING id INTO v_grant_id;
    v_grant_action := 'created';
    v_created_any  := true;
  ELSIF v_grant.expires_at IS NOT NULL AND v_grant.expires_at <= now() THEN
    -- Expired-but-unrevoked occupant: revoke the historical row, then grant anew.
    UPDATE public.user_role_grants
    SET revoked_at = now(), revoked_by = p_granted_by
    WHERE id = v_grant.id;
    INSERT INTO public.user_role_grants (user_profile_id, role, granted_by, expires_at)
    VALUES (v_profile_id, p_role, p_granted_by, p_expires_at)
    RETURNING id INTO v_grant_id;
    v_grant_action := 'renewed';
    v_created_any  := true;
  ELSIF p_expires_at IS DISTINCT FROM v_grant.expires_at THEN
    -- Active occupant, intentionally changed window: update it in place.
    UPDATE public.user_role_grants SET expires_at = p_expires_at WHERE id = v_grant.id;
    v_grant_id     := v_grant.id;
    v_grant_action := 'renewed';
  ELSE
    -- Active occupant, identical window: idempotent reuse.
    v_grant_id     := v_grant.id;
    v_grant_action := 'reused';
  END IF;

  -- 1d. Student link (student role only). One active link per student, enforced
  --     here and by the partial unique index; a link on a DIFFERENT profile is
  --     a genuine conflict, a revoked historical link is replaced by a new one.
  IF p_role = 'student' THEN
    SELECT id INTO v_id
    FROM public.user_student_links
    WHERE user_profile_id = v_profile_id AND student_id = p_student_id AND revoked_at IS NULL
    LIMIT 1;

    IF FOUND THEN
      v_action := 'reused';
    ELSE
      IF EXISTS (
        SELECT 1 FROM public.user_student_links
        WHERE student_id = p_student_id AND revoked_at IS NULL
          AND user_profile_id <> v_profile_id
      ) THEN
        RAISE EXCEPTION 'student % is already linked to another active portal account', p_student_id
          USING ERRCODE = 'PT409';
      END IF;
      INSERT INTO public.user_student_links (user_profile_id, student_id, linked_by)
      VALUES (v_profile_id, p_student_id, p_granted_by)
      RETURNING id INTO v_id;
      v_action := 'created';
      v_created_any := true;
    END IF;
    v_links := jsonb_build_array(
      jsonb_build_object('id', v_id, 'student_id', p_student_id, 'action', v_action)
    );
  END IF;

  -- 1e. Unit scopes (unit_leader role only). Multiple distinct units are
  --     preserved; each key is created, renewed (expired-unrevoked or changed
  --     window), or reused independently.
  IF p_role = 'unit_leader' THEN
    FOREACH v_key IN ARRAY p_unit_keys LOOP
      SELECT id, expires_at INTO v_row
      FROM public.user_unit_scopes
      WHERE user_profile_id = v_profile_id AND unit_key = v_key
        AND COALESCE(cohort_id, v_zero) = COALESCE(p_cohort_id, v_zero)
        AND revoked_at IS NULL
      LIMIT 1;

      IF NOT FOUND THEN
        INSERT INTO public.user_unit_scopes (user_profile_id, unit_key, cohort_id, granted_by, expires_at)
        VALUES (v_profile_id, v_key, p_cohort_id, p_granted_by, p_expires_at)
        RETURNING id INTO v_id;
        v_action := 'created'; v_created_any := true;
      ELSIF v_row.expires_at IS NOT NULL AND v_row.expires_at <= now() THEN
        UPDATE public.user_unit_scopes SET revoked_at = now(), revoked_by = p_granted_by WHERE id = v_row.id;
        INSERT INTO public.user_unit_scopes (user_profile_id, unit_key, cohort_id, granted_by, expires_at)
        VALUES (v_profile_id, v_key, p_cohort_id, p_granted_by, p_expires_at)
        RETURNING id INTO v_id;
        v_action := 'renewed'; v_created_any := true;
      ELSIF p_expires_at IS DISTINCT FROM v_row.expires_at THEN
        UPDATE public.user_unit_scopes SET expires_at = p_expires_at WHERE id = v_row.id;
        v_id := v_row.id; v_action := 'renewed';
      ELSE
        v_id := v_row.id; v_action := 'reused';
      END IF;
      v_units := v_units || jsonb_build_object(
        'id', v_id, 'unit_key', v_key, 'cohort_id', p_cohort_id, 'action', v_action
      );
    END LOOP;
  END IF;

  -- 1f. School scopes (academic_partner role only). Same lifecycle as units.
  IF p_role = 'academic_partner' THEN
    FOREACH v_key IN ARRAY p_school_keys LOOP
      SELECT id, expires_at INTO v_row
      FROM public.user_school_scopes
      WHERE user_profile_id = v_profile_id AND school_key = v_key
        AND COALESCE(cohort_id, v_zero) = COALESCE(p_cohort_id, v_zero)
        AND revoked_at IS NULL
      LIMIT 1;

      IF NOT FOUND THEN
        INSERT INTO public.user_school_scopes (user_profile_id, school_key, cohort_id, granted_by, expires_at)
        VALUES (v_profile_id, v_key, p_cohort_id, p_granted_by, p_expires_at)
        RETURNING id INTO v_id;
        v_action := 'created'; v_created_any := true;
      ELSIF v_row.expires_at IS NOT NULL AND v_row.expires_at <= now() THEN
        UPDATE public.user_school_scopes SET revoked_at = now(), revoked_by = p_granted_by WHERE id = v_row.id;
        INSERT INTO public.user_school_scopes (user_profile_id, school_key, cohort_id, granted_by, expires_at)
        VALUES (v_profile_id, v_key, p_cohort_id, p_granted_by, p_expires_at)
        RETURNING id INTO v_id;
        v_action := 'renewed'; v_created_any := true;
      ELSIF p_expires_at IS DISTINCT FROM v_row.expires_at THEN
        UPDATE public.user_school_scopes SET expires_at = p_expires_at WHERE id = v_row.id;
        v_id := v_row.id; v_action := 'renewed';
      ELSE
        v_id := v_row.id; v_action := 'reused';
      END IF;
      v_schools := v_schools || jsonb_build_object(
        'id', v_id, 'school_key', v_key, 'cohort_id', p_cohort_id, 'action', v_action
      );
    END LOOP;
  END IF;

  -- 1g. Re-read the final grant window so the return is accurate on every path.
  SELECT starts_at, expires_at INTO v_grant FROM public.user_role_grants WHERE id = v_grant_id;

  RETURN jsonb_build_object(
    'user_profile_id', v_profile_id,
    'role',            p_role,
    'grant',           jsonb_build_object(
                         'id',         v_grant_id,
                         'action',     v_grant_action,
                         'starts_at',  v_grant.starts_at,
                         'expires_at', v_grant.expires_at
                       ),
    'links',           v_links,
    'unit_scopes',     v_units,
    'school_scopes',   v_schools,
    'created_any',     v_created_any
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.revoke_portal_access(
  p_user_profile_id uuid,
  p_role            text,
  p_revoked_by      uuid    DEFAULT NULL,
  p_student_id      uuid    DEFAULT NULL,
  p_unit_keys       text[]  DEFAULT NULL,
  p_school_keys     text[]  DEFAULT NULL,
  p_cohort_id       uuid    DEFAULT NULL,
  p_cascade         boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_grant_id     uuid;
  v_grant_action text;
  v_links        jsonb := '[]'::jsonb;
  v_units        jsonb := '[]'::jsonb;
  v_schools      jsonb := '[]'::jsonb;
  v_row          record;
BEGIN
  IF p_role NOT IN ('student', 'unit_leader', 'academic_partner', 'nursing_academic', 'talent_acquisition') THEN
    RAISE EXCEPTION 'unsupported portal role: %', p_role USING ERRCODE = 'PT400';
  END IF;
  IF p_user_profile_id IS NULL THEN
    RAISE EXCEPTION 'user_profile_id is required' USING ERRCODE = 'PT400';
  END IF;

  -- 2a. Revoke the active role grant (idempotent: already-revoked is success).
  SELECT id INTO v_grant_id
  FROM public.user_role_grants
  WHERE user_profile_id = p_user_profile_id AND role = p_role AND revoked_at IS NULL
  LIMIT 1;

  IF FOUND THEN
    UPDATE public.user_role_grants
    SET revoked_at = now(), revoked_by = p_revoked_by
    WHERE id = v_grant_id;
    v_grant_action := 'revoked';
  ELSE
    v_grant_action := 'already_revoked';
  END IF;

  -- 2b. Revoke dependent assignments for THIS role only. p_cascade revokes all
  --     of the role's active assignments; a specific target narrows it.
  --     nursing_academic owns no scope rows, so it has no cascade branch.
  IF p_role = 'student' AND (p_cascade OR p_student_id IS NOT NULL) THEN
    FOR v_row IN
      UPDATE public.user_student_links
      SET revoked_at = now(), revoked_by = p_revoked_by
      WHERE user_profile_id = p_user_profile_id AND revoked_at IS NULL
        AND (p_student_id IS NULL OR student_id = p_student_id)
      RETURNING id, student_id
    LOOP
      v_links := v_links || jsonb_build_object('id', v_row.id, 'student_id', v_row.student_id, 'action', 'revoked');
    END LOOP;
  END IF;

  IF p_role = 'unit_leader' AND (p_cascade OR p_unit_keys IS NOT NULL) THEN
    FOR v_row IN
      UPDATE public.user_unit_scopes
      SET revoked_at = now(), revoked_by = p_revoked_by
      WHERE user_profile_id = p_user_profile_id AND revoked_at IS NULL
        AND (p_unit_keys IS NULL OR unit_key = ANY (p_unit_keys))
        AND (p_cohort_id IS NULL OR cohort_id IS NOT DISTINCT FROM p_cohort_id)
      RETURNING id, unit_key, cohort_id
    LOOP
      v_units := v_units || jsonb_build_object('id', v_row.id, 'unit_key', v_row.unit_key, 'cohort_id', v_row.cohort_id, 'action', 'revoked');
    END LOOP;
  END IF;

  IF p_role = 'academic_partner' AND (p_cascade OR p_school_keys IS NOT NULL) THEN
    FOR v_row IN
      UPDATE public.user_school_scopes
      SET revoked_at = now(), revoked_by = p_revoked_by
      WHERE user_profile_id = p_user_profile_id AND revoked_at IS NULL
        AND (p_school_keys IS NULL OR school_key = ANY (p_school_keys))
        AND (p_cohort_id IS NULL OR cohort_id IS NOT DISTINCT FROM p_cohort_id)
      RETURNING id, school_key, cohort_id
    LOOP
      v_schools := v_schools || jsonb_build_object('id', v_row.id, 'school_key', v_row.school_key, 'cohort_id', v_row.cohort_id, 'action', 'revoked');
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'user_profile_id', p_user_profile_id,
    'role',            p_role,
    'grant',           jsonb_build_object('id', v_grant_id, 'action', v_grant_action),
    'links',           v_links,
    'unit_scopes',     v_units,
    'school_scopes',   v_schools
  );
END;
$$;

-- CREATE OR REPLACE preserves existing privileges, but restate them so this
-- file is self-sufficient if the functions were ever dropped.
REVOKE ALL ON FUNCTION public.provision_portal_access(uuid, text, text, text, uuid, timestamptz, uuid, text[], text[], uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.provision_portal_access(uuid, text, text, text, uuid, timestamptz, uuid, text[], text[], uuid)
  TO service_role;
REVOKE ALL ON FUNCTION public.revoke_portal_access(uuid, text, uuid, uuid, text[], text[], uuid, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_portal_access(uuid, text, uuid, uuid, text[], text[], uuid, boolean)
  TO service_role;

-- ── 3. Let events be ticked for Talent Acquisition ──────────────────────────

ALTER TABLE public.aspire_events
  DROP CONSTRAINT IF EXISTS aspire_events_audiences_check;
ALTER TABLE public.aspire_events
  ADD CONSTRAINT aspire_events_audiences_check
  CHECK (audiences <@ array['student','unit_leader','academic_partner','nursing_academic','talent_acquisition']::text[]);

COMMENT ON COLUMN public.aspire_events.audiences IS
  'EVENT-AUDIENCE-2: portal roles that may see this event (student, unit_leader, academic_partner, nursing_academic, talent_acquisition). Empty = internal team only. Delivery is further gated by event type (PORTAL_DELIVERED_TYPES).';

NOTIFY pgrst, 'reload schema';

COMMIT;

-- ── VERIFICATION (run after COMMIT) ──────────────────────────────────────────
--   See db/audit/residency_portal_talent_acquisition_checks.sql, POST 1 to POST 4.

-- ── ROLLBACK ─────────────────────────────────────────────────────────────────
-- Safe only while NO talent_acquisition grant exists (re-adding the narrower
-- CHECK would otherwise fail closed, which protects live grants from being
-- orphaned). Restore the four-role functions by re-running section 2 of
-- 20260824000000.
/*
BEGIN;
ALTER TABLE public.user_role_grants
  DROP CONSTRAINT IF EXISTS user_role_grants_role_check;
ALTER TABLE public.user_role_grants
  ADD CONSTRAINT user_role_grants_role_check
  CHECK (role IN ('student', 'unit_leader', 'academic_partner', 'nursing_academic'));
-- Only while no event is ticked for talent_acquisition:
ALTER TABLE public.aspire_events
  DROP CONSTRAINT IF EXISTS aspire_events_audiences_check;
ALTER TABLE public.aspire_events
  ADD CONSTRAINT aspire_events_audiences_check
  CHECK (audiences <@ array['student','unit_leader','academic_partner','nursing_academic']::text[]);
COMMIT;
*/
