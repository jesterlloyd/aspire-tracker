-- INTERVIEW-MODE-1 checks for 20261110000000_interview_mode.sql. Read-only.

-- PRE 1: the column is not there yet. Expect column_present false, constraint_present false.
SELECT
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ngrp_candidates' AND column_name = 'interview_mode') AS column_present,
  EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ngrp_candidates_interview_mode_check') AS constraint_present;

-- POST 1: both true, and nothing recorded yet (expect recorded 0).
SELECT
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ngrp_candidates' AND column_name = 'interview_mode') AS column_present,
  EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ngrp_candidates_interview_mode_check') AS constraint_present,
  (SELECT count(*) FROM public.ngrp_candidates WHERE interview_mode IS NOT NULL) AS recorded;
