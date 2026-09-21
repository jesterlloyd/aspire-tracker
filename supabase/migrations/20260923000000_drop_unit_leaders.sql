-- ============================================================================
-- UNIT-LEADERS-RETIRE-2: drop the hand-seeded unit_leaders table
-- ============================================================================
-- *** APPLY MANUALLY (Owner/Jester). Claude Code has applied NOTHING. ***
--
-- Owner decision, 2026-09-20: "whatever is in ASPIRE Connect > Contacts is the
-- canon; you can lose whatever hasn't been updated in a while." Since 31f943c3
-- (UNIT-LEADERS-RETIRE-1, live 2026-09-20) nothing in the app reads this table:
-- notification routing, the placement greeting, the Overview lead map, the
-- capacity outreach selector, the placement board and Keith all read Connect
-- Unit Leader contacts through src/lib/unitLeadersFromConnect.js, and
-- test/unitLeadersFromConnect.test.mjs fails on any from('unit_leaders').
--
-- THE PREFLIGHT WAS RUN by the Owner on 2026-09-20
-- (db/audit/unit_leaders_vs_connect_preflight.sql): 26 of 28 units resolve the
-- same lead from Connect as from this table; 4 North resolves Edcynt Solita
-- (Connect) where the table still said Iesha King, who is 7 South's Associate
-- Director in both; Transfer Center gains a lead (Jeremy Miller, Director);
-- Float Pool has no lead in Connect because Charina Emerson (Executive
-- Director) is not a Unit Leader contact there. Every unit the table knew has
-- at least one Unit Leader contact in Connect. Seven rows name people who are
-- not in Connect at all (six operational staff and Charina Emerson); under the
-- Owner's rule they are not carried over, and the seed that created them stays
-- in the repository (db/migrations/seed_unit_leaders.sql) as the record.
--
-- WHAT THIS FILE DOES
--   1. Refuses to run if any view, function, trigger or foreign key still
--      depends on the table (none does in this repository; the check is for
--      objects created out of band, which this project has met before).
--   2. Drops the table's policies by name (service_role_all_unit_leaders,
--      staff_read_unit_leaders, and the dashboard-created anon_read_unit_leaders
--      that S-18 recorded), then the table and its three indexes with it.
--   3. Reloads the PostgREST schema.
--
-- NOT REVERSIBLE by rollback: the rows are gone with the table. Recovery, if it
-- were ever wanted, is db/migrations/unit_response_system.sql (the table) and
-- db/migrations/seed_unit_leaders.sql (the 2026 hand seed), both kept.
--
-- PREFLIGHT / POSTFLIGHT: db/audit/unit_leaders_drop_checks.sql

BEGIN;

DO $pre$
DECLARE
  dep_count integer;
BEGIN
  IF to_regclass('public.unit_leaders') IS NULL THEN
    RAISE NOTICE 'unit_leaders is already gone; nothing to do';
    RETURN;
  END IF;

  -- Anything that would be dragged down by a CASCADE is a reason to stop instead:
  -- a view or rule (pg_rewrite), a trigger, or a constraint that belongs to ANOTHER
  -- table (a foreign key pointing here). The table's own indexes, constraints,
  -- defaults and policies leave with it and are not counted.
  SELECT count(*) INTO dep_count
  FROM pg_depend d
  JOIN pg_class c ON c.oid = d.refobjid
  WHERE c.oid = 'public.unit_leaders'::regclass
    AND d.deptype IN ('n', 'a')
    AND (
      d.classid = 'pg_rewrite'::regclass
      OR d.classid = 'pg_trigger'::regclass
      OR (d.classid = 'pg_constraint'::regclass
          AND d.objid IN (SELECT oid FROM pg_constraint WHERE conrelid <> c.oid))
    );
  IF dep_count > 0 THEN
    RAISE EXCEPTION 'PRECHECK FAILED: % object(s) still depend on public.unit_leaders (see PRE 2 in db/audit/unit_leaders_drop_checks.sql)', dep_count;
  END IF;

  SELECT count(*) INTO dep_count
  FROM pg_constraint
  WHERE contype = 'f' AND confrelid = 'public.unit_leaders'::regclass;
  IF dep_count > 0 THEN
    RAISE EXCEPTION 'PRECHECK FAILED: % foreign key(s) still reference public.unit_leaders', dep_count;
  END IF;
END
$pre$;

DROP POLICY IF EXISTS "service_role_all_unit_leaders"  ON public.unit_leaders;
DROP POLICY IF EXISTS "staff_read_unit_leaders"        ON public.unit_leaders;
DROP POLICY IF EXISTS "authenticated_read_unit_leaders" ON public.unit_leaders;
DROP POLICY IF EXISTS "authenticated_all_unit_leaders"  ON public.unit_leaders;
DROP POLICY IF EXISTS "anon_read_unit_leaders"          ON public.unit_leaders;

DROP TABLE IF EXISTS public.unit_leaders;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- ── ROLLBACK ─────────────────────────────────────────────────────────────────
-- There is none: the rows leave with the table. To recreate the table empty, run
-- the CREATE TABLE block of db/migrations/unit_response_system.sql; to refill
-- it with the 2026 hand seed, run db/migrations/seed_unit_leaders.sql. Nothing
-- in the app would read it either way.
