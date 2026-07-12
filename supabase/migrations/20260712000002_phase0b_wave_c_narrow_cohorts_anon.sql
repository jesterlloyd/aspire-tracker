-- ============================================================================
-- PHASE 0B, WAVE C: cohorts, anon narrowed from ALL to SELECT
-- ============================================================================
-- Owner instructions: run this ENTIRE file as one block in the Supabase SQL
-- editor. Prerequisite: none. Safe at any time.
--
-- Verified dependency (audit 5.2): the public /student-form, /school-form,
-- and /unit-form pages all SELECT cohorts with the anon key (accepting-cohort
-- lookup). SELECT is therefore preserved; write access for the public key is
-- removed. The tracked anon_all policy is FOR ALL, so it must be replaced,
-- not just revoked.
--
-- NOTE: units keeps its anon_all until Wave D because the CURRENT production
-- bundle still writes units from the public unit form; the Wave D code
-- release removes that write path first.
--
-- Revert: db/audit/phase0b_reverts.sql, section Wave C.
-- ============================================================================

DROP POLICY IF EXISTS "anon_all" ON public.cohorts;

DROP POLICY IF EXISTS "anon_select_cohorts" ON public.cohorts;
CREATE POLICY "anon_select_cohorts" ON public.cohorts
  FOR SELECT TO anon USING (true);

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.cohorts FROM anon;

-- Verification (expected: exactly one anon policy on cohorts, cmd = SELECT):
--   SELECT policyname, cmd FROM pg_policies
--   WHERE schemaname = 'public' AND tablename = 'cohorts' AND 'anon' = ANY(roles);
--
-- Post-wave smoke test: open /student-form, /school-form, and /unit-form in a
-- logged-out browser; each must load its cohort state (open or closed) normally.
