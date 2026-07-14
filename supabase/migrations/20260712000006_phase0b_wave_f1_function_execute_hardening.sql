-- ============================================================================
-- PHASE 0B, WAVE F-1: SECURITY DEFINER function EXECUTE privilege hardening
-- ============================================================================
-- Closes confirmed finding F8: several SECURITY DEFINER functions are
-- executable by anon or PUBLIC. A function granted to PUBLIC is callable by
-- anon regardless of any explicit anon revoke, so PUBLIC must be revoked.
--
-- *** PREREQUISITE: Phase 0B Wave A (is_staff) recommended first, because    ***
-- *** this file re-grants is_staff/is_owner_or_admin to authenticated.       ***
-- Safe to apply any time after Wave A; it changes privileges only, never a
-- function body, so it cannot alter behavior for a legitimately authorized
-- caller. Run the ENTIRE file as one block.
--
-- Method: data-driven DO blocks over pg_proc, so exact signatures never need
-- to be hardcoded (several target functions are dashboard-created and their
-- argument lists are not in the repository). Idempotent and safely rerunnable
-- (REVOKE/GRANT are idempotent). Wrapped in a transaction.
--
-- Preserved for the ANONYMOUS /school-form workflow (verified dependency,
-- boolean-only, no data returned): verify_school_form_password and
-- school_form_requires_password keep anon EXECUTE.
--
-- IMPORTANT follow-up (documented, NOT done here): privilege hardening alone
-- cannot distinguish a staff authenticated session from a portal authenticated
-- session, because Postgres has only the anon/authenticated/service_role
-- roles. Functions that expose staff-wide data to any authenticated caller
-- (get_all_user_profiles, and any interviewer-mutation RPC) therefore ALSO
-- need an INTERNAL is_owner_or_admin()/is_staff() gate in their body. Those
-- bodies are dashboard-created and not in the repository, so they are NOT
-- rewritten here. Confirm the internal gate against live-state audit section 4
-- BEFORE inviting any portal user (see docs/security/OWNER_SQL_GATE.md). The
-- recommended internal guard, to add at the top of get_all_user_profiles:
--     IF NOT public.is_owner_or_admin() THEN
--       RAISE EXCEPTION 'Insufficient permissions';
--     END IF;
-- ============================================================================

BEGIN;

-- ── Step 1: revoke anon + PUBLIC EXECUTE from every SECURITY DEFINER function
--            in public, EXCEPT the anonymous-workflow preserve-list. ─────────
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.proname,
           pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef
      AND p.proname NOT IN (
        'verify_school_form_password',
        'school_form_requires_password'
      )
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%I(%s) FROM PUBLIC;', r.proname, r.args);
    EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%I(%s) FROM anon;',   r.proname, r.args);
  END LOOP;
END $$;

-- ── Step 2: preserve the anonymous school-form functions. ───────────────────
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

-- ── Step 3: restore authenticated EXECUTE for functions legitimately called
--            from a signed-in session (the PUBLIC revoke above may have been
--            their only grant). These run as the querying role in RLS or via
--            client .rpc(). ────────────────────────────────────────────────
DO $$
DECLARE r record; fn text;
  names text[] := ARRAY[
    'get_my_profile', 'get_all_user_profiles', 'get_active_interviewers',
    'update_my_avatar', 'update_my_connect_signature',
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

-- ── Step 4: ensure service_role retains EXECUTE on every SECURITY DEFINER
--            function (the PUBLIC revoke could otherwise strip a function whose
--            only grant was PUBLIC; service_role is trusted backend infra and
--            already holds explicit grants on the token/governance RPCs). ────
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

-- ── Verification ────────────────────────────────────────────────────────────
-- 1. No SECURITY DEFINER function should grant EXECUTE to anon or PUBLIC,
--    except the two school-form functions (expected: only those two rows, and
--    only for grantee 'anon'/PUBLIC):
--   SELECT p.proname, r.rolname AS grantee
--   FROM pg_proc p
--   JOIN pg_namespace n ON n.oid = p.pronamespace
--   CROSS JOIN LATERAL aclexplode(p.proacl) a
--   JOIN pg_roles r ON r.oid = a.grantee
--   WHERE n.nspname = 'public' AND p.prosecdef
--     AND a.privilege_type = 'EXECUTE'
--     AND (r.rolname = 'anon' OR a.grantee = 0)  -- 0 = PUBLIC
--   ORDER BY p.proname;
--
-- 2. Confirm the school-form functions remain anon-executable (expected 2 rows):
--   SELECT p.proname
--   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--   CROSS JOIN LATERAL aclexplode(p.proacl) a
--   JOIN pg_roles r ON r.oid = a.grantee
--   WHERE n.nspname='public' AND r.rolname='anon' AND a.privilege_type='EXECUTE'
--     AND p.proname IN ('verify_school_form_password','school_form_requires_password');
--
-- 3. Smoke test after apply: /school-form still gates by password; every staff
--    RPC path still works (login loads profile via get_my_profile, interviewer
--    dropdown via get_active_interviewers, disposition record/clear, avatar
--    update). If any breaks, section-3 re-grant missed a name; add it and rerun.

-- ── Rollback ────────────────────────────────────────────────────────────────
-- Restores the pre-hardening (permissive) state. Only for emergency recovery;
-- it re-opens finding F8.
/*
BEGIN;
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
