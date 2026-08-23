-- ============================================================================
-- DROP THE OUT-OF-BAND "Full access on interviewers" POLICY
-- ============================================================================
-- APPLY MANUALLY (Owner/Jester) in the Supabase SQL Editor, as ONE COMPLETE
-- BLOCK. Single transaction. Run
-- db/audit/interviewers_full_access_preflight_and_verification.sql (PRE-APPLY
-- section) first, one section at a time.
--
-- WHAT WAS FOUND
-- POST 1 of the Wave E write split verification surfaced a policy on
-- public.interviewers that this repository has never contained:
--
--   "Full access on interviewers"  FOR ALL  TO public  USING (true)  WITH CHECK (true)
--
-- It appears in no migration, no legacy root file, no revert script, and no
-- document. It was created out-of-band in the Supabase dashboard, like
-- user_profiles, activity_logs, and get_my_profile, which the security docs
-- already record as dashboard-created. Wave B (20260712000001) dropped three
-- dashboard-era "Allow anon ... on interviewers" policies BY NAME and would have
-- dropped this one too, had its name been known.
--
-- WHY IT MATTERS
-- Permissive policies OR together. A FOR ALL policy with USING (true) therefore
-- makes every other policy on the table irrelevant, including the four
-- interviewers_* policies the Wave E split installs. Read precisely:
--   anon           holds NO table privilege on interviewers (Wave B line 53:
--                  REVOKE ALL ON public.interviewers FROM anon), so this policy
--                  cannot grant anon anything. A policy only widens what a role's
--                  table privileges already permit.
--   authenticated  holds the Supabase default ALL privileges, so this policy
--                  grants FULL READ AND WRITE on the interviewer directory to
--                  EVERY authenticated principal: not only all staff roles, but
--                  portal students, unit leaders, and academic partners as well.
-- That second point is the live exposure, and it is closed by dropping the
-- policy. Nothing depends on it: no code references the name, every browser
-- read of interviewers runs as authenticated staff (covered by
-- interviewers_staff_select), and the service-role endpoints bypass RLS.
--
-- ORDERING
-- Independent of 20260822020000. Applying this first leaves the Wave E FOR ALL
-- policy governing the table, which is the pre-split state. Applying it second
-- lets the four writer policies take effect, which is the intended end state.
-- Either order is safe; apply both.
--
-- This migration changes ONE POLICY and nothing else. It writes no row in any
-- application table and drops no data.
-- ============================================================================

BEGIN;

-- Named exactly, never discovered, so this can drop only the policy that was
-- reported. Any other unexpected policy on this table is surfaced by the
-- verification queries rather than silently removed here.
DROP POLICY IF EXISTS "Full access on interviewers" ON public.interviewers;

COMMIT;


-- ── Verification ─────────────────────────────────────────────────────────────
-- See db/audit/interviewers_full_access_preflight_and_verification.sql, POST-APPLY
-- section. Run each numbered section separately.


-- ============================================================================
-- ROLLBACK (INERT). Recreates the policy from the definition POST 1 reported.
-- Save the PRE 1 output before applying; if it shows any attribute differing
-- from the statement below (for example RESTRICTIVE rather than PERMISSIVE),
-- use the PRE 1 restore_sql column instead, which is generated from the live
-- catalog verbatim.
--
-- Reintroduces the exposure by design: for emergency recovery only.
-- ============================================================================
/*
BEGIN;
CREATE POLICY "Full access on interviewers" ON public.interviewers
  AS PERMISSIVE FOR ALL TO public
  USING (true) WITH CHECK (true);
COMMIT;
*/
