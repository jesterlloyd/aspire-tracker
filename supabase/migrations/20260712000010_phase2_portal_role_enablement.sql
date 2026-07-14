-- ============================================================================
-- PHASE 2, PART 4: enable the 'portal' profile role (CHECK widening only)
-- ============================================================================
-- *** PREREQUISITES (hard): Phase 0B Waves A through E, then the Phase 2      ***
-- *** foundation (20260712000007) and access lifecycle (20260712000009).     ***
-- *** MUST be applied before ANY portal invitation: provision_portal_access  ***
-- *** sets user_profiles.role = 'portal', which the live CHECK rejects until  ***
-- *** this migration widens it.                                              ***
--
-- Owner instructions: run this ENTIRE file as one block. It changes ONE object:
-- the user_profiles role CHECK constraint. It inserts no data, converts no
-- existing profile, and creates no table, policy, function, grant, or role
-- grant. Applying it does NOT activate any portal account.
--
-- WHY THIS IS SAFE (audited, not weakening staff authorization):
--   The live constraint is
--     CHECK (role = ANY (ARRAY['owner','admin','interviewer','viewer']))
--   which forbids role='portal'. This migration only ADDS 'portal' to that
--   list. A CHECK constraint constrains legal VALUES; it confers no privilege.
--
--   The privilege wall that stops a client from changing its own role is
--   already in place from Phase 0B Wave E (applied):
--     - authenticated has NO table-level UPDATE on user_profiles (revoked).
--     - authenticated has a COLUMN-level UPDATE grant ONLY on the cosmetic
--       self-service columns: avatar_url, onboarding_tour_completed,
--       onboarding_tour_completed_at, onboarding_tour_version,
--       onboarding_tour_dismissed, last_login_at.
--     - role, is_owner, is_active, can_conduct_interviews, and login_enabled
--       are NOT column-granted, so any self UPDATE that touches them is
--       rejected at the column-privilege level, independent of the row policy.
--     - user_profiles_update_self restricts writes to the caller's OWN row
--       (USING/WITH CHECK auth_user_id = auth.uid()).
--   Therefore a portal user can never set role='owner'/'admin'/'interviewer'/
--   'viewer' (or flip is_owner/is_active). Widening the CHECK does not open a
--   role-escalation path; it only lets the service-role, Owner/Admin-gated
--   provision_portal_access() write role='portal'.
--
--   Routing is unaffected: is_staff() and is_owner_or_admin() do NOT list
--   'portal', and the client PORTAL_STAFF_ROLES list (src/App.jsx) does not
--   either, so a role='portal' profile enters PortalApp, and with no active
--   authorization grant it sees no portal data.
--
-- NULL behavior is preserved: role = ANY(ARRAY[...]) evaluates to NULL when
-- role IS NULL, and a CHECK passes on NULL or TRUE, so a NULL role remains
-- permitted exactly as before.
-- ============================================================================

BEGIN;

ALTER TABLE public.user_profiles
  DROP CONSTRAINT user_profiles_role_check;

ALTER TABLE public.user_profiles
  ADD CONSTRAINT user_profiles_role_check
  CHECK (
    role = ANY (
      ARRAY[
        'owner'::text,
        'admin'::text,
        'interviewer'::text,
        'viewer'::text,
        'portal'::text
      ]
    )
  );

COMMIT;

-- ── Verification ─────────────────────────────────────────────────────────────
-- 1. The constraint permits exactly the five roles (expect 'portal' present):
--   SELECT pg_get_constraintdef(oid) FROM pg_constraint
--   WHERE conname = 'user_profiles_role_check'
--     AND conrelid = 'public.user_profiles'::regclass;
-- 2. No existing profile was converted (expect zero portal profiles until an
--    invitation provisions one):
--   SELECT count(*) FROM public.user_profiles WHERE role = 'portal';
-- 3. is_staff() still excludes portal (expect false for a portal test profile):
--   SELECT proname, pg_get_functiondef(oid) LIKE '%''portal''%' AS lists_portal
--   FROM pg_proc WHERE proname IN ('is_staff','is_owner_or_admin')
--     AND pronamespace = 'public'::regnamespace;   -- lists_portal expected false

-- ── Rollback (restores the pre-portal four-role CHECK; only safe when NO
--    profile currently holds role='portal', or that row is first re-roled) ─────
/*
BEGIN;
ALTER TABLE public.user_profiles DROP CONSTRAINT user_profiles_role_check;
ALTER TABLE public.user_profiles
  ADD CONSTRAINT user_profiles_role_check
  CHECK (role = ANY (ARRAY['owner'::text, 'admin'::text, 'interviewer'::text, 'viewer'::text]));
COMMIT;
*/
