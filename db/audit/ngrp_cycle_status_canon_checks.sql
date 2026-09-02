-- db/audit/ngrp_cycle_status_canon_checks.sql
--
-- Verification for 20260905000000_ngrp_cycle_status_canon.sql.
-- Read-only. Run each numbered section ON ITS OWN, one at a time, in the Supabase SQL
-- editor, and read the result before moving to the next.
--
-- PRE 1 and PRE 2 run BEFORE the migration. POST 1 through POST 4 run after.

-- ─────────────────────────────────────────────────────────────────────────────
-- PRE 1. What is actually stored today, and how many rows each migration step
--        will touch. Run this FIRST: it is the only record of what the six
--        middle values held before they were collapsed, and the migration
--        deliberately does not preserve it.
--        EXPECT: one row per status in use. Save this output.
-- ─────────────────────────────────────────────────────────────────────────────
SELECT status,
       count(*) AS cycles,
       string_agg(name, ', ' ORDER BY name) AS cohort_names
  FROM public.ngrp_cycles
 GROUP BY status
 ORDER BY status;


-- ─────────────────────────────────────────────────────────────────────────────
-- PRE 2. The constraint the migration expects to drop.
--        EXPECT: one row, conname = 'ngrp_cycles_status_check', listing the nine
--        old values. If the name differs, STOP: the migration's DROP would be a
--        silent no-op and step 3 would then fail on a duplicate constraint.
-- ─────────────────────────────────────────────────────────────────────────────
SELECT conname, pg_get_constraintdef(oid) AS definition
  FROM pg_constraint
 WHERE conrelid = 'public.ngrp_cycles'::regclass
   AND contype = 'c'
   AND pg_get_constraintdef(oid) ILIKE '%status%';


-- ─────────────────────────────────────────────────────────────────────────────
-- POST 1. The new constraint exists and names exactly four values.
--         EXPECT: one row, conname = 'ngrp_cycles_status_canon', definition
--         containing Planning, Active, Completed, Archived and NOTHING else.
-- ─────────────────────────────────────────────────────────────────────────────
SELECT conname, pg_get_constraintdef(oid) AS definition
  FROM pg_constraint
 WHERE conrelid = 'public.ngrp_cycles'::regclass
   AND contype = 'c'
   AND pg_get_constraintdef(oid) ILIKE '%status%';


-- ─────────────────────────────────────────────────────────────────────────────
-- POST 2. No row survived outside the canon.
--         EXPECT: zero rows. Any row here means the UPDATE missed a value.
-- ─────────────────────────────────────────────────────────────────────────────
SELECT id, name, status
  FROM public.ngrp_cycles
 WHERE status NOT IN ('Planning', 'Active', 'Completed', 'Archived');


-- ─────────────────────────────────────────────────────────────────────────────
-- POST 3. The new distribution, to compare against PRE 1.
--         EXPECT: the PRE 1 counts for Planning / Completed / Archived unchanged,
--         and Active holding the sum of the six collapsed values.
-- ─────────────────────────────────────────────────────────────────────────────
SELECT status,
       count(*) AS cycles,
       string_agg(name, ', ' ORDER BY name) AS cohort_names
  FROM public.ngrp_cycles
 GROUP BY status
 ORDER BY status;


-- ─────────────────────────────────────────────────────────────────────────────
-- POST 4. The constraint actually refuses an old value.
--         A constraint that exists is not the same as a constraint that bites.
--         EXPECT: ERROR "new row for relation ngrp_cycles violates check
--         constraint ngrp_cycles_status_canon". The ROLLBACK means nothing is
--         written even if it unexpectedly succeeds.
-- ─────────────────────────────────────────────────────────────────────────────
BEGIN;
  UPDATE public.ngrp_cycles SET status = 'Application Open'
   WHERE id = (SELECT id FROM public.ngrp_cycles LIMIT 1);
ROLLBACK;
