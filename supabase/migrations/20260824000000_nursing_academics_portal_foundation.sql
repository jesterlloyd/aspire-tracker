-- ============================================================================
-- NURSING ACADEMICS PORTAL: foundation migration
-- ============================================================================
-- *** APPLY MANUALLY (Owner/Jester). Claude Code has applied NOTHING. ***
--
-- Adds the fourth portal role, `nursing_academic`, plus the community-benefit
-- reporting storage. Additive and transactional. It rewrites no historical
-- data and touches no policy, view, or table outside the objects named below.
--
-- WHAT THIS FILE DOES
--   1. Widens the user_role_grants role CHECK to include 'nursing_academic'.
--   2. CREATE OR REPLACEs provision_portal_access and revoke_portal_access
--      with the widened allowlist. A nursing_academic grant requires and
--      writes NO scope rows (no student links, no unit scopes, no school
--      scopes); organization-wide read is the role itself. Signatures are
--      unchanged, so existing service_role EXECUTE privileges survive.
--   3. Creates community_benefit_rates (append-only, versioned by
--      superseded_at; one active rate per fiscal year + category) and
--      community_benefit_capstone_hours (append-only, voidable). Both are
--      RLS-enabled with NO client policies: only service_role endpoints
--      (Owner-gated in the API layer) can read or write them.
--      set_community_benefit_rate performs rate supersession + replacement
--      atomically, so a failed replacement cannot retire the current rate.
--   4. Adds students.course_type (nullable text, no CHECK, matching the
--      production reality of program_type; values are validated server-side
--      against the COURSE_TYPES catalog and historical rows stay NULL,
--      rendering as "Unclassified").
--
-- WHAT THIS FILE DOES NOT DO
--   - It does not add nursing_academic to portal messaging, feedback, or
--     conversation role constraints. Those features are intentionally not
--     enabled for this role.
--   - It does not create or reference public.schools or students.school_id
--     (confirmed absent from production; school grouping stays on the
--     students.school text resolved through src/lib/schoolIdentity.js).
--
-- FAIL-CLOSED BEHAVIOR BEFORE THIS IS APPLIED
--   invite-portal-user for nursing_academic fails with PT400 from the live
--   provision_portal_access; the academics portal endpoints return 403 to
--   everyone because no grant can exist. Nothing degrades for the three
--   existing roles.
--
-- ── PREFLIGHT (run and review BEFORE the transaction) ────────────────────────
--   -- P1. Verify the live role CHECK name and definition (expect
--   --     user_role_grants_role_check with the three-role IN list):
--   SELECT conname, pg_get_constraintdef(oid)
--   FROM pg_constraint
--   WHERE conrelid = 'public.user_role_grants'::regclass
--     AND contype = 'c';
--
--   -- P2. Dump the live lifecycle function bodies and compare with the repo
--   --     (this file replaces the whole body, so drift is absorbed, but
--   --     review the diff first):
--   SELECT pg_get_functiondef('public.provision_portal_access(uuid, text, text, text, uuid, timestamptz, uuid, text[], text[], uuid)'::regprocedure);
--   SELECT pg_get_functiondef('public.revoke_portal_access(uuid, text, uuid, uuid, text[], text[], uuid, boolean)'::regprocedure);
--
--   -- P3. Confirm the new objects do not already exist (expect all NULL/false):
--   SELECT to_regclass('public.community_benefit_rates')          AS rates_tbl,
--          to_regclass('public.community_benefit_capstone_hours') AS capstone_tbl;
--   SELECT EXISTS (
--     SELECT 1 FROM information_schema.columns
--     WHERE table_schema = 'public' AND table_name = 'students'
--       AND column_name = 'course_type'
--   ) AS course_type_exists;
--
--   -- P4. Confirm the school catalog is still absent (expect both NULL; if
--   --     this ever changes, revisit the report's school grouping):
--   SELECT to_regclass('public.schools') AS schools_tbl,
--          (SELECT 1 FROM information_schema.columns
--           WHERE table_schema='public' AND table_name='students'
--             AND column_name='school_id') AS students_school_id;
--
-- If P1 returns a role CHECK under a DIFFERENT name, substitute that name in
-- step 1 below before running.
-- ============================================================================

BEGIN;

-- ── 1. Widen the user_role_grants role CHECK ────────────────────────────────

ALTER TABLE public.user_role_grants
  DROP CONSTRAINT IF EXISTS user_role_grants_role_check;
ALTER TABLE public.user_role_grants
  ADD CONSTRAINT user_role_grants_role_check
  CHECK (role IN ('student', 'unit_leader', 'academic_partner', 'nursing_academic'));

-- ── 2. Lifecycle functions with the widened allowlist ───────────────────────
-- Bodies are byte-for-byte the 20260712000009 versions except:
--   provision: the role allowlist (1a) gains 'nursing_academic'; the role
--              requires no scope payload, so no new validation branch and no
--              new write branch exist for it.
--   revoke:    the role allowlist gains 'nursing_academic'; the role owns no
--              scope rows, so no cascade branch exists for it.

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
  IF p_role NOT IN ('student', 'unit_leader', 'academic_partner', 'nursing_academic') THEN
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
  IF p_role NOT IN ('student', 'unit_leader', 'academic_partner', 'nursing_academic') THEN
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

-- ── 3. Community-benefit storage (Owner-entered, append-only) ───────────────

CREATE TABLE IF NOT EXISTS public.community_benefit_rates (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fiscal_year   integer NOT NULL
    CONSTRAINT chk_cbr_fiscal_year CHECK (fiscal_year BETWEEN 2020 AND 2100),
  category      text NOT NULL
    CONSTRAINT chk_cbr_category CHECK (category IN ('rn_preceptor', 'management')),
  hourly_rate   numeric(8,2) NOT NULL
    CONSTRAINT chk_cbr_rate_nonnegative CHECK (hourly_rate >= 0),
  note          text,
  entered_by    uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  superseded_at timestamptz,
  superseded_by uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL
);

COMMENT ON TABLE public.community_benefit_rates IS
  'Owner-entered hourly rates for community-benefit estimation. Append-only: a rate change supersedes the old row (superseded_at), never updates the amount in place.';

CREATE UNIQUE INDEX IF NOT EXISTS uq_cbr_one_active_rate_per_fy_category
  ON public.community_benefit_rates (fiscal_year, category)
  WHERE superseded_at IS NULL;

CREATE OR REPLACE FUNCTION public.set_community_benefit_rate(
  p_fiscal_year integer,
  p_category    text,
  p_hourly_rate numeric,
  p_note        text,
  p_entered_by  uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_row public.community_benefit_rates%ROWTYPE;
BEGIN
  IF p_fiscal_year < 2020 OR p_fiscal_year > 2100 THEN
    RAISE EXCEPTION 'invalid fiscal year' USING ERRCODE = 'PT400';
  END IF;
  IF p_category NOT IN ('rn_preceptor', 'management') THEN
    RAISE EXCEPTION 'invalid rate category' USING ERRCODE = 'PT400';
  END IF;
  IF p_hourly_rate IS NULL OR p_hourly_rate < 0 OR p_hourly_rate > 10000 THEN
    RAISE EXCEPTION 'invalid hourly rate' USING ERRCODE = 'PT400';
  END IF;

  UPDATE public.community_benefit_rates AS r
  SET superseded_at = now(), superseded_by = p_entered_by
  WHERE r.fiscal_year = p_fiscal_year
    AND r.category = p_category
    AND r.superseded_at IS NULL;

  INSERT INTO public.community_benefit_rates
    (fiscal_year, category, hourly_rate, note, entered_by)
  VALUES
    (p_fiscal_year, p_category, p_hourly_rate, NULLIF(btrim(p_note), ''), p_entered_by)
  RETURNING * INTO v_row;

  RETURN jsonb_build_object(
    'id', v_row.id,
    'fiscal_year', v_row.fiscal_year,
    'category', v_row.category,
    'hourly_rate', v_row.hourly_rate,
    'note', v_row.note,
    'created_at', v_row.created_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.set_community_benefit_rate(integer, text, numeric, text, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_community_benefit_rate(integer, text, numeric, text, uuid)
  TO service_role;

CREATE TABLE IF NOT EXISTS public.community_benefit_capstone_hours (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fiscal_year integer NOT NULL
    CONSTRAINT chk_cbch_fiscal_year CHECK (fiscal_year BETWEEN 2020 AND 2100),
  school_name text NOT NULL
    CONSTRAINT chk_cbch_school_trimmed CHECK (btrim(school_name) <> ''),
  cohort_id   uuid REFERENCES public.cohorts(id) ON DELETE SET NULL,
  hours       numeric(8,2) NOT NULL
    CONSTRAINT chk_cbch_hours_nonnegative CHECK (hours >= 0),
  note        text,
  entered_by  uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  voided_at   timestamptz,
  voided_by   uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL
);

COMMENT ON TABLE public.community_benefit_capstone_hours IS
  'Owner-entered aggregate UCLA capstone project hours (hours NOT already recorded as clinical shift hours). Never allocated to individual students, never combined with student_shift_logs. Append-only: corrections void a row (voided_at), never delete it.';

CREATE INDEX IF NOT EXISTS idx_cbch_fiscal_year
  ON public.community_benefit_capstone_hours (fiscal_year);

-- RLS: enabled with NO policies, and every client-role privilege revoked.
-- service_role (which bypasses RLS) is the only path, and the API layer gates
-- writes on active Owner authority (is_owner capability), never on role
-- strings or client state.
ALTER TABLE public.community_benefit_rates          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_benefit_capstone_hours ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.community_benefit_rates          FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.community_benefit_capstone_hours FROM PUBLIC, anon, authenticated;

-- ── 4. students.course_type ─────────────────────────────────────────────────
-- Nullable text with no CHECK, mirroring how program_type exists in
-- production. The server validates new values against the COURSE_TYPES
-- catalog; historical rows stay NULL and render as "Unclassified" until
-- Jester maps them through the staff editor.

ALTER TABLE public.students
  ADD COLUMN IF NOT EXISTS course_type text;

COMMENT ON COLUMN public.students.course_type IS
  'Structured course/subject type for the placement (COURSE_TYPES catalog). NULL or empty = Unclassified (historical, awaiting owner mapping). Never inferred from notes.';

COMMIT;

-- ── VERIFICATION (run after COMMIT) ──────────────────────────────────────────
--   -- V1. Constraint now lists four roles:
--   SELECT pg_get_constraintdef(oid)
--   FROM pg_constraint
--   WHERE conrelid = 'public.user_role_grants'::regclass
--     AND conname = 'user_role_grants_role_check';
--
--   -- V2. Both function bodies mention nursing_academic exactly once each:
--   SELECT proname,
--          (length(prosrc) - length(replace(prosrc, 'nursing_academic', ''))) / length('nursing_academic') AS mentions
--   FROM pg_proc
--   WHERE pronamespace = 'public'::regnamespace
--     AND proname IN ('provision_portal_access', 'revoke_portal_access');
--   -- expect provision_portal_access -> 2 (allowlist + comment) and
--   --        revoke_portal_access    -> 2 (allowlist + comment)
--
--   -- V3. Tables exist, RLS on, no client privileges (expect zero rows):
--   SELECT relname, relrowsecurity
--   FROM pg_class
--   WHERE relname IN ('community_benefit_rates', 'community_benefit_capstone_hours');
--   SELECT grantee, table_name, privilege_type
--   FROM information_schema.role_table_grants
--   WHERE table_name IN ('community_benefit_rates', 'community_benefit_capstone_hours')
--     AND grantee IN ('anon', 'authenticated', 'PUBLIC');
--   SELECT has_function_privilege('anon',
--            'public.set_community_benefit_rate(integer, text, numeric, text, uuid)', 'EXECUTE') AS anon_exec,
--          has_function_privilege('authenticated',
--            'public.set_community_benefit_rate(integer, text, numeric, text, uuid)', 'EXECUTE') AS authenticated_exec,
--          has_function_privilege('service_role',
--            'public.set_community_benefit_rate(integer, text, numeric, text, uuid)', 'EXECUTE') AS service_exec;
--   -- expect false, false, true
--
--   -- V4. Column present:
--   SELECT column_name, data_type, is_nullable
--   FROM information_schema.columns
--   WHERE table_schema = 'public' AND table_name = 'students'
--     AND column_name = 'course_type';
--
--   -- V5. Existing grants untouched (count per role should match pre-apply):
--   SELECT role, count(*) FROM public.user_role_grants GROUP BY role ORDER BY role;

-- ── ROLLBACK ─────────────────────────────────────────────────────────────────
-- Safe to run only if no nursing_academic grant, rate, or capstone row has
-- been created yet (the DROP CONSTRAINT step would otherwise fail closed on
-- re-add, which is the desired protection against orphaning live grants).
/*
BEGIN;
ALTER TABLE public.user_role_grants
  DROP CONSTRAINT IF EXISTS user_role_grants_role_check;
ALTER TABLE public.user_role_grants
  ADD CONSTRAINT user_role_grants_role_check
  CHECK (role IN ('student', 'unit_leader', 'academic_partner'));
-- Restore the 20260712000009 function bodies by re-running section 1 of that
-- file (CREATE OR REPLACE with the three-role allowlists).
DROP FUNCTION IF EXISTS public.set_community_benefit_rate(integer, text, numeric, text, uuid);
DROP TABLE IF EXISTS public.community_benefit_capstone_hours;
DROP TABLE IF EXISTS public.community_benefit_rates;
ALTER TABLE public.students DROP COLUMN IF EXISTS course_type;
COMMIT;
*/
