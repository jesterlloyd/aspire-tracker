-- RESIDENCY-FLAG-1 checks for 20261107000000_ngrp_followup_flag.sql. Read-only.

-- PRE 1: is the column already there? Expect false before the migration.
SELECT EXISTS (
  SELECT 1 FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'ngrp_candidates' AND column_name = 'flagged_for_followup'
) AS column_present;

-- POST 1: present, boolean, NOT NULL, default false, and nobody flagged yet.
SELECT c.data_type, c.is_nullable, c.column_default,
       (SELECT count(*) FROM public.ngrp_candidates WHERE flagged_for_followup) AS flagged_now
FROM information_schema.columns c
WHERE c.table_schema = 'public' AND c.table_name = 'ngrp_candidates' AND c.column_name = 'flagged_for_followup';
