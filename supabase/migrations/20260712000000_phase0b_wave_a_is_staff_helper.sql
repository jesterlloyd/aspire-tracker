-- ============================================================================
-- PHASE 0B, WAVE A: is_staff() helper (ADDITIVE ONLY, no behavior change)
-- ============================================================================
-- Owner instructions: run this ENTIRE file as one block in the Supabase SQL
-- editor. It creates one function and changes no policies, no tables, and no
-- data. Nothing depends on it until Wave E, so it is safe at any time.
--
-- is_staff() complements is_owner_or_admin(): TRUE when the calling
-- authenticated user holds any CURRENT internal staff role and is not
-- deactivated. Future portal roles (student, unit_leader, academic_partner,
-- Phase 2) are intentionally NOT in this list: everything re-scoped to
-- is_staff() in Wave E is invisible to portal accounts by default.
--
-- Both 'co_lead' and 'co-lead' spellings are included because both appear in
-- production policy history (see notification_log's owners_admins_read).
-- is_active: profiles are created with is_active = true (api/invite-user.js)
-- and deactivation sets it false; COALESCE treats legacy NULL as active,
-- matching current UI behavior (AuthedShell blocks is_active === false).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.is_staff()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_catalog
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE auth_user_id = auth.uid()
      AND role IN ('owner', 'admin', 'co_lead', 'co-lead', 'interviewer', 'viewer')
      AND COALESCE(is_active, true) = true
  );
$$;

REVOKE ALL ON FUNCTION public.is_staff() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_staff() FROM anon;
GRANT EXECUTE ON FUNCTION public.is_staff() TO authenticated;

-- Verification (run after; expected: one row, prosecdef = true):
--   SELECT proname, prosecdef FROM pg_proc
--   WHERE proname = 'is_staff' AND pronamespace = 'public'::regnamespace;
