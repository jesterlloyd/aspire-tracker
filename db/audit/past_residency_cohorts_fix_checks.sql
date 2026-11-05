-- db/audit/past_residency_cohorts_fix_checks.sql
-- Checks for 20261127200000_past_residency_cohorts_fix.sql. Read-only.

-- PRE 1 / POST 1: the seeded cohorts, their start dates, and what points at each.
-- PRE expects: seven rows (Winter/Spring/Summer 2025 with nothing pointing at them; 2026 dates 02-02, 05-18, 08-14).
-- POST expects: four rows, Fall 2025 2025-10-20, Winter 2026 2026-02-03, Spring 2026 2026-05-12, Summer 2026 2026-08-11.
SELECT c.name, c.residency_start_date,
  (SELECT count(*) FROM public.ngrp_candidates x WHERE x.cycle_id = c.id) AS candidates,
  (SELECT count(*) FROM public.ngrp_residency_outcomes x WHERE x.cycle_id = c.id) AS outcomes,
  (SELECT count(*) FROM public.ngrp_audit_events x WHERE x.cycle_id = c.id) AS audits
  FROM public.ngrp_cycles c WHERE c.notes LIKE 'Added by HIRE-HISTORY-3%'
 ORDER BY c.residency_start_date;

-- POST 2: the past hires in Summer 2026 and their title dates (expects hired 2026-08-11, title 2026-08-11).
-- SELECT o.hired_at, o.offer_extended_at, o.offer_accepted_at, o.residency_start_date,
--        (SELECT string_agg(t.effective_on::text, ', ') FROM public.ngrp_resident_titles t WHERE t.candidate_id = o.candidate_id) AS title_dates
--   FROM public.ngrp_residency_outcomes o JOIN public.ngrp_cycles c ON c.id = o.cycle_id
--  WHERE c.name = 'Summer 2026' AND o.backfilled;
