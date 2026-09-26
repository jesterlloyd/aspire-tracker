-- supabase/migrations/20261007000000_s24_cohort_school_rotations_read_scope.sql
--
-- S-24 (FINDINGS_REGISTER): cohort_school_rotations carried two SELECT policies with
-- USING (true), one for anon and one for authenticated, since 20260522000000. Anyone with
-- the public anon key could read every school's rotation window and coordinator name and
-- email, and every signed-in portal user could read every school's rows.
--
-- Discovery at S24-1 (2026-09-25) found:
--   * every browser reader is in the STAFF app (StaffApp, RotationActivity, MatchingTab,
--     ManageCohortModal, CohortBar, OverviewTab, StudentSidePanel, StudentCoverage, the scope
--     picker and the home loaders), all signed in with a staff role: is_staff() covers them;
--   * no public, logged-out page reads the table. The "school-form confirmation fetch" the
--     anon policy anticipated in 2026-05 was never built, so nothing moves to an endpoint;
--   * no portal reads the table from the browser. The Academic Partner, Unit Leader, Student
--     and Nursing Academics portals read it only through server endpoints on the service
--     role, each of which already scopes by school, unit or student. The one caller-scoped
--     (JWT) client in api/ calls the school-form password RPC and never this table;
--   * the SQL routines that read it are SECURITY DEFINER, or invoker-rights with EXECUTE
--     granted to service_role only (student_shift_classify).
-- So the right shape is a single staff read policy and no portal or anon policy: a portal
-- policy would guard a read that does not exist. Writes were already service-role only (no
-- write policy exists) and are not touched.
--
-- This file: drops the two USING (true) policies, creates
-- cohort_school_rotations_staff_select FOR SELECT TO authenticated USING (is_staff()), and
-- revokes the anon role's table privileges so an anon read is refused outright rather than
-- returning an empty set. Idempotent, one transaction, refuses to run without is_staff().
-- No application deploy is needed before or after it: no code changes with it.
--
-- Owner-gated. Checks, one section at a time, are in
-- db/audit/s24_cohort_school_rotations_read_scope_checks.sql: PRE 1 to 3, then this file,
-- then POST 1 to 3. Rollback (inert until run) at the end.

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.cohort_school_rotations') IS NULL THEN
    RAISE EXCEPTION 'S-24: public.cohort_school_rotations does not exist; nothing was applied';
  END IF;
  IF to_regprocedure('public.is_staff()') IS NULL THEN
    RAISE EXCEPTION 'S-24: public.is_staff() must exist (Wave A); nothing was applied';
  END IF;
END $$;

ALTER TABLE public.cohort_school_rotations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cohort_school_rotations_anon_select"          ON public.cohort_school_rotations;
DROP POLICY IF EXISTS "cohort_school_rotations_authenticated_select" ON public.cohort_school_rotations;
DROP POLICY IF EXISTS cohort_school_rotations_staff_select           ON public.cohort_school_rotations;

CREATE POLICY cohort_school_rotations_staff_select
  ON public.cohort_school_rotations FOR SELECT TO authenticated
  USING (public.is_staff());

-- The anon role has no reader; take the table grant away too, so the refusal is explicit.
REVOKE ALL ON TABLE public.cohort_school_rotations FROM anon;

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────────
-- Rollback (Owner-gated, one block; inert until run). Restores the two 20260522000000
-- policies and the anon SELECT grant exactly as they were.
--
--   BEGIN;
--   DROP POLICY IF EXISTS cohort_school_rotations_staff_select ON public.cohort_school_rotations;
--   CREATE POLICY "cohort_school_rotations_authenticated_select"
--     ON public.cohort_school_rotations FOR SELECT TO authenticated USING (true);
--   CREATE POLICY "cohort_school_rotations_anon_select"
--     ON public.cohort_school_rotations FOR SELECT TO anon USING (true);
--   GRANT SELECT ON TABLE public.cohort_school_rotations TO anon;
--   COMMIT;
-- ─────────────────────────────────────────────────────────────────────────────
