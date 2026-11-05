-- 20261127100000_past_residency_cohorts.sql
-- HIRE-HISTORY-3 (Owner, 2026-11-04): the residency cohorts that ran before the app held them,
-- so a past hire can be recorded in the cohort it belongs to (Profiles & Interest > a binder >
-- Hiring > Record a past hire > NGRP cohort). Seven cohorts, each Completed, real (is_demo false),
-- not active, with the residency start date the Owner gave. That date is also the hire date a past
-- hire in the cohort takes (cohortHireDate). No other date is known, so none is set.
--
--   Winter 2025  2025-02-03     Winter 2026  2026-02-02
--   Spring 2025  2025-05-12     Spring 2026  2026-05-18
--   Summer 2025  2025-08-11     Summer 2026  2026-08-14
--   Fall 2025    2025-10-20
--
-- Winter 2027 already exists (the current cohort, Planning) and is not touched. A name that
-- already exists is skipped, never changed (ON CONFLICT (name) DO NOTHING), so a re-run is a
-- no-op. No source cohorts, units, policy, grant or other table changes. Safe before or after
-- the deploy. CHECKS: db/audit/past_residency_cohorts_checks.sql (PRE 1, POST 1).

BEGIN;

INSERT INTO public.ngrp_cycles (name, status, is_active, is_demo, residency_start_date, notes)
VALUES
  ('Winter 2025', 'Completed', false, false, DATE '2025-02-03', 'Added by HIRE-HISTORY-3 (2026-11-04) to record past hires.'),
  ('Spring 2025', 'Completed', false, false, DATE '2025-05-12', 'Added by HIRE-HISTORY-3 (2026-11-04) to record past hires.'),
  ('Summer 2025', 'Completed', false, false, DATE '2025-08-11', 'Added by HIRE-HISTORY-3 (2026-11-04) to record past hires.'),
  ('Fall 2025',   'Completed', false, false, DATE '2025-10-20', 'Added by HIRE-HISTORY-3 (2026-11-04) to record past hires.'),
  ('Winter 2026', 'Completed', false, false, DATE '2026-02-02', 'Added by HIRE-HISTORY-3 (2026-11-04) to record past hires.'),
  ('Spring 2026', 'Completed', false, false, DATE '2026-05-18', 'Added by HIRE-HISTORY-3 (2026-11-04) to record past hires.'),
  ('Summer 2026', 'Completed', false, false, DATE '2026-08-14', 'Added by HIRE-HISTORY-3 (2026-11-04) to record past hires.')
ON CONFLICT (name) DO NOTHING;

COMMIT;

-- UNDO (only while no candidate, outcome or other row points at them):
--   DELETE FROM public.ngrp_cycles
--    WHERE name IN ('Winter 2025','Spring 2025','Summer 2025','Fall 2025','Winter 2026','Spring 2026','Summer 2026')
--      AND notes LIKE 'Added by HIRE-HISTORY-3%';
