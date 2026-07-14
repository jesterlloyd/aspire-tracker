-- ============================================================================
-- PHASE 0B, WAVE F-1: SECURITY DEFINER function EXECUTE hardening + internal
-- authorization gates + fixed search_path (live-state reconciled)
-- ============================================================================
-- Closes confirmed finding F8: several SECURITY DEFINER functions are
-- executable by anon or PUBLIC. A function granted to PUBLIC is callable by
-- anon regardless of any explicit anon revoke, so PUBLIC must be revoked from
-- EVERY SECURITY DEFINER function (including the school-form functions), then
-- the exact required roles re-granted.
--
-- This wave also reconciles the live state discovered during Wave F-1 review:
--   1. The two school-form functions were NOT excluded from the PUBLIC revoke
--      (they must lose PUBLIC, then be re-granted anon + authenticated).
--   2. Six staff RPCs are added to the explicit authenticated allowlist.
--   3. Nine SECURITY DEFINER functions receive a fixed search_path.
--   4. Five dashboard-created functions receive an INTERNAL authorization gate.
--      Their exact live bodies were captured from production (pg_get_functiondef)
--      and are reproduced here verbatim, with only the gate and the fixed
--      search_path added, so the repository is now the source of truth and
--      authorized-caller behavior (signatures, returned columns, queries,
--      mutations, ordering) is preserved exactly.
--
-- *** PREREQUISITE: Waves A through E-2 applied (is_staff and is_owner_or_admin ***
-- *** must exist; the gates and the authenticated re-grants call them).        ***
-- Run the ENTIRE file as one block. Idempotent and safely rerunnable
-- (CREATE OR REPLACE, ALTER, and REVOKE/GRANT are all repeatable). Wrapped in a
-- transaction. Ownership is never changed (CREATE OR REPLACE preserves owner).
--
-- Preserved for the ANONYMOUS /school-form workflow (boolean-only, no data
-- returned): verify_school_form_password and school_form_requires_password keep
-- anon EXECUTE and are NOT given a staff gate.
--
-- Authorization boundaries implemented (confirmed from production callers):
--   get_all_user_profiles()            -> Owner/Admin (is_owner_or_admin)
--   get_active_interviewers()          -> active staff (is_staff)
--   add_interviewer(text, text)        -> Owner/Admin (is_owner_or_admin)
--   update_interviewer_color(uuid,text)-> Owner/Admin (is_owner_or_admin)
--   update_interviewer_email(uuid,text)-> Owner/Admin (is_owner_or_admin)
--   is_current_user_owner()            -> authenticated self-check, no staff gate
-- ============================================================================

BEGIN;

-- ── Step 1: rewrite the five sensitive dashboard-created functions with an
--            internal authorization gate and a fixed search_path. Bodies are
--            the exact live definitions; only the guard and SET search_path are
--            added. CREATE OR REPLACE preserves ownership and existing ACLs. ──

CREATE OR REPLACE FUNCTION public.get_all_user_profiles()
 RETURNS SETOF user_profiles
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, pg_catalog
AS $function$
BEGIN
  IF NOT public.is_owner_or_admin() THEN
    RAISE EXCEPTION 'Insufficient permissions';
  END IF;
  RETURN QUERY
  SELECT *
  FROM user_profiles
  ORDER BY created_at DESC;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_active_interviewers()
 RETURNS TABLE(
   id uuid,
   full_name text,
   email text,
   interviewer_color text,
   can_conduct_interviews boolean,
   is_active boolean,
   login_enabled boolean,
   default_interview_duration integer
 )
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, pg_catalog
AS $function$
BEGIN
  IF NOT public.is_staff() THEN
    RAISE EXCEPTION 'Insufficient permissions';
  END IF;
  RETURN QUERY
  SELECT
    up.id,
    up.full_name,
    up.email,
    up.interviewer_color,
    up.can_conduct_interviews,
    up.is_active,
    up.login_enabled,
    up.default_interview_duration
  FROM user_profiles up
  WHERE up.can_conduct_interviews = TRUE
    AND up.is_active = TRUE
  ORDER BY up.full_name;
END;
$function$;

CREATE OR REPLACE FUNCTION public.add_interviewer(p_name text, p_email text)
 RETURNS TABLE(id uuid, name text, email text, color text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, pg_catalog
AS $function$
BEGIN
  IF NOT public.is_owner_or_admin() THEN
    RAISE EXCEPTION 'Insufficient permissions';
  END IF;
  RETURN QUERY
  INSERT INTO interviewers (name, email)
  VALUES (p_name, COALESCE(p_email, ''))
  RETURNING interviewers.id, interviewers.name,
            interviewers.email, interviewers.color;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_interviewer_color(p_id uuid, p_color text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, pg_catalog
AS $function$
BEGIN
  IF NOT public.is_owner_or_admin() THEN
    RAISE EXCEPTION 'Insufficient permissions';
  END IF;
  UPDATE interviewers
  SET color = p_color
  WHERE id = p_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_interviewer_email(p_id uuid, p_email text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, pg_catalog
AS $function$
BEGIN
  IF NOT public.is_owner_or_admin() THEN
    RAISE EXCEPTION 'Insufficient permissions';
  END IF;
  UPDATE interviewers
  SET email = COALESCE(p_email, '')
  WHERE id = p_id;
END;
$function$;

-- ── Step 2: fixed search_path for the four functions that need only that
--            (exact signatures; bodies unchanged). is_current_user_owner is NOT
--            touched (it already sets its own search_path and needs no gate). ──
ALTER FUNCTION public.clear_student_disposition(uuid, text)
  SET search_path = public, pg_catalog;
ALTER FUNCTION public.record_student_disposition(
    uuid, uuid, text, text, text, text, text, date, text[], text)
  SET search_path = public, pg_catalog;
ALTER FUNCTION public.school_form_requires_password(uuid)
  SET search_path = public, pg_catalog;
ALTER FUNCTION public.verify_school_form_password(uuid, text)
  SET search_path = public, pg_catalog;

-- ── Step 3: revoke PUBLIC + anon EXECUTE from EVERY SECURITY DEFINER function
--            in public (NO school-form exclusion). ──────────────────────────
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prosecdef
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%I(%s) FROM PUBLIC;', r.proname, r.args);
    EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%I(%s) FROM anon;',   r.proname, r.args);
  END LOOP;
END $$;

-- ── Step 4: restore anon (and authenticated) EXECUTE for ONLY the two
--            anonymous school-form functions. ───────────────────────────────
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('verify_school_form_password', 'school_form_requires_password')
  LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I(%s) TO anon, authenticated;', r.proname, r.args);
  END LOOP;
END $$;

-- ── Step 5: restore authenticated EXECUTE for the approved staff/self allowlist.
--            Names absent from live (Phase 2 scope functions) are skipped by the
--            inner catalog lookup, so this is safe before Phase 2. ────────────
DO $$
DECLARE r record; fn text;
  names text[] := ARRAY[
    'get_my_profile', 'get_all_user_profiles', 'get_active_interviewers',
    'add_interviewer', 'update_interviewer_color', 'update_interviewer_email',
    'is_current_user_owner', 'update_my_avatar', 'update_my_connect_signature',
    'record_student_disposition', 'clear_student_disposition',
    'complete_disposition_followup', 'is_owner_or_admin', 'is_staff',
    'portal_profile_id', 'has_active_role_grant', 'my_linked_student_ids',
    'my_unit_scope_keys', 'my_school_scope_keys', 'get_my_portal_access'
  ];
BEGIN
  FOREACH fn IN ARRAY names LOOP
    FOR r IN
      SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = fn
    LOOP
      EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I(%s) TO authenticated;', r.proname, r.args);
    END LOOP;
  END LOOP;
END $$;

-- ── Step 6: ensure service_role retains EXECUTE on every SECURITY DEFINER
--            function (the PUBLIC revoke could otherwise strip a function whose
--            only grant was the PUBLIC default). ──────────────────────────────
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prosecdef
  LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I(%s) TO service_role;', r.proname, r.args);
  END LOOP;
END $$;

COMMIT;

-- ── Verification (read-only; all use COALESCE(proacl, acldefault(...)) so a
--    function relying on the DEFAULT PUBLIC grant is correctly surfaced) ───────
--
-- 1. PUBLIC has no EXECUTE on any public SECURITY DEFINER function (expected 0 rows):
--   SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
--   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--   CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
--   WHERE n.nspname = 'public' AND p.prosecdef
--     AND a.privilege_type = 'EXECUTE' AND a.grantee = 0   -- 0 = PUBLIC
--   ORDER BY p.proname;
--
-- 2. anon has EXECUTE only on the two school-form functions (expected exactly 2 rows):
--   SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
--   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--   CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
--   JOIN pg_roles r ON r.oid = a.grantee
--   WHERE n.nspname = 'public' AND p.prosecdef
--     AND a.privilege_type = 'EXECUTE' AND r.rolname = 'anon'
--   ORDER BY p.proname;
--
-- 3. authenticated EXECUTE allowlist (expected: the live subset of the 20 names):
--   SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
--   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--   CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
--   JOIN pg_roles r ON r.oid = a.grantee
--   WHERE n.nspname = 'public' AND p.prosecdef
--     AND a.privilege_type = 'EXECUTE' AND r.rolname = 'authenticated'
--   ORDER BY p.proname;
--
-- 4. service_role has EXECUTE on every SECURITY DEFINER function (expected 0 rows):
--   SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
--   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE n.nspname = 'public' AND p.prosecdef
--     AND NOT EXISTS (
--       SELECT 1 FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
--       JOIN pg_roles r ON r.oid = a.grantee
--       WHERE a.privilege_type = 'EXECUTE' AND r.rolname = 'service_role')
--   ORDER BY p.proname;
--
-- 5. The nine functions have a fixed search_path (expected 9 rows, each proconfig
--    containing search_path=public, pg_catalog):
--   SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args, p.proconfig
--   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE n.nspname = 'public' AND p.proname IN
--     ('add_interviewer','clear_student_disposition','get_active_interviewers',
--      'get_all_user_profiles','record_student_disposition',
--      'school_form_requires_password','update_interviewer_color',
--      'update_interviewer_email','verify_school_form_password')
--   ORDER BY p.proname;
--
-- 6. The five sensitive functions contain their internal gate (expected: the four
--    owner/admin functions TRUE for owner_admin_gate; get_active_interviewers
--    TRUE for staff_gate):
--   SELECT p.proname,
--     position('is_owner_or_admin' in pg_get_functiondef(p.oid)) > 0 AS owner_admin_gate,
--     position('is_staff' in pg_get_functiondef(p.oid)) > 0 AS staff_gate
--   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE n.nspname='public' AND p.proname IN
--     ('get_all_user_profiles','get_active_interviewers','add_interviewer',
--      'update_interviewer_color','update_interviewer_email')
--   ORDER BY p.proname;
--
-- 7. No equivalent overload remains anon/PUBLIC-exposed: query 1 and 2 already
--    iterate every overload (each pg_proc row), so a nonzero count there is the
--    only signal needed. Cross-check overloads with:
--   SELECT p.proname, count(*) AS overloads
--   FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
--   WHERE n.nspname='public' AND p.prosecdef
--   GROUP BY p.proname HAVING count(*) > 1 ORDER BY p.proname;
--
-- 8. Smoke test after apply: /school-form still gates by password (logged out);
--    staff login loads the profile; the interviewer dropdown populates for a
--    staff user; owner/admin can add or recolor an interviewer; a non-staff
--    authenticated caller of get_active_interviewers or a non-owner/admin caller
--    of get_all_user_profiles receives 'Insufficient permissions'.

-- ── Rollback (INERT; for emergency recovery only). Reintroduces the known
--    SECURITY DEFINER exposure: it restores the exact prior UNGATED bodies, the
--    prior (absent) search_path on the reconciled functions, and the permissive
--    PUBLIC EXECUTE posture (reopening finding F8). ────────────────────────────
/*
BEGIN;

-- Restore the five prior ungated bodies (exact pre-change live definitions):
CREATE OR REPLACE FUNCTION public.get_all_user_profiles()
 RETURNS SETOF user_profiles LANGUAGE plpgsql SECURITY DEFINER
AS $function$
BEGIN
  RETURN QUERY SELECT * FROM user_profiles ORDER BY created_at DESC;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_active_interviewers()
 RETURNS TABLE(id uuid, full_name text, email text, interviewer_color text,
   can_conduct_interviews boolean, is_active boolean, login_enabled boolean,
   default_interview_duration integer)
 LANGUAGE plpgsql SECURITY DEFINER
AS $function$
BEGIN
  RETURN QUERY
  SELECT up.id, up.full_name, up.email, up.interviewer_color,
         up.can_conduct_interviews, up.is_active, up.login_enabled,
         up.default_interview_duration
  FROM user_profiles up
  WHERE up.can_conduct_interviews = TRUE AND up.is_active = TRUE
  ORDER BY up.full_name;
END;
$function$;

CREATE OR REPLACE FUNCTION public.add_interviewer(p_name text, p_email text)
 RETURNS TABLE(id uuid, name text, email text, color text)
 LANGUAGE plpgsql SECURITY DEFINER
AS $function$
BEGIN
  RETURN QUERY
  INSERT INTO interviewers (name, email)
  VALUES (p_name, COALESCE(p_email, ''))
  RETURNING interviewers.id, interviewers.name, interviewers.email, interviewers.color;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_interviewer_color(p_id uuid, p_color text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER
AS $function$
BEGIN
  UPDATE interviewers SET color = p_color WHERE id = p_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_interviewer_email(p_id uuid, p_email text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER
AS $function$
BEGIN
  UPDATE interviewers SET email = COALESCE(p_email, '') WHERE id = p_id;
END;
$function$;

-- Reset search_path on the four ALTER-only functions to the prior (absent) state:
ALTER FUNCTION public.clear_student_disposition(uuid, text) RESET search_path;
ALTER FUNCTION public.record_student_disposition(
    uuid, uuid, text, text, text, text, text, date, text[], text) RESET search_path;
ALTER FUNCTION public.school_form_requires_password(uuid) RESET search_path;
ALTER FUNCTION public.verify_school_form_password(uuid, text) RESET search_path;

-- Reopen EXECUTE to PUBLIC on every SECURITY DEFINER function (reopens F8):
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prosecdef
  LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I(%s) TO PUBLIC;', r.proname, r.args);
  END LOOP;
END $$;
COMMIT;
*/

-- ── Optional cosmetic cleanup (former F10), not security-bearing ─────────────
-- The student_reads and session_reads UPDATE policies omit WITH CHECK and a TO
-- clause. Harmless (the USING predicate already restricts to own rows under the
-- intentional id model). Left as an optional future tidy; intentionally NOT
-- changed here to avoid touching working read-receipt policies.
