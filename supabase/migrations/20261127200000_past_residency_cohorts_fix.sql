-- 20261127200000_past_residency_cohorts_fix.sql
-- HIRE-HISTORY-3 correction (Owner, 2026-11-04): the residency cohorts before Winter 2027 are
-- exactly these four. 20261127100000 seeded seven with the wrong dates.
--
--   Fall 2025    2025-10-20   (unchanged)
--   Winter 2026  2026-02-03   (was 2026-02-02)
--   Spring 2026  2026-05-12   (was 2026-05-18)
--   Summer 2026  2026-08-11   (was 2026-08-14)
--
-- 1. Winter 2025, Spring 2025 and Summer 2025 never existed and are deleted. Only rows seeded by
--    20261127100000 (notes 'Added by HIRE-HISTORY-3%'), and only while nothing points at them: the
--    precheck refuses if any candidate, outcome, audit event, added alumnus or source mapping does.
-- 2. The three 2026 start dates are corrected.
-- 3. A past hire recorded in Summer 2026 took the old start as its hire date (cohortHireDate). The
--    one such hire on 2026-11-04 (Carla Layug, backfilled) moves from 2026-08-14 to 2026-08-11:
--    its outcome's hired_at, offer timestamps and residency start, and its title row's effective date.
--    ngrp_resident_titles is append-only for the app; this one-time correction of a date the app
--    derived from the wrong seed runs as the migration owner. Only backfilled rows dated exactly
--    2026-08-14 noon UTC are touched.
--
-- NOT CHANGED: Winter 2027, the demo cohort, every other table and policy. CHECKS:
-- db/audit/past_residency_cohorts_fix_checks.sql (PRE 1, POST 1-2).

BEGIN;

DO $pre$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.ngrp_cycles c
     WHERE c.name IN ('Winter 2025', 'Spring 2025', 'Summer 2025') AND c.notes LIKE 'Added by HIRE-HISTORY-3%'
       AND (EXISTS (SELECT 1 FROM public.ngrp_candidates x WHERE x.cycle_id = c.id)
         OR EXISTS (SELECT 1 FROM public.ngrp_residency_outcomes x WHERE x.cycle_id = c.id)
         OR EXISTS (SELECT 1 FROM public.ngrp_audit_events x WHERE x.cycle_id = c.id)
         OR EXISTS (SELECT 1 FROM public.ngrp_cycle_added_alumni x WHERE x.cycle_id = c.id)
         OR EXISTS (SELECT 1 FROM public.ngrp_cycle_source_cohorts x WHERE x.cycle_id = c.id))
  ) THEN
    RAISE EXCEPTION 'PRECHECK FAILED: a 2025 cohort to delete already has rows pointing at it';
  END IF;
END
$pre$;

DELETE FROM public.ngrp_cycles
 WHERE name IN ('Winter 2025', 'Spring 2025', 'Summer 2025') AND notes LIKE 'Added by HIRE-HISTORY-3%';

UPDATE public.ngrp_cycles SET residency_start_date = DATE '2026-02-03', updated_at = now()
 WHERE name = 'Winter 2026' AND notes LIKE 'Added by HIRE-HISTORY-3%';
UPDATE public.ngrp_cycles SET residency_start_date = DATE '2026-05-12', updated_at = now()
 WHERE name = 'Spring 2026' AND notes LIKE 'Added by HIRE-HISTORY-3%';
UPDATE public.ngrp_cycles SET residency_start_date = DATE '2026-08-11', updated_at = now()
 WHERE name = 'Summer 2026' AND notes LIKE 'Added by HIRE-HISTORY-3%';

UPDATE public.ngrp_resident_titles t SET effective_on = DATE '2026-08-11'
  FROM public.ngrp_residency_outcomes o, public.ngrp_cycles c
 WHERE t.candidate_id = o.candidate_id AND o.cycle_id = c.id
   AND c.name = 'Summer 2026' AND c.notes LIKE 'Added by HIRE-HISTORY-3%'
   AND o.backfilled = true AND o.hired_at = TIMESTAMPTZ '2026-08-14 12:00:00+00'
   AND t.effective_on = DATE '2026-08-14';

UPDATE public.ngrp_residency_outcomes o
   SET hired_at = TIMESTAMPTZ '2026-08-11 12:00:00+00',
       offer_extended_at = TIMESTAMPTZ '2026-08-11 12:00:00+00',
       offer_accepted_at = TIMESTAMPTZ '2026-08-11 12:00:00+00',
       residency_start_date = CASE WHEN o.residency_start_date = DATE '2026-08-14' THEN DATE '2026-08-11' ELSE o.residency_start_date END,
       updated_at = now()
  FROM public.ngrp_cycles c
 WHERE o.cycle_id = c.id AND c.name = 'Summer 2026' AND c.notes LIKE 'Added by HIRE-HISTORY-3%'
   AND o.backfilled = true AND o.hired_at = TIMESTAMPTZ '2026-08-14 12:00:00+00';

COMMIT;
