-- ============================================================================
-- INTERVIEWER COHORT ENTITLEMENTS + SCHEDULING IDENTITY (Wave F-2)
-- ============================================================================
-- *** APPLY MANUALLY (Owner/Jester) in the Supabase SQL editor. Prepared but    ***
-- *** NOT executed by the assistant. Run the ENTIRE file once. It is additive:   ***
-- *** one table, its indexes, RLS + least-privilege grants, and one identity     ***
-- *** column on interview_availability_blocks. It creates NO data and creates no  ***
-- *** storage object; it changes no bucket or storage policy. It is SEPARATE from ***
-- *** the student-files privacy migrations (Pass 2 backfill / Pass 3 cutover).    ***
-- ***                                                                             ***
-- *** The initial backfill is a SEPARATE step: after applying this file, run the  ***
-- *** read-only owner/admin query in                                              ***
-- *** supabase/migrations/20260719000001_interviewer_cohort_entitlements_backfill.sql, ***
-- *** choose the granting Owner/Admin profile id, then run its backfill block.    ***
--
-- Supersedes the earlier proposal
--   supabase/migrations/20260718000002_interviewer_assignment_identity.sql
--   (branch wave-f2-interviewer-access @ 62c3de1). That migration added an
--   interviewer_profile_id column to interview_availability_blocks ONLY as an
--   authorization signal. It must remain UNAPPLIED. This file keeps an identity
--   column on that table for OPERATIONAL scheduling traceability, but the
--   authorization boundary is the interviewer_cohort_entitlements table below.
--
-- Identity model (preserved exactly): auth.users.id, user_profiles.auth_user_id,
-- and user_profiles.id are three distinct values. Every relationship here uses
-- user_profiles.id; no FK references auth.users.
--
-- Authorization boundary: interviewer_cohort_entitlements is the source of truth
-- for interviewer file access. It is server-mediated only (no authenticated
-- browser grant, so RLS + no policy denies the browser; the service-role server
-- endpoints manage it). public.is_staff() is intentionally NOT used.
--
-- Entitlement semantics (enforced by the application + these constraints):
--   Active entitlement  = revoked_at IS NULL AND the linked user_profiles row has
--                         role 'interviewer' AND is_active IS NOT FALSE.
--   Durable             = it does NOT expire when a rubric is submitted, an
--                         interview ends, a cycle ends, a slot/block changes, a
--                         student is reassigned, or the cohort later goes inactive.
--   Ends only on        = manual revocation OR the interviewer account being
--                         deactivated (checked live by the server).
--   History preserved   = revocation sets revoked_at/revoked_by_profile_id; a
--                         re-grant inserts a NEW active row and never modifies the
--                         revoked one. Rows are never deleted.
-- ============================================================================

BEGIN;

-- ── 1. Entitlement table ─────────────────────────────────────────────────────
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

-- ── 2. Scheduling identity (operational traceability, NOT authorization) ─────
-- The account an availability block is FOR. Owner/Admin scheduling on behalf of an
-- interviewer selects this account; self-created blocks set it to the creator.
-- interviewer_name remains as presentation text only. This is NOT the file-access
-- boundary (that is interviewer_cohort_entitlements); it lets the app auto-ensure
-- an entitlement when an interviewer is scheduled, by identity rather than name.
ALTER TABLE public.interview_availability_blocks
  ADD COLUMN IF NOT EXISTS interviewer_profile_id uuid
  REFERENCES public.user_profiles(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.interview_availability_blocks.interviewer_profile_id IS
  'The interviewer account (user_profiles.id) this availability is FOR. Operational '
  'traceability + auto-entitlement on scheduling; NOT the file-access authorization '
  'boundary (that is interviewer_cohort_entitlements). interviewer_name is display only.';

CREATE INDEX IF NOT EXISTS idx_iab_interviewer_profile
  ON public.interview_availability_blocks (interviewer_profile_id);

COMMIT;

-- ── Verification (run separately, one result set at a time, AFTER applying) ────
-- 1. Table + RLS present, no browser grant:
--   SELECT relrowsecurity FROM pg_class WHERE oid = 'public.interviewer_cohort_entitlements'::regclass;
--   SELECT grantee, privilege_type FROM information_schema.role_table_grants
--   WHERE table_name = 'interviewer_cohort_entitlements' ORDER BY grantee;
--   -- expected: only service_role holds SELECT/INSERT/UPDATE; no anon/authenticated.
-- 2. Scheduling identity column exists:
--   SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'interview_availability_blocks' AND column_name = 'interviewer_profile_id';

-- ── Rollback ─────────────────────────────────────────────────────────────────
-- Drops the table (and its history) and the scheduling column. Use only to fully
-- revert this feature.
/*
BEGIN;
DROP INDEX IF EXISTS public.idx_iab_interviewer_profile;
ALTER TABLE public.interview_availability_blocks DROP COLUMN IF EXISTS interviewer_profile_id;
DROP TABLE IF EXISTS public.interviewer_cohort_entitlements;
COMMIT;
*/
