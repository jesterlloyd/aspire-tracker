-- 20261110000000_interview_mode.sql
-- INTERVIEW-MODE-1 (Owner, 2026-10-05): record whether a residency interview was held in person
-- or virtually. Optional ("good data to have"; most are virtual). Shown in the applicant binder's
-- Interview section, on the Interview Board card, in the roster CSV and in the applicant packet.
--
-- 1. ngrp_candidates.interview_mode: text, NULL (not recorded), 'in_person' or 'virtual'.
--    lib/server/ngrpPlanning.js INTERVIEW_MODES lists the same two values.
--
-- NOT CHANGED. No policy or grant; every write is the service role's through /api/ngrp-manage.
-- EITHER DEPLOY ORDER. Before this runs the binder hides the choice and every interview still
-- saves; the roster read falls back one tier without the column.
-- CHECKS: db/audit/interview_mode_checks.sql (PRE 1, POST 1).

BEGIN;

ALTER TABLE public.ngrp_candidates
  ADD COLUMN IF NOT EXISTS interview_mode text;

ALTER TABLE public.ngrp_candidates
  DROP CONSTRAINT IF EXISTS ngrp_candidates_interview_mode_check;
ALTER TABLE public.ngrp_candidates
  ADD CONSTRAINT ngrp_candidates_interview_mode_check
    CHECK (interview_mode IS NULL OR interview_mode IN ('in_person', 'virtual'));

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK:
--   ALTER TABLE public.ngrp_candidates DROP CONSTRAINT IF EXISTS ngrp_candidates_interview_mode_check;
--   ALTER TABLE public.ngrp_candidates DROP COLUMN IF EXISTS interview_mode;
