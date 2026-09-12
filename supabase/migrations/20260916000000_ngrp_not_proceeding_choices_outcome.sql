-- RESIDENCY-ROSTER-1: Not Proceeding, staff-set unit choices, and the two
-- interview results the outcome record could not hold.
--
-- Owner decisions, 2026-09-12:
--   1. Confirmation becomes automatic. Anyone who submitted the Transition
--      Form, is eligible or conditionally eligible, and is interested is in the
--      Applicant Pool. Nothing here computes that: the rule is pure code in
--      lib/server/ngrpPool.js, read the same way by the browser and the server.
--      This migration only has to hold what a HUMAN decided, which is the one
--      thing the rule cannot derive: that someone is no longer proceeding.
--   2. "Reject" is called NOT PROCEEDING, with a reason. It is the word ASPIRE
--      already uses for a student who has left the pathway, and it reads
--      correctly whether they withdrew, missed the deadline, or the team
--      decided not to advance them. The submitted form and the eligibility
--      result STAY ON RECORD: leaving the pool is not erasure.
--   3. Staff can change the ranked unit choices. The submitted ranking is
--      immutable (it lives in a transition revision), so a staff ranking is
--      stored BESIDE it and becomes the effective one, exactly as an
--      eligibility override sits beside the calculated result.
--   4. Pairing on the placement board means "this unit will interview them".
--      After the interview the result is Offered, Hired, Not Selected or
--      Declined Offer. The outcome table already held offers and hires; the two
--      NEGATIVE results had nowhere to go, so a real decision was unrecordable.
--
-- Builds on the applied foundation (20260903000000), its delete-privilege
-- repair (20260903010000), the assignment/interview columns (20260906000000)
-- and the audit widening (20260907000000). None of those is edited or re-run.
--
-- ONE DATA REWRITE, and it is small: existing 'withdrawn' candidates become
-- 'not_proceeding' with the reason 'withdrew', which is what that status always
-- meant. 'withdrawn' stays LEGAL so no older row or path can break; the
-- application writes only 'not_proceeding' from here on. PRE 3 counts the rows
-- this will touch before you run it.

BEGIN;

-- ── 1 · Not Proceeding ───────────────────────────────────────────────────────

ALTER TABLE public.ngrp_candidates
  -- The reason, from the one allowlist (NOT_PROCEEDING_REASONS in
  -- lib/server/ngrpPool.js). A removal without a reason is the thing this
  -- column exists to prevent: six months later "withdrawn" answers nothing.
  ADD COLUMN IF NOT EXISTS not_proceeding_reason text
    CHECK (not_proceeding_reason IS NULL OR not_proceeding_reason IN (
      'withdrew','not_interested','no_longer_eligible',
      'no_response_by_deadline','position_elsewhere','other')),
  ADD COLUMN IF NOT EXISTS not_proceeding_note text
    CHECK (not_proceeding_note IS NULL OR btrim(not_proceeding_note) <> ''),
  ADD COLUMN IF NOT EXISTS not_proceeding_at timestamptz,
  ADD COLUMN IF NOT EXISTS not_proceeding_by_profile_id uuid REFERENCES public.user_profiles(id);

-- The status vocabulary learns the new value. Widened, never narrowed: every
-- existing value is carried through, including 'withdrawn', which the rewrite
-- below empties but which stays legal so nothing older can fail.
ALTER TABLE public.ngrp_candidates
  DROP CONSTRAINT IF EXISTS ngrp_candidates_application_status_check;
ALTER TABLE public.ngrp_candidates
  DROP CONSTRAINT IF EXISTS ngrp_candidates_application_status_canon;
ALTER TABLE public.ngrp_candidates
  ADD CONSTRAINT ngrp_candidates_application_status_canon
    CHECK (application_status IN ('not_confirmed','confirmed','withdrawn','not_proceeding'));

-- The timestamps stay coherent with the state, as they already did for the
-- other three. A not_proceeding row carries its own moment; it may ALSO still
-- carry the earlier confirmation, which is the record of what happened before
-- the removal and is not thrown away.
ALTER TABLE public.ngrp_candidates
  DROP CONSTRAINT IF EXISTS ngrp_application_state_times;
ALTER TABLE public.ngrp_candidates
  ADD CONSTRAINT ngrp_application_state_times
    CHECK (
      (application_status = 'not_confirmed'  AND application_confirmed_at IS NULL AND application_withdrawn_at IS NULL)
      OR (application_status = 'confirmed'   AND application_confirmed_at IS NOT NULL AND application_withdrawn_at IS NULL)
      OR (application_status = 'withdrawn'   AND application_withdrawn_at IS NOT NULL)
      OR (application_status = 'not_proceeding' AND not_proceeding_at IS NOT NULL)
    );

-- A removal carries its reason and its moment, or it is not a removal. The
-- ACTOR is required only going forward: the rows rewritten below predate this
-- column and there is no honest value to invent for them, so the constraint
-- asks for what the record can actually answer.
ALTER TABLE public.ngrp_candidates
  DROP CONSTRAINT IF EXISTS ngrp_not_proceeding_requires_reason_time;
ALTER TABLE public.ngrp_candidates
  ADD CONSTRAINT ngrp_not_proceeding_requires_reason_time
    CHECK (application_status <> 'not_proceeding'
           OR (not_proceeding_reason IS NOT NULL AND not_proceeding_at IS NOT NULL));

-- 'Other' is the only reason that explains nothing by itself, so it carries a
-- note. The API refuses it too; this is the half that cannot be bypassed.
ALTER TABLE public.ngrp_candidates
  DROP CONSTRAINT IF EXISTS ngrp_not_proceeding_other_needs_note;
ALTER TABLE public.ngrp_candidates
  ADD CONSTRAINT ngrp_not_proceeding_other_needs_note
    CHECK (not_proceeding_reason IS DISTINCT FROM 'other' OR not_proceeding_note IS NOT NULL);

-- The one rewrite. 'withdrawn' always meant exactly this, so the reason is
-- recorded rather than guessed, and the original timestamp is carried across
-- instead of being stamped with today.
UPDATE public.ngrp_candidates
   SET application_status = 'not_proceeding',
       not_proceeding_reason = 'withdrew',
       not_proceeding_at = application_withdrawn_at
 WHERE application_status = 'withdrawn';

-- ── 2 · Staff-set ranked unit choices ────────────────────────────────────────

ALTER TABLE public.ngrp_candidates
  -- At most three, in rank order, no blanks and no NULL slots. NULL means "no
  -- staff ranking", which is different from an empty ranking and is the normal
  -- state: what the alumnus asked for is then the effective ranking.
  ADD COLUMN IF NOT EXISTS staff_unit_preferences text[]
    CHECK (staff_unit_preferences IS NULL
           OR (cardinality(staff_unit_preferences) BETWEEN 1 AND 3
               AND array_position(staff_unit_preferences, NULL) IS NULL
               AND NOT ('' = ANY(staff_unit_preferences)))),
  ADD COLUMN IF NOT EXISTS unit_preferences_set_by_profile_id uuid REFERENCES public.user_profiles(id),
  ADD COLUMN IF NOT EXISTS unit_preferences_set_at timestamptz;

-- Same shape the eligibility override and the unit assignment already enforce:
-- who changed this, and when, is never a question the row cannot answer.
ALTER TABLE public.ngrp_candidates
  DROP CONSTRAINT IF EXISTS ngrp_unit_prefs_require_actor_time;
ALTER TABLE public.ngrp_candidates
  ADD CONSTRAINT ngrp_unit_prefs_require_actor_time
    CHECK (staff_unit_preferences IS NULL
           OR (unit_preferences_set_by_profile_id IS NOT NULL AND unit_preferences_set_at IS NOT NULL));

-- ── 3 · The two interview results the outcome record could not hold ──────────

ALTER TABLE public.ngrp_residency_outcomes
  -- They were interviewed and the position went to someone else.
  ADD COLUMN IF NOT EXISTS not_selected_at timestamptz,
  -- They were offered the position and turned it down.
  ADD COLUMN IF NOT EXISTS offer_declined_at timestamptz;

ALTER TABLE public.ngrp_residency_outcomes
  DROP CONSTRAINT IF EXISTS ngrp_outcomes_decline_requires_offer;
ALTER TABLE public.ngrp_residency_outcomes
  ADD CONSTRAINT ngrp_outcomes_decline_requires_offer
    CHECK (offer_declined_at IS NULL OR offer_extended_at IS NOT NULL);

-- One final result per attempt. Hired, declined and not selected are mutually
-- exclusive answers to the same question, and a row holding two of them would
-- make the roster's Status column a coin toss.
ALTER TABLE public.ngrp_residency_outcomes
  DROP CONSTRAINT IF EXISTS ngrp_outcomes_one_final_result;
ALTER TABLE public.ngrp_residency_outcomes
  ADD CONSTRAINT ngrp_outcomes_one_final_result
    CHECK (num_nonnulls(hired_at, offer_declined_at, not_selected_at) <= 1);

-- ── 4 · Audit vocabulary ─────────────────────────────────────────────────────
--
-- recordNgrpAudit's insert has to pass BOTH the JS allowlist and this CHECK, so
-- a new event type that is not here is refused by the database. Carries every
-- value 20260907000000 established, plus the five this release records.
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
      'unit_assigned','unit_assignment_cleared',
      -- NGRP-INTERVIEW-HIRE-1
      'interview_recorded','offer_extended','offer_accepted','hire_recorded',
      -- RESIDENCY-ROSTER-1
      'not_proceeding_recorded','application_reinstated',
      'unit_preferences_set','offer_declined','not_selected'));

COMMENT ON COLUMN public.ngrp_candidates.not_proceeding_reason IS
  'Why this alumnus left the Applicant Pool (NOT_PROCEEDING_REASONS in lib/server/ngrpPool.js). The submitted form and the eligibility result stay on record: leaving the pool is not erasure.';
COMMENT ON COLUMN public.ngrp_candidates.staff_unit_preferences IS
  'A staff ranking that becomes the effective one. NEVER overwrites the submitted ranking, which is immutable in the transition revision: the same shape as an eligibility override beside a calculated result.';
COMMENT ON COLUMN public.ngrp_residency_outcomes.not_selected_at IS
  'They were interviewed and the position went to someone else. Pairing on the placement board means a unit will INTERVIEW them; this is one of the four results that can follow.';

COMMIT;

-- Verification: db/audit/ngrp_not_proceeding_choices_outcome_checks.sql
-- (PRE 1-3, POST 1-6). Run each numbered section on its own.
