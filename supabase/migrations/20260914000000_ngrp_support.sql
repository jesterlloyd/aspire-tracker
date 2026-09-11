-- ============================================================================
-- RESIDENCY SUPPORT: recorded support and resident mentors
-- ============================================================================
-- *** APPLY MANUALLY (Owner/Jester). Claude Code has applied NOTHING. ***
--
-- Owner decisions, 2026-09-11. The Residency Support tab shows the support the
-- ASPIRE team gives alumni:
--   Before residency: Résumé Review, Town Hall, Interview Bootcamp,
--                     Placement Advising.
--   During residency: Mentorship Sessions with the resident's assigned NPD-P,
--                     and Weekly Email Check-ins. Check-ins are sent through
--                     ASPIRE Connect and counted from what Connect already
--                     records, so they are NOT stored here.
-- Only the ASPIRE team records support; Talent Acquisition sees it. Taking
-- part is always optional and never affects eligibility.
--
-- Additive and transactional. It rewrites no data and changes no existing
-- table, policy, view, or function.
--
-- WHAT THIS FILE DOES
--   1. Creates ngrp_support_entries: one row per activity per alumnus per day.
--      A wrong entry is VOIDED (who, when, why), never deleted, so the record
--      of support given cannot silently shrink. Recording the same activity
--      for the same alumnus on the same day twice is refused by a partial
--      unique index, which makes group attendance safe to re-submit.
--   2. Creates ngrp_resident_mentors: each resident's assigned NPD-P mentor,
--      by name, with an optional link to their staff profile.
--   3. Server-only privileges: no DELETE for anyone, nothing for anon or
--      authenticated. api/ngrp-support.js reads and writes as service_role
--      after its own checks.
--
-- The activity CHECK must match SUPPORT_ACTIVITY_KEYS in
-- src/lib/ngrp/ngrpSupportActivities.js (a test pins that).
--
-- SAFE IN EITHER DEPLOY ORDER: the Support tab shows its placeholder until
-- these tables exist.
--
-- PREFLIGHT / POSTFLIGHT: db/audit/ngrp_support_checks.sql

BEGIN;

DO $pre$
BEGIN
  IF to_regclass('public.ngrp_candidates') IS NULL OR to_regclass('public.ngrp_cycles') IS NULL THEN
    RAISE EXCEPTION 'PRECHECK FAILED: the NGRP foundation tables are missing';
  END IF;
END
$pre$;

-- ############################################################################
-- 1. Support entries
-- ############################################################################
CREATE TABLE IF NOT EXISTS public.ngrp_support_entries (
  id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_id               uuid        NOT NULL REFERENCES public.ngrp_cycles(id) ON DELETE RESTRICT,
  candidate_id           uuid        NOT NULL REFERENCES public.ngrp_candidates(id) ON DELETE CASCADE,
  student_id             uuid        NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  activity               text        NOT NULL CHECK (activity IN (
                                       'resume_review', 'town_hall', 'interview_bootcamp',
                                       'placement_advising', 'mentorship_session')),
  occurred_on            date        NOT NULL,
  note                   text        CHECK (note IS NULL OR (btrim(note) <> '' AND char_length(note) <= 1000)),
  -- Mentorship sessions only: who led it (the mentor at the time).
  mentor_name            text        CHECK (mentor_name IS NULL OR (btrim(mentor_name) <> '' AND char_length(mentor_name) <= 120)),
  -- Optional link to the calendar event (a Town Hall, for example). No
  -- foreign key: the record of attendance outlives an edited calendar.
  event_id               uuid,
  -- No foreign key: the recorder of record is kept even if that profile goes.
  recorded_by_profile_id uuid        NOT NULL,
  recorded_at            timestamptz NOT NULL DEFAULT now(),
  voided_at              timestamptz,
  voided_by_profile_id   uuid,
  void_reason            text        CHECK (void_reason IS NULL OR (btrim(void_reason) <> '' AND char_length(void_reason) <= 300)),
  CONSTRAINT chk_ngrp_support_void CHECK (
    (voided_at IS NULL AND voided_by_profile_id IS NULL AND void_reason IS NULL) OR
    (voided_at IS NOT NULL AND voided_by_profile_id IS NOT NULL)
  )
);

COMMENT ON TABLE public.ngrp_support_entries IS
  'RESIDENCY-SUPPORT-1: support the ASPIRE team gave one alumnus on one day. Voided, never deleted. Server-only.';

CREATE UNIQUE INDEX IF NOT EXISTS uq_ngrp_support_entry_live
  ON public.ngrp_support_entries (candidate_id, activity, occurred_on)
  WHERE voided_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_ngrp_support_entries_cycle
  ON public.ngrp_support_entries (cycle_id, activity, occurred_on DESC);

-- ############################################################################
-- 2. Resident mentors (one per resident)
-- ############################################################################
CREATE TABLE IF NOT EXISTS public.ngrp_resident_mentors (
  candidate_id           uuid        PRIMARY KEY REFERENCES public.ngrp_candidates(id) ON DELETE CASCADE,
  mentor_name            text        NOT NULL CHECK (btrim(mentor_name) <> '' AND char_length(mentor_name) <= 120),
  -- Set when the mentor is an ASPIRE staff member with a profile.
  mentor_profile_id      uuid        REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  assigned_by_profile_id uuid        NOT NULL,
  assigned_at            timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.ngrp_resident_mentors IS
  'RESIDENCY-SUPPORT-1: each resident''s assigned NPD-P mentor. Server-only.';

-- ############################################################################
-- 3. Server-only privileges (no DELETE for anyone)
-- ############################################################################
ALTER TABLE public.ngrp_support_entries  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ngrp_resident_mentors ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES ON TABLE public.ngrp_support_entries  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL PRIVILEGES ON TABLE public.ngrp_resident_mentors FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.ngrp_support_entries  TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.ngrp_resident_mentors TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- ── ROLLBACK (only while both tables are still empty) ────────────────────────
-- BEGIN;
--   DROP TABLE IF EXISTS public.ngrp_resident_mentors;
--   DROP TABLE IF EXISTS public.ngrp_support_entries;
--   NOTIFY pgrst, 'reload schema';
-- COMMIT;
