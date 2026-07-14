-- ============================================================================
-- PHASE 2, PART 1: many-to-many authorization foundation
-- ============================================================================
-- *** PREREQUISITES (hard): Phase 0B Waves A through E applied and verified. ***
-- *** No portal account may be invited before those waves are live.         ***
--
-- Owner instructions: run this ENTIRE file as one block in the Supabase SQL
-- editor. It is additive only: four new tables, six functions, RLS policies
-- on the new tables. It does not modify user_profiles or any existing table,
-- policy, or data. Nothing reads these tables until the Phase 2 application
-- release, so it is safe to apply at any time after Wave E.
--
-- Design (binding amendments 2 and 3):
--   - Roles are many-to-many: a user may hold multiple portal roles at once,
--     each grant with activation (starts_at), expiration (expires_at), and
--     revocation (revoked_at / revoked_by).
--   - Student identity is a DEDICATED link table (user_student_links), not a
--     student_id column on user_profiles. A repeating student (one students
--     row per cohort) simply holds multiple links.
--   - Unit scope keys are the canonical unit names from src/lib/unitCatalog.js
--     (the units DB table is per-cohort, so unit_name is the stable identity).
--   - School scope keys are canonical school names (api/lib/schoolAliases.js);
--     Phase 4 may normalize schools into a table without changing this shape.
--   - user_profiles.role stays untouched for staff backward compatibility.
--     Portal users receive user_profiles.role = 'portal' (set by the invite
--     endpoint, NOT by this migration) so is_staff() excludes them.
--
-- BEFORE the first portal invite, verify user_profiles has no CHECK
-- constraint that would reject role = 'portal' (the table is dashboard-
-- created, so the repository cannot see its constraints):
--   SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
--   WHERE conrelid = 'public.user_profiles'::regclass;
-- If a role CHECK exists, report it back before inviting anyone.
--
-- "Active" everywhere below means:
--   revoked_at IS NULL AND starts_at <= now()
--   AND (expires_at IS NULL OR expires_at > now())
-- An expired-but-unrevoked grant still occupies its uniqueness slot; extend
-- it by updating expires_at, or revoke it and grant anew.
-- ============================================================================

-- ── 0. Explicit transaction: the CREATE POLICY statements below are not
--       idempotent, so this file must be atomic (all-or-nothing) rather than
--       relying on the SQL editor's implicit-transaction behavior. ────────────
BEGIN;

-- ── 1. Role grants ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.user_role_grants (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_profile_id  uuid        NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  role             text        NOT NULL CHECK (role IN ('student', 'unit_leader', 'academic_partner')),
  granted_by       uuid        REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  granted_at       timestamptz NOT NULL DEFAULT now(),
  starts_at        timestamptz NOT NULL DEFAULT now(),
  expires_at       timestamptz,
  revoked_at       timestamptz,
  revoked_by       uuid        REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  notes            text,
  CONSTRAINT chk_role_grant_window CHECK (expires_at IS NULL OR expires_at > starts_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_user_role_grants_active
  ON public.user_role_grants (user_profile_id, role)
  WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_user_role_grants_profile
  ON public.user_role_grants (user_profile_id);

-- ── 2. User-to-student links (dedicated link model, amendment 3) ────────────

CREATE TABLE IF NOT EXISTS public.user_student_links (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_profile_id  uuid        NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  student_id       uuid        NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  linked_by        uuid        REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  linked_at        timestamptz NOT NULL DEFAULT now(),
  revoked_at       timestamptz,
  revoked_by       uuid        REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  notes            text
);

-- One active link per (user, student), and a student row belongs to at most
-- one portal account at a time.
CREATE UNIQUE INDEX IF NOT EXISTS uq_user_student_links_active_pair
  ON public.user_student_links (user_profile_id, student_id)
  WHERE revoked_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_user_student_links_active_student
  ON public.user_student_links (student_id)
  WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_user_student_links_profile
  ON public.user_student_links (user_profile_id);

-- ── 3. Unit scopes ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.user_unit_scopes (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_profile_id  uuid        NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  unit_key         text        NOT NULL,  -- canonical unit name (unitCatalog)
  cohort_id        uuid        REFERENCES public.cohorts(id) ON DELETE CASCADE,  -- NULL = all cohorts
  granted_by       uuid        REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  granted_at       timestamptz NOT NULL DEFAULT now(),
  starts_at        timestamptz NOT NULL DEFAULT now(),
  expires_at       timestamptz,
  revoked_at       timestamptz,
  revoked_by       uuid        REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  notes            text,
  CONSTRAINT chk_unit_scope_window CHECK (expires_at IS NULL OR expires_at > starts_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_user_unit_scopes_active
  ON public.user_unit_scopes (user_profile_id, unit_key,
    COALESCE(cohort_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_user_unit_scopes_profile
  ON public.user_unit_scopes (user_profile_id);

-- ── 4. School scopes ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.user_school_scopes (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_profile_id  uuid        NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  school_key       text        NOT NULL,  -- canonical school name (schoolAliases)
  cohort_id        uuid        REFERENCES public.cohorts(id) ON DELETE CASCADE,  -- NULL = all cohorts
  granted_by       uuid        REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  granted_at       timestamptz NOT NULL DEFAULT now(),
  starts_at        timestamptz NOT NULL DEFAULT now(),
  expires_at       timestamptz,
  revoked_at       timestamptz,
  revoked_by       uuid        REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  notes            text,
  CONSTRAINT chk_school_scope_window CHECK (expires_at IS NULL OR expires_at > starts_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_user_school_scopes_active
  ON public.user_school_scopes (user_profile_id, school_key,
    COALESCE(cohort_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_user_school_scopes_profile
  ON public.user_school_scopes (user_profile_id);

-- ── 5. RLS: deny-by-default; self-read and owner/admin-read; writes are
--          service-role only (managed by the invite and admin endpoints) ─────

ALTER TABLE public.user_role_grants   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_student_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_unit_scopes   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_school_scopes ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.user_role_grants,   public.user_student_links,
              public.user_unit_scopes,   public.user_school_scopes
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.user_role_grants,   public.user_student_links,
                public.user_unit_scopes,   public.user_school_scopes
  TO authenticated;
GRANT ALL PRIVILEGES ON public.user_role_grants,   public.user_student_links,
                        public.user_unit_scopes,   public.user_school_scopes
  TO service_role;

-- Self-read uses the same sub-select convention as student_reads (correct
-- whether or not user_profiles.id equals auth_user_id).
CREATE POLICY "self_select_role_grants" ON public.user_role_grants
  FOR SELECT TO authenticated
  USING (user_profile_id = (SELECT id FROM public.user_profiles WHERE auth_user_id = auth.uid()));
CREATE POLICY "owner_admin_select_role_grants" ON public.user_role_grants
  FOR SELECT TO authenticated USING (public.is_owner_or_admin());

CREATE POLICY "self_select_student_links" ON public.user_student_links
  FOR SELECT TO authenticated
  USING (user_profile_id = (SELECT id FROM public.user_profiles WHERE auth_user_id = auth.uid()));
CREATE POLICY "owner_admin_select_student_links" ON public.user_student_links
  FOR SELECT TO authenticated USING (public.is_owner_or_admin());

CREATE POLICY "self_select_unit_scopes" ON public.user_unit_scopes
  FOR SELECT TO authenticated
  USING (user_profile_id = (SELECT id FROM public.user_profiles WHERE auth_user_id = auth.uid()));
CREATE POLICY "owner_admin_select_unit_scopes" ON public.user_unit_scopes
  FOR SELECT TO authenticated USING (public.is_owner_or_admin());

CREATE POLICY "self_select_school_scopes" ON public.user_school_scopes
  FOR SELECT TO authenticated
  USING (user_profile_id = (SELECT id FROM public.user_profiles WHERE auth_user_id = auth.uid()));
CREATE POLICY "owner_admin_select_school_scopes" ON public.user_school_scopes
  FOR SELECT TO authenticated USING (public.is_owner_or_admin());

-- ── 6. Helper functions (SECURITY DEFINER, active-grant aware) ───────────────

CREATE OR REPLACE FUNCTION public.portal_profile_id()
RETURNS uuid
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public, pg_catalog
AS $$
  SELECT id FROM public.user_profiles WHERE auth_user_id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.has_active_role_grant(p_role text)
RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public, pg_catalog
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_role_grants g
    WHERE g.user_profile_id = public.portal_profile_id()
      AND g.role = p_role
      AND g.revoked_at IS NULL
      AND g.starts_at <= now()
      AND (g.expires_at IS NULL OR g.expires_at > now())
  );
$$;

CREATE OR REPLACE FUNCTION public.my_linked_student_ids()
RETURNS SETOF uuid
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public, pg_catalog
AS $$
  SELECT l.student_id FROM public.user_student_links l
  WHERE l.user_profile_id = public.portal_profile_id()
    AND l.revoked_at IS NULL
    AND public.has_active_role_grant('student');
$$;

CREATE OR REPLACE FUNCTION public.my_unit_scope_keys()
RETURNS TABLE (unit_key text, cohort_id uuid)
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public, pg_catalog
AS $$
  SELECT s.unit_key, s.cohort_id FROM public.user_unit_scopes s
  WHERE s.user_profile_id = public.portal_profile_id()
    AND s.revoked_at IS NULL
    AND s.starts_at <= now()
    AND (s.expires_at IS NULL OR s.expires_at > now())
    AND public.has_active_role_grant('unit_leader');
$$;

CREATE OR REPLACE FUNCTION public.my_school_scope_keys()
RETURNS TABLE (school_key text, cohort_id uuid)
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public, pg_catalog
AS $$
  SELECT s.school_key, s.cohort_id FROM public.user_school_scopes s
  WHERE s.user_profile_id = public.portal_profile_id()
    AND s.revoked_at IS NULL
    AND s.starts_at <= now()
    AND (s.expires_at IS NULL OR s.expires_at > now())
    AND public.has_active_role_grant('academic_partner');
$$;

-- One call for the client router: which portals may this user enter?
CREATE OR REPLACE FUNCTION public.get_my_portal_access()
RETURNS jsonb
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public, pg_catalog
AS $$
  SELECT jsonb_build_object(
    'roles', COALESCE((
      SELECT jsonb_agg(DISTINCT g.role) FROM public.user_role_grants g
      WHERE g.user_profile_id = public.portal_profile_id()
        AND g.revoked_at IS NULL
        AND g.starts_at <= now()
        AND (g.expires_at IS NULL OR g.expires_at > now())
    ), '[]'::jsonb),
    'student_ids', COALESCE((
      SELECT jsonb_agg(sid) FROM public.my_linked_student_ids() AS sid
    ), '[]'::jsonb),
    'unit_keys', COALESCE((
      SELECT jsonb_agg(DISTINCT u.unit_key) FROM public.my_unit_scope_keys() AS u
    ), '[]'::jsonb),
    'school_keys', COALESCE((
      SELECT jsonb_agg(DISTINCT s.school_key) FROM public.my_school_scope_keys() AS s
    ), '[]'::jsonb)
  );
$$;

-- Function privileges: callable by signed-in users only.
REVOKE ALL ON FUNCTION public.portal_profile_id()             FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.has_active_role_grant(text)     FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.my_linked_student_ids()         FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.my_unit_scope_keys()            FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.my_school_scope_keys()          FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_my_portal_access()          FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.portal_profile_id()          TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_active_role_grant(text)  TO authenticated;
GRANT EXECUTE ON FUNCTION public.my_linked_student_ids()      TO authenticated;
GRANT EXECUTE ON FUNCTION public.my_unit_scope_keys()         TO authenticated;
GRANT EXECUTE ON FUNCTION public.my_school_scope_keys()       TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_portal_access()       TO authenticated;

COMMIT;

-- Verification (expected: 4 tables with rls_enabled = true, 8 policies,
-- 6 functions):
--   SELECT tablename, policyname FROM pg_policies
--   WHERE tablename IN ('user_role_grants','user_student_links',
--                       'user_unit_scopes','user_school_scopes')
--   ORDER BY tablename, policyname;
--   SELECT proname FROM pg_proc WHERE pronamespace = 'public'::regnamespace
--   AND proname IN ('portal_profile_id','has_active_role_grant',
--     'my_linked_student_ids','my_unit_scope_keys','my_school_scope_keys',
--     'get_my_portal_access');
