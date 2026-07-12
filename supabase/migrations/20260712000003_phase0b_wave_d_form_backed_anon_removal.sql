-- ============================================================================
-- PHASE 0B, WAVE D: students, units, unit_cohort_responses anon removal
-- ============================================================================
-- *** HARD PREREQUISITE: DO NOT RUN until the Wave D application release is ***
-- *** verified live in production (Settings -> General -> About shows the   ***
-- *** Wave D commit SHA). That release moved these client paths server-side: ***
--   - /student-form student lookup  -> api/student-intake-lookup.js
--   - /unit-form pre-fill           -> api/unit-form-lookup.js
--   - /unit-form submission         -> api/unit-form-submit.js
-- Running this wave against the OLD bundle breaks the live intake and unit
-- participation forms. After the release, visitors with a stale tab open must
-- refresh; prefer applying during a quiet window outside form-collection
-- periods.
--
-- Owner instructions: run this ENTIRE file as one block AFTER the deploy
-- verification above.
--
-- Findings: F1 (students anon_all), F3 (intake SELECT *), F4
-- (unit_cohort_responses anon write and read), audit sections 5.1, 5.3, 5.20.
-- Revert: db/audit/phase0b_reverts.sql, section Wave D.
-- ============================================================================

-- students: full anon removal. The intake form resolves students server-side.
DROP POLICY IF EXISTS "anon_all" ON public.students;
REVOKE ALL ON public.students FROM anon;

-- units: anon narrowed to SELECT. Verified anon SELECT dependencies remain
-- (unit dropdowns on /student-form and /unit-form read units client-side);
-- the unit form's INSERT and UPDATE of units moved into unit-form-submit.
DROP POLICY IF EXISTS "anon_all" ON public.units;
DROP POLICY IF EXISTS "anon_select_units" ON public.units;
CREATE POLICY "anon_select_units" ON public.units
  FOR SELECT TO anon USING (true);
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.units FROM anon;

-- unit_cohort_responses: full anon removal (read, insert, update). Pre-fill
-- and submission both moved server-side. The unscoped anon UPDATE (any unit,
-- any cohort, from any visitor) closes here.
DROP POLICY IF EXISTS "anon_insert_unit_responses" ON public.unit_cohort_responses;
DROP POLICY IF EXISTS "anon_update_unit_responses" ON public.unit_cohort_responses;
DROP POLICY IF EXISTS "anon_select_unit_responses" ON public.unit_cohort_responses;
REVOKE ALL ON public.unit_cohort_responses FROM anon;

-- Verification (expected: units shows exactly one anon SELECT policy; the
-- other two tables show zero anon policies):
--   SELECT tablename, policyname, cmd FROM pg_policies
--   WHERE schemaname = 'public' AND 'anon' = ANY(roles)
--     AND tablename IN ('students', 'units', 'unit_cohort_responses');
--
-- Post-wave smoke test (logged-out browser):
--   1. /student-form: enter a known school email, confirm the form accepts it
--      and a full submission succeeds end to end.
--   2. /unit-form: select a unit with a previous submission, confirm pre-fill
--      appears; submit an update; confirm the Overview drawer reflects it.
--   3. /school-form: unchanged, but confirm it still loads (cohorts SELECT).
