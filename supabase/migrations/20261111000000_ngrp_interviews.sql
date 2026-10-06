-- ============================================================================
-- RESIDENCY INTERVIEWS (NGRP-INTERVIEWS-1, Phase 1): rubrics, open times, bookings
-- ============================================================================
-- *** APPLY MANUALLY (Owner/Jester). Claude Code has applied NOTHING. ***
--
-- Owner decisions, 2026-10-05. Unit leaders interview the new graduates Talent Acquisition
-- paired with their unit (Residency > Interview Board), from a new Interviews tab in the Unit
-- Leader Portal, with an internship interviewer's abilities: open times, see their
-- interviewees, score with the rubric. The rubric is the NGRP "Competency-Based Interview
-- Rubric, New Graduate RN Interview Scoring Sheet": Clinical Judgment, Professional Presence and
-- Goal Alignment, each 1 to 5, a composite of 3 to 15, one of three recommendations. Each
-- interviewer sees only their own rubric in full; the ASPIRE team and Talent Acquisition see
-- every rubric and the panel result. The unit opens times; Talent Acquisition or the alumnus
-- books one through a link (provisional until the Owner confirms with Talent Acquisition).
--
-- Additive and transactional. It rewrites no data. The one existing object it changes is the
-- ngrp_audit_events event-type CHECK, rebuilt with every earlier type kept.
--
-- WHAT THIS FILE DOES
--   1. ngrp_interview_rubrics: ONE rubric per interviewer per applicant (unique, so a second
--      tab or a retry cannot create a duplicate, which the internship rubric allows). Per
--      domain: the question asked (a key from src/lib/ngrp/ngrpRubric.js, or 'other' with its
--      text), the score 1 to 5 and notes. The composite is a GENERATED column (the sum of the
--      three scores, NULL until all three are given), so it can never disagree with them. A
--      rubric marked completed must have all three scores and a recommendation. Never deleted.
--   2. ngrp_interview_blocks: a span of time a unit opens for interviews, cut into slots.
--   3. ngrp_interview_slots: one bookable time. A booking names the applicant; an applicant
--      holds at most one booked slot per residency cohort.
--   4. ngrp_audit_events accepts eight new event types for Settings > Residency Activity:
--      interview_rubric_completed, interview_rubric_reopened, interview_times_opened,
--      interview_times_removed, interview_slot_blocked, interview_slot_unblocked,
--      interview_booked, interview_booking_cancelled.
--   5. Server-only privileges. The Unit Leader Portal and Residency endpoints read and write as
--      service_role after their own checks (a unit leader's units, the applicant's pairing).
--
-- The CHECK values must match src/lib/ngrp/ngrpRubric.js (question keys are free text here on
-- purpose: a later edition of the sheet may add questions) and lib/server/ngrpAudit.js
-- NGRP_AUDIT_EVENTS (a test pins both).
--
-- SAFE IN EITHER DEPLOY ORDER: nothing reads these tables until the Phase 2 and 3 code ships,
-- and that code treats a missing table as "not enabled yet".
--
-- PREFLIGHT / POSTFLIGHT: db/audit/ngrp_interviews_checks.sql

BEGIN;

DO $pre$
BEGIN
  IF to_regclass('public.ngrp_candidates') IS NULL OR to_regclass('public.ngrp_cycles') IS NULL
     OR to_regclass('public.ngrp_audit_events') IS NULL THEN
    RAISE EXCEPTION 'PRECHECK FAILED: the NGRP tables are missing';
  END IF;
END
$pre$;

-- ############################################################################
-- 1. Rubrics
-- ############################################################################
CREATE TABLE IF NOT EXISTS public.ngrp_interview_rubrics (
  id                         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_id                   uuid        NOT NULL REFERENCES public.ngrp_cycles(id) ON DELETE RESTRICT,
  candidate_id               uuid        NOT NULL REFERENCES public.ngrp_candidates(id) ON DELETE RESTRICT,
  -- The unit the applicant was paired with when this rubric was started.
  unit_key                   text        NOT NULL CHECK (btrim(unit_key) <> '' AND char_length(unit_key) <= 120),
  interviewer_profile_id     uuid        NOT NULL REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
  -- The interviewer's name as signed, kept even if the account is later renamed.
  interviewer_name           text        NOT NULL CHECK (btrim(interviewer_name) <> '' AND char_length(interviewer_name) <= 160),
  interview_at               timestamptz,
  cj_question                text        CHECK (cj_question IS NULL OR char_length(cj_question) <= 40),
  cj_question_other          text        CHECK (cj_question_other IS NULL OR char_length(cj_question_other) <= 500),
  cj_score                   smallint    CHECK (cj_score BETWEEN 1 AND 5),
  cj_notes                   text        CHECK (cj_notes IS NULL OR char_length(cj_notes) <= 4000),
  pp_question                text        CHECK (pp_question IS NULL OR char_length(pp_question) <= 40),
  pp_question_other          text        CHECK (pp_question_other IS NULL OR char_length(pp_question_other) <= 500),
  pp_score                   smallint    CHECK (pp_score BETWEEN 1 AND 5),
  pp_notes                   text        CHECK (pp_notes IS NULL OR char_length(pp_notes) <= 4000),
  ga_question                text        CHECK (ga_question IS NULL OR char_length(ga_question) <= 40),
  ga_question_other          text        CHECK (ga_question_other IS NULL OR char_length(ga_question_other) <= 500),
  ga_score                   smallint    CHECK (ga_score BETWEEN 1 AND 5),
  ga_notes                   text        CHECK (ga_notes IS NULL OR char_length(ga_notes) <= 4000),
  composite_score            smallint    GENERATED ALWAYS AS (cj_score + pp_score + ga_score) STORED,
  individual_recommendation  text        CHECK (individual_recommendation IS NULL OR individual_recommendation IN (
                                           'recommend', 'recommend_with_reservations', 'do_not_recommend')),
  suggested_unit             text        CHECK (suggested_unit IS NULL OR char_length(suggested_unit) <= 120),
  summary_comments           text        CHECK (summary_comments IS NULL OR char_length(summary_comments) <= 4000),
  status                     text        NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'completed')),
  completed_at               timestamptz,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_ngrp_interview_rubric_interviewer UNIQUE (candidate_id, interviewer_profile_id),
  CONSTRAINT chk_ngrp_interview_rubric_complete CHECK (
    status = 'in_progress' OR (
      cj_score IS NOT NULL AND pp_score IS NOT NULL AND ga_score IS NOT NULL
      AND individual_recommendation IS NOT NULL AND completed_at IS NOT NULL
    )
  )
);

COMMENT ON TABLE public.ngrp_interview_rubrics IS
  'NGRP-INTERVIEWS-1: one interviewer''s NGRP scoring sheet for one applicant. One per interviewer per applicant; composite generated; never deleted. Server-only.';

CREATE INDEX IF NOT EXISTS idx_ngrp_interview_rubrics_cycle_unit
  ON public.ngrp_interview_rubrics (cycle_id, unit_key);

-- ############################################################################
-- 2. Open times
-- ############################################################################
CREATE TABLE IF NOT EXISTS public.ngrp_interview_blocks (
  id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_id               uuid        NOT NULL REFERENCES public.ngrp_cycles(id) ON DELETE RESTRICT,
  unit_key               text        NOT NULL CHECK (btrim(unit_key) <> '' AND char_length(unit_key) <= 120),
  block_date             date        NOT NULL,
  start_time             time        NOT NULL,
  end_time               time        NOT NULL,
  duration_minutes       smallint    NOT NULL CHECK (duration_minutes BETWEEN 10 AND 120),
  break_minutes          smallint    NOT NULL DEFAULT 0 CHECK (break_minutes IN (0, 5, 10, 15, 30)),
  -- How these interviews are held, when the unit already knows.
  interview_mode         text        CHECK (interview_mode IS NULL OR interview_mode IN ('in_person', 'virtual')),
  created_by_profile_id  uuid        NOT NULL REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
  created_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_ngrp_interview_block_span CHECK (end_time > start_time)
);

COMMENT ON TABLE public.ngrp_interview_blocks IS
  'NGRP-INTERVIEWS-1: a span a unit opened for residency interviews; cut into ngrp_interview_slots. Server-only.';

CREATE INDEX IF NOT EXISTS idx_ngrp_interview_blocks_cycle_unit
  ON public.ngrp_interview_blocks (cycle_id, unit_key, block_date);

-- ############################################################################
-- 3. Bookable times
-- ############################################################################
CREATE TABLE IF NOT EXISTS public.ngrp_interview_slots (
  id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  block_id               uuid        NOT NULL REFERENCES public.ngrp_interview_blocks(id) ON DELETE CASCADE,
  cycle_id               uuid        NOT NULL REFERENCES public.ngrp_cycles(id) ON DELETE RESTRICT,
  unit_key               text        NOT NULL,
  slot_at                timestamptz NOT NULL,
  duration_minutes       smallint    NOT NULL CHECK (duration_minutes BETWEEN 10 AND 120),
  status                 text        NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'booked', 'blocked')),
  booked_candidate_id    uuid        REFERENCES public.ngrp_candidates(id) ON DELETE RESTRICT,
  booked_at              timestamptz,
  -- Who booked it: a staff or Talent Acquisition profile, or NULL when the alumnus did.
  booked_by_profile_id   uuid,
  CONSTRAINT chk_ngrp_interview_slot_booking CHECK (
    (status = 'booked' AND booked_candidate_id IS NOT NULL AND booked_at IS NOT NULL) OR
    (status <> 'booked' AND booked_candidate_id IS NULL)
  )
);

COMMENT ON TABLE public.ngrp_interview_slots IS
  'NGRP-INTERVIEWS-1: one bookable residency interview time. An applicant holds at most one booked slot per cohort. Server-only.';

CREATE UNIQUE INDEX IF NOT EXISTS uq_ngrp_interview_slot_one_booking
  ON public.ngrp_interview_slots (cycle_id, booked_candidate_id)
  WHERE status = 'booked';

CREATE INDEX IF NOT EXISTS idx_ngrp_interview_slots_cycle_unit
  ON public.ngrp_interview_slots (cycle_id, unit_key, slot_at);

-- ############################################################################
-- 4. Residency Activity: eight new event types (every earlier type kept)
-- ############################################################################
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
      'interview_recorded','offer_extended','offer_accepted','hire_recorded',
      'not_proceeding_recorded','application_reinstated',
      'unit_preferences_set','offer_declined','not_selected',
      'reflection_started','reflection_sent','reflection_opened',
      'reflection_submitted','reflection_stopped',
      'support_logged','support_voided','followup_flagged','followup_unflagged',
      'document_uploaded','resume_scored',
      'packet_downloaded',
      -- NGRP-INTERVIEWS-1
      'interview_rubric_completed','interview_rubric_reopened',
      'interview_times_opened','interview_times_removed',
      'interview_slot_blocked','interview_slot_unblocked',
      'interview_booked','interview_booking_cancelled'));

-- ############################################################################
-- 5. Server-only privileges (rubrics are never deleted; open times can be removed)
-- ############################################################################
ALTER TABLE public.ngrp_interview_rubrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ngrp_interview_blocks  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ngrp_interview_slots   ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES ON TABLE public.ngrp_interview_rubrics FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL PRIVILEGES ON TABLE public.ngrp_interview_blocks  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL PRIVILEGES ON TABLE public.ngrp_interview_slots   FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE         ON TABLE public.ngrp_interview_rubrics TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.ngrp_interview_blocks  TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.ngrp_interview_slots   TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- ── ROLLBACK (only while all three tables are still empty) ───────────────────
-- BEGIN;
--   DROP TABLE IF EXISTS public.ngrp_interview_slots;
--   DROP TABLE IF EXISTS public.ngrp_interview_blocks;
--   DROP TABLE IF EXISTS public.ngrp_interview_rubrics;
--   DELETE FROM public.ngrp_audit_events WHERE event_type LIKE 'interview\_%' ESCAPE '\' AND event_type <> 'interview_recorded';
--   (then restore the CHECK from 20261109000000)
--   NOTIFY pgrst, 'reload schema';
-- COMMIT;
