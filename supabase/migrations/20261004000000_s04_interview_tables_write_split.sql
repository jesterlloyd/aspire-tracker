-- supabase/migrations/20261004000000_s04_interview_tables_write_split.sql
--
-- S-04, the last part: the three interview tables that Wave E's split (20260822020000)
-- deliberately EXCLUDED, because interviewers legitimately write them from the browser,
-- now get the same split. The browser no longer writes them at all (S04-1): pausing a
-- block, blocking and unblocking a slot, marking a Teams invite sent and the
-- student-delete cascade all run through api/availability.js, which checks ownership
-- from the verified profile. What was holding these tables open was the lack of an
-- ownership rule RLS could express; the endpoint is that rule.
--
-- For each of interview_availability_blocks, interview_slots and interview_sessions:
--   DROP  the FOR ALL USING (is_staff()) policy Wave E created (named explicitly)
--   CREATE <table>_staff_select   FOR SELECT  USING (is_staff())
--          <table>_writer_insert  FOR INSERT  WITH CHECK (is_active_staff_writer())
--          <table>_writer_update  FOR UPDATE  USING and WITH CHECK (is_active_staff_writer())
--          <table>_writer_delete  FOR DELETE  USING (is_active_staff_writer())
-- exactly the shape 20260822020000 gave the other eight tables. Any OTHER policy on these
-- tables is left alone: only the three named policies and this file's own names are dropped,
-- so a narrower policy created since is preserved. Reads do not change for anyone.
-- Interviewers and viewers keep SELECT; their writes go through the endpoint, whose
-- service-role client bypasses RLS.
--
-- STOP: apply this ONLY after S04-1 is live in production. Until then the browser still
-- writes these tables for an interviewer, and this file would turn every one of those
-- writes into a silent refusal (a PostgREST update that matches no row).
--
-- Owner-gated. Apply as ONE block. Checks, one section at a time, are in
-- db/audit/s04_interview_tables_write_split_checks.sql: PRE 1 to 3, then this file, then
-- POST 1 to 4. Rollback (inert until run) at the end.

BEGIN;

DO $$
BEGIN
  IF to_regprocedure('public.is_staff()') IS NULL OR to_regprocedure('public.is_active_staff_writer()') IS NULL THEN
    RAISE EXCEPTION 'S-04: is_staff() and is_active_staff_writer() must both exist (Wave A and 20260822020000); nothing was applied';
  END IF;
END $$;

DO $split$
DECLARE
  t record;
BEGIN
  FOR t IN
    SELECT * FROM (VALUES
      ('interview_availability_blocks', 'staff_all_availability_blocks'),
      ('interview_slots',               'staff_all_interview_slots'),
      ('interview_sessions',            'staff_all_interview_sessions')
    ) AS v(tbl, old_policy)
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.tbl);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t.old_policy, t.tbl);

    -- Idempotent: drop this file's own names too, so a re-run is safe.
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t.tbl || '_staff_select', t.tbl);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t.tbl || '_writer_insert', t.tbl);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t.tbl || '_writer_update', t.tbl);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t.tbl || '_writer_delete', t.tbl);

    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.is_staff())',
      t.tbl || '_staff_select', t.tbl);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (public.is_active_staff_writer())',
      t.tbl || '_writer_insert', t.tbl);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (public.is_active_staff_writer()) WITH CHECK (public.is_active_staff_writer())',
      t.tbl || '_writer_update', t.tbl);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (public.is_active_staff_writer())',
      t.tbl || '_writer_delete', t.tbl);

    RAISE NOTICE 'S-04: split write policies on public.%', t.tbl;
  END LOOP;
END
$split$;

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────────
-- Rollback (Owner-gated, one block; inert until run). Restores the three Wave E
-- FOR ALL policies exactly as 20260712000004 created them.
--
--   BEGIN;
--   DO $$
--   DECLARE t record;
--   BEGIN
--     FOR t IN SELECT * FROM (VALUES
--         ('interview_availability_blocks', 'staff_all_availability_blocks'),
--         ('interview_slots',               'staff_all_interview_slots'),
--         ('interview_sessions',            'staff_all_interview_sessions')) AS v(tbl, old_policy)
--     LOOP
--       EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t.tbl || '_staff_select',  t.tbl);
--       EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t.tbl || '_writer_insert', t.tbl);
--       EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t.tbl || '_writer_update', t.tbl);
--       EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t.tbl || '_writer_delete', t.tbl);
--       EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (public.is_staff()) WITH CHECK (public.is_staff())',
--                      t.old_policy, t.tbl);
--     END LOOP;
--   END $$;
--   COMMIT;
-- ─────────────────────────────────────────────────────────────────────────────
