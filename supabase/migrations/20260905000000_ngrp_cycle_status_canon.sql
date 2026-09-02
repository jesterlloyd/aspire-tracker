-- 20260905000000_ngrp_cycle_status_canon.sql
--
-- NGRP-CYCLE-STATUS-CANON: collapse ngrp_cycles.status from nine values to the four
-- an ASPIRE cohort already uses.
--
-- WHY. Two cohort lists sit in one Scope picker. The ASPIRE side speaks
-- Planning/Active/Completed/Archived; the residency side spoke Planning, Accepting
-- Interest, Application Open, Application Closed, Interviews, Offers, Residency
-- Active, Completed, Archived. The same act of setting a cohort's status had to be
-- learned twice, and the two lists could not be compared at a glance.
--
-- The six middle values were also a hand-maintained SECOND COPY of the dates this
-- table already carries: 'Application Open' restated application_open_date,
-- 'Interviews' restated interview_window_start, 'Residency Active' restated
-- residency_start_date. Nothing kept the copy honest, so a cycle could sit at
-- 'Interviews' with an interview window months away, or the reverse. Lifecycle phase
-- is now read from the dates (the picker renders them); status says what an ASPIRE
-- cohort's status says and nothing more.
--
-- DATA. The six middle values all mean "this cohort is underway", so they map to
-- 'Active'. Planning, Completed and Archived are unchanged and are not rewritten.
-- The mapping is deliberately not reversible: 'Active' does not remember which of the
-- six phases a row was in. That information was never trustworthy (see above) and the
-- dates carry it properly. If a row's phase matters, read its dates.
--
-- ORDER MATTERS. The CHECK constraint is dropped BEFORE the UPDATE. 'Active' is not in
-- the old vocabulary, so an UPDATE that ran first would violate the constraint it is
-- trying to escape. Relax, then write, then re-tighten.
--
-- Safe to re-run: the DROP is IF EXISTS, the UPDATE matches only old values (a second
-- run touches zero rows), and the constraint is re-added under a name checked first.

BEGIN;

-- 1. Relax. The inline column CHECK from 20260903000000_ngrp_foundation.sql carries
--    Postgres's generated name for an unnamed column constraint.
ALTER TABLE public.ngrp_cycles DROP CONSTRAINT IF EXISTS ngrp_cycles_status_check;
ALTER TABLE public.ngrp_cycles DROP CONSTRAINT IF EXISTS ngrp_cycles_status_canon;

-- 2. Write. Every "underway" phase becomes Active. Planning/Completed/Archived are
--    already canonical and are left alone.
UPDATE public.ngrp_cycles
   SET status = 'Active',
       updated_at = now()
 WHERE status IN ('Accepting Interest', 'Application Open', 'Application Closed',
                  'Interviews', 'Offers', 'Residency Active');

-- 3. Re-tighten, under an explicit name so a future migration never has to guess it.
ALTER TABLE public.ngrp_cycles
  ADD CONSTRAINT ngrp_cycles_status_canon
  CHECK (status IN ('Planning', 'Active', 'Completed', 'Archived'));

COMMIT;

-- ── ROLLBACK (inert; uncomment and run as its own block only if required) ────
-- Restores the nine-value vocabulary. It CANNOT restore which phase a row held
-- before step 2: every remapped row stays 'Active', which the old CHECK does not
-- permit, so the old constraint is re-added only after mapping 'Active' back to a
-- legal value. 'Application Open' is chosen as that landing value because it is the
-- phase in which form sends were expected. Re-derive the true phase from the cycle's
-- dates afterward; do not trust this value.
--
-- BEGIN;
--   ALTER TABLE public.ngrp_cycles DROP CONSTRAINT IF EXISTS ngrp_cycles_status_canon;
--   UPDATE public.ngrp_cycles SET status = 'Application Open' WHERE status = 'Active';
--   ALTER TABLE public.ngrp_cycles
--     ADD CONSTRAINT ngrp_cycles_status_check
--     CHECK (status IN ('Planning','Accepting Interest','Application Open',
--                       'Application Closed','Interviews','Offers',
--                       'Residency Active','Completed','Archived'));
-- COMMIT;
