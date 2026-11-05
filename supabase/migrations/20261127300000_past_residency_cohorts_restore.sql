-- 20261127300000_past_residency_cohorts_restore.sql
-- COHORT-ORDER-2 (Owner, 2026-11-04): the residency cohorts are the EIGHT the Owner first gave.
-- 20261127200000 cut them to four because the scope picker listed closed cohorts oldest first,
-- so only the 2025 ones were in view and the 2026 ones looked missing. The Owner's list:
--
--   Winter 2025  2025-02-03     Winter 2026  2026-02-02
--   Spring 2025  2025-05-12     Spring 2026  2026-05-18
--   Summer 2025  2025-08-11     Summer 2026  2026-08-14
--   Fall 2025    2025-10-20     Winter 2027  2027-01-25 (unchanged, Planning)
--
-- 1. Winter, Spring and Summer 2025 are inserted again: Completed, real, not active, the same
--    note as 20261127100000. A name that exists is skipped (ON CONFLICT (name) DO NOTHING).
-- 2. The three 2026 start dates go back to 02-02, 05-18, 08-14.
-- 3. The one backfilled hire in Summer 2026 (Carla Layug) goes back from 2026-08-11 to
--    2026-08-14: hired_at, both offer timestamps, residency start, and its title row's date.
--    Only backfilled rows dated exactly 2026-08-11 noon UTC are touched.
--
-- NOT CHANGED: Fall 2025, Winter 2027, the demo cohort, every other table and policy.
-- CHECKS: db/audit/past_residency_cohorts_restore_checks.sql (PRE 1, POST 1-2).

BEGIN;

INSERT INTO public.ngrp_cycles (name, status, is_active, is_demo, residency_start_date, notes)
VALUES
  ('Winter 2025', 'Completed', false, false, DATE '2025-02-03', 'Added by HIRE-HISTORY-3 (2026-11-04) to record past hires.'),
  ('Spring 2025', 'Completed', false, false, DATE '2025-05-12', 'Added by HIRE-HISTORY-3 (2026-11-04) to record past hires.'),
  ('Summer 2025', 'Completed', false, false, DATE '2025-08-11', 'Added by HIRE-HISTORY-3 (2026-11-04) to record past hires.')
ON CONFLICT (name) DO NOTHING;

UPDATE public.ngrp_cycles SET residency_start_date = DATE '2026-02-02', updated_at = now()
 WHERE name = 'Winter 2026' AND notes LIKE 'Added by HIRE-HISTORY-3%';
UPDATE public.ngrp_cycles SET residency_start_date = DATE '2026-05-18', updated_at = now()
 WHERE name = 'Spring 2026' AND notes LIKE 'Added by HIRE-HISTORY-3%';
UPDATE public.ngrp_cycles SET residency_start_date = DATE '2026-08-14', updated_at = now()
 WHERE name = 'Summer 2026' AND notes LIKE 'Added by HIRE-HISTORY-3%';

UPDATE public.ngrp_resident_titles t SET effective_on = DATE '2026-08-14'
  FROM public.ngrp_residency_outcomes o, public.ngrp_cycles c
 WHERE t.candidate_id = o.candidate_id AND o.cycle_id = c.id
   AND c.name = 'Summer 2026' AND c.notes LIKE 'Added by HIRE-HISTORY-3%'
   AND o.backfilled = true AND o.hired_at = TIMESTAMPTZ '2026-08-11 12:00:00+00'
   AND t.effective_on = DATE '2026-08-11';

UPDATE public.ngrp_residency_outcomes o
   SET hired_at = TIMESTAMPTZ '2026-08-14 12:00:00+00',
       offer_extended_at = TIMESTAMPTZ '2026-08-14 12:00:00+00',
       offer_accepted_at = TIMESTAMPTZ '2026-08-14 12:00:00+00',
       residency_start_date = CASE WHEN o.residency_start_date = DATE '2026-08-11' THEN DATE '2026-08-14' ELSE o.residency_start_date END,
       updated_at = now()
  FROM public.ngrp_cycles c
 WHERE o.cycle_id = c.id AND c.name = 'Summer 2026' AND c.notes LIKE 'Added by HIRE-HISTORY-3%'
   AND o.backfilled = true AND o.hired_at = TIMESTAMPTZ '2026-08-11 12:00:00+00';

COMMIT;
