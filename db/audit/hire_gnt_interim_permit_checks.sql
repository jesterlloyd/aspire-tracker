-- db/audit/hire_gnt_interim_permit_checks.sql
-- HIRE-HISTORY-2: checks for 20261125000000_hire_gnt_interim_permit.sql. Read-only.
-- Run one section at a time with: supabase db query --linked -f <this file>

-- PRE 1 / POST 1: the hired_as CHECK, the permit column, and what hired_as holds.
-- PRE expects: check lists 'Graduate Nurse Tech', permit_column false.
-- POST expects: check lists 'Graduate Nurse Trainee', permit_column true, no 'Graduate Nurse Tech' row.
SELECT
  (SELECT pg_get_constraintdef(oid) FROM pg_constraint
    WHERE conrelid = 'public.ngrp_residency_outcomes'::regclass AND conname = 'ngrp_residency_outcomes_hired_as_check') AS hired_as_check,
  EXISTS (SELECT 1 FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = 'ngrp_residency_outcomes' AND column_name = 'interim_permit_issued') AS permit_column,
  (SELECT count(*) FROM public.ngrp_residency_outcomes WHERE hired_as = 'Graduate Nurse Tech') AS old_spelling_rows;

-- POST 2: the permit column's type (boolean, nullable).
-- SELECT data_type, is_nullable FROM information_schema.columns
--  WHERE table_schema = 'public' AND table_name = 'ngrp_residency_outcomes' AND column_name = 'interim_permit_issued';
