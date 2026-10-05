-- 20261107000000_ngrp_followup_flag.sql
-- RESIDENCY-FLAG-1 (Owner, 2026-10-05): the follow-up flag on an alumnus's RESIDENCY record.
--
-- WHY. Residency > Profiles & Interest opens each alumnus in the Student Profiles binder, and
-- the Owner asked for the same FLAG ribbon there. It is a separate flag from the student
-- chart's (students.flagged_for_followup): flagging an applicant in Residency never marks the
-- student in the internship roster, and the reverse (Owner chose this over sharing one flag).
-- It lives on ngrp_candidates, so it belongs to one residency cohort, as the application does.
-- Like every other ribbon it carries NO note.
--
-- WHAT. One boolean, NOT NULL DEFAULT false, so every existing candidate reads unflagged. On
-- Postgres 11+ a constant default is metadata-only: no table rewrite.
--
-- NOT CHANGED. No policy, no grant, no backfill, no function. ngrp_candidates is written by
-- the service role only, through /api/ngrp-manage `followup_flag_set`, which refuses Talent
-- Acquisition. An alumnus with no candidate row yet is enrolled first (as Support does).
--
-- EITHER DEPLOY ORDER. Before this runs the ribbon is inert and says so, and a pull answers
-- 409 not_enabled. The roster reads candidates with '*', so applying this switches the
-- ribbon on with no redeploy.
--
-- CHECKS: db/audit/ngrp_followup_flag_checks.sql (PRE 1, POST 1).

BEGIN;

ALTER TABLE public.ngrp_candidates
  ADD COLUMN IF NOT EXISTS flagged_for_followup boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.ngrp_candidates.flagged_for_followup IS
  'RESIDENCY-FLAG-1: staff follow-up flag on this residency application, set by the ribbon on '
  'the Applicant chart. Separate from students.flagged_for_followup; carries no note.';

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK (drops every residency flag; the ribbon goes back to inert with no redeploy):
--   ALTER TABLE public.ngrp_candidates DROP COLUMN IF EXISTS flagged_for_followup;
--   NOTIFY pgrst, 'reload schema';
