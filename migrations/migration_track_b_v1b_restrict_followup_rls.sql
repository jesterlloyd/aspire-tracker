-- Track B v1b: Restrict student_disposition_followups SELECT to Owner/Admin only.
--
-- PREREQUISITES - apply this file ONLY after ALL of the following are confirmed:
--   1. migration_track_b_v1a_secure_completion_rpc.sql is live
--      (is_owner_or_admin() function must exist before this policy can be created)
--   2. The frontend build using supabase.rpc('complete_disposition_followup', …)
--      is deployed and completion has been verified working end-to-end for an Owner/Admin user.
--
-- What this does:
--   Drops the broad "authenticated for ALL" policy on student_disposition_followups
--   and replaces it with an Owner/Admin-only SELECT policy.
--   Writes are no longer permitted via direct client INSERT/UPDATE/DELETE - only the
--   SECURITY DEFINER RPC (which bypasses RLS) can write to this table.
--
-- After applying, verify:
--   - Owner/Admin can still read follow-up rows and complete them via the RPC.
--   - Non-Owner/Admin (interviewer, viewer) receives 0 rows on SELECT.
--   - Action Center disposition stack is empty for non-Owner/Admin (expected - canEdit gate).

DROP POLICY IF EXISTS "authenticated_all_disposition_followups" ON public.student_disposition_followups;

DROP POLICY IF EXISTS "owner_admin_select_disposition_followups" ON public.student_disposition_followups;

CREATE POLICY "owner_admin_select_disposition_followups"
  ON public.student_disposition_followups
  FOR SELECT
  TO authenticated
  USING (public.is_owner_or_admin());
