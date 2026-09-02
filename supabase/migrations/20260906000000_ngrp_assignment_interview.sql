-- NGRP-PLACEMENT-BOARD-1: the HR-assigned unit and the interview record.
--
-- Product source of truth: docs/product/NGRP_WORKSPACE_PRODUCT_PLAN.md
-- (sections 5.3, 10.1, and the state table at 147-148). Builds ON TOP of the
-- applied foundation (20260903000000), its delete-privilege repair
-- (20260903010000), and the planning/transition migration (20260904000000).
-- None of those is edited or re-run.
--
-- WHY THESE COLUMNS AND NOT A NEW TABLE. The two existing NGRP tables already
-- draw the line this change has to respect, and they say so in their own
-- comments: ngrp_candidates is "workflow state, not durable employment
-- history" (CASCADE on student delete), and ngrp_residency_outcomes holds "the
-- minimal DURABLE employment facts" (RESTRICT, service-role DELETE revoked).
-- An interview being scheduled, completed, cancelled or no-showed is workflow;
-- a hire is durable. So the assignment and the interview live here, and the
-- offer/hire columns already on ngrp_residency_outcomes are left alone.
--
-- THE CLIENT HAS MODELLED THIS ALL ALONG. src/lib/ngrp/ngrpStates.js already
-- defines INTERVIEW_STATES and defaults every candidate to
-- assigned_unit: null / interview_status: 'not_scheduled'. Until now nothing
-- backed them, so every roster row rendered the neutral default forever. The
-- CHECK below is that same vocabulary, enforced in the database rather than
-- merely in the UI.
--
-- ALL ADDITIVE. Every column is nullable or defaulted, so existing rows stay
-- valid and no backfill is required.

BEGIN;

ALTER TABLE public.ngrp_candidates
  -- The ONE unit HR assigns. Deliberately NOT a foreign key to
  -- ngrp_cycle_units: unit identity is unit_name text everywhere in this app
  -- (the plan's "no second unit directory" rule), and an assignment must
  -- survive a unit later being unpicked from the cohort. A blank string is
  -- rejected so "assigned to nothing" has exactly one representation, NULL.
  ADD COLUMN IF NOT EXISTS assigned_unit text
    CHECK (assigned_unit IS NULL OR btrim(assigned_unit) <> ''),
  ADD COLUMN IF NOT EXISTS assigned_unit_at timestamptz,
  ADD COLUMN IF NOT EXISTS assigned_by_profile_id uuid REFERENCES public.user_profiles(id),

  -- Interview state. Same vocabulary as INTERVIEW_STATES, same neutral default
  -- as the roster's: 'not_scheduled' is a baseline, never a failure.
  ADD COLUMN IF NOT EXISTS interview_status text NOT NULL DEFAULT 'not_scheduled'
    CHECK (interview_status IN (
      'not_scheduled','scheduled','completed','decision_recorded',
      'cancelled','applicant_withdrew','no_interview','no_show')),
  ADD COLUMN IF NOT EXISTS interview_at timestamptz,
  ADD COLUMN IF NOT EXISTS interview_recorded_by_profile_id uuid REFERENCES public.user_profiles(id),
  ADD COLUMN IF NOT EXISTS interview_recorded_at timestamptz;

-- An assignment carries its actor and its moment, or it carries neither. The
-- same shape the eligibility override already enforces one table over, so
-- "who assigned this, and when" is never a question the data cannot answer.
ALTER TABLE public.ngrp_candidates
  DROP CONSTRAINT IF EXISTS ngrp_assignment_requires_actor_time;
ALTER TABLE public.ngrp_candidates
  ADD CONSTRAINT ngrp_assignment_requires_actor_time
    CHECK (assigned_unit IS NULL
           OR (assigned_unit_at IS NOT NULL AND assigned_by_profile_id IS NOT NULL));

-- A scheduled interview has a time; an unscheduled one does not claim to.
-- 'completed' and everything past it may retain the time it was held at.
ALTER TABLE public.ngrp_candidates
  DROP CONSTRAINT IF EXISTS ngrp_interview_scheduled_has_time;
ALTER TABLE public.ngrp_candidates
  ADD CONSTRAINT ngrp_interview_scheduled_has_time
    CHECK (interview_status <> 'scheduled' OR interview_at IS NOT NULL);

-- The board's one filter: confirmed applicants for a cohort, by assigned unit.
CREATE INDEX IF NOT EXISTS ngrp_candidates_cycle_assigned_idx
  ON public.ngrp_candidates (cycle_id, assigned_unit);

COMMENT ON COLUMN public.ngrp_candidates.assigned_unit IS
  'The one HR-assigned unit. NEVER a substitute for a ranked preference: preferences live in the Transition Form revision payload and are what the applicant asked for, this is what HR decided.';
COMMENT ON COLUMN public.ngrp_candidates.interview_status IS
  'Interview workflow state (INTERVIEW_STATES). No rubric or score is stored anywhere: this program records who was interviewed and what came of it, not how they were graded.';

-- The audit CHECK has to learn the two new event types, or recordNgrpAudit's
-- insert is refused by the database even though the JS allowlist permits it.
-- An event type must pass BOTH gates. Widened, never narrowed: every existing
-- value is carried through unchanged.
ALTER TABLE public.ngrp_audit_events
  DROP CONSTRAINT IF EXISTS ngrp_audit_events_event_type_check;
ALTER TABLE public.ngrp_audit_events
  ADD CONSTRAINT ngrp_audit_events_event_type_check
    CHECK (event_type IN (
      'cycle_created','cycle_updated','cycle_activated',
      'source_cohorts_changed','units_changed',
      'form_sent','form_opened','form_submitted','form_revised',
      'token_revoked','token_resent',
      'eligibility_calculated','eligibility_overridden',
      'application_confirmed','application_withdrawn',
      'unit_assigned','unit_assignment_cleared'));

COMMIT;

-- ── Verification (run after applying; every row must come back true) ────────
--
--   SELECT
--     (SELECT count(*) FROM information_schema.columns
--       WHERE table_name = 'ngrp_candidates'
--         AND column_name IN ('assigned_unit','assigned_unit_at','assigned_by_profile_id',
--                             'interview_status','interview_at',
--                             'interview_recorded_by_profile_id','interview_recorded_at')) = 7
--       AS all_seven_columns,
--     (SELECT count(*) FROM pg_constraint
--       WHERE conname IN ('ngrp_assignment_requires_actor_time',
--                         'ngrp_interview_scheduled_has_time')) = 2
--       AS both_constraints,
--     (SELECT count(*) FROM pg_indexes
--       WHERE indexname = 'ngrp_candidates_cycle_assigned_idx') = 1
--       AS index_present,
--     (SELECT count(*) FROM public.ngrp_candidates
--       WHERE interview_status IS NULL) = 0
--       AS no_null_interview_status,
--     (SELECT pg_get_constraintdef(oid) LIKE '%unit_assigned%'
--        FROM pg_constraint
--       WHERE conname = 'ngrp_audit_events_event_type_check')
--       AS audit_check_widened;
