-- ============================================================================
-- INTERVIEWER ASSIGNMENT IDENTITY (Wave F-2 interviewer file-access prerequisite)
-- ============================================================================
-- *** APPLY MANUALLY (Owner/Jester) in the Supabase SQL editor. This migration  ***
-- *** was prepared but NOT executed by the assistant. It is SEPARATE from the    ***
-- *** student-files privacy migrations (Pass 2 backfill / Pass 3 cutover) and    ***
-- *** does not touch storage, buckets, or storage policies.                      ***
--
-- Why this exists
--   The locked interviewer model grants an active Interviewer read-only, cohort-wide
--   access to student resumes/photos when that Interviewer has a verified,
--   IDENTITY-BASED interview assignment in the same active cohort. Authorization may
--   NOT use interviewer names, emails, free-text, roster strings, or comma-separated
--   name lists.
--
--   Today there is no reliable identity link from an interview assignment to an
--   interviewer ACCOUNT:
--     - interview_slots / interview_sessions / interview_rubrics reference the
--       interviewer only by interviewer_name (a roster string).
--     - interview_availability_blocks.created_by_user_id identifies who CREATED the
--       block, which is the admin (not the interviewer) whenever an Owner/Admin
--       creates availability on an interviewer's behalf.
--   So the assigned interviewer cannot be resolved by identity for all cases.
--
-- What this adds (smallest dedicated change)
--   A nullable FK column interviewer_profile_id on interview_availability_blocks that
--   names the interviewer ACCOUNT the availability/assignment is FOR (distinct from
--   created_by_user_id = who created it). Slots inherit the interviewer via block_id.
--   The Wave F-2 access endpoint will then authorize an interviewer for a cohort iff
--   EXISTS a block WHERE interviewer_profile_id = <caller user_profiles.id>
--   AND cohort_id = <requested student's active cohort>.
--
-- Run the section 1 block as one statement group. Sections 2 and 3 are REVIEW-ONLY
-- templates (commented) for Owner to run deliberately after inspecting the data.
-- Transactional, idempotent, rerunnable.
-- ============================================================================

-- ── 1. Schema: add the identity column + lookup index ────────────────────────
BEGIN;

ALTER TABLE public.interview_availability_blocks
  ADD COLUMN IF NOT EXISTS interviewer_profile_id uuid
  REFERENCES public.user_profiles(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.interview_availability_blocks.interviewer_profile_id IS
  'The interviewer ACCOUNT (user_profiles.id) this availability/assignment is FOR. '
  'Distinct from created_by_user_id (who created the block). Basis for identity-based, '
  'cohort-wide interviewer file access (Wave F-2). NULL until assigned.';

-- Entitlement lookup is (interviewer_profile_id, cohort_id) -> exists.
CREATE INDEX IF NOT EXISTS idx_iab_interviewer_profile_cohort
  ON public.interview_availability_blocks (interviewer_profile_id, cohort_id);

COMMIT;

-- ── 2. Backfill template (REVIEW, then run deliberately) ─────────────────────
-- Self-created blocks map cleanly: the creator IS the interviewer. Populate those
-- from created_by_user_id, but ONLY where the creator is actually an interviewer
-- account whose name matches the block's interviewer_name (a one-time, Owner-reviewed
-- data resolution, NOT a runtime authorization decision).
--
-- Admin-created-on-behalf blocks (created_by_user_id is an admin, interviewer_name is
-- someone else) are intentionally left NULL here: assign them explicitly, either by
-- updating create_block to capture the interviewer account, or by a reviewed name->id
-- resolution you approve. Leaving them NULL simply means that interviewer is not yet
-- entitled, which is the safe default.
--
-- UPDATE public.interview_availability_blocks b
-- SET    interviewer_profile_id = b.created_by_user_id
-- FROM   public.user_profiles p
-- WHERE  b.interviewer_profile_id IS NULL
--   AND  p.id = b.created_by_user_id
--   AND  (p.role = 'interviewer' OR p.can_conduct_interviews = true)
--   AND  lower(btrim(p.full_name)) = lower(btrim(b.interviewer_name));

-- ── 3. Verification (after backfill) ─────────────────────────────────────────
-- Rows still unassigned (admin-created-on-behalf await explicit assignment):
--   SELECT count(*) FROM public.interview_availability_blocks WHERE interviewer_profile_id IS NULL;
-- Distinct entitled (interviewer, cohort) pairs:
--   SELECT interviewer_profile_id, cohort_id, count(*) FROM public.interview_availability_blocks
--   WHERE interviewer_profile_id IS NOT NULL GROUP BY 1,2 ORDER BY 3 DESC;

-- ── Rollback ─────────────────────────────────────────────────────────────────
-- Removes the column and index (reverts to name-only interviewer references).
/*
BEGIN;
DROP INDEX IF EXISTS public.idx_iab_interviewer_profile_cohort;
ALTER TABLE public.interview_availability_blocks DROP COLUMN IF EXISTS interviewer_profile_id;
COMMIT;
*/
