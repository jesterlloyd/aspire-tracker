-- ============================================================================
-- INTERVIEWER COHORT ENTITLEMENTS: INITIAL BACKFILL (manual, actor-selected)
-- ============================================================================
-- *** APPLY MANUALLY (Owner/Jester), AFTER 20260719000000_interviewer_cohort_    ***
-- *** entitlements.sql. This is a one-time data step, NOT auto-run. Run the       ***
-- *** three steps below IN ORDER, each as its OWN statement, reading the result   ***
-- *** of one before running the next. It creates one active entitlement for every ***
-- *** active interviewer in the single active cohort, attributed to an Owner/Admin ***
-- *** profile YOU choose. It never infers the actor by name or email and never    ***
-- *** uses auth.uid().                                                            ***
--
-- Goal: "Map every active Interviewer account to the active cohort."
-- Active cohort = cohorts.status = 'Active'. The database does not enforce a single
-- active cohort, so STEP 3 refuses to run if there is not exactly one, rather than
-- guessing across cohorts.

-- ── STEP 1 (READ ONLY): list the Owner/Admin profiles you may grant as ────────
-- Run this alone. Copy the id of the active Owner/Admin who should be recorded as
-- granted_by_profile_id for the backfill.
SELECT id, full_name, email, role, is_active
FROM public.user_profiles
WHERE role IN ('owner', 'admin') AND COALESCE(is_active, true) = true
ORDER BY role, full_name;

-- ── STEP 2 (READ ONLY): confirm exactly one active cohort and preview the set ─
-- Run this alone. Expect exactly one row for the cohort, and a count of the active
-- interviewers who will receive an entitlement.
SELECT
  (SELECT count(*) FROM public.cohorts WHERE status = 'Active')                            AS active_cohort_count,
  (SELECT id       FROM public.cohorts WHERE status = 'Active' ORDER BY id LIMIT 1)        AS active_cohort_id,
  (SELECT count(*) FROM public.user_profiles
     WHERE role = 'interviewer' AND COALESCE(is_active, true) = true)                       AS active_interviewers;

-- ── STEP 3 (WRITE): insert the backfill entitlements ─────────────────────────
-- Replace the placeholder below with the granting Owner/Admin id from STEP 1, then
-- run this block alone. It validates the actor (must be an active Owner/Admin) and
-- the single active cohort, and aborts (RAISE) rather than guess. It is idempotent:
-- re-running inserts nothing more once every active interviewer has an active row.
DO $$
DECLARE
  v_actor   uuid := '00000000-0000-0000-0000-000000000000';  -- <<< REPLACE with the id from STEP 1
  v_cohort  uuid;
  n_cohorts int;
  n_actor   int;
  n_inserted int;
BEGIN
  IF v_actor = '00000000-0000-0000-0000-000000000000' THEN
    RAISE EXCEPTION 'Set v_actor to the granting Owner/Admin id from STEP 1 before running.';
  END IF;

  -- Actor must be an active Owner/Admin (validated by identity, never by name/email).
  SELECT count(*) INTO n_actor
  FROM public.user_profiles
  WHERE id = v_actor AND role IN ('owner', 'admin') AND COALESCE(is_active, true) = true;
  IF n_actor <> 1 THEN
    RAISE EXCEPTION 'Backfill aborted: v_actor % is not an active Owner/Admin profile.', v_actor;
  END IF;

  -- Exactly one active cohort, else abort (do not guess).
  SELECT count(*) INTO n_cohorts FROM public.cohorts WHERE status = 'Active';
  IF n_cohorts <> 1 THEN
    RAISE EXCEPTION 'Backfill aborted: expected exactly one active cohort (cohorts.status = ''Active''), found %.', n_cohorts;
  END IF;
  SELECT id INTO v_cohort FROM public.cohorts WHERE status = 'Active';

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

-- ── STEP 4 (READ ONLY, run each separately): verify ──────────────────────────
-- No duplicate active entitlement per (interviewer, cohort) (expected 0 rows):
--   SELECT interviewer_profile_id, cohort_id, count(*) FROM public.interviewer_cohort_entitlements
--   WHERE revoked_at IS NULL GROUP BY 1,2 HAVING count(*) > 1;
-- Every active interviewer now has an active entitlement for the active cohort (expected 0 rows):
--   SELECT p.id FROM public.user_profiles p
--   WHERE p.role='interviewer' AND COALESCE(p.is_active,true)=true
--     AND NOT EXISTS (SELECT 1 FROM public.interviewer_cohort_entitlements e
--       JOIN public.cohorts c ON c.id=e.cohort_id AND c.status='Active'
--       WHERE e.interviewer_profile_id=p.id AND e.revoked_at IS NULL);
-- Inactive interviewers and non-interviewers received nothing (expected 0 rows):
--   SELECT e.id FROM public.interviewer_cohort_entitlements e
--   JOIN public.user_profiles p ON p.id = e.interviewer_profile_id
--   WHERE e.revoked_at IS NULL AND (p.role <> 'interviewer' OR COALESCE(p.is_active,true) = false);
