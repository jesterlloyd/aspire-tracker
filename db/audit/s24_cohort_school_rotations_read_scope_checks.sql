-- Checks for supabase/migrations/20261007000000_s24_cohort_school_rotations_read_scope.sql
-- Nothing here leaves a change behind. PRE 1 to 3, POST 1 and POST 2 are plain SELECTs
-- over the catalog. POST 3 impersonates three callers inside a DO block that ENDS WITH
-- RAISE EXCEPTION on purpose, so its SET LOCAL ROLE and settings are discarded and its
-- report is the error message. No names or emails are selected anywhere; the block picks
-- auth ids to impersonate and prints only counts.
--
-- Run each numbered section on its own in the Supabase SQL editor, in this order:
--   PRE 1 to 3, then the migration as ONE block, then POST 1 to 3.
-- The migration needs no deploy before or after it: no application code changes with it.

-- ── PRE 1: every policy on the table today ────────────────────────────────────
-- Expect exactly 2 rows: cohort_school_rotations_anon_select (roles {anon}) and
-- cohort_school_rotations_authenticated_select (roles {authenticated}), both cmd SELECT,
-- both qual true. Any OTHER row is a policy this file does not know about: STOP and
-- report it before applying.
SELECT policyname, cmd, roles, qual, with_check
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'cohort_school_rotations'
ORDER BY policyname;

-- ── PRE 2: the predicate the new policy calls, and RLS state ──────────────────
-- Expect 1 row: is_staff, security_definer true, rls_enabled true, anon_select true
-- (the grant the migration removes), authenticated_select true. STOP if is_staff is
-- missing.
SELECT p.proname,
       p.prosecdef AS security_definer,
       (SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = 'public.cohort_school_rotations'::regclass) AS rls_enabled,
       has_table_privilege('anon',          'public.cohort_school_rotations', 'SELECT') AS anon_select,
       has_table_privilege('authenticated', 'public.cohort_school_rotations', 'SELECT') AS authenticated_select,
       has_table_privilege('service_role',  'public.cohort_school_rotations', 'SELECT') AS service_select
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'is_staff';

-- ── PRE 3: the population POST 3 counts against, and who can be impersonated ──
-- Expect 1 row. total_rows is what a staff caller must see in POST 3. staff_profiles
-- and portal_profiles must both be at least 1 or POST 3 cannot run its comparison; if
-- portal_profiles is 0, say so and POST 3 will report that leg as skipped.
SELECT (SELECT count(*) FROM public.cohort_school_rotations) AS total_rows,
       (SELECT count(*) FROM public.user_profiles
         WHERE role IN ('owner', 'admin', 'co_lead', 'co-lead', 'interviewer', 'viewer')
           AND COALESCE(is_active, true) AND auth_user_id IS NOT NULL) AS staff_profiles,
       (SELECT count(*) FROM public.user_role_grants g
           JOIN public.user_profiles p ON p.id = g.user_profile_id
         WHERE g.role = 'academic_partner' AND g.revoked_at IS NULL
           AND g.starts_at <= now() AND (g.expires_at IS NULL OR g.expires_at > now())
           AND p.auth_user_id IS NOT NULL
           AND p.role NOT IN ('owner', 'admin', 'co_lead', 'co-lead', 'interviewer', 'viewer')) AS portal_profiles;

-- ═════════════════════════════════════════════════════════════════════════════
-- APPLY supabase/migrations/20261007000000_s24_cohort_school_rotations_read_scope.sql
-- as ONE block. Expected: "Success. No rows returned."
-- ═════════════════════════════════════════════════════════════════════════════

-- ── POST 1: one policy, on is_staff(), and nothing on true ───────────────────
-- Expect exactly 1 row: cohort_school_rotations_staff_select, cmd SELECT, roles
-- {authenticated}, qual is_staff(). STOP if any row's qual is true, or if either
-- 20260522000000 name remains.
SELECT policyname, cmd, roles, qual, with_check
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'cohort_school_rotations'
ORDER BY policyname;

-- ── POST 2: anon holds nothing on the table; the other grants are unchanged ──
-- Expect 1 row: anon_select false, anon_any false, authenticated_select true,
-- service_select true, rls_enabled true.
SELECT has_table_privilege('anon',          'public.cohort_school_rotations', 'SELECT') AS anon_select,
       (has_table_privilege('anon', 'public.cohort_school_rotations', 'INSERT')
        OR has_table_privilege('anon', 'public.cohort_school_rotations', 'UPDATE')
        OR has_table_privilege('anon', 'public.cohort_school_rotations', 'DELETE')) AS anon_any,
       has_table_privilege('authenticated', 'public.cohort_school_rotations', 'SELECT') AS authenticated_select,
       has_table_privilege('service_role',  'public.cohort_school_rotations', 'SELECT') AS service_select,
       (SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = 'public.cohort_school_rotations'::regclass) AS rls_enabled;

-- ── POST 3: what each caller actually reads ──────────────────────────────────
-- Impersonates, in turn: the anon role; the authenticated role with no JWT (auth.uid()
-- NULL); an active Academic Partner portal user; an active staff profile. Each leg
-- counts the rows it can see. The block ends with RAISE EXCEPTION, so every SET LOCAL
-- and setting is discarded; the report is the error message.
-- Expect the message to begin "S-24 POST 3 PASS" and read:
--   anon=refused authenticated_no_jwt=0 portal_user=0 staff_user=<total_rows from PRE 3>
-- (portal_user=skipped when PRE 3 showed portal_profiles 0). STOP on "S-24 POST 3 FAIL".
DO $post3$
DECLARE
  total   bigint;
  n       bigint;
  staff_uid  uuid;
  portal_uid uuid;
  r_anon text; r_nojwt text; r_portal text; r_staff text;
  failed boolean := false;
BEGIN
  SELECT count(*) INTO total FROM public.cohort_school_rotations;

  SELECT auth_user_id INTO staff_uid FROM public.user_profiles
   WHERE role IN ('owner', 'admin', 'co_lead', 'co-lead', 'interviewer', 'viewer')
     AND COALESCE(is_active, true) AND auth_user_id IS NOT NULL
   ORDER BY id LIMIT 1;

  SELECT p.auth_user_id INTO portal_uid
    FROM public.user_role_grants g JOIN public.user_profiles p ON p.id = g.user_profile_id
   WHERE g.role = 'academic_partner' AND g.revoked_at IS NULL
     AND g.starts_at <= now() AND (g.expires_at IS NULL OR g.expires_at > now())
     AND p.auth_user_id IS NOT NULL
     AND p.role NOT IN ('owner', 'admin', 'co_lead', 'co-lead', 'interviewer', 'viewer')
   ORDER BY g.starts_at, g.id LIMIT 1;

  -- anon: the grant is gone, so the read itself is refused.
  BEGIN
    EXECUTE 'SET LOCAL ROLE anon';
    EXECUTE 'SELECT count(*) FROM public.cohort_school_rotations' INTO n;
    EXECUTE 'RESET ROLE';
    r_anon := n::text; failed := true;
  EXCEPTION WHEN insufficient_privilege THEN
    EXECUTE 'RESET ROLE'; r_anon := 'refused';
  END;

  -- authenticated with no JWT claims: auth.uid() is NULL, is_staff() is false.
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  EXECUTE 'SELECT count(*) FROM public.cohort_school_rotations' INTO n;
  EXECUTE 'RESET ROLE';
  r_nojwt := n::text; IF n <> 0 THEN failed := true; END IF;

  -- an Academic Partner portal user: not staff, so nothing (their school's rows reach
  -- them through the service-role endpoint, not through RLS).
  IF portal_uid IS NULL THEN
    r_portal := 'skipped';
  ELSE
    PERFORM set_config('request.jwt.claim.sub', portal_uid::text, true);
    PERFORM set_config('request.jwt.claims', json_build_object('sub', portal_uid, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    EXECUTE 'SELECT count(*) FROM public.cohort_school_rotations' INTO n;
    EXECUTE 'RESET ROLE';
    r_portal := n::text; IF n <> 0 THEN failed := true; END IF;
  END IF;

  -- a staff profile: everything, as before.
  PERFORM set_config('request.jwt.claim.sub', staff_uid::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', staff_uid, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  EXECUTE 'SELECT count(*) FROM public.cohort_school_rotations' INTO n;
  EXECUTE 'RESET ROLE';
  r_staff := n::text; IF n <> total THEN failed := true; END IF;

  RAISE EXCEPTION 'S-24 POST 3 % (rolled back on purpose): anon=% authenticated_no_jwt=% portal_user=% staff_user=% total_rows=%',
    CASE WHEN failed THEN 'FAIL' ELSE 'PASS' END, r_anon, r_nojwt, r_portal, r_staff, total;
END
$post3$;
