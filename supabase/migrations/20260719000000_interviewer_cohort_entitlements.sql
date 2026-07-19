-- ============================================================================
-- INTERVIEWER COHORT ENTITLEMENTS (Wave F-2 interviewer file access)
-- ============================================================================
-- *** APPLY MANUALLY (Owner/Jester) in the Supabase SQL editor. Prepared but    ***
-- *** NOT executed by the assistant. Run the ENTIRE file once. It is additive:   ***
-- *** one table, its indexes, RLS + least-privilege grants, and a guarded        ***
-- *** backfill. It creates no storage objects and changes no bucket or storage   ***
-- *** policy. It is SEPARATE from the student-files privacy migrations (Pass 2    ***
-- *** backfill / Pass 3 cutover).                                                 ***
--
-- Supersedes the earlier proposal
--   supabase/migrations/20260718000002_interviewer_assignment_identity.sql
--   (branch wave-f2-interviewer-access @ 62c3de1). That migration added an
--   interviewer_profile_id column to interview_availability_blocks. It must remain
--   UNAPPLIED; do not run it. This entitlement-table design replaces it per the
--   locked product decisions: durable, manually managed, cohort-wide entitlement.
--
-- Identity model (preserved exactly): auth.users.id, user_profiles.auth_user_id,
-- and user_profiles.id are three distinct values. Every relationship here uses
-- user_profiles.id, never auth.users.id, and no policy compares a profile id to
-- auth.uid() directly.
--
-- Authorization boundary: this table is the source of truth for interviewer file
-- access. It is server-mediated only (no authenticated browser grant, so RLS +
-- no policy denies the browser; the service-role server endpoints manage it).
-- public.is_staff() is intentionally NOT used (it also returns true for
-- interviewer and viewer). The existing public.is_active_owner_or_admin() helper
-- is reused where a policy predicate is needed.
--
-- Entitlement semantics (enforced by the application + these constraints):
--   Active entitlement  = revoked_at IS NULL AND the linked user_profiles row has
--                         role 'interviewer' AND is_active IS NOT FALSE.
--   Durable             = it does NOT expire when a rubric is submitted, an
--                         interview ends, a cycle ends, a slot/block changes, a
--                         student is reassigned, or the cohort later goes inactive.
--   Ends only on        = manual revocation (revoked_at set) OR the interviewer
--                         account being deactivated (is_active = false), which the
--                         server checks live so access stops immediately even if the
--                         row is still unrevoked.
--   History preserved   = revocation sets revoked_at/revoked_by_profile_id; rows
--                         are never deleted, so the audit trail remains.
-- ============================================================================

-- ── 1. Schema: table, indexes, RLS, least-privilege grants ───────────────────
BEGIN;

CREATE TABLE IF NOT EXISTS public.interviewer_cohort_entitlements (
  id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  interviewer_profile_id uuid        NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  cohort_id              uuid        NOT NULL REFERENCES public.cohorts(id)        ON DELETE CASCADE,
  granted_by_profile_id  uuid        NOT NULL REFERENCES public.user_profiles(id),
  granted_at             timestamptz NOT NULL DEFAULT now(),
  revoked_at             timestamptz,
  revoked_by_profile_id  uuid        REFERENCES public.user_profiles(id) ON DELETE SET NULL
);

COMMENT ON TABLE public.interviewer_cohort_entitlements IS
  'Durable, manually managed grant of read-only student resume/photo access to an '
  'interviewer for an entire cohort (Wave F-2). Managed only through server-mediated '
  'active-Owner/Admin paths. Active = revoked_at IS NULL and the linked account is an '
  'active interviewer.';

-- At most one ACTIVE entitlement per (interviewer, cohort). Revoked history may
-- accumulate freely (a later re-grant inserts a new active row).
CREATE UNIQUE INDEX IF NOT EXISTS uq_ice_active
  ON public.interviewer_cohort_entitlements (interviewer_profile_id, cohort_id)
  WHERE revoked_at IS NULL;

-- File-access lookup: an interviewer's active entitlements (their entitled cohorts).
CREATE INDEX IF NOT EXISTS idx_ice_interviewer_active
  ON public.interviewer_cohort_entitlements (interviewer_profile_id)
  WHERE revoked_at IS NULL;

-- Management listing by cohort.
CREATE INDEX IF NOT EXISTS idx_ice_cohort
  ON public.interviewer_cohort_entitlements (cohort_id);

-- RLS on, no browser grant: authenticated/anon get NO privileges and NO policy, so
-- the table is unreachable from the browser. All reads and writes go through the
-- service-role server endpoints (which bypass RLS). No is_staff(), no anon.
ALTER TABLE public.interviewer_cohort_entitlements ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.interviewer_cohort_entitlements FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.interviewer_cohort_entitlements TO service_role;

COMMIT;

-- ── 2. Guarded backfill: map every active Interviewer to the active cohort ────
-- Aborts safely (no rows written) if the live assumptions do not hold, rather than
-- guessing. Re-runnable: the NOT EXISTS guard and uq_ice_active make it idempotent.
-- The schema above is already committed, so an aborted backfill leaves the table in
-- place; fix the ambiguity and re-run this block.
BEGIN;
DO $$
DECLARE
  v_cohort  uuid;
  v_actor   uuid;
  n_cohorts int;
  n_owners  int;
  n_inserted int;
BEGIN
  -- Active cohort must be unambiguous (cohorts.status = 'Active'). The app uses a
  -- single-active-cohort convention but does not enforce it in the database, so we
  -- refuse to guess across multiple.
  SELECT count(*) INTO n_cohorts FROM public.cohorts WHERE status = 'Active';
  IF n_cohorts <> 1 THEN
    RAISE EXCEPTION 'Backfill aborted: expected exactly one active cohort (cohorts.status = ''Active''), found %. Resolve the cohort state, then re-run section 2.', n_cohorts;
  END IF;
  SELECT id INTO v_cohort FROM public.cohorts WHERE status = 'Active';

  -- Deterministic audit actor: the single active Owner. No name/email/roster
  -- resolution and no invented actor.
  SELECT count(*) INTO n_owners
  FROM public.user_profiles
  WHERE is_owner = true AND COALESCE(is_active, true) = true;
  IF n_owners <> 1 THEN
    RAISE EXCEPTION 'Backfill aborted: expected exactly one active Owner to attribute the backfill grants to, found %. Grant these entitlements through the management API instead, or resolve Owner accounts and re-run.', n_owners;
  END IF;
  SELECT id INTO v_actor
  FROM public.user_profiles
  WHERE is_owner = true AND COALESCE(is_active, true) = true;

  -- One active entitlement per active interviewer that lacks one.
  INSERT INTO public.interviewer_cohort_entitlements
    (interviewer_profile_id, cohort_id, granted_by_profile_id)
  SELECT p.id, v_cohort, v_actor
  FROM public.user_profiles p
  WHERE p.role = 'interviewer'
    AND COALESCE(p.is_active, true) = true
    AND NOT EXISTS (
      SELECT 1 FROM public.interviewer_cohort_entitlements e
      WHERE e.interviewer_profile_id = p.id
        AND e.cohort_id = v_cohort
        AND e.revoked_at IS NULL
    );
  GET DIAGNOSTICS n_inserted = ROW_COUNT;
  RAISE NOTICE 'Interviewer entitlement backfill: cohort=%, actor=%, granted=%', v_cohort, v_actor, n_inserted;
END $$;
COMMIT;

-- ── Verification (run separately, one result set at a time, AFTER applying) ────
-- 1. Table + RLS present, no browser grant:
--   SELECT relrowsecurity FROM pg_class WHERE oid = 'public.interviewer_cohort_entitlements'::regclass;
--   SELECT grantee, privilege_type FROM information_schema.role_table_grants
--   WHERE table_name = 'interviewer_cohort_entitlements' ORDER BY grantee;
--   -- expected: only service_role holds SELECT/INSERT/UPDATE; no anon/authenticated.
-- 2. Exactly one active entitlement per (interviewer, cohort):
--   SELECT interviewer_profile_id, cohort_id, count(*) FROM public.interviewer_cohort_entitlements
--   WHERE revoked_at IS NULL GROUP BY 1,2 HAVING count(*) > 1;  -- expected 0 rows
-- 3. Every active interviewer has an active entitlement for the active cohort:
--   SELECT p.id FROM public.user_profiles p
--   WHERE p.role='interviewer' AND COALESCE(p.is_active,true)=true
--     AND NOT EXISTS (SELECT 1 FROM public.interviewer_cohort_entitlements e
--       JOIN public.cohorts c ON c.id=e.cohort_id AND c.status='Active'
--       WHERE e.interviewer_profile_id=p.id AND e.revoked_at IS NULL);  -- expected 0 rows

-- ── Rollback ─────────────────────────────────────────────────────────────────
-- Drops the table (and its history). Use only to fully revert this feature.
/*
BEGIN;
DROP TABLE IF EXISTS public.interviewer_cohort_entitlements;
COMMIT;
*/
