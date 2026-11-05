-- db/audit/past_residency_cohorts_checks.sql
-- HIRE-HISTORY-3: checks for 20261127100000_past_residency_cohorts.sql. Read-only.
-- Run with: supabase db query --linked -f <this file>

-- PRE 1 / POST 1: every residency cohort by name, with what the migration sets.
-- PRE expects: Winter 2027 (Planning, active) and the demo cohort; none of the seven names.
-- POST expects: the seven, each Completed, inactive, real, with the start date in the header.
SELECT name, status, is_active, is_demo, residency_start_date, application_open_date
  FROM public.ngrp_cycles
 ORDER BY residency_start_date NULLS LAST, name;
