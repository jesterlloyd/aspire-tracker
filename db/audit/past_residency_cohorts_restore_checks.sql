-- db/audit/past_residency_cohorts_restore_checks.sql
-- Checks for 20261127300000_past_residency_cohorts_restore.sql. Read-only.

-- PRE 1 / POST 1: every real residency cohort and its start date.
-- PRE expects: Fall 2025 10-20, Winter 2026 02-03, Spring 2026 05-12, Summer 2026 08-11, Winter 2027 01-25.
-- POST expects eight: Winter 2025 02-03, Spring 2025 05-12, Summer 2025 08-11, Fall 2025 10-20,
--   Winter 2026 02-02, Spring 2026 05-18, Summer 2026 08-14, Winter 2027 01-25.
SELECT c.name, c.status, c.residency_start_date,
  (SELECT count(*) FROM public.ngrp_residency_outcomes x WHERE x.cycle_id = c.id) AS outcomes
  FROM public.ngrp_cycles c WHERE NOT c.is_demo
 ORDER BY c.residency_start_date;

-- POST 2: the past hires in Summer 2026 and their title dates (expects 2026-08-14 throughout).
-- SELECT o.hired_at, o.offer_extended_at, o.offer_accepted_at, o.residency_start_date,
--        (SELECT string_agg(t.effective_on::text, ', ') FROM public.ngrp_resident_titles t WHERE t.candidate_id = o.candidate_id) AS title_dates
--   FROM public.ngrp_residency_outcomes o JOIN public.ngrp_cycles c ON c.id = o.cycle_id
--  WHERE c.name = 'Summer 2026' AND o.backfilled;
